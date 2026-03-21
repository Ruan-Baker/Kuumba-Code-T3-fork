import { useState, useEffect, useCallback, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChatHeader } from "~/components/ChatHeader";
import { Composer } from "~/components/Composer";
import { MessagesList } from "~/components/MessagesList";
import { MessageSkeleton } from "~/components/LoadingSkeleton";
import { ModelPicker } from "~/components/ModelPicker";
import { ApprovalPanel } from "~/components/ApprovalPanel";
import { showToast } from "~/components/Toast";
import { useSettingsStore } from "~/stores/settingsStore";
import { useDevicesStore } from "~/stores/devicesStore";
import { useConnectionStore } from "~/stores/connectionStore";
import { useSession } from "~/lib/useSession";
import { NotesModal } from "~/components/NotesModal";

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
  const [runtimeMode, setRuntimeMode] = useState<"full-access" | "approval-required">("full-access");
  const [notesOpen, setNotesOpen] = useState(false);

  const savedDevices = useSettingsStore((s) => s.savedDevices);
  const { devices, refreshAll } = useDevicesStore();
  const { activeDeviceId, setActiveDevice, connect, disconnect, getActiveTransport } =
    useConnectionStore();

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

  // Session hook
  const transport = getActiveTransport();
  console.log("[App] render: activeDeviceId=", activeDeviceId, "activeThreadId=", activeThreadId, "transport=", !!transport);
  const session = useSession(transport, activeThreadId);

  const { relayDevices } = useConnectionStore();

  // Build device list — merge HTTP-polled (direct) and relay-provided devices
  function buildDeviceList() {
    const result: Array<{
      deviceId: string;
      deviceName: string;
      online: boolean;
      projects: Array<{ projectName: string; sessions: Array<{ threadId: string; title: string; status: string }> }>;
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
        projects: Object.entries(projectMap).map(([projectName, sess]) => ({ projectName, sessions: sess })),
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
        projectMap[pName]!.push({ threadId: s.threadId, title: s.title || "Untitled", status: s.status });
      }
      result.push({
        deviceId: sd.id,
        deviceName: sd.name,
        online: rd?.online ?? false,
        projects: Object.entries(projectMap).map(([projectName, sess]) => ({ projectName, sessions: sess })),
      });
    }

    return result;
  }

  const headerDevices = buildDeviceList();

  const activeDevice = activeDeviceId ? devices[activeDeviceId] : undefined;
  const activeSavedDevice = savedDevices.find((d) => d.id === activeDeviceId);
  const isStreaming = session.messages.some((m) => m.streaming);
  const hasSession = activeThreadId != null && session.thread != null;
  const activeApproval = session.pendingApprovals[0];

  function handleSelectSession(deviceId: string, threadId: string) {
    const device = savedDevices.find((d) => d.id === deviceId)
      ?? savedDevices.find((d) => d.deviceId === deviceId);
    if (device) {
      const t = connect(device);
      console.log("[App] selectSession device=", device.id, "thread=", threadId, "transport=", t, "existing connections=", Object.keys(useConnectionStore.getState().connections));
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
          // Re-poll direct devices
          doPoll();
          // Reconnect relay devices
          for (const device of savedDevices) {
            if (device.isRelay) {
              disconnect(device.id);
              connectedRelayIds.current.delete(device.id);
            }
          }
          // They'll auto-reconnect via the useEffect
          setTimeout(() => {
            for (const device of savedDevices) {
              if (device.isRelay && !connectedRelayIds.current.has(device.id)) {
                connectedRelayIds.current.add(device.id);
                connect(device);
              }
            }
          }, 500);
        }}
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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-destructive-foreground">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p className="text-center text-sm text-muted-foreground">{session.error}</p>
          <button onClick={() => setActiveThreadId(null)} className="text-sm font-medium text-primary">
            Go back
          </button>
        </main>
      ) : hasSession ? (
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
      ) : (
        <main className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4">
          <div className="flex flex-col items-center gap-4 text-center">
            <img src="/icon.png" alt="Kuumba Code" className="size-16 rounded-2xl" />
            <h1 className="text-xl font-bold text-foreground">Kuumba Code</h1>
            <p className="text-sm text-muted-foreground">Mobile Companion</p>
            <p className="max-w-[280px] text-sm leading-relaxed text-muted-foreground">
              {savedDevices.length > 0
                ? "Select a session from the device picker to start monitoring."
                : "Connect to a desktop running Kuumba Code to monitor and interact with coding sessions remotely."}
            </p>
          </div>
        </main>
      )}

      <Composer
        disabled={!hasSession}
        hasSession={hasSession}
        isWorking={isStreaming}
        isUltrathink={reasoningLevel === "ultrathink"}
        placeholder={hasSession ? "Ask anything, @tag files..." : "Connect a device to start..."}
        interactionMode={interactionMode}
        runtimeMode={runtimeMode}
        onSend={(text) => session.sendMessage(text)}
        onStop={session.stopTurn}
        onModelPickerOpen={() => setModelPickerOpen(true)}
        onOpenNotes={() => setNotesOpen(true)}
        projectContext={session.thread?.projectName}
        onToggleInteractionMode={() => setInteractionMode((m) => (m === "chat" ? "plan" : "chat"))}
        onToggleRuntimeMode={() => setRuntimeMode((m) => (m === "full-access" ? "approval-required" : "full-access"))}
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
        onSelectModel={setSelectedModel}
        onReasoningLevelChange={setReasoningLevel}
      />

      <NotesModal
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        transport={transport}
        projectCwd={session.thread?.projectCwd ?? ""}
        projectName={session.thread?.projectName ?? ""}
      />
    </div>
  );
}
