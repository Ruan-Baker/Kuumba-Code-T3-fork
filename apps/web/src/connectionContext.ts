/**
 * ConnectionContext - Reactive store for the active connection target.
 *
 * Replaces the module-level mutable NativeApi switching with a reactive
 * Zustand store that owns:
 * - current connection mode (local vs remote)
 * - transport instance
 * - presence state
 * - sequence cursors for recovery
 * - connected device info
 *
 * All consumers read the active API/transport from this reactive state,
 * not from a module-level mutable global.
 */
import { create } from "zustand";
import type { NativeApi, RemotePresenceState } from "@t3tools/contracts";
import type { WsTransport } from "./wsTransport";
import type { RemoteDeviceConfig } from "./appSettings";

// ── Types ────────────────────────────────────────────────────────────

export type ConnectionMode = "local" | "remote";

export type RecoveryState = "idle" | "replaying" | "snapshot" | "failed";

export interface SequenceCursors {
  /** Last orchestration event sequence received. */
  readonly lastOrchestrationSequence: number;
  /** Last terminal event sequence per terminal key. */
  readonly lastTerminalSequenceByKey: Record<string, number>;
  /** Last global push sequence. */
  readonly lastPushSequence: number;
}

export interface ConnectionContextState {
  /** Whether the connection is local or remote. */
  mode: ConnectionMode;
  /** The current NativeApi instance (local or remote). */
  api: NativeApi | null;
  /** The WsTransport instance backing the current API (if WebSocket-based). */
  transport: WsTransport | null;
  /** Heartbeat-based presence state for the current connection. */
  presence: RemotePresenceState;
  /** Sequence cursors for reconnect/recovery. */
  cursors: SequenceCursors;
  /** Recovery state during reconnect catch-up. */
  recoveryState: RecoveryState;
  /** Connected remote device config (null when local). */
  remoteDevice: RemoteDeviceConfig | null;
  /** Connected remote device name (null when local). */
  remoteDeviceName: string | null;
  /** Unique instance ID for this client session. Used for command deduplication. */
  clientInstanceId: string;
}

interface ConnectionContextActions {
  /** Set the local connection (default mode). */
  setLocal: (api: NativeApi, transport: WsTransport) => void;

  /** Switch to a remote connection. Disposes the previous remote transport if any. */
  setRemote: (
    api: NativeApi,
    transport: WsTransport,
    device: RemoteDeviceConfig,
    deviceName: string,
  ) => void;

  /** Reset back to local mode. Disposes the remote transport. */
  resetToLocal: () => void;

  /** Update the presence state. */
  setPresence: (presence: RemotePresenceState) => void;

  /** Update sequence cursors from current transport. */
  syncCursors: () => void;

  /** Update the recovery state. */
  setRecoveryState: (state: RecoveryState) => void;

  /** Get the current API, throwing if not available. */
  ensureApi: () => NativeApi;
}

// ── Store ────────────────────────────────────────────────────────────

function generateClientInstanceId(): string {
  return `cli_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const INITIAL_CURSORS: SequenceCursors = {
  lastOrchestrationSequence: 0,
  lastTerminalSequenceByKey: {},
  lastPushSequence: 0,
};

export const useConnectionContext = create<ConnectionContextState & ConnectionContextActions>(
  (set, get) => {
    // Track the active remote transport for cleanup
    let activeRemoteTransport: WsTransport | null = null;
    // Track presence/state unsubscribers
    let presenceUnsub: (() => void) | null = null;
    let stateUnsub: (() => void) | null = null;

    function cleanupRemoteTransport() {
      if (presenceUnsub) {
        presenceUnsub();
        presenceUnsub = null;
      }
      if (stateUnsub) {
        stateUnsub();
        stateUnsub = null;
      }
      if (activeRemoteTransport) {
        activeRemoteTransport.dispose();
        activeRemoteTransport = null;
      }
    }

    function bindTransportListeners(transport: WsTransport) {
      presenceUnsub = transport.onPresenceChange((newPresence) => {
        set({ presence: newPresence });
      });
      stateUnsub = transport.onStateChange((newState) => {
        if (newState === "closed" || newState === "reconnecting") {
          set({ presence: "reconnecting" });
        }
      });
    }

    return {
      mode: "local",
      api: null,
      transport: null,
      presence: "connecting",
      cursors: { ...INITIAL_CURSORS },
      recoveryState: "idle",
      remoteDevice: null,
      remoteDeviceName: null,
      clientInstanceId: generateClientInstanceId(),

      setLocal: (api, transport) => {
        cleanupRemoteTransport();
        set({
          mode: "local",
          api,
          transport,
          presence: "healthy",
          cursors: { ...INITIAL_CURSORS },
          recoveryState: "idle",
          remoteDevice: null,
          remoteDeviceName: null,
        });
      },

      setRemote: (api, transport, device, deviceName) => {
        cleanupRemoteTransport();
        activeRemoteTransport = transport;
        bindTransportListeners(transport);
        set({
          mode: "remote",
          api,
          transport,
          presence: transport.getPresenceState(),
          cursors: {
            lastOrchestrationSequence: 0,
            lastTerminalSequenceByKey: {},
            lastPushSequence: 0,
          },
          recoveryState: "idle",
          remoteDevice: device,
          remoteDeviceName: deviceName,
        });
      },

      resetToLocal: () => {
        cleanupRemoteTransport();
        const current = get();
        // Keep the local API/transport that was set earlier
        if (current.mode === "local") return;
        set({
          mode: "local",
          presence: "healthy",
          cursors: { ...INITIAL_CURSORS },
          recoveryState: "idle",
          remoteDevice: null,
          remoteDeviceName: null,
          // api and transport will remain as the local ones set via setLocal
        });
      },

      setPresence: (presence) => set({ presence }),

      syncCursors: () => {
        const { transport } = get();
        if (!transport) return;
        set({
          cursors: {
            lastOrchestrationSequence: transport.getLastChannelSequence(
              "orchestration.domainEvent",
            ),
            lastTerminalSequenceByKey: {}, // Terminal sequences tracked separately
            lastPushSequence: transport.getLastPushSequence(),
          },
        });
      },

      setRecoveryState: (recoveryState) => set({ recoveryState }),

      ensureApi: () => {
        const { api } = get();
        if (!api) throw new Error("No active API connection");
        return api;
      },
    };
  },
);

// ── Selectors (for performance-sensitive consumers) ─────────────────

export const selectIsRemote = (state: ConnectionContextState) => state.mode === "remote";
export const selectPresence = (state: ConnectionContextState) => state.presence;
export const selectRecoveryState = (state: ConnectionContextState) => state.recoveryState;
export const selectRemoteDeviceName = (state: ConnectionContextState) => state.remoteDeviceName;
export const selectApi = (state: ConnectionContextState) => state.api;
