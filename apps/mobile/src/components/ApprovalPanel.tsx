import { Terminal } from "lucide-react";

interface ApprovalPanelProps {
  type: "command" | "file-read" | "file-change";
  detail: string;
  pendingCount: number;
  currentIndex: number;
  onApprove: () => void;
  onDecline: () => void;
}

export function ApprovalPanel({
  type,
  detail,
  pendingCount,
  currentIndex,
  onApprove,
  onDecline,
}: ApprovalPanelProps) {
  const label =
    type === "command"
      ? "Run command"
      : type === "file-read"
        ? "Read file"
        : "Edit file";

  return (
    <div className="flex flex-col gap-2 p-3.5">
      <div className="flex items-center gap-1.5">
        <Terminal className="size-3.5 text-warning" />
        <span className="text-[13px] font-medium text-foreground">
          {label}
        </span>
        {pendingCount > 1 && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {currentIndex + 1} of {pendingCount}
          </span>
        )}
      </div>

      <div className="rounded-lg bg-background/50 px-2.5 py-2">
        <code className="font-mono text-[13px] text-foreground">{detail}</code>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onDecline}
          className="flex h-9 flex-1 items-center justify-center rounded-lg border border-border text-[13px] font-medium text-destructive-foreground active:bg-muted"
        >
          Decline
        </button>
        <button
          onClick={onApprove}
          className="flex h-9 flex-1 items-center justify-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground active:bg-primary/90"
        >
          Approve
        </button>
      </div>
    </div>
  );
}
