/**
 * Hook managing voice input pipeline:
 *
 * 1. Always capture audio via MediaRecorder (works in all browsers/WebViews)
 * 2. Also try Web Speech API in parallel for instant results
 * 3. If Web Speech API produced text → use it
 *    If not → transcribe recorded audio with local Whisper model
 * 4. Clean up with OpenRouter (optional, if API key stored)
 */
import { useState, useRef, useCallback } from "react";
import { cleanupTranscript } from "./cleanup";
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
  const hasSpeechAPIRef = useRef<boolean>(false);

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

      // Always start MediaRecorder as the reliable audio capture
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

      // Also try Web Speech API for instant results (best-effort)
      hasSpeechAPIRef.current = false;
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
            hasSpeechAPIRef.current = true;
            let transcript = "";
            for (let i = 0; i < event.results.length; i++) {
              transcript += event.results[i][0].transcript;
            }
            transcriptRef.current = transcript;
          };

          recognition.onerror = (event: any) => {
            if (event.error === "no-speech" || event.error === "aborted") return;
            console.warn("[Voice] Speech API error:", event.error);
            // Don't fail — MediaRecorder is still capturing
          };

          recognition.start();
        } catch (e) {
          console.warn("[Voice] Speech API start failed, will use Whisper fallback:", e);
        }
      } else {
        console.log("[Voice] Web Speech API not available — will use Whisper for transcription");
      }

      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setState({ phase: "recording", durationMs: Date.now() - startTimeRef.current });
      }, 100);

      setState({ phase: "recording", durationMs: 0 });
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone permission denied. Please allow microphone access."
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

    let rawText = speechAPIText;

    // If Web Speech API didn't produce results, use Whisper on the recorded audio
    if (!rawText) {
      const audioBlob = await recordedAudioPromise;
      if (!audioBlob || audioBlob.size < 1000) {
        // Too short or no audio
        setState({ phase: "idle" });
        if (audioBlob && audioBlob.size < 1000) {
          showToast("info", "Recording too short — try speaking longer");
        }
        return "";
      }

      setState({ phase: "transcribing" });
      try {
        const { loadWhisperModel, transcribeAudio, isWhisperCached } = await import("./whisper");

        if (!isWhisperCached()) {
          showToast("info", "Downloading speech model (first time only)...");
        }

        await loadWhisperModel((progress) => {
          if (progress.progress !== undefined) {
            console.log(`[Voice] Whisper loading: ${Math.round(progress.progress)}%`);
          }
        });

        rawText = await transcribeAudio(audioBlob);
      } catch (err) {
        console.error("[Voice] Whisper transcription failed:", err);
        showToast("error", "Transcription failed. Try again.");
        setState({ phase: "idle" });
        return "";
      }
    } else {
      // We had speech API results — don't need the recorded audio
      await recordedAudioPromise; // just drain it
    }

    if (!rawText.trim()) {
      setState({ phase: "idle" });
      showToast("info", "No speech detected — try again");
      return "";
    }

    // Cleanup with OpenRouter (optional)
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
