import { useState, useCallback, useEffect, useRef } from "react";
import { speak, stop, type TTSStatus } from "./tts-engine";
import { stripMarkdownForTTS } from "./markdown-stripper";

export function useTTS() {
  const [status, setStatus] = useState<TTSStatus>({ state: "idle" });
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
        await speakText(markdown);
      }
    },
    [status.state, speakText, stopSpeaking],
  );

  return {
    status,
    isSpeaking: status.state === "speaking",
    isLoading:
      status.state === "downloading" || status.state === "synthesizing",
    speak: speakText,
    stop: stopSpeaking,
    toggle,
  };
}
