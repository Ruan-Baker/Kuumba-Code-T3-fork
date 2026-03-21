/**
 * Hook to manage a remote session — loads snapshot, subscribes to domain events,
 * provides messages, activities, pending approvals, and dispatch actions.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ORCHESTRATION_WS_METHODS, ORCHESTRATION_WS_CHANNELS } from "@t3tools/contracts";
import type { ChatMessage } from "~/components/MessagesList";
import type { WsPushChannel, WsPushMessage } from "@t3tools/contracts";

/** Minimal transport interface — both WsTransport and RelayTransport satisfy this. */
interface Transport {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  subscribe<C extends WsPushChannel>(channel: C, listener: (message: WsPushMessage<C>) => void): () => void;
}

interface SessionThread {
  id: string;
  title: string;
  projectName: string;
  projectCwd: string;
  model: string;
  sessionStatus: string | null;
}

export interface ActivityEntry {
  id: string;
  tone: "info" | "tool" | "approval" | "error";
  kind: string;
  summary: string;
  payload: unknown;
  createdAt: string;
}

export interface PendingApproval {
  requestId: string;
  type: string;
  detail: string;
}

export interface ProposedPlan {
  id: string;
  planMarkdown: string;
  implementedAt: string | null;
  createdAt: string;
}

export interface PendingUserInputData {
  requestId: string;
  questions: Array<{
    id: string;
    header: string;
    question: string;
    options: Array<{ label: string; description?: string | undefined }>;
  }>;
}

interface SessionState {
  loading: boolean;
  error: string | null;
  thread: SessionThread | null;
  messages: ChatMessage[];
  activities: ActivityEntry[];
  pendingApprovals: PendingApproval[];
  proposedPlans: ProposedPlan[];
  pendingUserInputs: PendingUserInputData[];
}

export function useSession(
  transport: Transport | null,
  threadId: string | null,
) {
  const [state, setState] = useState<SessionState>({
    loading: false,
    error: null,
    thread: null,
    messages: [],
    activities: [],
    pendingApprovals: [],
    proposedPlans: [],
    pendingUserInputs: [],
  });

  const unsubRef = useRef<(() => void) | null>(null);

  // Load snapshot — with stale-while-revalidate caching
  useEffect(() => {
    if (!transport || !threadId) {
      setState({ loading: false, error: null, thread: null, messages: [], activities: [], pendingApprovals: [], proposedPlans: [], pendingUserInputs: [] });
      return;
    }

    let cancelled = false;

    // Try loading from cache first for instant display
    const cacheKey = `kuumba-session-${threadId}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const cachedState = JSON.parse(cached) as SessionState;
        if (cachedState.thread && cachedState.messages.length > 0) {
          setState({ ...cachedState, loading: true, error: null });
        } else {
          setState((s) => ({ ...s, loading: true, error: null }));
        }
      } else {
        setState((s) => ({ ...s, loading: true, error: null }));
      }
    } catch {
      setState((s) => ({ ...s, loading: true, error: null }));
    }

    transport
      .request<{
        threads: Array<{
          id: string;
          title: string;
          projectId: string;
          model: string;
          session: { status: string } | null;
          messages: Array<{
            id: string;
            role: "user" | "assistant" | "system";
            text: string;
            streaming: boolean;
            createdAt: string;
            updatedAt: string;
          }>;
          activities: Array<{
            id: string;
            tone: "info" | "tool" | "approval" | "error";
            kind: string;
            summary: string;
            payload: unknown;
            createdAt: string;
          }>;
          proposedPlans: Array<{
            id: string;
            planMarkdown: string;
            implementedAt: string | null;
            createdAt: string;
          }>;
        }>;
        projects: Array<{ id: string; name: string; cwd: string }>;
      }>(ORCHESTRATION_WS_METHODS.getSnapshot)
      .then((snapshot) => {
        if (cancelled) return;

        const thread = snapshot.threads.find((t) => t.id === threadId);
        if (!thread) {
          setState({ loading: false, error: "Thread not found", thread: null, messages: [], activities: [], pendingApprovals: [], proposedPlans: [], pendingUserInputs: [] });
          return;
        }

        const project = snapshot.projects.find((p) => p.id === thread.projectId);

        // Extract pending approvals from activities
        const pendingApprovals: PendingApproval[] = thread.activities
          .filter((a) => a.tone === "approval")
          .map((a) => {
            const payload = a.payload as Record<string, unknown> | null;
            return {
              requestId: a.id,
              type: a.kind,
              detail: a.summary,
            };
          });

        setState({
          loading: false,
          error: null,
          thread: {
            id: thread.id,
            title: thread.title,
            projectName: project?.name ?? "Unknown",
            projectCwd: project?.cwd ?? "",
            model: thread.model,
            sessionStatus: thread.session?.status ?? null,
          },
          messages: thread.messages.map((m) => ({
            id: m.id,
            role: m.role,
            text: m.text,
            streaming: m.streaming,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
          })),
          activities: thread.activities.map((a) => ({
            id: a.id,
            tone: a.tone,
            kind: a.kind,
            summary: a.summary,
            payload: a.payload,
            createdAt: a.createdAt,
          })),
          pendingApprovals,
          proposedPlans: (thread.proposedPlans ?? []).map((p) => ({
            id: p.id,
            planMarkdown: p.planMarkdown,
            implementedAt: p.implementedAt,
            createdAt: p.createdAt,
          })),
          pendingUserInputs: [],
        });

        // Cache for instant loading next time (async, non-blocking)
        try {
          const toCache = {
            thread: { id: thread.id, title: thread.title, projectName: project?.name ?? "Unknown", projectCwd: project?.cwd ?? "", model: thread.model, sessionStatus: thread.session?.status ?? null },
            messages: thread.messages.slice(-100), // Only cache last 100 messages
          };
          localStorage.setItem(cacheKey, JSON.stringify({ ...toCache, loading: false, error: null, activities: [], pendingApprovals: [], proposedPlans: [], pendingUserInputs: [] }));
        } catch { /* storage full — ignore */ }
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ loading: false, error: err instanceof Error ? err.message : "Failed to load", thread: null, messages: [], activities: [], pendingApprovals: [], proposedPlans: [], pendingUserInputs: [] });
      });

    return () => { cancelled = true; };
  }, [transport, threadId]);

  // Subscribe to domain events
  useEffect(() => {
    if (!transport || !threadId) return;
    unsubRef.current?.();

    const unsub = transport.subscribe(
      ORCHESTRATION_WS_CHANNELS.domainEvent,
      (pushMsg) => {
        const event = pushMsg.data as {
          type: string;
          payload: Record<string, unknown>;
        };

        const eventThreadId =
          (event.payload?.threadId as string) ??
          (event.payload?.aggregateId as string);
        if (eventThreadId !== threadId) return;

        switch (event.type) {
          case "thread.message-sent": {
            const p = event.payload as {
              messageId: string;
              role: "user" | "assistant" | "system";
              text: string;
              streaming: boolean;
              createdAt: string;
              updatedAt: string;
            };

            setState((s) => {
              const existingIdx = s.messages.findIndex((m) => m.id === p.messageId);
              if (existingIdx >= 0) {
                const updated = [...s.messages];
                updated[existingIdx] = {
                  id: p.messageId,
                  role: p.role,
                  text: p.text,
                  streaming: p.streaming,
                  createdAt: p.createdAt,
                  updatedAt: p.updatedAt,
                };
                return { ...s, messages: updated };
              }
              return { ...s, messages: [...s.messages, { id: p.messageId, role: p.role, text: p.text, streaming: p.streaming, createdAt: p.createdAt, updatedAt: p.updatedAt }] };
            });
            break;
          }

          case "thread.activity-appended": {
            const p = event.payload as {
              id: string;
              tone: "info" | "tool" | "approval" | "error";
              kind: string;
              summary: string;
              payload: unknown;
              createdAt: string;
            };
            setState((s) => {
              const newActivities = [...s.activities, { id: p.id, tone: p.tone, kind: p.kind, summary: p.summary, payload: p.payload, createdAt: p.createdAt }];
              // Add to pending approvals if tone is approval
              const newApprovals = p.tone === "approval"
                ? [...s.pendingApprovals, { requestId: p.id, type: p.kind, detail: p.summary }]
                : s.pendingApprovals;
              return { ...s, activities: newActivities, pendingApprovals: newApprovals };
            });
            break;
          }

          case "thread.meta-updated": {
            const p = event.payload as { title?: string };
            if (p.title) {
              setState((s) => s.thread ? { ...s, thread: { ...s.thread, title: p.title! } } : s);
            }
            break;
          }

          case "thread.session-set": {
            const p = event.payload as { status?: string };
            if (p.status) {
              setState((s) => s.thread ? { ...s, thread: { ...s.thread, sessionStatus: p.status! } } : s);
            }
            break;
          }

          case "thread.proposed-plan-upserted": {
            const p = event.payload as {
              proposedPlan: { id: string; planMarkdown: string; implementedAt: string | null; createdAt: string };
            };
            if (p.proposedPlan) {
              setState((s) => {
                const existing = s.proposedPlans.findIndex((pl) => pl.id === p.proposedPlan.id);
                if (existing >= 0) {
                  const updated = [...s.proposedPlans];
                  updated[existing] = p.proposedPlan;
                  return { ...s, proposedPlans: updated };
                }
                return { ...s, proposedPlans: [...s.proposedPlans, p.proposedPlan] };
              });
            }
            break;
          }
        }
      },
    );

    unsubRef.current = unsub;
    return () => { unsub(); unsubRef.current = null; };
  }, [transport, threadId]);

  const sendMessage = useCallback(
    (text: string) => {
      if (!transport || !threadId) return;
      void transport.request(ORCHESTRATION_WS_METHODS.dispatchCommand, {
        command: { _tag: "SendMessage", threadId, text },
      });
    },
    [transport, threadId],
  );

  const stopTurn = useCallback(() => {
    if (!transport || !threadId) return;
    void transport.request(ORCHESTRATION_WS_METHODS.dispatchCommand, {
      command: { _tag: "InterruptTurn", threadId },
    });
  }, [transport, threadId]);

  const respondToApproval = useCallback(
    (requestId: string, decision: "approve" | "deny") => {
      if (!transport || !threadId) return;
      void transport.request(ORCHESTRATION_WS_METHODS.dispatchCommand, {
        command: {
          _tag: "RespondToApproval",
          threadId,
          requestId,
          decision,
        },
      });
      // Remove from pending
      setState((s) => ({
        ...s,
        pendingApprovals: s.pendingApprovals.filter((a) => a.requestId !== requestId),
      }));
    },
    [transport, threadId],
  );

  return {
    ...state,
    sendMessage,
    stopTurn,
    respondToApproval,
  };
}
