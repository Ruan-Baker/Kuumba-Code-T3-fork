import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  MODEL_OPTIONS_BY_PROVIDER,
  CLAUDE_CODE_EFFORT_OPTIONS,
  CODEX_REASONING_EFFORT_OPTIONS,
} from "@t3tools/contracts";

export type ProviderKind = "claudeAgent" | "codex";
export type ReasoningLevel = string;

interface ModelPickerProps {
  open: boolean;
  onClose: () => void;
  provider: ProviderKind;
  selectedModel: string;
  reasoningLevel: string;
  onSelectModel: (modelId: string) => void;
  onReasoningLevelChange: (level: string) => void;
}

const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
  ultrathink: "Ultrathink",
  xhigh: "Extra High",
};

export function ModelPicker({
  open,
  onClose,
  provider,
  selectedModel,
  reasoningLevel,
  onSelectModel,
  onReasoningLevelChange,
}: ModelPickerProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  if (!open) return null;

  const models = MODEL_OPTIONS_BY_PROVIDER[provider];
  const effortOptions = provider === "claudeAgent"
    ? CLAUDE_CODE_EFFORT_OPTIONS
    : CODEX_REASONING_EFFORT_OPTIONS;

  const providerLabel = provider === "claudeAgent" ? "Claude" : "Codex";

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative flex max-h-[70vh] flex-col rounded-t-2xl border-t border-border bg-background">
        <div className="flex justify-center pb-1.5 pt-2.5">
          <div className="h-1 w-9 rounded-full bg-border" />
        </div>

        <div className="flex items-center justify-between px-5 pb-3 pt-1">
          <span className="text-base font-semibold text-foreground">
            {providerLabel} Models
          </span>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full bg-muted active:bg-muted/80"
          >
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {models.map((model) => {
            const isSelected = selectedModel === model.slug;
            return (
              <button
                key={model.slug}
                onClick={() => { onSelectModel(model.slug); }}
                className="flex w-full items-center gap-3 border-b border-border/40 py-3 text-left active:bg-muted/50"
              >
                <div
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                    isSelected ? "border-primary" : "border-muted-foreground/30",
                  )}
                >
                  {isSelected && <div className="size-2.5 rounded-full bg-primary" />}
                </div>
                <span className="text-sm font-medium text-foreground">
                  {model.name}
                </span>
              </button>
            );
          })}
        </div>

        {/* Reasoning effort */}
        <div className="border-t border-border px-5 pb-8 pt-4">
          <span className="mb-3 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {provider === "claudeAgent" ? "Effort" : "Reasoning"}
          </span>
          <div className="flex gap-1.5">
            {effortOptions.map((level) => {
              const isActive = reasoningLevel === level;
              const isUltrathink = level === "ultrathink";
              return (
                <button
                  key={level}
                  onClick={() => onReasoningLevelChange(level)}
                  className={cn(
                    "flex flex-1 items-center justify-center rounded-lg border py-2 text-xs font-medium transition-colors",
                    isActive
                      ? isUltrathink
                        ? "ultrathink-pill border-transparent text-foreground"
                        : "border-primary/30 bg-primary/8 text-primary"
                      : "border-border text-muted-foreground active:bg-muted",
                  )}
                >
                  {EFFORT_LABELS[level] ?? level}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
