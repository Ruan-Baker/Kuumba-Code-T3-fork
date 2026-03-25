/**
 * Convex client for mobile — provides the ConvexReactClient singleton
 * and a polling-based hook for reading thread state.
 *
 * Since we're in a Vite web app (not a full Convex project), we use
 * ConvexHttpClient with polling instead of ConvexReactClient + useQuery,
 * which would require generated API types from the convex/ directory.
 */
import { useEffect, useRef, useState } from "react";

const CONVEX_URL = (import.meta as any).env?.VITE_CONVEX_URL as string | undefined;
const POLL_INTERVAL_MS = 1_000;

// Lazy-loaded HTTP client
let httpClient: any = null;

async function getClient() {
  if (httpClient) return httpClient;
  if (!CONVEX_URL) return null;

  try {
    const { ConvexHttpClient } = await import("convex/browser");
    httpClient = new ConvexHttpClient(CONVEX_URL);
    console.log("[convex-mobile] Client initialized:", CONVEX_URL);
    return httpClient;
  } catch (err) {
    console.warn("[convex-mobile] Failed to initialize:", err);
    return null;
  }
}

export interface ConvexThreadState {
  threadId: string;
  hostDeviceId: string;
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
  updatedAt: number;
}

/**
 * Hook that polls Convex for the latest thread state.
 * Returns null if Convex is not configured or thread not found.
 * Updates every POLL_INTERVAL_MS.
 */
export function useConvexThreadState(threadId: string | null): ConvexThreadState | null {
  const [state, setState] = useState<ConvexThreadState | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!threadId || !CONVEX_URL) {
      setState(null);
      return;
    }

    let cancelled = false;

    const fetchState = async () => {
      const client = await getClient();
      if (!client || cancelled) return;

      try {
        const raw = await client.query("remoteSync:getThreadState", { threadId });
        if (cancelled || !raw) return;

        const parsed: ConvexThreadState = {
          threadId: raw.threadId,
          hostDeviceId: raw.hostDeviceId,
          sessionStatus: raw.sessionStatus,
          title: raw.title,
          projectName: raw.projectName,
          projectCwd: raw.projectCwd,
          model: raw.model,
          messages: JSON.parse(raw.messagesJson || "[]"),
          activities: JSON.parse(raw.activitiesJson || "[]"),
          proposedPlans: JSON.parse(raw.proposedPlansJson || "[]"),
          pendingApprovals: JSON.parse(raw.pendingApprovalsJson || "[]"),
          isStreaming: raw.isStreaming,
          updatedAt: raw.updatedAt,
        };

        setState(parsed);
      } catch (err) {
        // Silent fail — relay is the primary, Convex is the backup
        if (!cancelled) console.warn("[convex-mobile] Poll failed:", err);
      }
    };

    // Fetch immediately on mount
    void fetchState();

    // Then poll every 2 seconds
    intervalRef.current = setInterval(fetchState, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [threadId]);

  return state;
}

/**
 * Check if Convex is configured for this mobile app.
 */
export function isConvexConfigured(): boolean {
  return !!CONVEX_URL;
}
