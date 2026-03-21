import {
  ChevronRightIcon,
  MonitorIcon,
  RadioIcon,
  SettingsIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAppSettings, type RemoteDeviceConfig } from "../appSettings";
import {
  useRemoteDevices,
  useRelayDevices,
  type RemoteDeviceStatus,
  type RemoteSessionInfo,
} from "../remoteDevices";
import { useRemoteConnectionStore, buildRemoteWsUrl } from "../remoteConnection";
import type { PairedDevice } from "../lib/relay-transport";
import type { RelayTransport } from "../lib/relay-transport";
import { createRemoteNativeApi, createRelayNativeApi } from "../wsNativeApi";
import { setActiveApi } from "../nativeApi";
import { setNotesApiOverride, clearNotesApiOverride } from "../projectNotesStore";
import { ProjectNotesPopover } from "./ProjectNotesPopover";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { Badge } from "./ui/badge";
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

function RemoteDeviceGroup({ deviceStatus }: { deviceStatus: RemoteDeviceStatus }) {
  const [expanded, setExpanded] = useState(true);
  const navigate = useNavigate();
  const { connect, setStatus } = useRemoteConnectionStore();

  // Create a cached remote API for this device so notes can read/write remotely
  const remoteApi = useMemo(() => {
    if (!deviceStatus.online) return null;
    const wsUrl = buildRemoteWsUrl(deviceStatus.config);
    return createRemoteNativeApi(wsUrl);
  }, [deviceStatus.online, deviceStatus.config]);

  // Set API overrides for each project cwd so the notes store uses the remote API
  const projectCwds = useMemo(() => {
    return (deviceStatus.info?.sessions ?? []).map((s) => s.projectCwd).filter(Boolean);
  }, [deviceStatus.info?.sessions]);

  useEffect(() => {
    if (!remoteApi) return;
    for (const cwd of projectCwds) {
      setNotesApiOverride(cwd, remoteApi);
    }
    return () => {
      for (const cwd of projectCwds) {
        clearNotesApiOverride(cwd);
      }
    };
  }, [remoteApi, projectCwds]);

  const handleSessionClick = async (session: RemoteSessionInfo) => {
    try {
      connect(deviceStatus.config, deviceStatus.info?.deviceName ?? deviceStatus.config.name);
      const wsUrl = buildRemoteWsUrl(deviceStatus.config);
      const remoteApi = createRemoteNativeApi(wsUrl);
      setActiveApi(remoteApi);
      setStatus("connected");
      void navigate({ to: "/$threadId", params: { threadId: session.threadId } });
    } catch (err) {
      setStatus("error", err instanceof Error ? err.message : "Connection failed");
    }
  };

  const deviceName = deviceStatus.info?.deviceName ?? deviceStatus.config.name;
  const sessions = deviceStatus.info?.sessions ?? [];
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
            {deviceName}
          </span>
          {deviceStatus.online ? (
            <WifiIcon className="size-3 text-green-500 shrink-0" />
          ) : (
            <WifiOffIcon className="size-3 text-red-400 shrink-0" />
          )}
        </SidebarMenuButton>

        <CollapsibleContent>
          <SidebarMenuSub className="mx-1 my-0 w-full translate-x-0 gap-0.5 px-1.5 py-0">
            {!deviceStatus.online ? (
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
                  {/* Project header with notes button */}
                  <div className="group/project flex items-center gap-1 px-1 py-0.5">
                    <span className="flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                      {group.projectName}
                    </span>
                    {/* Notes button — reads/writes on the REMOTE server */}
                    <div className="opacity-0 group-hover/project:opacity-100 transition-opacity">
                      <ProjectNotesPopover
                        projectCwd={group.projectCwd}
                        projectName={group.projectName}
                      />
                    </div>
                  </div>
                  {/* Sessions under this project */}
                  {group.sessions.map((session) => (
                    <SidebarMenuSubItem key={session.threadId}>
                      <SidebarMenuSubButton
                        className="flex items-center gap-1.5 py-1"
                        onClick={() => void handleSessionClick(session)}
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
    // Create a NativeApi backed by the relay bridge for this device.
    const { api, bridge } = createRelayNativeApi(transport, device.deviceId);

    // Wire the relay transport to deliver decrypted messages to this bridge.
    transport.registerMessageHandler(device.deviceId, (plaintext) => {
      bridge.handleRelayMessage(plaintext);
    });

    // Record the relay connection in the global store and activate the API.
    connectViaRelay(transport, device.deviceId, device.deviceName);
    setActiveApi(api);

    void navigate({ to: "/$threadId", params: { threadId: session.threadId } });
  };

  const sessions = device.sessions;

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
              sessions.map((session) => (
                <SidebarMenuSubItem key={session.threadId}>
                  <SidebarMenuSubButton
                    className="flex items-center gap-1.5 py-1"
                    onClick={() => handleSessionClick(session)}
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${statusColor(session.status)}`}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-xs">
                        {session.title || "Untitled"}
                      </span>
                      <span className="truncate text-[10px] text-muted-foreground/60">
                        {session.projectName}
                      </span>
                    </span>
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 leading-none shrink-0">
                      {statusLabel(session.status)}
                    </Badge>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
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
  const { statuses } = useRemoteDevices(settings.remoteDevices);

  // Relay-based presence — only active when a relayUrl is configured.
  const relayConfig = settings.relayUrl
    ? {
        relayUrl: settings.relayUrl,
        deviceId: settings.devicePairingToken,
        deviceName: settings.tailscaleHostname || "This device",
        pairingToken: settings.devicePairingToken,
      }
    : null;
  const { transport, pairedDevices, relayConnected } = useRelayDevices(relayConfig);

  const navigate = useNavigate();

  const hasTailscaleDevices = settings.remoteDevices.length > 0;
  const hasRelayUrl = !!settings.relayUrl;

  // Show empty state only when neither Tailscale nor relay is configured.
  if (!hasTailscaleDevices && !hasRelayUrl) {
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

  // All Tailscale devices online but none have shared sessions (only when no relay).
  const tailscaleAllOnlineNoSessions =
    hasTailscaleDevices &&
    statuses.every((s) => s.online && (s.info?.sessions ?? []).length === 0);
  const relayAllNoSessions =
    hasRelayUrl && pairedDevices.every((d) => !d.online || d.sessions.length === 0);

  if (
    tailscaleAllOnlineNoSessions &&
    relayAllNoSessions &&
    statuses.length > 0 &&
    pairedDevices.length >= 0
  ) {
    const noPairedAtAll = !hasRelayUrl || pairedDevices.length === 0;
    if (noPairedAtAll || (relayConnected && relayAllNoSessions)) {
      // Only show the "no shared sessions" screen when no Tailscale sessions AND
      // relay is either not connected or also has no sessions.
    }
  }

  return (
    <SidebarContent>
      {/* ── Relay devices section ─────────────────────────────────────── */}
      {hasRelayUrl && (
        <SidebarGroup>
          {hasTailscaleDevices && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/50 px-2 pb-0.5">
              Relay
              {relayConnected ? (
                <span className="ml-1.5 inline-block size-1.5 rounded-full bg-green-500" />
              ) : (
                <span className="ml-1.5 inline-block size-1.5 rounded-full bg-yellow-500 animate-pulse" />
              )}
            </SidebarGroupLabel>
          )}
          {pairedDevices.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground/50 italic">
              {relayConnected ? "No paired devices" : "Connecting to relay…"}
            </div>
          ) : (
            <SidebarMenu>
              {pairedDevices.map((device) => (
                <RelayDeviceGroup
                  key={device.deviceId}
                  device={device}
                  transport={transport!}
                />
              ))}
            </SidebarMenu>
          )}
        </SidebarGroup>
      )}

      {/* ── Tailscale devices section ─────────────────────────────────── */}
      {hasTailscaleDevices && (
        <SidebarGroup>
          {hasRelayUrl && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/50 px-2 pb-0.5">
              Tailscale
            </SidebarGroupLabel>
          )}
          <SidebarMenu>
            {statuses.map((deviceStatus) => (
              <RemoteDeviceGroup
                key={`${deviceStatus.config.tailscaleHost}:${deviceStatus.config.port}`}
                deviceStatus={deviceStatus}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      )}
    </SidebarContent>
  );
}
