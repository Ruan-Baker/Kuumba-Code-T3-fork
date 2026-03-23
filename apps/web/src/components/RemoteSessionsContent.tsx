import { ChevronRightIcon, MonitorIcon, SettingsIcon, WifiIcon, WifiOffIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAppSettings } from "../appSettings";
import { useRelay } from "../lib/useRelayConnection";
import { useRemoteConnectionStore } from "../remoteConnection";
import type { PairedDevice } from "../lib/relay-transport";
import type { RelayTransport } from "../lib/relay-transport";
import { createRelayNativeApi } from "../wsNativeApi";
import { setActiveApi } from "../nativeApi";
import { ProjectNotesPopover } from "./ProjectNotesPopover";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { Badge } from "./ui/badge";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "./ui/sidebar";

function statusColor(status: string): string {
  switch (status) {
    case "running":
    case "ready":
      return "bg-green-500";
    case "starting":
    case "idle":
      return "bg-yellow-500";
    case "error":
      return "bg-red-500";
    default:
      return "bg-gray-400";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return "Working";
    case "ready":
      return "Ready";
    case "starting":
      return "Starting";
    case "idle":
      return "Idle";
    case "error":
      return "Error";
    default:
      return status;
  }
}

/** Group sessions by projectId so we can show notes per project */
function groupSessionsByProject(sessions: PairedDevice["sessions"]) {
  const groups = new Map<
    string,
    { projectName: string; projectCwd: string; sessions: PairedDevice["sessions"] }
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

// ── Relay device group ────────────────────────────────────────────────

function RelayDeviceGroup({
  device,
  transport,
}: {
  device: PairedDevice;
  transport: RelayTransport;
}) {
  const [expanded, setExpanded] = useState(true);
  const { connectViaRelay } = useRemoteConnectionStore();
  const navigate = useNavigate();

  const handleSessionClick = (session: PairedDevice["sessions"][number]) => {
    const { api, bridge } = createRelayNativeApi(transport, device.deviceId);

    transport.registerMessageHandler(device.deviceId, (plaintext) => {
      bridge.handleRelayMessage(plaintext);
    });

    connectViaRelay(transport, device.deviceId, device.deviceName);
    setActiveApi(api);

    void navigate({ to: "/$threadId", params: { threadId: session.threadId } });
  };

  const sessions = device.sessions;
  const projectGroups = groupSessionsByProject(sessions);

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
            {device.deviceName}
          </span>
          {device.online ? (
            <WifiIcon className="size-3 text-green-500 shrink-0" />
          ) : (
            <WifiOffIcon className="size-3 text-red-400 shrink-0" />
          )}
        </SidebarMenuButton>

        <CollapsibleContent>
          <SidebarMenuSub className="mx-1 my-0 w-full translate-x-0 gap-0.5 px-1.5 py-0">
            {!device.online ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground/60 italic">
                Device offline
              </div>
            ) : sessions.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground/60 italic">
                No active sessions
              </div>
            ) : (
              projectGroups.map((group) => (
                <div key={group.projectCwd} className="mb-1">
                  <div className="group/project flex items-center gap-1 px-1 py-0.5">
                    <span className="flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                      {group.projectName}
                    </span>
                    <div className="opacity-0 group-hover/project:opacity-100 transition-opacity">
                      <ProjectNotesPopover
                        projectCwd={group.projectCwd}
                        projectName={group.projectName}
                      />
                    </div>
                  </div>
                  {group.sessions.map((session) => (
                    <SidebarMenuSubItem key={session.threadId}>
                      <SidebarMenuSubButton
                        className="flex items-center gap-1.5 py-1"
                        onClick={() => handleSessionClick(session)}
                      >
                        <span
                          className={`size-1.5 shrink-0 rounded-full ${statusColor(session.status)}`}
                        />
                        <span className="flex-1 truncate text-xs">
                          {session.title || session.projectName}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 leading-none">
                          {statusLabel(session.status)}
                        </Badge>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </div>
              ))
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

export function RemoteSessionsContent() {
  const { settings } = useAppSettings();
  const navigate = useNavigate();

  // Use the global relay transport (managed by useRelayConnection at app root)
  const { transport, connected: relayConnected, pairedDevices } = useRelay();

  const hasRelayUrl = !!settings.relayUrl;

  // Show empty state when relay is not configured
  if (!hasRelayUrl) {
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

  return (
    <SidebarContent>
      <SidebarGroup>
        {pairedDevices.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground/50 italic">
            {relayConnected
              ? "No paired devices. Add a device in Settings."
              : "Connecting to relay…"}
          </div>
        ) : (
          <SidebarMenu>
            {pairedDevices.map((device) => (
              <RelayDeviceGroup key={device.deviceId} device={device} transport={transport!} />
            ))}
          </SidebarMenu>
        )}
      </SidebarGroup>
    </SidebarContent>
  );
}
