/**
 * Hook managing voice input pipeline:
 * record → browser SpeechRecognition → OpenRouter cleanup → return text
 *
 * No model download needed — uses the browser's built-in speech recognition.
 */
import { useState, useRef, useCallback } from "react";
import { cleanupTranscript } from "./cleanup";
import { loadStoredKey } from "./crypto";

export type VoiceState =
  | { phase: "idle" }
  | { phase: "recording"; durationMs: number }
  | { phase: "transcribing" }
  | { phase: "cleaning" }
  | { phase: "error"; message: string };

export function useVoiceInput(projectContext?: string | undefined) {
  const [state, setState] = useState<VoiceState>({ phase: "idle" });
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptRef = useRef<string>("");

  const getAnalyser = useCallback(() => analyserRef.current, []);

  const startRecording = useCallback(async () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setState({ phase: "error", message: "Speech recognition not supported in this browser" });
      return;
    }

    try {
      // Get mic stream for the waveform visualizer
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Set up speech recognition
      const recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognitionRef.current = recognition;
      transcriptRef.current = "";

      recognition.onresult = (event: any) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        transcriptRef.current = transcript;
      };

      recognition.onerror = (event: any) => {
        if (event.error === "no-speech") return; // Ignore no-speech
        console.warn("[Voice] Recognition error:", event.error);
      };

      recognition.start();
      startTimeRef.current = Date.now();

      timerRef.current = setInterval(() => {
        setState({ phase: "recording", durationMs: Date.now() - startTimeRef.current });
      }, 100);

      setState({ phase: "recording", durationMs: 0 });
    } catch (err) {
      setState({ phase: "error", message: "Microphone access denied" });
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<string> => {
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop recognition
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.stop();
      recognitionRef.current = null;
    }

    // Stop audio stream
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    const rawText = transcriptRef.current.trim();
    transcriptRef.current = "";

    if (!rawText) {
      setState({ phase: "idle" });
      return "";
    }

    // Cleanup with OpenRouter
    setState({ phase: "cleaning" });
    let cleanedText = rawText;
    try {
      const apiKey = await loadStoredKey();
      if (apiKey) {
        cleanedText = await cleanupTranscript(rawText, apiKey, projectContext);
      }
    } catch {
      // Use raw text if cleanup fails
    }

    setState({ phase: "idle" });
    return cleanedText;
  }, [projectContext]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    transcriptRef.current = "";
    setState({ phase: "idle" });
  }, []);

  return {
    state,
    startRecording,
    stopRecording,
    cancel,
    getAnalyser,
  };
}
