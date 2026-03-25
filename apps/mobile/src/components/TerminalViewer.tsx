/**
 * Mobile terminal viewer — read-only display of desktop terminal output.
 * Renders as a bottom sheet with monospace text, auto-scrolls to bottom.
 */
import { useEffect, useRef, useState } from "react";
import { X, TerminalSquare } from "lucide-react";
import { useTerminalStore } from "~/stores/terminalStore";
import { cn } from "~/lib/utils";

interface TerminalViewerProps {
  open: boolean;
  onClose: () => void;
}

export function TerminalViewer({ open, onClose }: TerminalViewerProps) {
  const { terminals, activeTerminalId, setActiveTerminal } = useTerminalStore();
  const outputRef = useRef<HTMLPreElement>(null);

  // Swipe-to-close state
  const [dragY, setDragY] = useState(0);
  const dragging = useRef(false);
  const dragStartY = useRef(0);

  const terminalIds = Object.keys(terminals);
  const activeTerminal = activeTerminalId ? terminals[activeTerminalId] : null;

  // Auto-scroll to bottom on new output
  useEffect(() => {
    if (open && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [open, activeTerminal?.output]);

  if (!open) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    dragging.current = true;
    dragStartY.current = e.touches[0]!.clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging.current) return;
    const dy = e.touches[0]!.clientY - dragStartY.current;
    if (dy > 0) setDragY(dy);
  };

  const handleTouchEnd = () => {
    dragging.current = false;
    if (dragY > 120) {
      onClose();
    }
    setDragY(0);
  };

  const statusColor =
    activeTerminal?.status === "running"
      ? "bg-green-500"
      : activeTerminal?.status === "exited"
        ? "bg-muted-foreground/40"
        : activeTerminal?.status === "error"
          ? "bg-red-500"
          : "bg-yellow-500";

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Sheet */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col rounded-t-2xl bg-zinc-900 shadow-2xl transition-transform"
        style={{ transform: `translateY(${dragY}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center py-2">
          <div className="h-1 w-10 rounded-full bg-zinc-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 pb-2">
          <div className="flex items-center gap-2">
            <TerminalSquare className="size-4 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-200">Terminal</span>
            {activeTerminal && (
              <span className={cn("size-2 rounded-full", statusColor)} />
            )}
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full text-zinc-400 active:bg-zinc-700"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Tab bar (when multiple terminals) */}
        {terminalIds.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-b border-zinc-700 px-4 py-1.5">
            {terminalIds.map((id) => (
              <button
                key={id}
                onClick={() => setActiveTerminal(id)}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  id === activeTerminalId
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-400 active:bg-zinc-800",
                )}
              >
                {id.replace("terminal-", "T").slice(0, 8)}
              </button>
            ))}
          </div>
        )}

        {/* Terminal output */}
        {activeTerminal ? (
          <pre
            ref={outputRef}
            className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-all px-4 py-3 font-mono text-[11px] leading-[1.5] text-green-400"
          >
            {activeTerminal.output || "[No output yet]"}
          </pre>
        ) : (
          <div className="flex flex-1 items-center justify-center py-12">
            <p className="text-sm text-zinc-500">
              {terminalIds.length === 0
                ? "No terminal sessions active on desktop."
                : "Select a terminal tab above."}
            </p>
          </div>
        )}

        {/* Status bar */}
        {activeTerminal && (
          <div className="flex items-center gap-2 border-t border-zinc-700 px-4 py-2">
            <span className="truncate text-[10px] text-zinc-500">
              {activeTerminal.cwd || "~"}
            </span>
            {activeTerminal.status === "exited" && (
              <span className="ml-auto text-[10px] text-zinc-500">
                exit: {activeTerminal.exitCode ?? "?"}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}
