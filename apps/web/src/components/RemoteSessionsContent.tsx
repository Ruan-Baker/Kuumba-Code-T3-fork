import {
  ChevronRightIcon,
  Loader2,
  MonitorIcon,
  SettingsIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAppSettings } from "../appSettings";
import {
  useRemoteDevices,
  type RemoteDeviceStatus,
  type RemoteSessionInfo,
} from "../remoteDevices";
import {
  useRemoteConnectionStore,
  setActiveRemoteBridge,
} from "../remoteConnection";
import { createRelayNativeApi } from "../wsNativeApi";
import { useConnectionContext } from "../connectionContext";
import { useRelay } from "../lib/useRelayConnection";
import { ProjectNotesPopover } from "./ProjectNotesPopover";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "./ui/sidebar";

// ── Status helpers ─────────────────────────────────────────────────────

function threadStatusInfo(status: string) {
  switch (status) {
    case "running":
      return { label: "Working", dotClass: "bg-green-500", colorClass: "text-green-600 dark:text-green-400", pulse: true };
    case "ready":
      return { label: "Ready", dotClass: "bg-green-500", colorClass: "text-green-600 dark:text-green-400", pulse: false };
    case "starting":
      return { label: "Starting", dotClass: "bg-yellow-500", colorClass: "text-yellow-600 dark:text-yellow-400", pulse: true };
    case "idle":
      return { label: "Idle", dotClass: "bg-yellow-500", colorClass: "text-yellow-600 dark:text-yellow-400", pulse: false };
    case "error":
      return { label: "Error", dotClass: "bg-red-500", colorClass: "text-red-600 dark:text-red-400", pulse: false };
    default:
      return { label: status || "Unknown", dotClass: "bg-gray-400", colorClass: "text-muted-foreground", pulse: false };
  }
}

/** Group sessions by projectId */
function groupSessionsByProject(sessions: RemoteSessionInfo[]) {
  const groups = new Map<
    string,
    { projectName: string; projectCwd: string; sessions: RemoteSessionInfo[] }
  >();
  for (const session of sessions) {
    const key = session.projectId;
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.set(key, {
        projectName: session.projectName,
        projectCwd: session.projectCwd,
        sessions: [session],
      });
    }
  }
  return Array.from(groups.values());
}

// ── Remote device group ────────────────────────────────────────────────

function RemoteDeviceGroup({
  deviceStatus,
}: {
  deviceStatus: RemoteDeviceStatus;
}) {
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);
  const { setStatus, connectViaRelay } = useRemoteConnectionStore();
  const { setRemote } = useConnectionContext();
  const { transport } = useRelay();
  const navigate = useNavigate();

  const handleSessionClick = async (session: RemoteSessionInfo) => {
    if (loading) return;
    setLoading(true);
    try {
      const deviceName = deviceStatus.info?.deviceName ?? deviceStatus.config.name;
      const targetDeviceId = deviceStatus.config.deviceId;

      if (!transport) {
        throw new Error("Relay transport not connected");
      }

      // Create a real relay bridge + NativeApi for this remote device
      const { api, bridge } = createRelayNativeApi(transport, targetDeviceId);

      // Store the bridge so other components can use it
      setActiveRemoteBridge(bridge);

      // Switch the global connection context to remote mode
      // RelayWsBridge implements the WsTransport interface (subscribe, request, dispose, etc.)
      setRemote(api, bridge as any, deviceStatus.config, deviceName);
      connectViaRelay(transport, targetDeviceId, deviceName);
      setStatus("connected");

      // Navigate to the thread
      void navigate({ to: "/$threadId", params: { threadId: session.threadId } });
    } catch (err) {
      console.error("[RemoteSession] Failed to connect:", err);
      setStatus("error", err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  const sessions = deviceStatus.info?.sessions ?? [];
  const projectGroups = groupSessionsByProject(sessions);
  const deviceName = deviceStatus.info?.deviceName ?? deviceStatus.config.name;

  return (
    <SidebarMenuItem>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <SidebarMenuButton onClick={() => setExpanded(!expanded)} className="gap-1.5 py-1">
          <ChevronRightIcon
            className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
              expanded ? "rotate-90" : ""
            }`}
          />
          <MonitorIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
          <span className="flex-1 truncate text-xs font-medium text-foreground/90">
            {deviceName}
          </span>
          {loading ? (
            <Loader2 className="size-3 animate-spin text-primary shrink-0" />
          ) : deviceStatus.online ? (
            <WifiIcon className="size-3 text-green-500 shrink-0" />
          ) : (
            <WifiOffIcon className="size-3 text-red-400 shrink-0" />
          )}
        </SidebarMenuButton>

        <CollapsibleContent>
          {!deviceStatus.online ? (
            <div className="px-4 py-2 text-xs text-muted-foreground/60 italic">
              Device offline
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-4 py-2 text-xs text-muted-foreground/60 italic">
              No active sessions
            </div>
          ) : (
            projectGroups.map((group) => (
              <Collapsible key={group.projectCwd} defaultOpen>
                {/* Project header — matches local sidebar style */}
                <SidebarGroupLabel className="group/project flex h-7 items-center gap-1 px-3">
                  <span className="flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                    {group.projectName}
                  </span>
                  <div className="shrink-0 opacity-0 transition-opacity group-hover/project:opacity-100">
                    <ProjectNotesPopover
                      projectCwd={group.projectCwd}
                      projectName={group.projectName}
                    />
                  </div>
                </SidebarGroupLabel>

                {/* Session items — matches local sidebar thread items */}
                <SidebarMenuSub className="mr-0 w-full translate-x-0 gap-0 border-l-0 px-0">
                  {group.sessions.map((session) => {
                    const status = threadStatusInfo(session.status);
                    return (
                      <SidebarMenuSubItem key={session.threadId} className="w-full">
                        <SidebarMenuSubButton
                          size="sm"
                          className="flex w-full items-center gap-1.5 py-1 pr-2"
                          onClick={() => void handleSessionClick(session)}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                            <span className={`inline-flex items-center gap-1 text-[10px] ${status.colorClass}`}>
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${status.dotClass} ${
                                  status.pulse ? "animate-pulse" : ""
                                }`}
                              />
                              <span className="hidden md:inline">{status.label}</span>
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs">
                              {session.title || session.projectName}
                            </span>
                          </div>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </Collapsible>
            ))
          )}
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

// ── Main content ───────────────────────────────────────────────────────

export function RemoteSessionsContent() {
  const { settings } = useAppSettings();
  const navigate = useNavigate();
  const { pairedDevices } = useRelay();

  const remoteDevices = settings.remoteDevices ?? [];
  const { statuses, updateDeviceSessions, updateDeviceStatus } = useRemoteDevices(remoteDevices);

  // Wire relay paired device data into the UI status map.
  useEffect(() => {
    for (const pd of pairedDevices) {
      const matchingConfig = remoteDevices.find((rd) => rd.deviceId === pd.deviceId);
      if (!matchingConfig) continue;

      if (pd.online && pd.sessions.length > 0) {
        updateDeviceSessions(pd.deviceId, {
          deviceId: pd.deviceId,
          deviceName: pd.deviceName,
          sessions: pd.sessions.map((s) => ({
            threadId: s.threadId,
            projectId: s.projectId,
            projectName: s.projectName,
            projectCwd: s.projectCwd,
            status: s.status,
            title: s.title,
          })),
        });
      } else if (pd.online) {
        updateDeviceStatus(pd.deviceId, { online: true });
      } else {
        updateDeviceStatus(pd.deviceId, { online: false, info: null });
      }
    }
  }, [pairedDevices, remoteDevices, updateDeviceSessions, updateDeviceStatus]);

  const hasDevices = remoteDevices.length > 0;

  if (!hasDevices) {
    return (
      <SidebarContent>
        <SidebarGroup>
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
            <div className="flex items-center justify-center rounded-full bg-muted/50 p-3">
              <MonitorIcon className="size-6 text-muted-foreground/40" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground/70">No remote devices yet</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground/50">
                Add your other machines in Settings to view their shared sessions here.
              </p>
            </div>
            <button
              onClick={() => void navigate({ to: "/settings" })}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-muted"
            >
              <SettingsIcon className="size-3" />
              Open Settings
            </button>
          </div>
        </SidebarGroup>
      </SidebarContent>
    );
  }

  const deviceStatusList = Array.from(statuses.values());

  return (
    <SidebarContent>
      <SidebarGroup className="gap-0">
        {deviceStatusList.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground/50 italic">
            Connecting to remote devices...
          </div>
        ) : (
          <SidebarMenu>
            {deviceStatusList.map((deviceStatus) => (
              <RemoteDeviceGroup
                key={deviceStatus.config.deviceId}
                deviceStatus={deviceStatus}
              />
            ))}
          </SidebarMenu>
        )}
      </SidebarGroup>
    </SidebarContent>
  );
}
