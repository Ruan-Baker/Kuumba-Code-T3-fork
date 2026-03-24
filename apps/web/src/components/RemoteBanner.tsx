import { MonitorIcon, XIcon, WifiIcon, AlertTriangleIcon, WifiOffIcon } from "lucide-react";
import { useRemoteConnectionStore } from "../remoteConnection";
import { useConnectionContext, selectPresence, selectRemoteDeviceName } from "../connectionContext";
import { useNavigate } from "@tanstack/react-router";
import type { RemotePresenceState } from "@t3tools/contracts";

function presenceIcon(presence: RemotePresenceState) {
  switch (presence) {
    case "healthy":
      return <WifiIcon className="size-3 text-green-500 shrink-0" />;
    case "degraded":
      return <AlertTriangleIcon className="size-3 text-yellow-500 shrink-0" />;
    case "reconnecting":
    case "connecting":
      return <WifiIcon className="size-3 text-yellow-500 shrink-0 animate-pulse" />;
    case "offline":
    case "error":
    case "auth_failed":
      return <WifiOffIcon className="size-3 text-red-400 shrink-0" />;
    default:
      return <WifiIcon className="size-3 text-muted-foreground shrink-0" />;
  }
}

function presenceLabel(presence: RemotePresenceState): string | null {
  switch (presence) {
    case "degraded":
      return "Connection unstable";
    case "reconnecting":
      return "Reconnecting...";
    case "offline":
      return "Offline";
    case "error":
      return "Connection error";
    case "auth_failed":
      return "Authentication failed";
    default:
      return null;
  }
}

export function RemoteBanner() {
  const { isActive, disconnect } = useRemoteConnectionStore();
  const presence = useConnectionContext(selectPresence);
  const deviceName = useConnectionContext(selectRemoteDeviceName);
  const { resetToLocal } = useConnectionContext();
  const navigate = useNavigate();

  const isRemote = useConnectionContext((s) => s.mode === "remote");

  if (!isActive && !isRemote) return null;

  const displayName = deviceName ?? "Unknown device";
  const statusLabel = presenceLabel(presence);

  const handleDisconnect = () => {
    resetToLocal();
    disconnect();
    void navigate({ to: "/" });
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border-b border-blue-500/20 text-xs text-blue-600 dark:text-blue-400">
      <MonitorIcon className="size-3.5 shrink-0" />
      <span className="flex-1 truncate">
        Viewing remote session on <strong>{displayName}</strong>
      </span>
      {presenceIcon(presence)}
      {statusLabel && <span className="text-[10px] text-muted-foreground/70">{statusLabel}</span>}
      <button
        type="button"
        className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium hover:bg-blue-500/20 transition-colors"
        onClick={handleDisconnect}
      >
        <XIcon className="size-3" />
        Disconnect
      </button>
    </div>
  );
}
