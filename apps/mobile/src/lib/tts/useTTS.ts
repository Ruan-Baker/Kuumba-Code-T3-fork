import { useState, useCallback, useEffect, useRef } from "react";
import {
  speak,
  stop,
  setPlaybackRate,
  getPlaybackRate,
  setTransport,
  SPEED_STEPS,
  type TTSStatus,
  type PlaybackSpeed,
} from "./tts-engine";
import { stripMarkdownForTTS } from "./markdown-stripper";
import { useConnectionStore } from "~/stores/connectionStore";

export function useTTS() {
  const [status, setStatus] = useState<TTSStatus>({ state: "idle" });
  const [speed, setSpeed] = useState<PlaybackSpeed>(getPlaybackRate());
  const isMounted = useRef(true);
  const transport = useConnectionStore((s) => s.getActiveTransport());

  // Keep the engine's transport reference in sync
  useEffect(() => {
    setTransport(transport);
  }, [transport]);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      stop();
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
        if (status.state === "error") safeSetStatus({ state: "idle" });
        if (!transport) {
          safeSetStatus({ state: "error", error: "Not connected to a device" });
          return;
        }
        await speakText(markdown);
      }
    },
    [status.state, transport, speakText, stopSpeaking, safeSetStatus],
  );

  const cycleSpeed = useCallback(() => {
    const currentIndex = SPEED_STEPS.indexOf(speed);
    const nextIndex = (currentIndex + 1) % SPEED_STEPS.length;
    const nextSpeed = SPEED_STEPS[nextIndex] ?? SPEED_STEPS[0]!;
    setPlaybackRate(nextSpeed);
    setSpeed(nextSpeed);
  }, [speed]);

  return {
    status,
    speed,
    isSpeaking: status.state === "speaking",
    isLoading: status.state === "synthesizing",
    speak: speakText,
    stop: stopSpeaking,
    toggle,
    cycleSpeed,
  };
}
