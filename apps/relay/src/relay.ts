import { WebSocket } from "ws";
import type { ClientToRelayMessage, RelayToClientMessage, RelaySessionInfo } from "./types.js";

interface RegisteredDevice {
  deviceId: string;
  deviceName: string;
  pairingToken: string;
  publicKey: string;
  sessions: RelaySessionInfo[];
  ws: WebSocket;
  pairedWith: Map<string, { deviceName: string; publicKey: string }>;
}

interface BufferedMessage {
  fromDeviceId: string;
  fromDeviceName: string;
  encrypted: { iv: string; data: string };
  timestamp: number;
}

export class Relay {
  private devices = new Map<string, RegisteredDevice>();
  private connectionAttempts = new Map<string, { count: number; resetAt: number }>();

  /**
   * Preserved pairings for disconnected devices.
   * When a device disconnects, its pairings are saved here so they can be
   * restored when the device reconnects (e.g. desktop app restart).
   * TTL: 1 hour (cleaned up periodically).
   */
  private savedPairings = new Map<
    string,
    { pairings: Map<string, { deviceName: string; publicKey: string }>; savedAt: number }
  >();
  private readonly PAIRING_TTL_MS = 60 * 60 * 1000; // 1 hour

  /** Per-device message buffer for when target is offline */
  private messageBuffer = new Map<string, BufferedMessage[]>();
  private readonly MAX_BUFFER_PER_DEVICE = 200;
  private readonly BUFFER_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private bufferCleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    // Periodically clean up expired buffered messages
    this.bufferCleanupTimer = setInterval(() => this.cleanupExpiredBuffers(), 60_000);
  }

  handleConnection(ws: WebSocket, ip: string): void {
    if (!this.checkRateLimit(ip)) {
      this.send(ws, { type: "error", message: "Rate limited. Try again later." });
      ws.close(4029, "Rate limited");
      return;
    }

    let registeredDeviceId: string | null = null;

    ws.on("message", (raw) => {
      let msg: ClientToRelayMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientToRelayMessage;
      } catch {
        this.send(ws, { type: "error", message: "Invalid JSON" });
        return;
      }

      console.log(`[relay] Received: ${msg.type} from ${registeredDeviceId ?? "unregistered"}`);

      switch (msg.type) {
        case "register":
          registeredDeviceId = this.handleRegister(ws, msg);
          break;
        case "forward":
          if (registeredDeviceId) this.handleForward(registeredDeviceId, msg);
          else console.log("[relay] Rejected forward: device not registered");
          break;
        case "query-devices":
          if (registeredDeviceId) this.handleQueryDevices(registeredDeviceId);
          else console.log("[relay] Rejected query-devices: device not registered");
          break;
        case "pair-request":
          if (registeredDeviceId) this.handlePairRequest(registeredDeviceId, msg);
          else
            console.log(
              "[relay] Rejected pair-request: device not registered — must register first",
            );
          break;
        default:
          this.send(ws, { type: "error", message: "Unknown message type" });
      }
    });

    ws.on("close", () => {
      if (registeredDeviceId) this.handleDisconnect(registeredDeviceId);
    });

    ws.on("error", () => {
      if (registeredDeviceId) this.handleDisconnect(registeredDeviceId);
    });
  }

  private handleRegister(
    ws: WebSocket,
    msg: Extract<ClientToRelayMessage, { type: "register" }>,
  ): string {
    if (!msg.deviceId || !msg.pairingToken || !msg.publicKey) {
      this.send(ws, { type: "error", message: "Missing required fields" });
      return "";
    }

    const existing = this.devices.get(msg.deviceId);
    if (existing && existing.ws !== ws) {
      // A genuinely new connection replacing a stale one
      existing.ws.close(4000, "Replaced by new connection");
    } else if (existing && existing.ws === ws) {
      // Same connection re-registering (e.g. to update sessions) — just update in place
      existing.deviceName = msg.deviceName;
      existing.pairingToken = msg.pairingToken;
      existing.publicKey = msg.publicKey;
      existing.sessions = msg.sessions ?? [];
      this.send(ws, { type: "register-ack", success: true });

      // Notify paired devices of updated sessions
      for (const [pairedId] of existing.pairedWith) {
        const paired = this.devices.get(pairedId);
        if (paired) {
          this.send(paired.ws, {
            type: "device-online",
            deviceId: existing.deviceId,
            deviceName: existing.deviceName,
            sessions: existing.sessions,
          });
        }
      }

      console.log(
        `[relay] Device re-registered (session update): ${msg.deviceName} (${msg.deviceId.slice(0, 8)}...)`,
      );

      // Drain any messages buffered while this device was offline
      this.drainBuffer(msg.deviceId);

      return msg.deviceId;
    }

    // Restore pairings: from existing entry, or from saved pairings (after disconnect)
    let restoredPairings = existing?.pairedWith ?? new Map<string, { deviceName: string; publicKey: string }>();
    if (restoredPairings.size === 0) {
      const saved = this.savedPairings.get(msg.deviceId);
      if (saved && Date.now() - saved.savedAt < this.PAIRING_TTL_MS) {
        restoredPairings = saved.pairings;
        console.log(
          `[relay] Restored ${restoredPairings.size} saved pairing(s) for ${msg.deviceName} (${msg.deviceId.slice(0, 8)}...)`,
        );
      }
      this.savedPairings.delete(msg.deviceId);
    }

    const device: RegisteredDevice = {
      deviceId: msg.deviceId,
      deviceName: msg.deviceName,
      pairingToken: msg.pairingToken,
      publicKey: msg.publicKey,
      sessions: msg.sessions ?? [],
      ws,
      pairedWith: restoredPairings,
    };

    this.devices.set(msg.deviceId, device);
    this.send(ws, { type: "register-ack", success: true });

    // Notify all paired devices that this device is back online
    for (const [pairedId] of device.pairedWith) {
      const paired = this.devices.get(pairedId);
      if (paired) {
        this.send(paired.ws, {
          type: "device-online",
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          sessions: device.sessions,
        });
        // Also re-add this device to the paired device's pairedWith (bidirectional)
        if (!paired.pairedWith.has(device.deviceId)) {
          paired.pairedWith.set(device.deviceId, {
            deviceName: device.deviceName,
            publicKey: device.publicKey,
          });
        }
      }
    }

    console.log(`[relay] Device registered: ${msg.deviceName} (${msg.deviceId.slice(0, 8)}...)`);

    // Drain any messages buffered while this device was offline
    this.drainBuffer(msg.deviceId);

    return msg.deviceId;
  }

  private handleForward(
    fromDeviceId: string,
    msg: Extract<ClientToRelayMessage, { type: "forward" }>,
  ): void {
    const sender = this.devices.get(fromDeviceId);
    const target = this.devices.get(msg.targetDeviceId);

    if (!sender) return;

    if (!sender.pairedWith.has(msg.targetDeviceId)) {
      this.send(sender.ws, { type: "error", message: "Not paired with target device" });
      return;
    }

    if (!target) {
      // Buffer the message for when the device comes back online
      this.bufferMessage(msg.targetDeviceId, fromDeviceId, sender.deviceName, msg.encrypted);
      console.log(`[relay] Buffered message for offline device ${msg.targetDeviceId.slice(0, 8)}...`);
      return;
    }

    this.send(target.ws, {
      type: "forwarded",
      fromDeviceId,
      fromDeviceName: sender.deviceName,
      encrypted: msg.encrypted,
    });
  }

  private handleQueryDevices(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (!device) return;

    const devices = Array.from(device.pairedWith.entries()).map(([pairedId, info]) => {
      const paired = this.devices.get(pairedId);
      return {
        deviceId: pairedId,
        deviceName: info.deviceName,
        online: paired !== undefined,
        sessions: paired?.sessions ?? [],
      };
    });

    this.send(device.ws, { type: "device-list", devices });
  }

  private handlePairRequest(
    fromDeviceId: string,
    msg: Extract<ClientToRelayMessage, { type: "pair-request" }>,
  ): void {
    const requester = this.devices.get(fromDeviceId);
    const target = this.devices.get(msg.targetDeviceId);

    if (!requester) return;

    if (!target) {
      this.send(requester.ws, {
        type: "pair-rejected",
        deviceId: msg.targetDeviceId,
        reason: "Device not found or offline",
      });
      return;
    }

    if (msg.pairingToken !== target.pairingToken) {
      this.send(requester.ws, {
        type: "pair-rejected",
        deviceId: msg.targetDeviceId,
        reason: "Invalid pairing token",
      });
      return;
    }

    requester.pairedWith.set(target.deviceId, {
      deviceName: target.deviceName,
      publicKey: target.publicKey,
    });
    target.pairedWith.set(requester.deviceId, {
      deviceName: requester.deviceName,
      publicKey: msg.publicKey,
    });

    this.send(requester.ws, {
      type: "pair-accepted",
      deviceId: target.deviceId,
      deviceName: target.deviceName,
      publicKey: target.publicKey,
    });

    this.send(target.ws, {
      type: "pair-accepted",
      deviceId: requester.deviceId,
      deviceName: requester.deviceName,
      publicKey: msg.publicKey,
    });

    console.log(`[relay] Paired: ${requester.deviceName} <-> ${target.deviceName}`);
  }

  private handleDisconnect(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (!device) return;

    // Save pairings so they survive reconnection (e.g. desktop app restart)
    if (device.pairedWith.size > 0) {
      this.savedPairings.set(deviceId, {
        pairings: new Map(device.pairedWith),
        savedAt: Date.now(),
      });
      console.log(
        `[relay] Saved ${device.pairedWith.size} pairing(s) for ${device.deviceName} (${deviceId.slice(0, 8)}...)`,
      );
    }

    // Notify paired devices that this device went offline
    for (const [pairedId] of device.pairedWith) {
      const paired = this.devices.get(pairedId);
      if (paired) {
        this.send(paired.ws, { type: "device-offline", deviceId });
      }
    }

    this.devices.delete(deviceId);
    console.log(`[relay] Device disconnected: ${device.deviceName}`);
  }

  private send(ws: WebSocket, msg: RelayToClientMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.connectionAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
      this.connectionAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    entry.count++;
    return entry.count <= 20;
  }

  getStats(): { devices: number; pairings: number } {
    let pairings = 0;
    for (const device of this.devices.values()) {
      pairings += device.pairedWith.size;
    }
    return { devices: this.devices.size, pairings: pairings / 2 };
  }

  // --- Message buffering for offline devices ---

  private bufferMessage(
    targetDeviceId: string,
    fromDeviceId: string,
    fromDeviceName: string,
    encrypted: { iv: string; data: string },
  ): void {
    let buffer = this.messageBuffer.get(targetDeviceId);
    if (!buffer) {
      buffer = [];
      this.messageBuffer.set(targetDeviceId, buffer);
    }
    // Enforce per-device buffer limit (drop oldest when full)
    if (buffer.length >= this.MAX_BUFFER_PER_DEVICE) {
      buffer.shift();
    }
    buffer.push({ fromDeviceId, fromDeviceName, encrypted, timestamp: Date.now() });
  }

  private drainBuffer(deviceId: string): void {
    const buffer = this.messageBuffer.get(deviceId);
    if (!buffer || buffer.length === 0) return;

    const device = this.devices.get(deviceId);
    if (!device) return;

    const now = Date.now();
    let sent = 0;
    for (const msg of buffer) {
      // Skip expired messages
      if (now - msg.timestamp > this.BUFFER_TTL_MS) continue;
      this.send(device.ws, {
        type: "forwarded",
        fromDeviceId: msg.fromDeviceId,
        fromDeviceName: msg.fromDeviceName,
        encrypted: msg.encrypted,
      });
      sent++;
    }

    this.messageBuffer.delete(deviceId);
    if (sent > 0) {
      console.log(`[relay] Drained ${sent} buffered messages to device ${deviceId.slice(0, 8)}...`);
    }
  }

  private cleanupExpiredBuffers(): void {
    const now = Date.now();
    for (const [deviceId, buffer] of this.messageBuffer) {
      const fresh = buffer.filter((m) => now - m.timestamp < this.BUFFER_TTL_MS);
      if (fresh.length === 0) {
        this.messageBuffer.delete(deviceId);
      } else {
        this.messageBuffer.set(deviceId, fresh);
      }
    }
    // Also clean up expired saved pairings
    for (const [deviceId, saved] of this.savedPairings) {
      if (now - saved.savedAt > this.PAIRING_TTL_MS) {
        this.savedPairings.delete(deviceId);
      }
    }
  }
}
