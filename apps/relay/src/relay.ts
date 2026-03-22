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

export class Relay {
  private devices = new Map<string, RegisteredDevice>();
  private connectionAttempts = new Map<string, { count: number; resetAt: number }>();

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
      return msg.deviceId;
    }

    const existingPairings = existing?.pairedWith ?? new Map();

    const device: RegisteredDevice = {
      deviceId: msg.deviceId,
      deviceName: msg.deviceName,
      pairingToken: msg.pairingToken,
      publicKey: msg.publicKey,
      sessions: msg.sessions ?? [],
      ws,
      pairedWith: existingPairings,
    };

    this.devices.set(msg.deviceId, device);
    this.send(ws, { type: "register-ack", success: true });

    for (const [pairedId] of device.pairedWith) {
      const paired = this.devices.get(pairedId);
      if (paired) {
        this.send(paired.ws, {
          type: "device-online",
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          sessions: device.sessions,
        });
      }
    }

    console.log(`[relay] Device registered: ${msg.deviceName} (${msg.deviceId.slice(0, 8)}...)`);
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
      this.send(sender.ws, { type: "error", message: "Target device is offline" });
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
}
