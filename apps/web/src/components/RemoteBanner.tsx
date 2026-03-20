import { MonitorIcon, XIcon } from "lucide-react";
import { useRemoteConnectionStore } from "../remoteConnection";
import { resetToLocalApi } from "../nativeApi";
import { useNavigate } from "@tanstack/react-router";

export function RemoteBanner() {
  const { isActive, connectedDeviceName, disconnect } = useRemoteConnectionStore();
  const navigate = useNavigate();

  if (!isActive) return null;

  const handleDisconnect = () => {
    resetToLocalApi();
    disconnect();
    void navigate({ to: "/" });
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border-b border-blue-500/20 text-xs text-blue-600 dark:text-blue-400">
      <MonitorIcon className="size-3.5 shrink-0" />
      <span className="flex-1 truncate">
        Viewing remote session on <strong>{connectedDeviceName ?? "Unknown device"}</strong>
      </span>
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
