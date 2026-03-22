import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { ActivityCard } from "./ActivityCard";
import { TurnDiffSummary } from "./TurnDiffSummary";
import { PlanView } from "./PlanView";
import type { ActivityEntry, ProposedPlan } from "~/lib/useSession";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming: boolean;
  createdAt: string;
  updatedAt: string;
}

interface MessagesListProps {
  messages: ChatMessage[];
  activities?: ActivityEntry[] | undefined;
  proposedPlans?: ProposedPlan[] | undefined;
  threadTitle?: string | undefined;
  projectName?: string | undefined;
  deviceHost?: string | undefined;
  devicePort?: number | undefined;
  authToken?: string | undefined;
}

interface TimelineItem {
  type: "message" | "activity" | "plan";
  createdAt: string;
  data: ChatMessage | ActivityEntry | ProposedPlan;
}

export function MessagesList({
  messages,
  activities = [],
  proposedPlans = [],
  threadTitle,
  projectName,
  deviceHost,
  devicePort,
  authToken,
}: MessagesListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, messages[messages.length - 1]?.text, activities.length]);

  // Build interleaved timeline sorted by createdAt
  const timeline: TimelineItem[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;
    timeline.push({ type: "message", createdAt: msg.createdAt, data: msg });
  }

  // Only show tool activities as cards between messages (not inside bubbles)
  for (const act of activities) {
    if (act.tone === "approval") continue; // approvals go in composer
    if (act.kind === "tool.started") continue;
    if (act.summary === "Checkpoint captured") continue;
    timeline.push({ type: "activity", createdAt: act.createdAt, data: act });
  }

  for (const plan of proposedPlans) {
    timeline.push({ type: "plan", createdAt: plan.createdAt, data: plan });
  }

  timeline.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Calculate elapsed time for assistant messages
  function getElapsedMs(msg: ChatMessage): number | undefined {
    if (msg.role !== "assistant") return undefined;
    const msgIdx = messages.indexOf(msg);
    for (let i = msgIdx - 1; i >= 0; i--) {
      const prev = messages[i];
      if (prev && prev.role === "user") {
        return new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime();
      }
    }
    return undefined;
  }

  // Extract changed files from activities near an assistant message
  function getChangedFiles(msg: ChatMessage): string[] {
    if (msg.role !== "assistant") return [];
    const msgTime = new Date(msg.createdAt).getTime();
    const files: string[] = [];
    for (const act of activities) {
      const payload = act.payload as Record<string, unknown> | null;
      const changedFiles = payload?.changedFiles;
      if (Array.isArray(changedFiles)) {
        const actTime = new Date(act.createdAt).getTime();
        if (actTime >= msgTime - 60000 && actTime <= msgTime + 300000) {
          for (const f of changedFiles) {
            if (typeof f === "string" && !files.includes(f)) files.push(f);
          }
        }
      }
    }
    return files;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-4">
      {threadTitle && (
        <div className="flex items-center gap-2 pb-3 pt-2">
          <span className="truncate text-sm font-medium text-foreground">{threadTitle}</span>
          {projectName && (
            <span className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {projectName}
            </span>
          )}
        </div>
      )}

      {timeline.map((item) => {
        if (item.type === "message") {
          const msg = item.data as ChatMessage;
          const changedFiles = getChangedFiles(msg);
          return (
            <div key={`msg-${msg.id}`}>
              <MessageBubble
                role={msg.role}
                text={msg.text}
                streaming={msg.streaming}
                createdAt={msg.createdAt}
                elapsedMs={getElapsedMs(msg)}
                changedFiles={changedFiles.length > 0 ? changedFiles : undefined}
                deviceHost={deviceHost}
                devicePort={devicePort}
                authToken={authToken}
              />
              {/* Show turn diff after assistant message if there are changed files */}
              {msg.role === "assistant" && !msg.streaming && changedFiles.length > 0 && (
                <TurnDiffSummary
                  files={changedFiles.map((f) => ({ path: f, additions: 0, deletions: 0 }))}
                />
              )}
            </div>
          );
        }

        if (item.type === "activity") {
          const act = item.data as ActivityEntry;
          return <ActivityCard key={`act-${act.id}`} activity={act} />;
        }

        if (item.type === "plan") {
          const plan = item.data as ProposedPlan;
          return <PlanView key={`plan-${plan.id}`} plan={plan} />;
        }

        return null;
      })}

      <div ref={bottomRef} />
    </div>
  );
}
