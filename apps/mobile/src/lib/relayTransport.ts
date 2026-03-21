/**
 * Relay transport for mobile — connects to the Kuumba relay server,
 * handles E2E encryption, and exposes the same request/subscribe API
 * as WsTransport so the rest of the app works transparently.
 */
import {
  generateKeyPair,
  deriveSharedKey,
  encrypt,
  decrypt,
  type E2EKeyPair,
  type SharedKey,
} from "./voice/e2e-crypto-polyfill";
import type { WsPushChannel, WsPushMessage } from "@t3tools/contracts";
import type { TransportState } from "./wsTransport";

// --- Persisted mobile identity ---

const MOBILE_ID_KEY = "kuumba-mobile-device-id";
const MOBILE_TOKEN_KEY = "kuumba-mobile-pairing-token";
const MOBILE_KEYPAIR_KEY = "kuumba-mobile-keypair";

function getOrCreateMobileId(): string {
  let id = localStorage.getItem(MOBILE_ID_KEY);
  if (!id) {
    id = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem(MOBILE_ID_KEY, id);
  }
  return id;
}

function getOrCreateMobileToken(): string {
  let token = localStorage.getItem(MOBILE_TOKEN_KEY);
  if (!token) {
    token = `mt-${Date.now()}-${Math.random().toString(36).slice(2, 15)}`;
    localStorage.setItem(MOBILE_TOKEN_KEY, token);
  }
  return token;
}

async function getOrCreateKeyPair(): Promise<E2EKeyPair> {
  const stored = localStorage.getItem(MOBILE_KEYPAIR_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as E2EKeyPair;
    } catch {
      // Corrupted, regenerate
    }
  }
  const kp = await generateKeyPair();
  localStorage.setItem(MOBILE_KEYPAIR_KEY, JSON.stringify(kp));
  return kp;
}

// --- Types ---

interface RelaySessionInfo {
  threadId: string;
  projectId: string;
  projectName: string;
  projectCwd: string;
  status: string;
  title: string;
}

interface PairedDevice {
  deviceId: string;
  deviceName: string;
  online: boolean;
  sharedKey: SharedKey;
  sessions: RelaySessionInfo[];
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

type PushListener = (message: { channel: string; data: unknown }) => void;

const REQUEST_TIMEOUT_MS = 60_000;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export interface RelayConfig {
  relayUrl: string;
  deviceName: string;
  targetDeviceId: string;
  targetPairingToken: string;
  targetPublicKey: string;
  targetDeviceName: string;
  onDevicesChanged?: ((devices: PairedDevice[]) => void) | undefined;
  onConnected?: (() => void) | undefined;
  onDisconnected?: (() => void) | undefined;
}

export class RelayTransport {
  private ws: WebSocket | null = null;
  private keyPair: E2EKeyPair | null = null;
  private readonly mobileDeviceId: string;
  private readonly mobilePairingToken: string;
  private readonly config: RelayConfig;
  private readonly pairedDevices = new Map<string, PairedDevice>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, Set<PushListener>>();
  private nextId = 1;
  private disposed = false;
  private registered = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private state: TransportState = "connecting";

  constructor(config: RelayConfig) {
    this.config = config;
    this.mobileDeviceId = getOrCreateMobileId();
    this.mobilePairingToken = getOrCreateMobileToken();
  }

  async connect(): Promise<void> {
    if (this.disposed) return;
    try {
      this.keyPair = await getOrCreateKeyPair();
    } catch (err) {
      console.error("[Relay] Key generation failed (requires secure context):", err);
      this.state = "closed";
      return;
    }
    console.log("[Relay] Connecting to", this.config.relayUrl, "as", this.mobileDeviceId);
    this.openSocket();
  }

  getState(): TransportState {
    return this.state;
  }

  getPairedDevices(): PairedDevice[] {
    return Array.from(this.pairedDevices.values());
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const targetDevice = this.pairedDevices.get(this.config.targetDeviceId);
    if (!targetDevice) {
      console.error("[Relay] request() — not paired with", this.config.targetDeviceId, "paired devices:", [...this.pairedDevices.keys()]);
      throw new Error("Not paired with target device");
    }

    const id = String(this.nextId++);
    const body = params != null ? { ...params, _tag: method } : { _tag: method };
    const plaintext = JSON.stringify({ id, body });

    console.log("[Relay] → Sending request", id, method);
    const encrypted = await encrypt(targetDevice.sharedKey, plaintext);
    this.sendRaw({
      type: "forward",
      targetDeviceId: this.config.targetDeviceId,
      encrypted,
    });

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });
    });
  }

  subscribe<C extends WsPushChannel>(
    channel: C,
    listener: (message: WsPushMessage<C>) => void,
  ): () => void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set<PushListener>();
      this.listeners.set(channel, set);
    }
    const wrapped: PushListener = (msg) => listener(msg as WsPushMessage<C>);
    set.add(wrapped);
    return () => {
      set?.delete(wrapped);
      if (set?.size === 0) this.listeners.delete(channel);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.state = "disposed";
    this.clearReconnectTimer();
    for (const p of this.pending.values()) {
      clearTimeout(p.timeout);
      p.reject(new Error("Transport disposed"));
    }
    this.pending.clear();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  // --- Internal ---

  private openSocket(): void {
    if (this.disposed) return;
    this.state = this.reconnectAttempts > 0 ? "reconnecting" : "connecting";

    const ws = new WebSocket(this.config.relayUrl);
    this.ws = ws;

    ws.onopen = () => {
      console.log("[Relay] WebSocket open — sending register");
      this.reconnectAttempts = 0;
      this.registered = false;
      // Step 1: Register mobile identity FIRST
      this.sendRegister();
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      void this.handleMessage(msg);
    };

    ws.onclose = (e) => {
      console.log("[Relay] WebSocket closed:", e.code, e.reason);
      this.registered = false;
      this.state = "closed";
      this.config.onDisconnected?.();
      if (!this.disposed) this.scheduleReconnect();
    };

    ws.onerror = (e) => {
      console.error("[Relay] WebSocket error:", e);
    };
  }

  /** Step 1: Register mobile's own identity with the relay. */
  private sendRegister(): void {
    if (!this.keyPair) return;
    this.sendRaw({
      type: "register",
      deviceId: this.mobileDeviceId,
      deviceName: this.config.deviceName,
      pairingToken: this.mobilePairingToken,
      publicKey: this.keyPair.publicKey,
      sessions: [],
    });
  }

  /** Step 2: After register-ack, pair with the target desktop. */
  private sendPairRequest(): void {
    if (!this.keyPair) return;
    console.log("[Relay] Sending pair-request to", this.config.targetDeviceId);
    this.sendRaw({
      type: "pair-request",
      targetDeviceId: this.config.targetDeviceId,
      pairingToken: this.config.targetPairingToken,
      publicKey: this.keyPair.publicKey,
      deviceName: this.config.deviceName,
    });
  }

  private sendRaw(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (msg.type === "forward") {
        console.log("[Relay] → Forward to", (msg as { targetDeviceId: string }).targetDeviceId);
      }
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn("[Relay] sendRaw: WebSocket not open, state=", this.ws?.readyState);
    }
  }

  private async handleMessage(msg: Record<string, unknown>): Promise<void> {
    console.log("[Relay] ←", msg.type);

    switch (msg.type) {
      // Step 1 response: registered successfully
      case "register-ack": {
        const ack = msg as { success: boolean };
        if (ack.success) {
          console.log("[Relay] Registered — now pairing with desktop");
          this.registered = true;
          this.state = "open";
          // Step 2: NOW pair with the target desktop
          this.sendPairRequest();
          this.config.onConnected?.();
        } else {
          console.error("[Relay] Registration failed");
        }
        break;
      }

      // Step 2 response: desktop accepted our pairing
      case "pair-accepted": {
        const m = msg as { deviceId: string; deviceName: string; publicKey: string };
        console.log("[Relay] Paired with", m.deviceName);
        if (!this.keyPair) break;
        const sharedKey = await deriveSharedKey(this.keyPair.privateKey, m.publicKey);
        const existing = this.pairedDevices.get(m.deviceId);
        this.pairedDevices.set(m.deviceId, {
          deviceId: m.deviceId,
          deviceName: m.deviceName,
          online: true,
          sharedKey,
          sessions: existing?.sessions ?? [],
        });
        this.notifyDevicesChanged();
        // Step 3: Query device status to get sessions
        this.sendRaw({ type: "query-devices" });
        break;
      }

      case "pair-rejected": {
        const m = msg as { deviceId: string; reason: string };
        console.warn("[Relay] Pair rejected:", m.reason);
        this.pairedDevices.delete(m.deviceId);
        this.notifyDevicesChanged();
        break;
      }

      // Encrypted message from desktop (RPC response or push event)
      case "forwarded": {
        const m = msg as { fromDeviceId: string; encrypted: { iv: string; data: string } };
        const peer = this.pairedDevices.get(m.fromDeviceId);
        if (!peer) break;
        try {
          const plaintext = await decrypt(peer.sharedKey, m.encrypted);
          this.handleDecryptedMessage(plaintext);
        } catch (err) {
          console.warn("[Relay] Decryption failed:", err);
        }
        break;
      }

      // Device status updates
      case "device-list": {
        const m = msg as { devices: Array<{ deviceId: string; deviceName: string; online: boolean; sessions: RelaySessionInfo[] }> };
        console.log("[Relay] Device list:", m.devices.length, "devices", JSON.stringify(m.devices.map(d => ({ id: d.deviceId, name: d.deviceName, online: d.online, sessions: d.sessions }))));
        for (const device of m.devices) {
          const existing = this.pairedDevices.get(device.deviceId);
          if (existing) {
            existing.online = device.online;
            existing.sessions = device.sessions;
            existing.deviceName = device.deviceName;
          }
        }
        this.notifyDevicesChanged();
        break;
      }

      case "device-online": {
        const m = msg as { deviceId: string; deviceName: string; sessions: RelaySessionInfo[] };
        console.log("[Relay] Device online:", m.deviceName);
        const peer = this.pairedDevices.get(m.deviceId);
        if (peer) {
          peer.online = true;
          peer.sessions = m.sessions;
          peer.deviceName = m.deviceName;
          this.notifyDevicesChanged();
        }
        break;
      }

      case "device-offline": {
        const m = msg as { deviceId: string };
        console.log("[Relay] Device offline:", m.deviceId);
        const peer = this.pairedDevices.get(m.deviceId);
        if (peer) {
          peer.online = false;
          peer.sessions = [];
          this.notifyDevicesChanged();
        }
        break;
      }

      case "error": {
        console.error("[Relay] Server error:", (msg as { message: string }).message);
        break;
      }
    }
  }

  private handleDecryptedMessage(plaintext: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(plaintext) as Record<string, unknown>;
    } catch {
      console.warn("[Relay] Failed to parse decrypted message");
      return;
    }

    console.log("[Relay] ← Decrypted message:", parsed.id ? `response id=${parsed.id}` : `type=${parsed.type}`);

    // RPC response (has id field)
    if (typeof parsed.id === "string") {
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        console.warn("[Relay] No pending request for id", parsed.id);
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(parsed.id);
      if (parsed.error && typeof parsed.error === "object" && parsed.error !== null) {
        pending.reject(new Error((parsed.error as { message?: string }).message ?? "Request failed"));
      } else {
        pending.resolve(parsed.result);
      }
      return;
    }

    // Push message (has type: "push" and channel)
    if (parsed.type === "push" && typeof parsed.channel === "string") {
      const channelListeners = this.listeners.get(parsed.channel);
      if (channelListeners) {
        for (const listener of channelListeners) {
          try {
            listener({ channel: parsed.channel, data: parsed.data });
          } catch {
            // Swallow
          }
        }
      }
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = Math.min(MIN_BACKOFF_MS * 2 ** this.reconnectAttempts, MAX_BACKOFF_MS);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      if (!this.disposed) this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private notifyDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  private notifyDevicesChanged(): void {
    // Debounce — the desktop spams device-online events
    if (this.notifyDebounceTimer) clearTimeout(this.notifyDebounceTimer);
    this.notifyDebounceTimer = setTimeout(() => {
      this.notifyDebounceTimer = null;
      const devices = this.getPairedDevices();
      console.log("[Relay] Devices changed:", devices.map((d) => `${d.deviceName}(${d.online ? "online" : "offline"}, ${d.sessions.length} sessions)`));
      this.config.onDevicesChanged?.(devices);
    }, 300);
  }
}
