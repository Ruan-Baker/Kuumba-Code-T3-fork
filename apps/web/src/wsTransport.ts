import {
  type WsPush,
  type WsPushChannel,
  type WsPushMessage,
  WebSocketResponse,
  type WsResponse as WsResponseMessage,
  WsResponse as WsResponseSchema,
  type RemotePresenceState,
} from "@t3tools/contracts";
import { decodeUnknownJsonResult, formatSchemaError } from "@t3tools/shared/schemaJson";
import { Result, Schema } from "effect";

type PushListener<C extends WsPushChannel> = (message: WsPushMessage<C>) => void;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface SubscribeOptions {
  readonly replayLatest?: boolean;
}

export type TransportState = "connecting" | "open" | "reconnecting" | "closed" | "disposed";

export type TransportStateChangeListener = (
  newState: TransportState,
  prevState: TransportState,
) => void;

export type PresenceStateChangeListener = (
  newState: RemotePresenceState,
  prevState: RemotePresenceState,
) => void;

const REQUEST_TIMEOUT_MS = 60_000;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 10_000];

/** Server heartbeat interval expected from the server (2s) */
const HEARTBEAT_EXPECTED_INTERVAL_MS = 2_000;
/** Mark presence as degraded if no heartbeat/message for 6s */
const PRESENCE_DEGRADED_THRESHOLD_MS = 6_000;
/** Mark presence as offline if no heartbeat/message for 10s */
const PRESENCE_OFFLINE_THRESHOLD_MS = 10_000;
/** Check presence health at this interval */
const PRESENCE_CHECK_INTERVAL_MS = 1_000;

const decodeWsResponse = decodeUnknownJsonResult(WsResponseSchema);
const isWebSocketResponseEnvelope = Schema.is(WebSocketResponse);

const isWsPushMessage = (value: WsResponseMessage): value is WsPush =>
  "type" in value && value.type === "push";

interface WsRequestEnvelope {
  id: string;
  body: {
    _tag: string;
    [key: string]: unknown;
  };
}

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(fallback);
}

export class WsTransport {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, Set<(message: WsPush) => void>>();
  private readonly latestPushByChannel = new Map<string, WsPush>();
  private readonly outboundQueue: string[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private state: TransportState = "connecting";
  private readonly url: string;

  // ── Heartbeat / Presence ──────────────────────────────────────────
  private lastMessageReceivedAt = 0;
  private presenceState: RemotePresenceState = "connecting";
  private presenceCheckTimer: ReturnType<typeof setInterval> | null = null;

  // ── Sequence Tracking ─────────────────────────────────────────────
  private lastPushSequence = 0;
  private readonly lastSequenceByChannel = new Map<string, number>();

  // ── Listeners ─────────────────────────────────────────────────────
  private readonly stateChangeListeners = new Set<TransportStateChangeListener>();
  private readonly presenceChangeListeners = new Set<PresenceStateChangeListener>();

  constructor(url?: string) {
    const bridgeUrl = window.desktopBridge?.getWsUrl();
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    this.url =
      url ??
      (bridgeUrl && bridgeUrl.length > 0
        ? bridgeUrl
        : envUrl && envUrl.length > 0
          ? envUrl
          : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:${window.location.port}`);
    this.startPresenceMonitor();
    this.connect();
  }

  // ── Public API ────────────────────────────────────────────────────

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (typeof method !== "string" || method.length === 0) {
      throw new Error("Request method is required");
    }

    const id = String(this.nextId++);
    const body = params != null ? { ...params, _tag: method } : { _tag: method };
    const message: WsRequestEnvelope = { id, body };
    const encoded = JSON.stringify(message);

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

      this.send(encoded);
    });
  }

  subscribe<C extends WsPushChannel>(
    channel: C,
    listener: PushListener<C>,
    options?: SubscribeOptions,
  ): () => void {
    let channelListeners = this.listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set<(message: WsPush) => void>();
      this.listeners.set(channel, channelListeners);
    }

    const wrappedListener = (message: WsPush) => {
      listener(message as WsPushMessage<C>);
    };
    channelListeners.add(wrappedListener);

    if (options?.replayLatest) {
      const latest = this.latestPushByChannel.get(channel);
      if (latest) {
        wrappedListener(latest);
      }
    }

    return () => {
      channelListeners?.delete(wrappedListener);
      if (channelListeners?.size === 0) {
        this.listeners.delete(channel);
      }
    };
  }

  getLatestPush<C extends WsPushChannel>(channel: C): WsPushMessage<C> | null {
    const latest = this.latestPushByChannel.get(channel);
    return latest ? (latest as WsPushMessage<C>) : null;
  }

  getState(): TransportState {
    return this.state;
  }

  getPresenceState(): RemotePresenceState {
    return this.presenceState;
  }

  /** Last global push sequence number received from the server. */
  getLastPushSequence(): number {
    return this.lastPushSequence;
  }

  /** Last push sequence for a specific channel. Returns 0 if no push received yet. */
  getLastChannelSequence(channel: string): number {
    return this.lastSequenceByChannel.get(channel) ?? 0;
  }

  /** Register a callback fired whenever the transport state changes. */
  onStateChange(listener: TransportStateChangeListener): () => void {
    this.stateChangeListeners.add(listener);
    return () => {
      this.stateChangeListeners.delete(listener);
    };
  }

  /** Register a callback fired whenever the presence state changes. */
  onPresenceChange(listener: PresenceStateChangeListener): () => void {
    this.presenceChangeListeners.add(listener);
    return () => {
      this.presenceChangeListeners.delete(listener);
    };
  }

  dispose() {
    this.disposed = true;
    this.setTransportState("disposed");
    this.stopPresenceMonitor();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Transport disposed"));
    }
    this.pending.clear();
    this.outboundQueue.length = 0;
    this.ws?.close();
    this.ws = null;
  }

  // ── Private: Connection ───────────────────────────────────────────

  private connect() {
    if (this.disposed) {
      return;
    }

    const nextState: TransportState = this.reconnectAttempt > 0 ? "reconnecting" : "connecting";
    this.setTransportState(nextState);
    this.setPresenceState("connecting");
    const ws = new WebSocket(this.url);

    ws.addEventListener("open", () => {
      this.ws = ws;
      this.setTransportState("open");
      this.reconnectAttempt = 0;
      this.lastMessageReceivedAt = Date.now();
      this.setPresenceState("healthy");
      this.flushQueue();
    });

    ws.addEventListener("message", (event) => {
      this.lastMessageReceivedAt = Date.now();
      this.handleMessage(event.data);
    });

    ws.addEventListener("close", () => {
      if (this.ws === ws) {
        this.ws = null;
      }
      if (this.disposed) {
        this.setTransportState("disposed");
        return;
      }
      this.setTransportState("closed");
      this.setPresenceState("reconnecting");
      this.scheduleReconnect();
    });

    ws.addEventListener("error", (event) => {
      console.warn("WebSocket connection error", { type: event.type, url: this.url });
    });
  }

  // ── Private: Message Handling ─────────────────────────────────────

  private handleMessage(raw: unknown) {
    const result = decodeWsResponse(raw);
    if (Result.isFailure(result)) {
      console.warn("Dropped inbound WebSocket envelope", formatSchemaError(result.failure));
      return;
    }

    const message = result.success;
    if (isWsPushMessage(message)) {
      // Track sequences
      if (typeof message.sequence === "number") {
        this.lastPushSequence = Math.max(this.lastPushSequence, message.sequence);
        const prevChannelSeq = this.lastSequenceByChannel.get(message.channel) ?? 0;
        this.lastSequenceByChannel.set(message.channel, Math.max(prevChannelSeq, message.sequence));
      }

      // Update presence on any server.presence push
      if (message.channel === "server.presence") {
        this.setPresenceState("healthy");
      }

      this.latestPushByChannel.set(message.channel, message);
      const channelListeners = this.listeners.get(message.channel);
      if (channelListeners) {
        for (const listener of channelListeners) {
          try {
            listener(message);
          } catch {
            // Swallow listener errors
          }
        }
      }
      return;
    }

    if (!isWebSocketResponseEnvelope(message)) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }

    pending.resolve(message.result);
  }

  // ── Private: Send / Queue ─────────────────────────────────────────

  private send(encodedMessage: string) {
    if (this.disposed) {
      return;
    }

    this.outboundQueue.push(encodedMessage);
    try {
      this.flushQueue();
    } catch {
      // Swallow: flushQueue has queued the message for retry on reconnect
    }
  }

  private flushQueue() {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.outboundQueue.length > 0) {
      const message = this.outboundQueue.shift();
      if (!message) {
        continue;
      }
      try {
        this.ws.send(message);
      } catch (error) {
        this.outboundQueue.unshift(message);
        throw asError(error, "Failed to send WebSocket request.");
      }
    }
  }

  // ── Private: Reconnect ────────────────────────────────────────────

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer !== null) {
      return;
    }

    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)] ??
      RECONNECT_DELAYS_MS[0]!;

    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // ── Private: Presence Monitor ─────────────────────────────────────

  private startPresenceMonitor() {
    if (this.presenceCheckTimer !== null) return;
    this.presenceCheckTimer = setInterval(() => {
      this.evaluatePresence();
    }, PRESENCE_CHECK_INTERVAL_MS);
  }

  private stopPresenceMonitor() {
    if (this.presenceCheckTimer !== null) {
      clearInterval(this.presenceCheckTimer);
      this.presenceCheckTimer = null;
    }
  }

  private evaluatePresence() {
    if (this.disposed) {
      this.setPresenceState("offline");
      return;
    }

    // If we're not in an open state, presence is managed by connect/close handlers
    if (this.state !== "open") {
      return;
    }

    const elapsed = Date.now() - this.lastMessageReceivedAt;

    if (elapsed >= PRESENCE_OFFLINE_THRESHOLD_MS) {
      this.setPresenceState("offline");
    } else if (elapsed >= PRESENCE_DEGRADED_THRESHOLD_MS) {
      this.setPresenceState("degraded");
    } else {
      this.setPresenceState("healthy");
    }
  }

  // ── Private: State Change Notification ────────────────────────────

  private setTransportState(newState: TransportState) {
    const prev = this.state;
    if (prev === newState) return;
    this.state = newState;
    for (const listener of this.stateChangeListeners) {
      try {
        listener(newState, prev);
      } catch {
        // Swallow listener errors
      }
    }
  }

  private setPresenceState(newState: RemotePresenceState) {
    const prev = this.presenceState;
    if (prev === newState) return;
    this.presenceState = newState;
    for (const listener of this.presenceChangeListeners) {
      try {
        listener(newState, prev);
      } catch {
        // Swallow listener errors
      }
    }
  }
}
