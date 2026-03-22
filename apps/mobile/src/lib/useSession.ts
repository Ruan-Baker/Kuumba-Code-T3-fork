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
  subscribe<C extends WsPushChannel>(
    channel: C,
    listener: (message: WsPushMessage<C>) => void,
  ): () => void;
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

export function useSession(transport: Transport | null, threadId: string | null) {
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

  // Load snapshot — instant from cache, then refresh in background
  useEffect(() => {
    if (!transport || !threadId) {
      setState({
        loading: false,
        error: null,
        thread: null,
        messages: [],
        activities: [],
        pendingApprovals: [],
        proposedPlans: [],
        pendingUserInputs: [],
      });
      return;
    }

    let cancelled = false;
    const cacheKey = `kuumba-session-${threadId}`;
    const seqKey = `kuumba-session-seq-${threadId}`;

    // Step 1: Show cached state IMMEDIATELY (not loading — fully interactive)
    let hasCachedData = false;
    let cachedSequence = 0;
    try {
      const cached = localStorage.getItem(cacheKey);
      const seq = localStorage.getItem(seqKey);
      if (cached) {
        const cachedState = JSON.parse(cached) as SessionState;
        // Invalidate cache if it has stale "Unknown" project name
        if (cachedState.thread?.projectName === "Unknown") {
          console.log("[useSession] Invalidating stale cache with Unknown project");
          localStorage.removeItem(cacheKey);
          localStorage.removeItem(seqKey);
        } else if (cachedState.thread && cachedState.messages.length > 0) {
          setState({ ...cachedState, loading: false, error: null });
          hasCachedData = true;
          cachedSequence = seq ? parseInt(seq, 10) : 0;
          console.log(
            `[useSession] Instant cache hit: ${cachedState.messages.length} messages, seq=${cachedSequence}, project=${cachedState.thread.projectName}`,
          );
        }
      }
    } catch {
      /* ignore */
    }

    if (!hasCachedData) {
      setState((s) => ({ ...s, loading: true, error: null }));
    }

    // Step 2: Refresh in background
    const refreshSession = async () => {
      try {
        // If we have cached data with a sequence, try delta update first
        if (hasCachedData && cachedSequence > 0) {
          console.log(`[useSession] Trying delta update from seq=${cachedSequence}`);
          try {
            const events = await transport.request<
              Array<{
                type: string;
                aggregateId?: string;
                payload: Record<string, unknown>;
              }>
            >(ORCHESTRATION_WS_METHODS.replayEvents, { fromSequenceExclusive: cachedSequence });

            if (cancelled) return;

            if (events && events.length < 500) {
              // Apply delta events to cached state
              console.log(
                `[useSession] Delta update: ${events.length} events since seq=${cachedSequence}`,
              );
              applyDeltaEvents(events, threadId, setState);

              // Update cached sequence
              if (events.length > 0) {
                const lastEvent = events[events.length - 1] as { sequence?: number };
                if (lastEvent?.sequence) {
                  localStorage.setItem(seqKey, String(lastEvent.sequence));
                }
              }

              // Save updated state to cache
              saveCacheAsync(cacheKey, seqKey, threadId, setState);
              return; // Delta update succeeded, no need for full snapshot
            }
            // Too many events — fall through to full snapshot
            console.log(
              `[useSession] Too many delta events (${events?.length}), falling back to full snapshot`,
            );
          } catch {
            // Delta update failed — fall through to full snapshot
            console.log("[useSession] Delta update failed, falling back to full snapshot");
          }
        }

        // Full snapshot load
        console.log("[useSession] Loading full snapshot for thread:", threadId);
        const snapshot = await transport.request<{
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
          projects: Array<{
            id: string;
            title?: string;
            name?: string;
            workspaceRoot?: string;
            cwd?: string;
          }>;
          snapshotSequence?: number;
        }>(ORCHESTRATION_WS_METHODS.getSnapshot);

        if (cancelled) return;

        const thread = snapshot.threads.find((t) => t.id === threadId);
        if (!thread) {
          if (!hasCachedData) {
            setState({
              loading: false,
              error: "Thread not found",
              thread: null,
              messages: [],
              activities: [],
              pendingApprovals: [],
              proposedPlans: [],
              pendingUserInputs: [],
            });
          }
          return;
        }

        const project = snapshot.projects.find((p) => p.id === thread.projectId);
        console.log("[useSession] Project lookup:", {
          projectId: thread.projectId,
          found: !!project,
          projectFields: project ? Object.keys(project) : [],
          title: (project as any)?.title,
          name: (project as any)?.name,
          workspaceRoot: (project as any)?.workspaceRoot,
          cwd: (project as any)?.cwd,
        });
        const pendingApprovals: PendingApproval[] = thread.activities
          .filter((a) => a.tone === "approval")
          .map((a) => ({ requestId: a.id, type: a.kind, detail: a.summary }));

        const newState: SessionState = {
          loading: false,
          error: null,
          thread: {
            id: thread.id,
            title: thread.title,
            projectName: project?.title ?? project?.name ?? "Unknown",
            projectCwd: project?.workspaceRoot ?? project?.cwd ?? "",
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
            kind: a.kind ?? "",
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
        };

        setState(newState);

        // Cache for next time
        try {
          const toCache = { ...newState, messages: newState.messages.slice(-100) };
          localStorage.setItem(cacheKey, JSON.stringify(toCache));
          if (snapshot.snapshotSequence) {
            localStorage.setItem(seqKey, String(snapshot.snapshotSequence));
          }
        } catch {
          /* storage full */
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[useSession] Snapshot load failed:", err);
        if (!hasCachedData) {
          setState({
            loading: false,
            error: err instanceof Error ? err.message : "Failed to load",
            thread: null,
            messages: [],
            activities: [],
            pendingApprovals: [],
            proposedPlans: [],
            pendingUserInputs: [],
          });
        }
        // If we have cached data, silently keep showing it
      }
    };

    void refreshSession();

    return () => {
      cancelled = true;
    };
  }, [transport, threadId]);

  // Subscribe to domain events
  useEffect(() => {
    if (!transport || !threadId) return;
    unsubRef.current?.();

    const unsub = transport.subscribe(ORCHESTRATION_WS_CHANNELS.domainEvent, (pushMsg) => {
      const event = pushMsg.data as {
        type: string;
        aggregateId?: string;
        payload: Record<string, unknown>;
      };

      console.log(
        "[useSession] Push event:",
        event.type,
        "aggregateId:",
        event.aggregateId,
        "payload threadId:",
        event.payload?.threadId,
      );

      const eventThreadId = (event.payload?.threadId as string) ?? event.aggregateId;
      if (eventThreadId !== threadId) return;

      switch (event.type) {
        case "thread.message-sent": {
          const p = event.payload as Record<string, unknown>;
          const messageId = (p.messageId ?? p.id) as string;
          const role = (p.role ?? "assistant") as "user" | "assistant" | "system";
          const textDelta = (p.text ?? "") as string;
          const streaming = (p.streaming ?? false) as boolean;
          const createdAt = (p.createdAt ?? new Date().toISOString()) as string;
          const updatedAt = (p.updatedAt ?? createdAt) as string;

          setState((s) => {
            const existingIdx = s.messages.findIndex((m) => m.id === messageId);
            if (existingIdx >= 0) {
              // Existing message — append delta if streaming, replace if done
              const existing = s.messages[existingIdx]!;
              const updated = [...s.messages];
              if (streaming) {
                // Streaming delta — append text
                updated[existingIdx] = {
                  ...existing,
                  text: existing.text + textDelta,
                  streaming: true,
                  updatedAt,
                };
              } else {
                // Stream finished — keep accumulated text, mark not streaming
                updated[existingIdx] = {
                  ...existing,
                  streaming: false,
                  updatedAt,
                };
              }
              return { ...s, messages: updated };
            }

            // New message
            if (
              role === "user" &&
              s.messages.some((m) => m.role === "user" && m.text === textDelta)
            ) {
              return s; // Skip duplicate optimistic user message
            }
            return {
              ...s,
              messages: [
                ...s.messages,
                {
                  id: messageId,
                  role,
                  text: textDelta,
                  streaming,
                  createdAt,
                  updatedAt,
                },
              ],
            };
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
            const newActivities = [
              ...s.activities,
              {
                id: p.id,
                tone: p.tone,
                kind: p.kind,
                summary: p.summary,
                payload: p.payload,
                createdAt: p.createdAt,
              },
            ];
            // Add to pending approvals if tone is approval
            const newApprovals =
              p.tone === "approval"
                ? [...s.pendingApprovals, { requestId: p.id, type: p.kind, detail: p.summary }]
                : s.pendingApprovals;
            return { ...s, activities: newActivities, pendingApprovals: newApprovals };
          });
          break;
        }

        case "thread.meta-updated": {
          const p = event.payload as { title?: string };
          if (p.title) {
            setState((s) => (s.thread ? { ...s, thread: { ...s.thread, title: p.title! } } : s));
          }
          break;
        }

        case "thread.session-set": {
          const p = event.payload as { status?: string };
          if (p.status) {
            setState((s) =>
              s.thread ? { ...s, thread: { ...s.thread, sessionStatus: p.status! } } : s,
            );
          }
          break;
        }

        case "thread.proposed-plan-upserted": {
          const p = event.payload as {
            proposedPlan: {
              id: string;
              planMarkdown: string;
              implementedAt: string | null;
              createdAt: string;
            };
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
    });

    unsubRef.current = unsub;
    return () => {
      unsub();
      unsubRef.current = null;
    };
  }, [transport, threadId]);

  const sendMessage = useCallback(
    (
      text: string,
      images?: File[],
      options?: { runtimeMode?: string; interactionMode?: string; provider?: string },
    ) => {
      if (!transport || !threadId) {
        console.warn("[useSession] sendMessage: no transport or threadId", {
          transport: !!transport,
          threadId,
        });
        return;
      }

      void (async () => {
        try {
          // Convert images to base64 attachments if present
          let attachments: Array<{ type: string; mediaType: string; data: string; name: string }> =
            [];
          if (images && images.length > 0) {
            attachments = await Promise.all(
              images.map(async (file) => {
                const buffer = await file.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                let binary = "";
                for (const byte of bytes) binary += String.fromCharCode(byte);
                return {
                  type: "image",
                  mediaType: file.type || "image/png",
                  data: btoa(binary),
                  name: file.name,
                };
              }),
            );
          }

          const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const commandId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const now = new Date().toISOString();

          // Optimistically add the user message to the UI immediately
          setState((s) => ({
            ...s,
            messages: [
              ...s.messages,
              {
                id: messageId,
                role: "user" as const,
                text,
                streaming: false,
                createdAt: now,
                updatedAt: now,
              },
            ],
          }));

          const resolvedRuntime = options?.runtimeMode ?? "full-access";
          const resolvedInteraction = options?.interactionMode === "plan" ? "plan" : "default";
          console.log("[useSession] Sending thread.turn.start:", text.slice(0, 50), {
            runtimeMode: resolvedRuntime,
            interactionMode: resolvedInteraction,
          });

          await transport.request(ORCHESTRATION_WS_METHODS.dispatchCommand, {
            command: {
              type: "thread.turn.start",
              commandId,
              threadId,
              message: {
                messageId,
                role: "user",
                text,
                attachments: [],
              },
              provider: options?.provider ?? "codex",
              assistantDeliveryMode: "streaming",
              runtimeMode: options?.runtimeMode ?? "full-access",
              interactionMode: options?.interactionMode === "plan" ? "plan" : "default",
              createdAt: now,
            },
          });
        } catch (err) {
          console.error("[useSession] sendMessage failed:", err);
        }
      })();
    },
    [transport, threadId],
  );

  const stopTurn = useCallback(() => {
    if (!transport || !threadId) return;
    const commandId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    void transport
      .request(ORCHESTRATION_WS_METHODS.dispatchCommand, {
        command: {
          type: "thread.turn.interrupt",
          commandId,
          threadId,
        },
      })
      .catch((err) => {
        console.error("[useSession] stopTurn failed:", err);
      });
  }, [transport, threadId]);

  const respondToApproval = useCallback(
    (requestId: string, decision: "approve" | "deny") => {
      if (!transport || !threadId) return;
      const commandId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      void transport
        .request(ORCHESTRATION_WS_METHODS.dispatchCommand, {
          command: {
            type: "thread.approval.respond",
            commandId,
            threadId,
            requestId,
            decision,
          },
        })
        .catch((err) => {
          console.error("[useSession] respondToApproval failed:", err);
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

// ── Helper: apply delta events to cached session state ──────────────

function applyDeltaEvents(
  events: Array<{ type: string; aggregateId?: string; payload: Record<string, unknown> }>,
  threadId: string,
  setState: React.Dispatch<React.SetStateAction<SessionState>>,
) {
  for (const event of events) {
    const eventThreadId = (event.payload?.threadId as string) ?? event.aggregateId;
    if (eventThreadId !== threadId) continue;

    switch (event.type) {
      case "thread.message-sent": {
        const p = event.payload;
        const messageId = (p.messageId ?? p.id) as string;
        const role = (p.role ?? "assistant") as "user" | "assistant" | "system";
        const text = (p.text ?? "") as string;
        const streaming = (p.streaming ?? false) as boolean;
        const createdAt = (p.createdAt ?? new Date().toISOString()) as string;
        const updatedAt = (p.updatedAt ?? createdAt) as string;

        setState((s) => {
          const idx = s.messages.findIndex((m) => m.id === messageId);
          if (idx >= 0) {
            const updated = [...s.messages];
            const existing = updated[idx]!;
            if (streaming) {
              updated[idx] = {
                ...existing,
                text: existing.text + text,
                streaming: true,
                updatedAt,
              };
            } else {
              updated[idx] = { ...existing, streaming: false, updatedAt };
            }
            return { ...s, messages: updated };
          }
          return {
            ...s,
            messages: [
              ...s.messages,
              { id: messageId, role, text, streaming, createdAt, updatedAt },
            ],
          };
        });
        break;
      }
      case "thread.meta-updated": {
        const title = event.payload.title as string | undefined;
        if (title) {
          setState((s) => (s.thread ? { ...s, thread: { ...s.thread, title } } : s));
        }
        break;
      }
      case "thread.session-set": {
        const status = event.payload.status as string | undefined;
        if (status) {
          setState((s) =>
            s.thread ? { ...s, thread: { ...s.thread, sessionStatus: status } } : s,
          );
        }
        break;
      }
    }
  }
}

// ── Helper: save current state to cache asynchronously ──────────────

function saveCacheAsync(
  cacheKey: string,
  seqKey: string,
  _threadId: string,
  setState: React.Dispatch<React.SetStateAction<SessionState>>,
) {
  // Read current state and save to cache
  setState((s) => {
    try {
      const toCache = { ...s, messages: s.messages.slice(-100) };
      localStorage.setItem(cacheKey, JSON.stringify(toCache));
    } catch {
      /* storage full */
    }
    return s; // Don't modify state
  });
}
