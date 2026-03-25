/**
 * Hook managing voice input pipeline:
 *
 * 1. Always capture audio via MediaRecorder (works in all browsers/WebViews)
 * 2. Also try Web Speech API in parallel for instant results
 * 3. If Web Speech API produced text → clean up with OpenRouter
 *    If not → send recorded audio to OpenRouter Gemini for transcription + cleanup
 * 4. No local Whisper model needed — everything goes through OpenRouter
 */
import { useState, useRef, useCallback } from "react";
import { cleanupTranscript } from "./cleanup";
import { transcribeWithOpenRouter } from "./transcribe";
import { loadStoredKey } from "./crypto";
import { showToast } from "~/components/Toast";

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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const getAnalyser = useCallback(() => analyserRef.current, []);

  const startRecording = useCallback(async () => {
    try {
      // Get mic stream — required for both MediaRecorder and waveform
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up audio analyser for waveform visualization
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Always start MediaRecorder as reliable audio capture (fallback for transcription)
      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      mediaRecorder.start(250); // Collect chunks every 250ms

      // Also try Web Speech API for instant results (best-effort, free)
      transcriptRef.current = "";
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.lang = "en-US";
          recognition.continuous = true;
          recognition.interimResults = true;
          recognitionRef.current = recognition;

          recognition.onresult = (event: any) => {
            let transcript = "";
            for (let i = 0; i < event.results.length; i++) {
              transcript += event.results[i][0].transcript;
            }
            transcriptRef.current = transcript;
          };

          recognition.onerror = (event: any) => {
            if (event.error === "no-speech" || event.error === "aborted") return;
            console.warn("[Voice] Speech API error:", event.error);
          };

          recognition.start();
        } catch (e) {
          console.warn("[Voice] Speech API start failed:", e);
        }
      } else {
        console.log("[Voice] Web Speech API not available — will use OpenRouter for transcription");
      }

      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setState({ phase: "recording", durationMs: Date.now() - startTimeRef.current });
      }, 100);

      setState({ phase: "recording", durationMs: 0 });
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone permission denied. Please allow mic access in your browser settings."
          : "Could not access microphone. Check browser permissions.";
      setState({ phase: "error", message: msg });
      showToast("error", msg);
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<string> => {
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop Speech API
    const recognition = recognitionRef.current;
    if (recognition) {
      try { recognition.stop(); } catch { /* */ }
      recognitionRef.current = null;
    }

    // Stop MediaRecorder and wait for final data
    const mediaRecorder = mediaRecorderRef.current;
    const recordedAudioPromise = new Promise<Blob | null>((resolve) => {
      if (!mediaRecorder || mediaRecorder.state === "inactive") {
        resolve(null);
        return;
      }
      mediaRecorder.onstop = () => {
        const chunks = audioChunksRef.current;
        if (chunks.length > 0) {
          resolve(new Blob(chunks, { type: chunks[0]!.type || "audio/webm" }));
        } else {
          resolve(null);
        }
      };
      mediaRecorder.stop();
    });
    mediaRecorderRef.current = null;

    // Stop audio stream
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Check if Web Speech API produced a result
    const speechAPIText = transcriptRef.current.trim();
    transcriptRef.current = "";

    // Get the recorded audio blob (needed if Speech API didn't work)
    const audioBlob = await recordedAudioPromise;

    // Load the OpenRouter API key
    const apiKey = await loadStoredKey();

    // --- Path A: Web Speech API produced text → just clean it up ---
    if (speechAPIText) {
      setState({ phase: "cleaning" });
      let cleanedText = speechAPIText;
      try {
        if (apiKey) {
          cleanedText = await cleanupTranscript(speechAPIText, apiKey, projectContext);
        }
      } catch {
        // Use raw text if cleanup fails
      }
      setState({ phase: "idle" });
      return cleanedText;
    }

    // --- Path B: No Speech API text → use OpenRouter to transcribe the audio ---
    if (!audioBlob || audioBlob.size < 1000) {
      setState({ phase: "idle" });
      if (audioBlob && audioBlob.size < 1000) {
        showToast("info", "Recording too short — try speaking longer");
      }
      return "";
    }

    if (!apiKey) {
      setState({ phase: "idle" });
      showToast("error", "Add your OpenRouter API key in Settings to enable voice transcription");
      return "";
    }

    setState({ phase: "transcribing" });
    try {
      // Send audio to OpenRouter Gemini for transcription + cleanup in one shot
      const text = await transcribeWithOpenRouter(audioBlob, apiKey, projectContext);
      if (!text.trim()) {
        showToast("info", "No speech detected — try again");
        setState({ phase: "idle" });
        return "";
      }
      setState({ phase: "idle" });
      return text;
    } catch (err) {
      console.error("[Voice] OpenRouter transcription failed:", err);
      showToast("error", "Transcription failed. Check your OpenRouter API key.");
      setState({ phase: "idle" });
      return "";
    }
  }, [projectContext]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* */ }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch { /* */ }
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];
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
