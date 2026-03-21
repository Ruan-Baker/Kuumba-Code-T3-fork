import { useState, useCallback, useEffect, useRef } from "react";
import { toastManager } from "~/components/ui/toast";
import {
  speak,
  stop,
  setPlaybackRate,
  getPlaybackRate,
  isKokoroCached,
  downloadModel,
  SPEED_STEPS,
  type TTSStatus,
  type PlaybackSpeed,
} from "./tts-engine";
import { stripMarkdownForTTS } from "./markdown-stripper";

export function useTTS() {
  const [status, setStatus] = useState<TTSStatus>({ state: "idle" });
  const [speed, setSpeed] = useState<PlaybackSpeed>(getPlaybackRate());
  const [modelReady, setModelReady] = useState(() => isKokoroCached());
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
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
        if (!modelReady) {
          safeSetStatus({ state: "needs-download" });
          return;
        }
        await speakText(markdown);
      }
    },
    [status.state, modelReady, speakText, stopSpeaking, safeSetStatus],
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
