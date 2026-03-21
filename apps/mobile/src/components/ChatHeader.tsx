import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { Settings, ChevronDown, ChevronLeft, RefreshCw } from "lucide-react";
import { cn } from "~/lib/utils";

interface SessionInfo {
  threadId: string;
  title: string;
  status: string;
}

interface ProjectGroup {
  projectName: string;
  sessions: SessionInfo[];
}

interface DeviceWithProjects {
  deviceId: string;
  deviceName: string;
  online: boolean;
  projects: ProjectGroup[];
}

interface ChatHeaderProps {
  devices?: DeviceWithProjects[] | undefined;
  activeSessionTitle?: string | undefined;
  hasActiveSession?: boolean | undefined;
  onSelectSession?: ((deviceId: string, threadId: string) => void) | undefined;
  onRefresh?: (() => void) | undefined;
}

export function ChatHeader({
  devices = [],
  activeSessionTitle,
  hasActiveSession,
  onSelectSession,
  onRefresh,
}: ChatHeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  // Store by ID, not object reference, so re-renders don't reset the view
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  function closeDropdown() {
    setDropdownOpen(false);
    setSelectedDeviceId(null);
    setSelectedProjectName(null);
  }

  function handleSelectSession(deviceId: string, threadId: string) {
    console.log("[Header] selectSession", deviceId, threadId);
    onSelectSession?.(deviceId, threadId);
    closeDropdown();
  }

  // Resolve current device/project from IDs
  const selectedDevice = selectedDeviceId ? devices.find((d) => d.deviceId === selectedDeviceId) : null;
  const selectedProject = selectedDevice && selectedProjectName
    ? selectedDevice.projects.find((p) => p.projectName === selectedProjectName)
    : null;

  const showDeviceList = !selectedDeviceId;
  const showProjectList = selectedDevice != null && !selectedProjectName;
  const showSessionList = selectedDevice != null && selectedProject != null;

  // Pill label
  const onlineDevices = devices.filter((d) => d.online);
  const pillLabel = activeSessionTitle
    ?? (onlineDevices.length > 0 ? onlineDevices[0]!.deviceName :
        devices.length > 0 ? devices[0]!.deviceName : "No device");
  const pillOnline = hasActiveSession || onlineDevices.length > 0;

  const [spinning, setSpinning] = useState(false);
  const handleRefresh = useCallback(() => {
    setSpinning(true);
    onRefresh?.();
    setTimeout(() => setSpinning(false), 1000);
  }, [onRefresh]);

  return (
    <header className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
      <div className="flex items-center gap-1.5">
        <Link
          to="/settings"
          className="flex size-9 items-center justify-center rounded-full border border-border active:bg-muted"
        >
          <Settings className="size-[18px] text-foreground" />
        </Link>
        <button
          onClick={handleRefresh}
          className="flex size-9 items-center justify-center rounded-full border border-border active:bg-muted"
        >
          <RefreshCw className={cn("size-[16px] text-foreground", spinning && "animate-spin")} />
        </button>
      </div>

      <div className="flex-1" />

      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => {
            if (dropdownOpen) closeDropdown();
            else setDropdownOpen(true);
          }}
          className="flex h-9 w-[160px] items-center gap-1.5 rounded-full border border-border px-3 pl-2.5 active:bg-muted"
        >
          <span className={cn("size-2 shrink-0 rounded-full", pillOnline ? "bg-success" : "bg-muted-foreground/40")} />
          <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-foreground">
            {pillLabel}
          </span>
          <ChevronDown className={cn("size-3 shrink-0 text-muted-foreground transition-transform", dropdownOpen && "rotate-180")} />
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
            {/* Back button */}
            {(showProjectList || showSessionList) && (
              <button
                onClick={() => {
                  if (showSessionList) setSelectedProjectName(null);
                  else { setSelectedDeviceId(null); setSelectedProjectName(null); }
                }}
                className="flex w-full items-center gap-2 border-b border-border/50 px-3 py-2 text-left active:bg-muted"
              >
                <ChevronLeft className="size-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">
                  {showSessionList ? selectedDevice!.deviceName : "Devices"}
                </span>
              </button>
            )}

            {/* Device list */}
            {showDeviceList && (
              devices.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm text-muted-foreground">No devices connected</p>
                  <Link to="/connect" onClick={() => closeDropdown()} className="mt-2 inline-block text-xs font-medium text-primary">
                    Add a device
                  </Link>
                </div>
              ) : (
                <div className="max-h-[280px] overflow-y-auto py-1">
                  {devices.map((device) => (
                    <button
                      key={device.deviceId}
                      onClick={() => {
                        if (!device.online) return;
                        setSelectedDeviceId(device.deviceId);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2.5 text-left",
                        device.online ? "active:bg-muted" : "opacity-40",
                      )}
                    >
                      <span className={cn("size-1.5 shrink-0 rounded-full", device.online ? "bg-success" : "bg-destructive")} />
                      <span className="flex-1 truncate text-sm text-foreground">{device.deviceName}</span>
                      {device.online && (
                        <span className="text-[11px] text-muted-foreground">
                          {device.projects.reduce((n, p) => n + p.sessions.length, 0)} sessions
                        </span>
                      )}
                      {!device.online && (
                        <span className="text-[11px] text-muted-foreground">Offline</span>
                      )}
                    </button>
                  ))}
                </div>
              )
            )}

            {/* Project list */}
            {showProjectList && selectedDevice && (
              <div className="max-h-[280px] overflow-y-auto py-1">
                {selectedDevice.projects.length === 0 ? (
                  <div className="px-4 py-5 text-center text-xs text-muted-foreground">
                    No shared sessions
                  </div>
                ) : (
                  selectedDevice.projects.map((project) => (
                    <button
                      key={project.projectName}
                      onClick={() => setSelectedProjectName(project.projectName)}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left active:bg-muted"
                    >
                      <span className="flex-1 truncate text-sm text-foreground">{project.projectName}</span>
                      <span className="text-[11px] text-muted-foreground">{project.sessions.length}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Session list */}
            {showSessionList && selectedDevice && selectedProject && (
              <div className="max-h-[280px] overflow-y-auto py-1">
                {selectedProject.sessions.map((session) => (
                  <button
                    key={session.threadId}
                    onClick={() => handleSelectSession(selectedDevice.deviceId, session.threadId)}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left active:bg-muted"
                  >
                    <span className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      session.status === "running" ? "bg-primary" :
                      session.status === "ready" ? "bg-success" :
                      session.status === "error" ? "bg-destructive" : "bg-muted-foreground",
                    )} />
                    <span className="flex-1 truncate text-sm text-foreground">{session.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
