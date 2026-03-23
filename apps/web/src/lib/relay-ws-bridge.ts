/**
 * relay-ws-bridge.ts
 *
 * Bridges a RelayTransport to the WsTransport interface so the rest of the
 * app can talk to a remote device through the relay exactly as if it were a
 * direct WebSocket connection.
 *
 * Flow (outbound):
 *   request(method, params)
 *     → serialise into WsRequestEnvelope { id, body: { _tag, ...params } }
 *     → relay.sendToDevice(targetDeviceId, JSON.stringify(envelope))
 *       (RelayTransport encrypts before sending)
 *
 * Flow (inbound):
 *   RelayTransport decrypts and calls onMessage(fromDeviceId, plaintext)
 *     → we only process messages whose fromDeviceId === targetDeviceId
 *     → parse plaintext as WsResponse (same schema WsTransport uses)
 *     → if push  → dispatch to channel subscribers / update latestPushByChannel
 *     → if reply → resolve/reject matching pending request
 */

import {
  type WsPush,
  type WsPushChannel,
  type WsPushMessage,
  WebSocketResponse,
  type WsResponse as WsResponseMessage,
  WsResponse as WsResponseSchema,
} from "@t3tools/contracts";
import { decodeUnknownJsonResult, formatSchemaError } from "@t3tools/shared/schemaJson";
import { Result, Schema } from "effect";

import type { RelayTransport } from "./relay-transport";

// ----- internal types (mirror WsTransport) ---------------------------------

type PushListener<C extends WsPushChannel> = (message: WsPushMessage<C>) => void;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface SubscribeOptions {
  readonly replayLatest?: boolean;
}

// ----- constants ------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 60_000;
const decodeWsResponse = decodeUnknownJsonResult(WsResponseSchema);
const isWebSocketResponseEnvelope = Schema.is(WebSocketResponse);

const isWsPushMessage = (value: WsResponseMessage): value is WsPush =>
  "type" in value && value.type === "push";

// ----- bridge class ---------------------------------------------------------

export class RelayWsBridge {
  private nextId = 1;
  private disposed = false;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, Set<(message: WsPush) => void>>();
  private readonly latestPushByChannel = new Map<string, WsPush>();

  /** Optional callback for custom push messages (composer.state-changed, etc.) */
  onCustomPush: ((channel: string, data: unknown) => void) | null = null;

  /**
   * @param relay          The connected RelayTransport instance.
   * @param targetDeviceId The remote device this bridge communicates with.
   */
  constructor(
    private readonly relay: RelayTransport,
    private readonly targetDeviceId: string,
  ) {
    // Register as a message consumer on the relay transport.
    // RelayTransport exposes onMessage via its config callback — to route
    // messages here we monkey-patch via the public injectMessage helper below.
    // Callers must wire relay's onMessage → this.handleRelayMessage.
  }

  /**
   * Called by external wiring whenever the relay delivers a decrypted message
   * from targetDeviceId.  Typically you pass this as part of the RelayTransport
   * config's onMessage callback:
   *
   *   onMessage: (fromId, _name, text) => {
   *     if (fromId === targetDeviceId) bridge.handleRelayMessage(text);
   *   }
   */
  handleRelayMessage(raw: string): void {
    if (this.disposed) return;
    this._handleMessage(raw);
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (typeof method !== "string" || method.length === 0) {
      throw new Error("Request method is required");
    }
    if (this.disposed) {
      throw new Error("RelayWsBridge disposed");
    }

    const id = String(this.nextId++);
    const body = params != null ? { ...params, _tag: method } : { _tag: method };
    const envelope = JSON.stringify({ id, body });

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

      // Fire-and-forget; errors surface through the pending reject above.
      this.relay.sendToDevice(this.targetDeviceId, envelope).catch((err: unknown) => {
        const pending = this.pending.get(id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(id);
          pending.reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
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

  dispose(): void {
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("RelayWsBridge disposed"));
    }
    this.pending.clear();
  }

  // ----- private helpers ----------------------------------------------------

  private _handleMessage(raw: string): void {
    // Handle custom push messages (composer.state-changed, notes.sync, etc.)
    // that don't match the strict WsResponse schema.
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.type === "push" && typeof parsed.channel === "string") {
        const fakePush = {
          type: "push" as const,
          channel: parsed.channel,
          data: parsed.data,
          sequence: 0,
        };
        this.latestPushByChannel.set(parsed.channel, fakePush as any);
        const channelListeners = this.listeners.get(parsed.channel);
        if (channelListeners) {
          for (const listener of channelListeners) {
            try {
              listener(fakePush as any);
            } catch {
              // Swallow listener errors
            }
          }
        }
        // Also dispatch to a generic handler if registered
        if (this.onCustomPush) {
          this.onCustomPush(parsed.channel, parsed.data);
        }
        return;
      }
    } catch {
      // Not valid JSON or not a push — fall through to schema decoding
    }

    const result = decodeWsResponse(raw);
    if (Result.isFailure(result)) {
      console.warn("[RelayWsBridge] Dropped inbound envelope", formatSchemaError(result.failure));
      return;
    }

    const message = result.success;

    if (isWsPushMessage(message)) {
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
}
