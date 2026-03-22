import { memo, useState } from "react";
import { Terminal, FileText, FileEdit, Search, ChevronDown, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { cn } from "~/lib/utils";
import type { ActivityEntry } from "~/lib/useSession";

interface ActivityCardProps {
  activity: ActivityEntry;
}

function getIcon(kind: string, tone: string) {
  if (kind.includes("command") || kind.includes("bash") || kind.includes("terminal")) {
    return <Terminal className="size-3.5" />;
  }
  if (kind.includes("write") || kind.includes("edit") || kind.includes("Edit")) {
    return <FileEdit className="size-3.5" />;
  }
  if (kind.includes("read") || kind.includes("Read") || kind.includes("file")) {
    return <FileText className="size-3.5" />;
  }
  if (kind.includes("search") || kind.includes("grep") || kind.includes("glob")) {
    return <Search className="size-3.5" />;
  }
  if (tone === "error") {
    return <XCircle className="size-3.5" />;
  }
  return <Terminal className="size-3.5" />;
}

function getStatusIcon(kind: string) {
  if (kind.includes("completed") || kind.includes("updated")) {
    return <CheckCircle2 className="size-3 text-success-foreground" />;
  }
  if (kind.includes("started")) {
    return <Loader2 className="size-3 animate-spin text-muted-foreground" />;
  }
  return null;
}

export const ActivityCard = memo(function ActivityCard({ activity }: ActivityCardProps) {
  const [expanded, setExpanded] = useState(false);

  const payload = activity.payload as Record<string, unknown> | null;
  const detail = typeof payload?.detail === "string" ? payload.detail : null;
  const command = typeof payload?.command === "string" ? payload.command : null;
  const kind = activity.kind ?? "";
  const isCommand = kind.includes("command") || kind.includes("bash") || !!command;

  // Don't render thinking/internal activities
  if (kind === "tool.started") return null;
  if (activity.summary === "Checkpoint captured") return null;
  if (!kind && !activity.summary) return null;

  return (
    <div
      className={cn(
        "my-1 rounded-lg border",
        activity.tone === "error"
          ? "border-destructive/20 bg-destructive/5"
          : "border-border/50 bg-muted/20",
      )}
    >
      <button
        onClick={() => detail && setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left",
          detail && "active:bg-muted/30",
        )}
      >
        <span className={cn(
          "shrink-0",
          activity.tone === "error" ? "text-destructive-foreground" : "text-muted-foreground",
        )}>
          {getIcon(activity.kind, activity.tone)}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {activity.summary}
        </span>
        {detail && (
          <ChevronDown className={cn(
            "size-3 shrink-0 text-muted-foreground/50 transition-transform",
            expanded && "rotate-180",
          )} />
        )}
      </button>

      {/* Expanded detail — command output or file content */}
      {expanded && detail && (
        <div className="border-t border-border/30 px-3 py-2">
          <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
            {detail.length > 2000 ? detail.slice(0, 2000) + "\n..." : detail}
          </pre>
        </div>
      )}
    </div>
  );
});
