import { memo } from "react";
import { Volume2, VolumeX, Loader2, AlertCircle } from "lucide-react";
import { useTTS } from "~/lib/tts/useTTS";

interface ReadAloudButtonProps {
  /** The raw markdown content of the AI response */
  content: string;
}

export const ReadAloudButton = memo(function ReadAloudButton({
  content,
}: ReadAloudButtonProps) {
  const { status, speed, isSpeaking, isLoading, toggle, cycleSpeed } =
    useTTS();

  const hasError = status.state === "error";
  const isActive = isSpeaking || isLoading;

  return (
    <span className="inline-flex items-center gap-0.5">
      {/* Play / Stop button */}
      <button
        type="button"
        onClick={() => void toggle(content)}
        disabled={isLoading}
        title={
          hasError
            ? status.error ?? "TTS error"
            : isLoading
              ? "Loading voice..."
              : isSpeaking
                ? "Stop reading"
                : "Read aloud"
        }
        className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md
                   transition-colors disabled:opacity-50 disabled:cursor-wait
                   ${hasError ? "text-destructive hover:text-destructive hover:bg-destructive/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
      >
        {isLoading ? (
          <Loader2 className="size-3 animate-spin" />
        ) : hasError ? (
          <AlertCircle className="size-3" />
        ) : isSpeaking ? (
          <VolumeX className="size-3" />
        ) : (
          <Volume2 className="size-3" />
        )}
        <span>
          {isLoading
            ? "Loading..."
            : hasError
              ? "Voice failed — retry?"
              : isSpeaking
                ? "Stop"
                : "Read aloud"}
        </span>
      </button>

      {/* Speed toggle — only visible while speaking or loading */}
      {isActive && (
        <button
          type="button"
          onClick={cycleSpeed}
          title={`Playback speed: ${speed}x (click to change)`}
          className="inline-flex items-center justify-center px-1.5 py-1 text-xs
                     font-medium tabular-nums rounded-md
                     text-muted-foreground hover:text-foreground hover:bg-muted
                     transition-colors min-w-[2.25rem]"
        >
          {speed}x
        </button>
      )}
    </span>
  );
});
