import {
  generateKeyPair,
  deriveSharedKey,
  encrypt,
  decrypt,
  type E2EKeyPair,
} from "@t3tools/shared/e2e-crypto";
import type {
  ClientToRelayMessage,
  RelayToClientMessage,
  RelaySessionInfo,
} from "@t3tools/relay/types";

export interface PairedDevice {
  deviceId: string;
  deviceName: string;
  online: boolean;
  sharedKey: CryptoKey;
  sessions: RelaySessionInfo[];
}

export interface RelayTransportConfig {
  relayUrl: string;
  deviceId: string;
  deviceName: string;
  pairingToken: string;
  /** Pre-existing E2E key pair (from appSettings). If not provided, a new one is generated. */
  existingKeyPair?: E2EKeyPair;
  onMessage?: (fromDeviceId: string, fromDeviceName: string, message: string) => void;
  onPairedDevicesChanged?: (devices: PairedDevice[]) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export class RelayTransport {
  private readonly config: RelayTransportConfig;
  private ws: WebSocket | null = null;
  private keyPair: E2EKeyPair | null = null;
  private pairedDevices = new Map<string, PairedDevice>();
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private registered = false;
  private pendingSessions: RelaySessionInfo[] = [];
  /** Per-device message handlers registered by RelayWsBridge instances. */
  private readonly deviceMessageHandlers = new Map<string, (plaintext: string) => void>();

  constructor(config: RelayTransportConfig) {
    this.config = config;
  }

  // --- Public API ---

  async connect(): Promise<void> {
    if (this.disposed) return;
    // Use existing key pair from appSettings (matches QR code) or generate a new one
    this.keyPair = this.config.existingKeyPair ?? (await generateKeyPair());
    this._openSocket();
  }

  async pairWithDevice(
    targetDeviceId: string,
    targetPairingToken: string,
    targetPublicKey: string,
    targetDeviceName: string,
  ): Promise<void> {
    if (!this.keyPair) throw new Error("RelayTransport not connected");

    // If we already have this device paired, skip
    if (this.pairedDevices.has(targetDeviceId)) return;

    // Pre-derive shared key if public key is available.
    // When pairing by Device ID + Token only (no public key), the key
    // will be derived from the pair-accepted response instead.
    if (targetPublicKey) {
      try {
        const sharedKey = await deriveSharedKey(this.keyPair.privateKey, targetPublicKey);
        this.pairedDevices.set(targetDeviceId, {
          deviceId: targetDeviceId,
          deviceName: targetDeviceName,
          online: false,
          sharedKey,
          sessions: [],
        });
        this._notifyPairedDevicesChanged();
      } catch {
        // Key derivation failed — will be handled by pair-accepted
      }
    }

    const msg: ClientToRelayMessage = {
      type: "pair-request",
      targetDeviceId,
      pairingToken: targetPairingToken,
      publicKey: this.keyPair.publicKey,
      deviceName: this.config.deviceName,
    };
    this._send(msg);
  }

  async sendToDevice(targetDeviceId: string, message: string): Promise<void> {
    const peer = this.pairedDevices.get(targetDeviceId);
    if (!peer) throw new Error(`Device ${targetDeviceId} is not paired`);

    console.log(`[RelayTransport] sendToDevice ${targetDeviceId.slice(0, 8)}...: ${message.slice(0, 120)}`);
    const encrypted = await encrypt(peer.sharedKey, message);
    const msg: ClientToRelayMessage = {
      type: "forward",
      targetDeviceId,
      encrypted,
    };
    this._send(msg);
  }

  private _updateSessionsTimer: ReturnType<typeof setTimeout> | null = null;

  updateSessions(sessions: RelaySessionInfo[]): void {
    this.pendingSessions = sessions;
    // Debounce re-registration to avoid spamming device-online events
    // (300ms is fast enough for near-instant updates but prevents flood)
    if (this._updateSessionsTimer) clearTimeout(this._updateSessionsTimer);
    this._updateSessionsTimer = setTimeout(() => {
      this._updateSessionsTimer = null;
      if (this.registered && this.ws?.readyState === WebSocket.OPEN && this.keyPair) {
        this._register();
      }
    }, 300);
  }

  queryDevices(): void {
    const msg: ClientToRelayMessage = { type: "query-devices" };
    this._send(msg);
  }

  getPublicKey(): string | null {
    return this.keyPair?.publicKey ?? null;
  }

  /**
   * Register a per-device message handler so that a RelayWsBridge can receive
   * decrypted messages from a specific remote device.  Replaces any existing
   * handler for that device.  Returns an unregister function.
   */
  registerMessageHandler(deviceId: string, handler: (plaintext: string) => void): () => void {
    this.deviceMessageHandlers.set(deviceId, handler);
    return () => {
      if (this.deviceMessageHandlers.get(deviceId) === handler) {
        this.deviceMessageHandlers.delete(deviceId);
      }
    };
  }

  getPairedDevices(): PairedDevice[] {
    return Array.from(this.pairedDevices.values());
  }

  dispose(): void {
    this.disposed = true;
    this._clearReconnectTimer();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  // --- Internal helpers ---

  private _openSocket(): void {
    if (this.disposed) return;

    const ws = new WebSocket(this.config.relayUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.registered = false;
      if (this.keyPair) {
        this._register();
      }
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: RelayToClientMessage;
      try {
        msg = JSON.parse(event.data) as RelayToClientMessage;
      } catch {
        return;
      }
      void this._handleMessage(msg);
    };

    ws.onclose = () => {
      this.registered = false;
      this.config.onDisconnected?.();
      if (!this.disposed) {
        this._scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose fires after onerror, so reconnect logic lives there
    };
  }

  private _register(): void {
    if (!this.keyPair) return;
    const msg: ClientToRelayMessage = {
      type: "register",
      deviceId: this.config.deviceId,
      deviceName: this.config.deviceName,
      pairingToken: this.config.pairingToken,
      publicKey: this.keyPair.publicKey,
      sessions: this.pendingSessions,
    };
    this._send(msg);
  }

  private _send(msg: ClientToRelayMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private async _handleMessage(msg: RelayToClientMessage): Promise<void> {
    switch (msg.type) {
      case "register-ack": {
        if (msg.success) {
          const wasAlreadyRegistered = this.registered;
          this.registered = true;
          if (!wasAlreadyRegistered) {
            this.config.onConnected?.();
          }
          this.queryDevices();
        }
        break;
      }

      case "forwarded": {
        const peer = this.pairedDevices.get(msg.fromDeviceId);
        if (!peer) {
          console.warn(
            `[RelayTransport] Forwarded message from UNKNOWN device ${msg.fromDeviceId} — not in pairedDevices:`,
            [...this.pairedDevices.keys()],
          );
          break;
        }
        try {
          const plaintext = await decrypt(peer.sharedKey, msg.encrypted);
          console.log(`[RelayTransport] Decrypted message from ${msg.fromDeviceId.slice(0, 8)}...: ${plaintext.slice(0, 120)}`);
          // Dispatch to the per-device handler registered by a RelayWsBridge, if any.
          const deviceHandler = this.deviceMessageHandlers.get(msg.fromDeviceId);
          if (deviceHandler) {
            console.log(`[RelayTransport] Dispatching to device handler for ${msg.fromDeviceId.slice(0, 8)}...`);
            deviceHandler(plaintext);
          } else {
            console.log(`[RelayTransport] No device handler for ${msg.fromDeviceId.slice(0, 8)}...`);
          }
          // Also call the global onMessage callback for any other consumers.
          this.config.onMessage?.(msg.fromDeviceId, msg.fromDeviceName, plaintext);
        } catch (err) {
          console.error(
            "[RelayTransport] Decryption failed for message from",
            msg.fromDeviceId,
            err,
          );
        }
        break;
      }

      case "device-list": {
        for (const device of msg.devices) {
          const existing = this.pairedDevices.get(device.deviceId);
          if (existing) {
            existing.online = device.online;
            existing.sessions = device.sessions;
          }
          // Devices not yet paired are not added here; pairing happens via pairWithDevice
        }
        this._notifyPairedDevicesChanged();
        break;
      }

      case "pair-accepted": {
        console.log(`[RelayTransport] pair-accepted from ${msg.deviceName} (${msg.deviceId})`);
        if (!this.keyPair) break;
        const sharedKey = await deriveSharedKey(this.keyPair.privateKey, msg.publicKey);
        const existing = this.pairedDevices.get(msg.deviceId);
        this.pairedDevices.set(msg.deviceId, {
          deviceId: msg.deviceId,
          deviceName: msg.deviceName,
          online: true,
          sharedKey,
          sessions: existing?.sessions ?? [],
        });
        this._notifyPairedDevicesChanged();
        break;
      }

      case "pair-rejected": {
        this.pairedDevices.delete(msg.deviceId);
        this._notifyPairedDevicesChanged();
        break;
      }

      case "device-online": {
        const peer = this.pairedDevices.get(msg.deviceId);
        if (peer) {
          peer.online = true;
          peer.sessions = msg.sessions;
          peer.deviceName = msg.deviceName;
          this._notifyPairedDevicesChanged();
        }
        break;
      }

      case "device-offline": {
        const peer = this.pairedDevices.get(msg.deviceId);
        if (peer) {
          peer.online = false;
          peer.sessions = [];
          this._notifyPairedDevicesChanged();
        }
        break;
      }

      case "error": {
        console.error("[RelayTransport] Server error:", msg.message);
        break;
      }
    }
  }

  private _scheduleReconnect(): void {
    this._clearReconnectTimer();
    const delay = Math.min(MIN_BACKOFF_MS * 2 ** this.reconnectAttempts, MAX_BACKOFF_MS);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      if (!this.disposed) {
        this._openSocket();
      }
    }, delay);
  }

  private _clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private _notifyPairedDevicesChanged(): void {
    this.config.onPairedDevicesChanged?.(this.getPairedDevices());
  }
}
