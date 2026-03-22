import { useEffect, useRef, useCallback, memo } from "react";
import { Mic, Square, Loader2, X } from "lucide-react";
import { cn } from "~/lib/utils";
import { useVoiceInput } from "~/lib/voice/useVoiceInput";

interface VoiceRecorderProps {
  disabled?: boolean | undefined;
  projectContext?: string | undefined;
  onTranscript: (text: string) => void;
}

function WaveformVisualizer({ getAnalyser }: { getAnalyser: () => AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      const analyser = getAnalyser();
      if (!canvas || !ctx) return;

      const { width, height } = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      if (!analyser) {
        drawBars(ctx, width, height, null);
        return;
      }

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);
      drawBars(ctx, width, height, dataArray);
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [getAnalyser]);

  return <canvas ref={canvasRef} className="h-full w-full" style={{ display: "block" }} />;
}

function drawBars(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  data: Uint8Array | null,
) {
  const barCount = 48;
  const gap = 2.5;
  const barWidth = (width - gap * (barCount - 1)) / barCount;
  const maxBarHeight = height * 0.85;
  const minBarHeight = 3;
  const cornerRadius = Math.min(barWidth / 2, 3);

  for (let i = 0; i < barCount; i++) {
    let barHeight = minBarHeight;
    let alpha = 0.2;

    if (data) {
      const bufferLength = data.length;
      const dataIndex = Math.floor((i / barCount) * bufferLength * 0.7);
      const value = data[dataIndex] ?? 0;
      const eased = Math.pow(value / 255, 0.7);
      barHeight = Math.max(minBarHeight, eased * maxBarHeight);
      alpha = 0.4 + eased * 0.6;
    }

    const x = i * (barWidth + gap);
    const y = (height - barHeight) / 2;

    ctx.fillStyle = `oklch(0.72 0.155 60 / ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(x + cornerRadius, y);
    ctx.lineTo(x + barWidth - cornerRadius, y);
    ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + cornerRadius);
    ctx.lineTo(x + barWidth, y + barHeight - cornerRadius);
    ctx.quadraticCurveTo(x + barWidth, y + barHeight, x + barWidth - cornerRadius, y + barHeight);
    ctx.lineTo(x + cornerRadius, y + barHeight);
    ctx.quadraticCurveTo(x, y + barHeight, x, y + barHeight - cornerRadius);
    ctx.lineTo(x, y + cornerRadius);
    ctx.quadraticCurveTo(x, y, x + cornerRadius, y);
    ctx.closePath();
    ctx.fill();
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export const VoiceRecorder = memo(function VoiceRecorder({
  disabled,
  projectContext,
  onTranscript,
}: VoiceRecorderProps) {
  const { state, startRecording, stopRecording, cancel, getAnalyser } =
    useVoiceInput(projectContext);

  const handleMicTap = useCallback(async () => {
    if (state.phase === "idle") {
      await startRecording();
    }
  }, [state.phase, startRecording]);

  const handleStop = useCallback(async () => {
    const text = await stopRecording();
    if (text) onTranscript(text);
  }, [stopRecording, onTranscript]);

  const isRecording = state.phase === "recording";
  const isProcessing = state.phase === "transcribing" || state.phase === "cleaning";

  return (
    <>
      {/* Recording/processing overlay — replaces textarea content */}
      {(isRecording || isProcessing) && (
        <div className="absolute inset-0 z-10 flex items-center rounded-[20px] bg-card">
          {isRecording && (
            <div className="flex w-full items-center gap-3 px-4">
              <div className="h-10 min-w-0 flex-1">
                <WaveformVisualizer getAnalyser={getAnalyser} />
              </div>
              <span className="shrink-0 font-mono text-xs tabular-nums text-primary">
                {formatDuration((state as { durationMs: number }).durationMs)}
              </span>
              <button
                onClick={cancel}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
              >
                <X className="size-3.5" />
              </button>
              <button
                onClick={() => void handleStop()}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary active:bg-primary/90"
              >
                <Square className="size-3.5 fill-primary-foreground text-primary-foreground" />
              </button>
            </div>
          )}

          {isProcessing && (
            <div className="flex w-full items-center justify-center gap-2.5 px-4">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Cleaning up...</span>
            </div>
          )}
        </div>
      )}

      {/* Mic button */}
      {!isRecording && !isProcessing && (
        <button
          onClick={() => void handleMicTap()}
          disabled={disabled}
          className={cn(
            "flex size-8 items-center justify-center rounded-full",
            disabled ? "text-muted-foreground/30" : "text-muted-foreground active:bg-muted",
          )}
        >
          <Mic className="size-4" />
        </button>
      )}
    </>
  );
});
