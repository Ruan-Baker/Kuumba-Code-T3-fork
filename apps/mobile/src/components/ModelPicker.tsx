import { useEffect, useRef, useState, useCallback } from "react";
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
  fastMode?: boolean | undefined;
  onSelectModel: (modelId: string) => void;
  onReasoningLevelChange: (level: string) => void;
  onFastModeChange?: ((enabled: boolean) => void) | undefined;
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
  fastMode = false,
  onSelectModel,
  onReasoningLevelChange,
  onFastModeChange,
}: ModelPickerProps) {
  // Swipe to close
  const [dragY, setDragY] = useState(0);
  const dragging = useRef(false);
  const dragStartY = useRef(0);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragging.current = true;
    dragStartY.current = e.touches[0]!.clientY;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragging.current) return;
    setDragY(Math.max(0, e.touches[0]!.clientY - dragStartY.current));
  }, []);

  const onTouchEnd = useCallback(() => {
    dragging.current = false;
    if (dragY > 100) onClose();
    setDragY(0);
  }, [dragY, onClose]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    dragStartY.current = e.clientY;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      setDragY(Math.max(0, ev.clientY - dragStartY.current));
    };
    const onUp = () => {
      dragging.current = false;
      setDragY((y) => { if (y > 100) onClose(); return 0; });
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [onClose]);

  if (!open) return null;

  const models = MODEL_OPTIONS_BY_PROVIDER[provider];
  const effortOptions = provider === "claudeAgent"
    ? CLAUDE_CODE_EFFORT_OPTIONS
    : CODEX_REASONING_EFFORT_OPTIONS;

  const providerLabel = provider === "claudeAgent" ? "Claude" : "Codex";

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div
        className="relative flex max-h-[75vh] flex-col rounded-t-2xl border-t border-border bg-background transition-transform"
        style={{
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragging.current ? "none" : "transform 0.2s ease-out",
        }}
      >
        {/* Swipe handle */}
        <div
          className="flex justify-center pb-1.5 pt-2.5 cursor-grab active:cursor-grabbing touch-none"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onMouseDown={onMouseDown}
        >
          <div className="h-1 w-9 rounded-full bg-border" />
        </div>

        {/* Header — no close button */}
        <div className="flex items-center px-5 pb-3 pt-1">
          <span className="text-base font-semibold text-foreground">
            {providerLabel} Models
          </span>
        </div>

        {/* Model list */}
        <div className="flex-1 overflow-y-auto px-5 pb-2">
          {models.map((model) => {
            const isSelected = selectedModel === model.slug;
            return (
              <button
                key={model.slug}
                onClick={() => onSelectModel(model.slug)}
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

        {/* Fast mode toggle */}
        <div className="border-t border-border px-5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Fast mode
            </span>
            <button
              onClick={() => onFastModeChange?.(!fastMode)}
              className={cn(
                "relative h-6 w-11 rounded-full transition-colors",
                fastMode ? "bg-primary" : "bg-muted-foreground/20",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform",
                  fastMode && "translate-x-5",
                )}
              />
            </button>
          </div>
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
