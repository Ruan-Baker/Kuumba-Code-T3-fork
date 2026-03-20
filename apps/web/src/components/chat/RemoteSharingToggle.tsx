/**
 * RemoteSharingToggle — Lets you share/unshare the current session with remote devices.
 *
 * When active (green dot), the session is visible in the Remote tab on other devices
 * configured in Settings. When inactive, the session is local-only.
 */
import { useCallback, useEffect, useState } from "react";
import { RadioIcon } from "lucide-react";
import { ensureNativeApi, isRemoteApiActive } from "../../nativeApi";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Toggle } from "../ui/toggle";

interface RemoteSharingToggleProps {
  threadId: string;
}

export function RemoteSharingToggle({ threadId }: RemoteSharingToggleProps) {
  const [shared, setShared] = useState(false);
  const [loading, setLoading] = useState(false);

  // Don't show the toggle when already viewing a remote session
  const isRemote = isRemoteApiActive();

  // Fetch current sharing state on mount / thread change
  useEffect(() => {
    if (isRemote) return;
    let cancelled = false;
    const api = ensureNativeApi();
    api.sessions.getRemoteSharing({ threadId }).then(
      (result) => {
        if (!cancelled) setShared(result.shared);
      },
      () => {
        // Silently ignore — server might not support this yet
      },
    );
    return () => {
      cancelled = true;
    };
  }, [threadId, isRemote]);

  const toggle = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const api = ensureNativeApi();
      const result = await api.sessions.setRemoteSharing({
        threadId,
        shared: !shared,
      });
      setShared(result.shared);
    } catch {
      // Silently ignore errors
    } finally {
      setLoading(false);
    }
  }, [threadId, shared, loading]);

  // Hide toggle entirely when viewing a remote session
  if (isRemote) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="relative shrink-0"
            pressed={shared}
            onPressedChange={() => void toggle()}
            aria-label={shared ? "Stop sharing remotely" : "Share session remotely"}
            variant="outline"
            size="xs"
            disabled={loading}
          >
            <RadioIcon className="size-3" />
            {/* Green dot indicator */}
            {shared && (
              <span className="absolute -top-0.5 -right-0.5 flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-green-500" />
              </span>
            )}
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">
        {shared
          ? "Session is shared — visible to remote devices. Click to stop sharing."
          : "Share this session with your remote devices"}
      </TooltipPopup>
    </Tooltip>
  );
}
