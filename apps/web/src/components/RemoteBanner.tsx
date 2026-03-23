import { MonitorIcon } from "lucide-react";
import { useRemoteConnectionStore } from "../remoteConnection";

export function RemoteBanner() {
  const { isActive, connectedDeviceName } = useRemoteConnectionStore();

  if (!isActive) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border-b border-blue-500/20 text-xs text-blue-600 dark:text-blue-400">
      <MonitorIcon className="size-3.5 shrink-0" />
      <span className="flex-1 truncate">
        Viewing remote session on <strong>{connectedDeviceName ?? "Unknown device"}</strong>
      </span>
    </div>
  );
}
