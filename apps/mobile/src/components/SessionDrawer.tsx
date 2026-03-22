import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { cn } from "~/lib/utils";

interface SessionItem {
  threadId: string;
  title: string;
  projectName: string;
  status: "idle" | "running" | "ready" | "error";
}

interface DeviceGroup {
  deviceId: string;
  deviceName: string;
  online: boolean;
  sessions: SessionItem[];
}

interface SessionDrawerProps {
  open: boolean;
  onClose: () => void;
  devices: DeviceGroup[];
  activeThreadId?: string | undefined;
  onSelectSession?: ((deviceId: string, threadId: string) => void) | undefined;
}

const statusColors: Record<string, string> = {
  idle: "bg-muted-foreground",
  running: "bg-primary",
  ready: "bg-success",
  error: "bg-destructive",
};

const statusLabels: Record<string, string> = {
  idle: "Idle",
  running: "Working",
  ready: "Ready",
  error: "Error",
};

export type { DeviceGroup, SessionItem };

export function SessionDrawer({
  open,
  onClose,
  devices,
  activeThreadId,
  onSelectSession,
}: SessionDrawerProps) {
  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Drawer */}
      <div className="relative flex max-h-[70vh] flex-col rounded-t-2xl border-t border-border bg-background">
        {/* Handle */}
        <div className="flex justify-center pb-1.5 pt-2.5">
          <div className="h-1 w-9 rounded-full bg-border" />
        </div>

        {/* Title */}
        <div className="flex items-center justify-between px-5 pb-3.5 pt-1">
          <span className="text-base font-semibold text-foreground">Sessions</span>
          <div className="flex items-center gap-2">
            <Link
              to="/connect"
              onClick={onClose}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-primary active:bg-muted"
            >
              + Add Device
            </Link>
            <button
              onClick={onClose}
              className="flex size-8 items-center justify-center rounded-full bg-muted active:bg-muted/80"
            >
              <X className="size-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 pb-8">
          {devices.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="text-sm text-muted-foreground">No devices connected</span>
              <Link to="/connect" onClick={onClose} className="text-sm font-medium text-primary">
                Add your first device
              </Link>
            </div>
          ) : (
            devices.map((device) => (
              <div key={device.deviceId} className="mb-2">
                {/* Device header */}
                <div className="flex items-center gap-2 px-1 pb-1.5 pt-2.5">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      device.online ? "bg-success" : "bg-destructive",
                    )}
                  />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {device.deviceName}
                  </span>
                  {!device.online && (
                    <span className="text-[11px] text-muted-foreground/60">Offline</span>
                  )}
                </div>

                {/* Sessions grouped by project */}
                {device.online && device.sessions.length === 0 && (
                  <div className="px-3 py-4 text-center text-[13px] text-muted-foreground">
                    No shared sessions
                  </div>
                )}
                {Object.entries(
                  device.sessions.reduce<Record<string, SessionItem[]>>((acc, s) => {
                    const key = s.projectName;
                    if (!acc[key]) acc[key] = [];
                    acc[key].push(s);
                    return acc;
                  }, {}),
                ).map(([projectName, sessions]) => (
                  <div key={projectName}>
                    {/* Project group label */}
                    <div className="px-3 pb-0.5 pt-2">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                        {projectName}
                      </span>
                    </div>
                    {sessions.map((session) => {
                      const isActive = session.threadId === activeThreadId;
                      return (
                        <button
                          key={session.threadId}
                          onClick={() => {
                            onSelectSession?.(device.deviceId, session.threadId);
                            onClose();
                          }}
                          className={cn(
                            "mt-0.5 flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left active:bg-muted",
                            isActive && "border border-primary/15 bg-primary/8",
                          )}
                        >
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              statusColors[session.status] ?? "bg-muted-foreground",
                            )}
                          />
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate text-sm font-medium text-foreground">
                              {session.title}
                            </span>
                            <span
                              className={cn(
                                "text-[11px] font-medium",
                                session.status === "running" && "text-primary",
                                session.status === "ready" && "text-success-foreground",
                                session.status === "error" && "text-destructive-foreground",
                                session.status === "idle" && "text-muted-foreground",
                              )}
                            >
                              {statusLabels[session.status]}
                            </span>
                          </div>
                          {isActive && (
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className="shrink-0 text-primary"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
