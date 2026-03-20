import { memo } from "react";
import { Volume2, VolumeX, Loader2 } from "lucide-react";
import { useTTS } from "~/lib/tts/useTTS";

interface ReadAloudButtonProps {
  /** The raw markdown content of the AI response */
  content: string;
}

export const ReadAloudButton = memo(function ReadAloudButton({
  content,
}: ReadAloudButtonProps) {
  const { isSpeaking, isLoading, toggle } = useTTS();

  return (
    <button
      type="button"
      onClick={() => void toggle(content)}
      disabled={isLoading}
      title={
        isLoading
          ? "Loading voice..."
          : isSpeaking
            ? "Stop reading"
            : "Read aloud"
      }
      className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md
                 text-muted-foreground hover:text-foreground hover:bg-muted
                 transition-colors disabled:opacity-50 disabled:cursor-wait"
    >
      {isLoading ? (
        <Loader2 className="size-3 animate-spin" />
      ) : isSpeaking ? (
        <VolumeX className="size-3" />
      ) : (
        <Volume2 className="size-3" />
      )}
      <span>
        {isLoading ? "Loading..." : isSpeaking ? "Stop" : "Read aloud"}
      </span>
    </button>
  );
});
