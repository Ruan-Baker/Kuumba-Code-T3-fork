import { useState, useCallback, useEffect, useRef } from "react";
import {
  speak,
  stop,
  setPlaybackRate,
  getPlaybackRate,
  SPEED_STEPS,
  type TTSStatus,
  type PlaybackSpeed,
} from "./tts-engine";
import { stripMarkdownForTTS } from "./markdown-stripper";

export function useTTS() {
  const [status, setStatus] = useState<TTSStatus>({ state: "idle" });
  const [speed, setSpeed] = useState<PlaybackSpeed>(getPlaybackRate());
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      stop(); // Stop TTS when component unmounts
    };
  }, []);

  const safeSetStatus = useCallback((s: TTSStatus) => {
    if (isMounted.current) setStatus(s);
  }, []);

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
        // Reset error state so the user can retry
        if (status.state === "error") {
          safeSetStatus({ state: "idle" });
        }
        await speakText(markdown);
      }
    },
    [status.state, speakText, stopSpeaking, safeSetStatus],
  );

  /** Cycle through 1x → 1.5x → 2x → 1x */
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
    isSpeaking: status.state === "speaking",
    isLoading: status.state === "downloading" || status.state === "synthesizing",
    speak: speakText,
    stop: stopSpeaking,
    toggle,
    cycleSpeed,
  };
}
