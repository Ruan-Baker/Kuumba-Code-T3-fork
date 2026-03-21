import { memo } from "react";
import { Volume2, VolumeX, Loader2, AlertCircle, Download, Check } from "lucide-react";
import { useTTS } from "~/lib/tts/useTTS";

interface ReadAloudButtonProps {
  /** The raw markdown content of the AI response */
  content: string;
}

export const ReadAloudButton = memo(function ReadAloudButton({ content }: ReadAloudButtonProps) {
  const {
    status,
    speed,
    isSpeaking,
    isLoading,
    needsDownload,
    toggle,
    cycleSpeed,
    downloadModel,
  } = useTTS();

  const hasError = status.state === "error";
  const isActive = isSpeaking || isLoading;
  const isDownloading = status.state === "downloading";

  return (
    <span className="relative inline-flex items-center gap-0.5">
      {/* Download overlay — inline in the message area */}
      {(needsDownload || isDownloading) && (
        <span className="inline-flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          {isDownloading ? (
            <>
              <Download className="size-4 shrink-0 text-primary" />
              <span className="flex flex-col gap-1">
                <span className="text-xs font-medium text-foreground">Downloading voice engine</span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${status.progress ?? 0}%` }}
                    />
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {status.progress ?? 0}%
                  </span>
                </span>
              </span>
            </>
          ) : (
            <>
              <Download className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-foreground">Voice engine required</span>
                <span className="text-[11px] text-muted-foreground">~90MB one-time download</span>
              </span>
              <button
                onClick={() => void downloadModel()}
                className="ml-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Download
              </button>
            </>
          )}
        </span>
      )}

      {/* Normal play/stop button — hidden during download flow */}
      {!needsDownload && !isDownloading && (
        <>
          <button
            type="button"
            onClick={() => void toggle(content)}
            disabled={isLoading}
            title={
              hasError
                ? (status.error ?? "TTS error")
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
        </>
      )}
    </span>
  );
});
