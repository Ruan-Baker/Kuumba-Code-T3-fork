import { memo, useState } from "react";
import { Copy, ChevronDown } from "lucide-react";
import { cn } from "~/lib/utils";
import { ChatMarkdown } from "./ChatMarkdown";
import { ReadAloudButton } from "./ReadAloudButton";
import type { ActivityEntry } from "~/lib/useSession";

interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  text: string;
  streaming?: boolean | undefined;
  createdAt: string;
  elapsedMs?: number | undefined;
  activities?: ActivityEntry[] | undefined;
  changedFiles?: string[] | undefined;
  deviceHost?: string | undefined;
  devicePort?: number | undefined;
  authToken?: string | undefined;
}

export const MessageBubble = memo(function MessageBubble({
  role,
  text,
  streaming,
  createdAt,
  elapsedMs,
  activities,
  changedFiles,
}: MessageBubbleProps) {
  const [workLogOpen, setWorkLogOpen] = useState(false);

  const time = new Date(createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  function handleCopy() {
    void navigator.clipboard.writeText(text);
  }

  if (role === "system") return null;

  const toolActivities = activities?.filter((a) => a.tone === "tool" || a.tone === "info") ?? [];
  const hasWorkLog = role === "assistant" && toolActivities.length > 0;
  const hasChangedFiles = role === "assistant" && changedFiles && changedFiles.length > 0;

  // --- User message: matches desktop exactly ---
  // Desktop: flex justify-end > max-w-[80%] rounded-2xl rounded-br-sm border border-border bg-secondary px-4 py-3
  if (role === "user") {
    return (
      <div className="flex justify-end py-1">
        <div className="max-w-[80%] min-w-0 overflow-hidden rounded-2xl rounded-br-sm border border-border bg-secondary px-4 py-3">
          <div className="message-content whitespace-pre-wrap text-sm text-foreground">
            {text}
          </div>
          <p className="mt-1.5 text-right text-[10px] text-muted-foreground/30">{time}</p>
        </div>
      </div>
    );
  }

  // --- Assistant message: matches desktop layout ---
  // Desktop: min-w-0 px-1 py-0.5 > ChatMarkdown > turn summary > actions
  return (
    <div className="min-w-0 max-w-full overflow-hidden px-1 py-1">
      {/* Content */}
      <div className="message-content min-w-0 max-w-full overflow-hidden">
        <ChatMarkdown text={text || (streaming ? "" : "(empty response)")} isStreaming={streaming} />
      </div>

      {/* Changed files */}
      {hasChangedFiles && (
        <div className="mt-2 rounded-lg border border-border/80 bg-card/45 p-2.5">
          <p className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
            Changed files ({changedFiles!.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {changedFiles!.map((file) => (
              <span key={file} className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                {file.split("/").pop()}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Work log */}
      {hasWorkLog && !streaming && (
        <div className="mt-1.5 rounded-lg border border-border/40 bg-muted/20">
          <button onClick={() => setWorkLogOpen(!workLogOpen)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left">
            <ChevronDown className={cn("size-3 text-muted-foreground transition-transform", workLogOpen && "rotate-180")} />
            <span className="text-xs font-medium text-muted-foreground">Work log</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{toolActivities.length}</span>
          </button>
          {workLogOpen && (
            <div className="flex flex-col border-t border-border/30 px-3 py-1">
              {toolActivities.map((a) => (
                <div key={a.id} className="flex items-center gap-2 py-1">
                  <span className="truncate text-xs text-muted-foreground">{a.summary}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions row */}
      {!streaming && (
        <div className="mt-1.5 flex items-center gap-1">
          <button onClick={handleCopy} className="flex size-7 items-center justify-center rounded-md active:bg-muted">
            <Copy className="size-3.5 text-muted-foreground" />
          </button>
          <ReadAloudButton content={text} />
          {elapsedMs != null && (
            <span className="ml-auto text-[10px] text-muted-foreground/30">{(elapsedMs / 1000).toFixed(1)}s</span>
          )}
          <span className={cn("text-[10px] text-muted-foreground/30", elapsedMs == null && "ml-auto")}>{time}</span>
        </div>
      )}
    </div>
  );
});
