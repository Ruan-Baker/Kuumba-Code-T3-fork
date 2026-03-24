/**
 * ConvexSync — pushes thread state to Convex whenever a remotely-shared
 * thread changes. Mobile devices subscribe to this data via Convex reactive
 * queries, ensuring they always have current state even if relay messages
 * are missed (network blip, background app, etc.).
 *
 * This module debounces writes to avoid flooding Convex during rapid
 * streaming updates (we write at most every 2 seconds).
 */

let convexClient: any = null;
let deviceId: string | null = null;

// Track which threads are being synced and their debounce timers
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingState = new Map<string, ThreadStateSnapshot>();

const DEBOUNCE_MS = 2_000;

export interface ThreadStateSnapshot {
  threadId: string;
  sessionStatus: string;
  title: string;
  projectName: string;
  projectCwd: string;
  model: string;
  messages: Array<{
    id: string;
    role: string;
    text: string;
    streaming: boolean;
    createdAt: string;
  }>;
  activities: Array<{
    id: string;
    tone: string;
    kind: string;
    summary: string;
    createdAt: string;
  }>;
  proposedPlans: Array<{
    id: string;
    planMarkdown: string;
    implementedAt: string | null;
    createdAt: string;
  }>;
  pendingApprovals: Array<{
    requestId: string;
    type: string;
    detail: string;
  }>;
  isStreaming: boolean;
}

/**
 * Initialize Convex sync with the given deployment URL and host device ID.
 * Call this once when the relay connection is established.
 */
export async function initConvexSync(convexUrl: string, hostDeviceId: string): Promise<void> {
  if (!convexUrl) {
    console.log("[convex-sync] No CONVEX_URL — Convex sync disabled");
    return;
  }

  try {
    const { ConvexHttpClient } = await import("convex/browser");
    convexClient = new ConvexHttpClient(convexUrl);
    deviceId = hostDeviceId;
    console.log("[convex-sync] Initialized for device:", hostDeviceId.slice(0, 8) + "...");
  } catch (err) {
    console.warn("[convex-sync] Failed to initialize:", err);
  }
}

/**
 * Push a thread state snapshot to Convex (debounced).
 * Call this whenever a remotely-shared thread's state changes.
 */
export function syncThreadState(snapshot: ThreadStateSnapshot): void {
  if (!convexClient || !deviceId) return;

  // Store the latest state
  pendingState.set(snapshot.threadId, snapshot);

  // Debounce: if there's already a timer for this thread, let it fire
  if (syncTimers.has(snapshot.threadId)) return;

  // For session status changes (non-streaming), flush immediately
  if (!snapshot.isStreaming) {
    void flushThreadState(snapshot.threadId);
    return;
  }

  // For streaming updates, debounce to avoid flooding
  const timer = setTimeout(() => {
    syncTimers.delete(snapshot.threadId);
    void flushThreadState(snapshot.threadId);
  }, DEBOUNCE_MS);

  syncTimers.set(snapshot.threadId, timer);
}

/**
 * Immediately flush pending state for a thread to Convex.
 */
async function flushThreadState(threadId: string): Promise<void> {
  const snapshot = pendingState.get(threadId);
  if (!snapshot || !convexClient || !deviceId) return;

  pendingState.delete(threadId);
  syncTimers.delete(threadId);

  try {
    await convexClient.mutation("remoteSync:upsertThreadState", {
      threadId: snapshot.threadId,
      hostDeviceId: deviceId,
      sessionStatus: snapshot.sessionStatus,
      title: snapshot.title,
      projectName: snapshot.projectName,
      projectCwd: snapshot.projectCwd,
      model: snapshot.model,
      messagesJson: JSON.stringify(snapshot.messages.slice(-100)), // Keep last 100 messages
      activitiesJson: JSON.stringify(snapshot.activities.slice(-50)),
      proposedPlansJson: JSON.stringify(snapshot.proposedPlans),
      pendingApprovalsJson: JSON.stringify(snapshot.pendingApprovals),
      isStreaming: snapshot.isStreaming,
    });
  } catch (err) {
    console.warn("[convex-sync] Failed to sync thread state:", err);
  }
}

/**
 * Remove thread state from Convex when remote sharing is disabled.
 */
export async function removeThreadState(threadId: string): Promise<void> {
  if (!convexClient) return;

  try {
    await convexClient.mutation("remoteSync:removeThreadState", { threadId });
    console.log("[convex-sync] Removed thread state:", threadId.slice(0, 8) + "...");
  } catch (err) {
    console.warn("[convex-sync] Failed to remove thread state:", err);
  }
}

/**
 * Check if Convex sync is active.
 */
export function isConvexSyncActive(): boolean {
  return convexClient !== null;
}

/**
 * Dispose all timers and client.
 */
export function disposeConvexSync(): void {
  for (const timer of syncTimers.values()) clearTimeout(timer);
  syncTimers.clear();
  pendingState.clear();
  convexClient = null;
  deviceId = null;
}
