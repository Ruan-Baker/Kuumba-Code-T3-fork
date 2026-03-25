import { useState, useEffect, useCallback, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ChatHeader } from "~/components/ChatHeader";
import { Composer } from "~/components/Composer";
import { MessagesList } from "~/components/MessagesList";
import { cn } from "~/lib/utils";
import { MessageSkeleton } from "~/components/LoadingSkeleton";
import { ModelPicker } from "~/components/ModelPicker";
import { ApprovalPanel } from "~/components/ApprovalPanel";
import { showToast } from "~/components/Toast";
import { useSettingsStore } from "~/stores/settingsStore";
import { useDevicesStore } from "~/stores/devicesStore";
import { useConnectionStore } from "~/stores/connectionStore";
import { useSession } from "~/lib/useSession";
import { NotesModal } from "~/components/NotesModal";
import { useNotesStore, setMobileNotesPushHandler } from "~/stores/notesStore";
import { useTerminalStore } from "~/stores/terminalStore";
import { TerminalViewer } from "~/components/TerminalViewer";
import { RelayTransport } from "~/lib/relayTransport";

export const Route = createFileRoute("/")({
  component: ChatView,
});

const POLL_INTERVAL_MS = 30_000;

function ChatView() {
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("claude-sonnet-4-6");
  const [reasoningLevel, setReasoningLevel] = useState<string>("high");
  const [provider, setProvider] = useState<"claudeAgent" | "codex">("claudeAgent");
  const [interactionMode, setInteractionMode] = useState<"chat" | "plan">("chat");
  const [runtimeMode, setRuntimeMode] = useState<"full-access" | "approval-required">(
    "full-access",
  );
  const [fastMode, setFastMode] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const terminalVisible = useTerminalStore((s) => s.visible);
  const setTerminalVisible = useTerminalStore((s) => s.setVisible);

  // Collapsible state for the device session list on the home screen
  const [collapsedDevices, setCollapsedDevices] = useState<Set<string>>(new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());

  const savedDevices = useSettingsStore((s) => s.savedDevices);
  const { devices, refreshAll } = useDevicesStore();
  const {
    activeDeviceId,
    setActiveDevice,
    connect,
    disconnect,
    getActiveTransport,
    setModeSyncHandler,
  } = useConnectionStore();

  // Poll direct devices + auto-connect relay devices
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectedRelayIds = useRef<Set<string>>(new Set());

  const doPoll = useCallback(() => {
    const directDevices = savedDevices.filter((d) => !d.isRelay);
    if (directDevices.length > 0) void refreshAll(directDevices);
  }, [savedDevices, refreshAll]);

  // Auto-connect relay devices on mount so we get device status
  useEffect(() => {
    for (const device of savedDevices) {
      if (device.isRelay && !connectedRelayIds.current.has(device.id)) {
        connectedRelayIds.current.add(device.id);
        connect(device);
      }
    }
  }, [savedDevices, connect]);

  useEffect(() => {
    doPoll();
    pollRef.current = setInterval(doPoll, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [doPoll]);

  // Restore session after hard reload (from refresh button)
  useEffect(() => {
    const restoreDevice = sessionStorage.getItem("kuumba-restore-device");
    const restoreThread = sessionStorage.getItem("kuumba-restore-thread");
    if (restoreDevice && restoreThread) {
      sessionStorage.removeItem("kuumba-restore-device");
      sessionStorage.removeItem("kuumba-restore-thread");
      // Wait a bit for relay to connect, then restore
      setTimeout(() => {
        const device = savedDevices.find((d) => d.id === restoreDevice);
        if (device) {
          connect(device);
          setActiveDevice(restoreDevice);
          setActiveThreadId(restoreThread);
        }
      }, 2000);
    }
  }, []);

  // Send composer state change to desktop via RPC
  const sendComposerState = useCallback(
    (patch: Record<string, string>) => {
      const t = getActiveTransport();
      if (!t) return;
      void t.request("composer.setState", patch).catch((err: unknown) => {
        console.warn("[App] composer.setState failed:", err);
      });
    },
    [getActiveTransport],
  );

  // Listen for mode sync from desktop
  useEffect(() => {
    setModeSyncHandler((data: Record<string, unknown>) => {
      console.log("[App] Mode sync from desktop:", data);
      // Only sync modes — not model/provider (those are per-session, desktop might be viewing a different one)
      if (data.interactionMode) {
        setInteractionMode(data.interactionMode === "plan" ? "plan" : "chat");
      }
      if (data.runtimeMode) {
        setRuntimeMode(data.runtimeMode as "full-access" | "approval-required");
      }
      if (data.reasoningLevel) {
        setReasoningLevel(data.reasoningLevel as string);
      }
      if (data.fastMode !== undefined) {
        setFastMode(data.fastMode === true || data.fastMode === "true");
      }
    });
    return () => setModeSyncHandler(null);
  }, [setModeSyncHandler]);

  // detectProvider helper — used after session hook
  function detectProvider(model: string): "claudeAgent" | "codex" {
    if (model.startsWith("claude-") || model.startsWith("claude_")) return "claudeAgent";
    if (
      model.startsWith("gpt-") ||
      model.startsWith("codex") ||
      model.startsWith("o1") ||
      model.startsWith("o3")
    )
      return "codex";
    return "codex";
  }

  // Wire up real-time notes sync
  const { setNotesSyncHandler } = useConnectionStore();
  useEffect(() => {
    // Desktop → Mobile: receive notes updates from desktop
    setNotesSyncHandler((data) => {
      useNotesStore.getState().setEditorStateFromRemote(data.editorState);
    });

    // Mobile → Desktop: push notes updates to desktop via relay
    setMobileNotesPushHandler((cwd, editorState, timestamp) => {
      const t = getActiveTransport();
      if (t && t instanceof RelayTransport) {
        void t.sendNotesSync(cwd, editorState, timestamp);
      }
    });

    return () => {
      setNotesSyncHandler(null);
      setMobileNotesPushHandler(null);
    };
  }, [setNotesSyncHandler, getActiveTransport]);

  // Subscribe to terminal events from desktop via relay push
  useEffect(() => {
    const t = getActiveTransport();
    if (!t || !(t instanceof RelayTransport)) return;

    const unsub = t.subscribe("terminal.event" as any, (message: { channel: string; data: unknown }) => {
      useTerminalStore.getState().handleTerminalEvent(message.data);
    });

    // Reset terminal store when transport changes
    return () => {
      unsub();
      useTerminalStore.getState().reset();
    };
  }, [getActiveTransport]);

  // Session hook
  const transport = getActiveTransport();
  console.log(
    "[App] render: activeDeviceId=",
    activeDeviceId,
    "activeThreadId=",
    activeThreadId,
    "transport=",
    !!transport,
  );
  const session = useSession(transport, activeThreadId);

  // Detect provider and model from thread data + fetch modes from desktop
  useEffect(() => {
    const t = getActiveTransport();
    if (!t || !activeThreadId) return;

    // Detect provider from the thread's model
    const threadModel = session.thread?.model;
    if (threadModel) {
      const detectedProvider = detectProvider(threadModel);
      setProvider(detectedProvider);
      setSelectedModel(threadModel);
    }

    // Fetch modes from desktop (plan/chat, supervised/full-access, reasoning)
    void t
      .request<Record<string, unknown>>("composer.getState")
      .then((state) => {
        if (state.interactionMode)
          setInteractionMode(state.interactionMode === "plan" ? "plan" : "chat");
        if (state.runtimeMode)
          setRuntimeMode(state.runtimeMode as "full-access" | "approval-required");
        if (state.reasoningLevel) setReasoningLevel(state.reasoningLevel as string);
        if (state.fastMode !== undefined)
          setFastMode(state.fastMode === true || state.fastMode === "true");
      })
      .catch(() => {});
  }, [activeThreadId, session.thread?.model]);

  const { relayDevices } = useConnectionStore();

  // Build device list — merge HTTP-polled (direct) and relay-provided devices
  function buildDeviceList() {
    const result: Array<{
      deviceId: string;
      deviceName: string;
      online: boolean;
      projects: Array<{
        projectName: string;
        sessions: Array<{ threadId: string; title: string; status: string }>;
      }>;
    }> = [];

    // Direct devices from HTTP polling
    for (const d of Object.values(devices)) {
      if (savedDevices.find((sd) => sd.id === d.deviceId)?.isRelay) continue;
      const sessions = (d.info?.sessions ?? []).map((s) => ({
        threadId: s.threadId,
        title: s.title || "Untitled",
        projectName: s.projectName,
        status: s.status,
      }));
      const projectMap: Record<string, { threadId: string; title: string; status: string }[]> = {};
      for (const s of sessions) {
        if (!projectMap[s.projectName]) projectMap[s.projectName] = [];
        projectMap[s.projectName]!.push(s);
      }
      result.push({
        deviceId: d.deviceId,
        deviceName: d.config.name,
        online: d.online,
        projects: Object.entries(projectMap).map(([projectName, sess]) => ({
          projectName,
          sessions: sess,
        })),
      });
    }

    // Relay devices — show saved relay devices, enriched with relay status if available
    const relayDeviceMap = new Map(relayDevices.map((rd) => [rd.deviceId, rd]));
    for (const sd of savedDevices) {
      if (!sd.isRelay || !sd.deviceId) continue;
      const rd = relayDeviceMap.get(sd.deviceId);
      const sessions = rd?.sessions ?? [];
      const projectMap: Record<string, { threadId: string; title: string; status: string }[]> = {};
      for (const s of sessions) {
        const pName = s.projectName || "Project";
        if (!projectMap[pName]) projectMap[pName] = [];
        projectMap[pName]!.push({
          threadId: s.threadId,
          title: s.title || "Untitled",
          status: s.status,
        });
      }
      result.push({
        deviceId: sd.id,
        deviceName: sd.name,
        online: rd?.online ?? false,
        projects: Object.entries(projectMap).map(([projectName, sess]) => ({
          projectName,
          sessions: sess,
        })),
      });
    }

    return result;
  }

  const headerDevices = buildDeviceList();

  const activeDevice = activeDeviceId ? devices[activeDeviceId] : undefined;
  const activeSavedDevice = savedDevices.find((d) => d.id === activeDeviceId);
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  const isStreaming = waitingForResponse || session.messages.some((m) => m.streaming);
  const hasSession = activeThreadId != null && session.thread != null;
  const activeApproval = session.pendingApprovals[0];

  // Clear waitingForResponse once we get a streaming assistant message
  useEffect(() => {
    if (waitingForResponse && session.messages.some((m) => m.role === "assistant" && m.streaming)) {
      setWaitingForResponse(false);
    }
  }, [waitingForResponse, session.messages]);

  function handleSelectSession(deviceId: string, threadId: string) {
    const device =
      savedDevices.find((d) => d.id === deviceId) ??
      savedDevices.find((d) => d.deviceId === deviceId);
    if (device) {
      const t = connect(device);
      console.log(
        "[App] selectSession device=",
        device.id,
        "thread=",
        threadId,
        "transport=",
        t,
        "existing connections=",
        Object.keys(useConnectionStore.getState().connections),
      );
      setActiveDevice(device.id);
      setActiveThreadId(threadId);
    } else {
      console.warn("[App] selectSession: device not found for", deviceId);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ChatHeader
        devices={headerDevices}
        activeSessionTitle={session.thread?.title}
        hasActiveSession={hasSession}
        onSelectSession={handleSelectSession}
        onRefresh={() => {
          // Save current session state so we reconnect after reload
          if (activeDeviceId && activeThreadId) {
            sessionStorage.setItem("kuumba-restore-device", activeDeviceId);
            sessionStorage.setItem("kuumba-restore-thread", activeThreadId);
          }
          // Hard reload like Ctrl+Shift+R
          window.location.reload();
        }}
        onOpenNotes={() => setNotesOpen(true)}
        hasNotes={hasSession}
      />

      {/* Content area */}
      {session.loading ? (
        <div className="flex-1 overflow-hidden">
          <MessageSkeleton />
          <MessageSkeleton />
        </div>
      ) : session.error ? (
        <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="text-destructive-foreground"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p className="text-center text-sm text-muted-foreground">{session.error}</p>
          <button
            onClick={() => setActiveThreadId(null)}
            className="text-sm font-medium text-primary"
          >
            Go back
          </button>
        </main>
      ) : hasSession ? (
        <>
          {/* Session toolbar with terminal toggle */}
          <div className="flex items-center justify-between border-b border-border px-4 py-1.5">
            <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
              {session.thread?.projectName ?? "Session"}
            </span>
            <button
              onClick={() => setTerminalVisible(true)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground active:bg-muted"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              Terminal
            </button>
          </div>
          <MessagesList
            messages={session.messages}
            activities={session.activities}
            proposedPlans={session.proposedPlans}
            threadTitle={session.thread?.title}
            projectName={session.thread?.projectName}
            deviceHost={activeDevice?.config.host}
            devicePort={activeDevice?.config.port}
            authToken={activeDevice?.config.authToken}
          />
        </>
      ) : (
        <main className="flex flex-1 flex-col overflow-y-auto px-4 pb-4">
          {/* Hero */}
          <div className="flex flex-col items-center gap-3 pt-8 pb-6 text-center">
            <img src="/icon.png" alt="Kuumba Code" className="size-16 rounded-2xl" />
            <h1 className="text-xl font-bold text-foreground">Kuumba Code</h1>
            <p className="text-sm text-muted-foreground">
              {savedDevices.length > 0
                ? "Select a session to start monitoring"
                : "Connect to a desktop running Kuumba Code to monitor and interact with coding sessions remotely."}
            </p>
          </div>

          {/* Device cards */}
          {headerDevices.length > 0 ? (
            <div className="flex flex-col gap-3">
              {headerDevices.map((device) => {
                const totalSessions = device.projects.reduce(
                  (sum, p) => sum + p.sessions.length,
                  0,
                );
                const isDeviceCollapsed = collapsedDevices.has(device.deviceId);

                return (
                  <div
                    key={device.deviceId}
                    className="overflow-hidden rounded-xl border border-border bg-card"
                  >
                    {/* Device header — tap to collapse/expand */}
                    <button
                      className="flex w-full items-center gap-3 px-4 py-3 active:bg-muted/50"
                      onClick={() =>
                        setCollapsedDevices((prev) => {
                          const next = new Set(prev);
                          if (next.has(device.deviceId)) next.delete(device.deviceId);
                          else next.add(device.deviceId);
                          return next;
                        })
                      }
                    >
                      <span
                        className={cn(
                          "size-2.5 shrink-0 rounded-full",
                          device.online ? "bg-emerald-500" : "bg-red-500",
                        )}
                      />
                      <div className="flex min-w-0 flex-1 flex-col items-start">
                        <span className="text-sm font-semibold text-foreground">
                          {device.deviceName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {totalSessions} session{totalSessions !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <ChevronDown
                        className={cn(
                          "size-4 text-muted-foreground transition-transform duration-200",
                          isDeviceCollapsed && "-rotate-90",
                        )}
                      />
                    </button>

                    {/* Device body — projects & sessions */}
                    {!isDeviceCollapsed && (
                      <div className="border-t border-border px-4 pb-3 pt-1">
                        {device.projects.map((project) => {
                          const projectKey = `${device.deviceId}:${project.projectName}`;
                          const isProjectCollapsed = collapsedProjects.has(projectKey);

                          return (
                            <div key={projectKey} className="mt-2">
                              {/* Project header — tap to collapse/expand */}
                              <button
                                className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 active:bg-muted/50"
                                onClick={() =>
                                  setCollapsedProjects((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(projectKey)) next.delete(projectKey);
                                    else next.add(projectKey);
                                    return next;
                                  })
                                }
                              >
                                <ChevronRight
                                  className={cn(
                                    "size-3.5 text-muted-foreground transition-transform duration-200",
                                    !isProjectCollapsed && "rotate-90",
                                  )}
                                />
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  {project.projectName}
                                </span>
                                <span className="text-[10px] text-muted-foreground/60">
                                  {project.sessions.length}
                                </span>
                              </button>

                              {/* Sessions list */}
                              {!isProjectCollapsed && (
                                <div className="ml-1 flex flex-col gap-0.5">
                                  {project.sessions.map((s) => (
                                    <button
                                      key={s.threadId}
                                      className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-left active:bg-muted/60"
                                      onClick={() =>
                                        handleSelectSession(device.deviceId, s.threadId)
                                      }
                                    >
                                      <span
                                        className={cn(
                                          "size-1.5 shrink-0 rounded-full",
                                          s.status === "running"
                                            ? "bg-blue-500"
                                            : s.status === "ready" || s.status === "idle"
                                              ? "bg-emerald-500"
                                              : s.status === "error"
                                                ? "bg-red-500"
                                                : "bg-muted-foreground/40",
                                        )}
                                      />
                                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                        {s.title}
                                      </span>
                                      <span className="shrink-0 text-[11px] capitalize text-muted-foreground">
                                        {s.status}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {device.projects.length === 0 && (
                          <p className="py-3 text-center text-xs text-muted-foreground">
                            No shared sessions
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : savedDevices.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Link
                to="/connect"
                className="rounded-lg border border-dashed border-border px-6 py-3 text-sm font-medium text-primary active:bg-muted/50"
              >
                + Add a device
              </Link>
            </div>
          ) : null}
        </main>
      )}

      {/* Working indicator — matches desktop style */}
      {hasSession && isStreaming && <WorkingIndicator />}

      <Composer
        disabled={!hasSession}
        hasSession={hasSession}
        isWorking={isStreaming}
        isUltrathink={reasoningLevel === "ultrathink"}
        placeholder={hasSession ? "Ask anything, @tag files..." : "Connect a device to start..."}
        interactionMode={interactionMode}
        runtimeMode={runtimeMode}
        onSend={(text, images) => {
          setWaitingForResponse(true);
          session.sendMessage(text, images, { runtimeMode, interactionMode, provider });
        }}
        onStop={session.stopTurn}
        onModelPickerOpen={() => setModelPickerOpen(true)}
        onOpenNotes={() => setNotesOpen(true)}
        projectContext={session.thread?.projectName}
        onToggleInteractionMode={() => {
          const newMode = interactionMode === "chat" ? "plan" : "chat";
          setInteractionMode(newMode);
          sendComposerState({ interactionMode: newMode === "plan" ? "plan" : "default" });
        }}
        onToggleRuntimeMode={() => {
          const newMode = runtimeMode === "full-access" ? "approval-required" : "full-access";
          setRuntimeMode(newMode);
          sendComposerState({ runtimeMode: newMode });
        }}
        approvalPanel={
          activeApproval ? (
            <ApprovalPanel
              type={activeApproval.type.includes("command") ? "command" : "file-change"}
              detail={activeApproval.detail}
              pendingCount={session.pendingApprovals.length}
              currentIndex={0}
              onApprove={() => session.respondToApproval(activeApproval.requestId, "approve")}
              onDecline={() => session.respondToApproval(activeApproval.requestId, "deny")}
            />
          ) : undefined
        }
      />

      <ModelPicker
        open={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        provider={provider}
        selectedModel={selectedModel}
        reasoningLevel={reasoningLevel}
        fastMode={fastMode}
        onSelectModel={(model) => {
          setSelectedModel(model);
          sendComposerState({ model });
        }}
        onReasoningLevelChange={(level) => {
          setReasoningLevel(level);
          sendComposerState({ reasoningLevel: level });
        }}
        onFastModeChange={(enabled) => {
          setFastMode(enabled);
          sendComposerState({ fastMode: enabled ? "true" : "false" });
        }}
      />

      <NotesModal
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        transport={transport}
        projectCwd={session.thread?.projectCwd ?? ""}
        projectName={session.thread?.projectName ?? ""}
      />

      <TerminalViewer
        open={terminalVisible}
        onClose={() => setTerminalVisible(false)}
      />
    </div>
  );
}

function WorkingIndicator() {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5">
      <div className="flex gap-[3px]">
        <span className="size-[5px] rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
        <span className="size-[5px] rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
        <span className="size-[5px] rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
      </div>
      <span className="text-xs text-muted-foreground/60">Working for {elapsed}s</span>
    </div>
  );
}
