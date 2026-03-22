import { memo } from "react";
import { Volume2, VolumeX, Loader2, AlertCircle } from "lucide-react";
import { useTTS } from "~/lib/tts/useTTS";

interface ReadAloudButtonProps {
  content: string;
}

export const ReadAloudButton = memo(function ReadAloudButton({ content }: ReadAloudButtonProps) {
  const { status, speed, isSpeaking, isLoading, toggle, cycleSpeed } = useTTS();

  const hasError = status.state === "error";
  const isActive = isSpeaking || isLoading;

  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => void toggle(content)}
        disabled={isLoading}
        className={`inline-flex min-h-[28px] items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors
                   ${hasError ? "text-destructive-foreground active:bg-destructive/10" : "text-muted-foreground active:bg-muted"}`}
      >
        {isLoading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : hasError ? (
          <AlertCircle className="size-3.5" />
        ) : isSpeaking ? (
          <VolumeX className="size-3.5" />
        ) : (
          <Volume2 className="size-3.5" />
        )}
      </button>

      {isActive && (
        <button
          type="button"
          onClick={cycleSpeed}
          className="inline-flex min-h-[28px] min-w-[2rem] items-center justify-center rounded-md px-1 py-1 text-xs font-medium tabular-nums text-muted-foreground active:bg-muted"
        >
          {speed}x
        </button>
      )}
    </span>
  );
});
