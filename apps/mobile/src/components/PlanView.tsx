import { memo, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { cn } from "~/lib/utils";
import { ChatMarkdown } from "./ChatMarkdown";

interface ProposedPlan {
  id: string;
  planMarkdown: string;
  implementedAt: string | null;
  createdAt: string;
}

interface PlanViewProps {
  plan: ProposedPlan;
}

export const PlanView = memo(function PlanView({ plan }: PlanViewProps) {
  const [expanded, setExpanded] = useState(false);

  // Extract title from first line of markdown
  const firstLine = plan.planMarkdown.split("\n")[0] ?? "Plan";
  const title = firstLine.replace(/^#+\s*/, "").trim() || "Proposed Plan";

  return (
    <div className="my-2 rounded-xl border border-border bg-card">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left active:bg-muted/50"
      >
        <FileText className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          {plan.implementedAt && (
            <span className="ml-2 text-[10px] font-medium text-success-foreground">
              Implemented
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {/* Expanded plan content */}
      {expanded && (
        <div className="border-t border-border px-3.5 py-3">
          <div className="text-sm">
            <ChatMarkdown text={plan.planMarkdown} />
          </div>
        </div>
      )}
    </div>
  );
});
