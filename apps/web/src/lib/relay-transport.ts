import { generateKeyPair, deriveSharedKey, encrypt, decrypt, type E2EKeyPair } from "@t3tools/shared/e2e-crypto";
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
    this.keyPair = await generateKeyPair();
    this._openSocket();
  }

  async pairWithDevice(
    targetDeviceId: string,
    targetPairingToken: string,
    targetPublicKey: string,
    targetDeviceName: string,
  ): Promise<void> {
    if (!this.keyPair) throw new Error("RelayTransport not connected");

    // Derive shared key immediately so we're ready to decrypt their first message
    const sharedKey = await deriveSharedKey(this.keyPair.privateKey, targetPublicKey);
    this.pairedDevices.set(targetDeviceId, {
      deviceId: targetDeviceId,
      deviceName: targetDeviceName,
      online: false,
      sharedKey,
      sessions: [],
    });
    this._notifyPairedDevicesChanged();

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

    const encrypted = await encrypt(peer.sharedKey, message);
    const msg: ClientToRelayMessage = {
      type: "forward",
      targetDeviceId,
      encrypted,
    };
    this._send(msg);
  }

  updateSessions(sessions: RelaySessionInfo[]): void {
    this.pendingSessions = sessions;
    // If already connected and registered, re-register with updated sessions
    if (this.registered && this.ws?.readyState === WebSocket.OPEN && this.keyPair) {
      this._register();
    }
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
          this.registered = true;
          this.config.onConnected?.();
          this.queryDevices();
        }
        break;
      }

      case "forwarded": {
        const peer = this.pairedDevices.get(msg.fromDeviceId);
        if (!peer) break;
        try {
          const plaintext = await decrypt(peer.sharedKey, msg.encrypted);
          // Dispatch to the per-device handler registered by a RelayWsBridge, if any.
          const deviceHandler = this.deviceMessageHandlers.get(msg.fromDeviceId);
          if (deviceHandler) {
            deviceHandler(plaintext);
          }
          // Also call the global onMessage callback for any other consumers.
          this.config.onMessage?.(msg.fromDeviceId, msg.fromDeviceName, plaintext);
        } catch {
          // Decryption failure — ignore malformed/tampered messages
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
