/**
 * Remote Recovery Manager
 *
 * Handles reconnect/catch-up logic for remote sessions:
 * 1. Detects when transport reconnects after a disconnect
 * 2. Performs resume handshake with last known sequence cursors
 * 3. Replays missed orchestration and terminal events
 * 4. Fetches a final snapshot for reconciliation
 * 5. Marks the UI as "recovering" during this process
 *
 * The recovery flow:
 *   reconnect → resume handshake → replay events → snapshot → live mode
 */
import { WS_METHODS, ORCHESTRATION_WS_METHODS } from "@t3tools/contracts";
import type { WsTransport, TransportState } from "./wsTransport";
import { useConnectionContext } from "./connectionContext";

// ── Types ────────────────────────────────────────────────────────────

interface ResumeResult {
  connection: {
    deviceId: string;
    deviceName: string;
    serverTime: string;
    lastOrchestrationSequence: number;
  };
  needsReplayFromSequenceExclusive: number;
  needsFullResync: boolean;
}

interface RecoveryHandle {
  /** Stop monitoring and clean up. */
  dispose: () => void;
}

// ── Recovery Logic ──────────────────────────────────────────────────

/**
 * Attach recovery monitoring to a remote WsTransport.
 *
 * When the transport reconnects (state goes from non-open to open),
 * this module will automatically:
 * 1. Set recoveryState to "replaying"
 * 2. Send a resume request with last known cursors
 * 3. If server says full resync needed, fetch snapshot directly
 * 4. Otherwise replay events then fetch snapshot
 * 5. Set recoveryState back to "idle"
 *
 * On failure, sets recoveryState to "failed" and retries on next reconnect.
 */
export function attachRecoveryMonitor(transport: WsTransport): RecoveryHandle {
  let wasOpen = false;
  let recovering = false;

  const unsub = transport.onStateChange(
    async (newState: TransportState, prevState: TransportState) => {
      // Detect reconnection: was previously not open, now is open
      const isReconnect = newState === "open" && prevState !== "connecting" && wasOpen;

      if (newState === "open") {
        wasOpen = true;
      }

      if (!isReconnect || recovering) return;

      recovering = true;
      const store = useConnectionContext.getState();

      try {
        store.setRecoveryState("replaying");

        // Step 1: Sync cursors from transport
        store.syncCursors();
        const cursors = useConnectionContext.getState().cursors;

        // Step 2: Resume handshake
        let resumeResult: ResumeResult;
        try {
          resumeResult = await transport.request<ResumeResult>(WS_METHODS.remoteResume, {
            lastOrchestrationSequence: cursors.lastOrchestrationSequence,
            lastTerminalSequenceByTerminalKey: cursors.lastTerminalSequenceByKey,
          });
        } catch {
          // Resume not supported — fall back to full resync
          resumeResult = {
            connection: {
              deviceId: "",
              deviceName: "",
              serverTime: new Date().toISOString(),
              lastOrchestrationSequence: 0,
            },
            needsReplayFromSequenceExclusive: 0,
            needsFullResync: true,
          };
        }

        if (resumeResult.needsFullResync) {
          // Step 3a: Full resync — just fetch fresh snapshot
          store.setRecoveryState("snapshot");
          try {
            const api = store.ensureApi();
            await api.orchestration.getSnapshot();
            // Snapshot is applied by the existing subscription system
          } catch {
            // Snapshot fetch failed — will retry on next reconnect
            store.setRecoveryState("failed");
            recovering = false;
            return;
          }
        } else {
          // Step 3b: Replay events from last known sequence
          try {
            const api = store.ensureApi();
            await api.orchestration.replayEvents(resumeResult.needsReplayFromSequenceExclusive);
          } catch {
            // Replay failed — try full snapshot instead
          }

          // Step 4: Always fetch snapshot after replay for reconciliation
          store.setRecoveryState("snapshot");
          try {
            const api = store.ensureApi();
            await api.orchestration.getSnapshot();
          } catch {
            store.setRecoveryState("failed");
            recovering = false;
            return;
          }
        }

        // Step 5: Recovery complete
        store.setRecoveryState("idle");
        store.syncCursors();
      } catch {
        store.setRecoveryState("failed");
      } finally {
        recovering = false;
      }
    },
  );

  return {
    dispose: () => {
      unsub();
    },
  };
}

/**
 * React hook-friendly wrapper: call in a useEffect to attach recovery
 * monitoring when a remote transport is active.
 *
 * Usage:
 * ```tsx
 * useEffect(() => {
 *   if (transport && mode === "remote") {
 *     const handle = attachRecoveryMonitor(transport);
 *     return () => handle.dispose();
 *   }
 * }, [transport, mode]);
 * ```
 */
