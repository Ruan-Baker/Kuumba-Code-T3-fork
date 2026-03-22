import { useEffect } from "react";
import { ImagePlus, Layers, MessageSquare, FileText, Lock, LockOpen } from "lucide-react";
import { cn } from "~/lib/utils";

interface ComposerMenuProps {
  open: boolean;
  onClose: () => void;
  hasSession: boolean;
  interactionMode: "chat" | "plan";
  runtimeMode: "full-access" | "approval-required";
  onAttachImage: () => void;
  onSelectModel: () => void;
  onToggleInteractionMode: () => void;
  onToggleRuntimeMode: () => void;
}

export function ComposerMenu({
  open,
  onClose,
  hasSession,
  interactionMode,
  runtimeMode,
  onAttachImage,
  onSelectModel,
  onToggleInteractionMode,
  onToggleRuntimeMode,
}: ComposerMenuProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div className="absolute bottom-full left-0 z-50 mb-2">
        <div className="flex w-52 flex-col rounded-xl border border-border bg-card shadow-lg">
          <MenuItem
            icon={<ImagePlus className="size-4" />}
            label="Attach image"
            disabled={!hasSession}
            onClick={() => {
              onAttachImage();
              onClose();
            }}
          />

          <div className="mx-3 h-px bg-border/50" />

          <MenuItem
            icon={<Layers className="size-4" />}
            label="Select model"
            disabled={!hasSession}
            onClick={() => {
              onSelectModel();
              onClose();
            }}
          />

          <div className="mx-3 h-px bg-border/50" />

          <MenuItem
            icon={
              interactionMode === "chat" ? (
                <MessageSquare className="size-4" />
              ) : (
                <FileText className="size-4" />
              )
            }
            label={interactionMode === "chat" ? "Chat mode" : "Plan mode"}
            active={interactionMode === "plan"}
            disabled={!hasSession}
            onClick={() => {
              onToggleInteractionMode();
            }}
          />

          <div className="mx-3 h-px bg-border/50" />

          <MenuItem
            icon={
              runtimeMode === "full-access" ? (
                <LockOpen className="size-4" />
              ) : (
                <Lock className="size-4" />
              )
            }
            label={runtimeMode === "full-access" ? "Full access" : "Supervised"}
            active={runtimeMode === "approval-required"}
            disabled={!hasSession}
            onClick={() => {
              onToggleRuntimeMode();
            }}
          />
        </div>
      </div>
    </>
  );
}

function MenuItem({
  icon,
  label,
  disabled,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean | undefined;
  active?: boolean | undefined;
  onClick: () => void;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={cn(
        "flex items-center gap-2.5 px-3.5 py-2.5 text-left",
        disabled ? "opacity-35" : "active:bg-muted",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[13px] text-foreground">{label}</span>
    </button>
  );
}
