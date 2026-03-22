import { useState, useCallback, useEffect, useRef } from "react";
import { toastManager } from "~/components/ui/toast";
import {
  speak,
  stop,
  setPlaybackRate,
  getPlaybackRate,
  downloadModel,
  checkTTSServerStatus,
  SPEED_STEPS,
  type TTSStatus,
  type PlaybackSpeed,
} from "./tts-engine";
import { stripMarkdownForTTS } from "./markdown-stripper";

export function useTTS() {
  const [status, setStatus] = useState<TTSStatus>({ state: "idle" });
  const [speed, setSpeed] = useState<PlaybackSpeed>(getPlaybackRate());
  const [modelReady, setModelReady] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    let pollInterval: ReturnType<typeof setInterval> | undefined;

    // Check real TTS status from the server on mount
    void checkTTSServerStatus().then((serverStatus) => {
      if (!isMounted.current) return;
      setModelReady(serverStatus.ready);
      if (serverStatus.error) setServerError(serverStatus.error);

      // If still loading, poll until ready or failed
      if (serverStatus.loading) {
        pollInterval = setInterval(() => {
          void checkTTSServerStatus().then((s) => {
            if (!isMounted.current) return;
            if (!s.loading) {
              clearInterval(pollInterval);
              pollInterval = undefined;
              setModelReady(s.ready);
              if (s.error) setServerError(s.error);
            }
          });
        }, 3000);
      }
    });

    return () => {
      isMounted.current = false;
      if (pollInterval) clearInterval(pollInterval);
      stop();
    };
  }, []);

  useEffect(() => {
    if (status.state !== "error" || !status.error) return;

    toastManager.add({
      type: "error",
      title: "Read aloud failed",
      description: status.error,
      data: { dismissAfterVisibleMs: 8000 },
    });
  }, [status]);

  const safeSetStatus = useCallback((s: TTSStatus) => {
    if (isMounted.current) setStatus(s);
  }, []);

  const handleDownload = useCallback(async () => {
    try {
      await downloadModel(safeSetStatus);
      if (isMounted.current) setModelReady(true);
    } catch {
      safeSetStatus({ state: "error", error: "Failed to download voice model." });
    }
  }, [safeSetStatus]);

  const speakText = useCallback(
    async (markdown: string) => {
      const text = stripMarkdownForTTS(markdown);
      if (!text) return;
      await speak(text, safeSetStatus);
    },
    [safeSetStatus],
  );

  const stopSpeaking = useCallback(() => {
    stop();
    safeSetStatus({ state: "idle" });
  }, [safeSetStatus]);

  const toggle = useCallback(
    async (markdown: string) => {
      if (status.state === "speaking" || status.state === "synthesizing") {
        stopSpeaking();
      } else {
        if (status.state === "error") {
          safeSetStatus({ state: "idle" });
        }

        // Re-check server status before speaking
        const serverStatus = await checkTTSServerStatus();
        setModelReady(serverStatus.ready);

        if (!serverStatus.ready) {
          if (serverStatus.error) {
            safeSetStatus({ state: "error", error: `Voice model failed: ${serverStatus.error}` });
          } else if (serverStatus.loading) {
            safeSetStatus({ state: "error", error: "Voice model is still loading. Try again in a few seconds." });
          } else {
            safeSetStatus({ state: "needs-download" });
          }
          return;
        }

        await speakText(markdown);
      }
    },
    [status.state, speakText, stopSpeaking, safeSetStatus],
  );

  const cycleSpeed = useCallback(() => {
    const currentIndex = SPEED_STEPS.indexOf(speed);
    const nextIndex = (currentIndex + 1) % SPEED_STEPS.length;
    const nextSpeed = SPEED_STEPS[nextIndex] ?? SPEED_STEPS[0];
    setPlaybackRate(nextSpeed);
    setSpeed(nextSpeed);
  }, [speed]);

  return {
    status,
    speed,
    modelReady,
    serverError,
    isSpeaking: status.state === "speaking",
    isLoading: status.state === "downloading" || status.state === "synthesizing",
    needsDownload: status.state === "needs-download",
    speak: speakText,
    stop: stopSpeaking,
    toggle,
    cycleSpeed,
    downloadModel: handleDownload,
  };
}
