/**
 * TTS Engine using Piper TTS via WASM.
 *
 * Uses @mintplex-labs/piper-tts-web which runs Piper voice models
 * entirely in the browser. Models are downloaded once on first use
 * and cached in IndexedDB / OPFS.
 */
import * as piperTTS from "@mintplex-labs/piper-tts-web";
import { logRendererDiagnostic } from "../rendererDiagnostics";

const DEFAULT_VOICE_ID = "en_US-amy-medium";
const ONNX_RUNTIME_VERSION = "1.24.3";
const ONNX_WASM_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_RUNTIME_VERSION}/dist/`;
const PIPER_WASM_PATHS = {
  ...piperTTS.TtsSession.WASM_LOCATIONS,
  onnxWasm: ONNX_WASM_BASE,
};

export const SPEED_STEPS = [1, 1.5, 2] as const;
export type PlaybackSpeed = (typeof SPEED_STEPS)[number];

let currentAudio: HTMLAudioElement | null = null;
const readyVoiceIds = new Set<string>();
let currentSpeed: PlaybackSpeed = 1;
let preloadPromise: Promise<void> | null = null;
let preloadVoiceId: string | null = null;

type StatusCallback = (status: TTSStatus) => void;

export interface TTSStatus {
  state: "idle" | "downloading" | "synthesizing" | "speaking" | "error";
  progress?: number;
  error?: string;
}

export async function preloadVoice(
  voiceId: string = DEFAULT_VOICE_ID,
  onProgress?: (percent: number) => void,
): Promise<void> {
  validatePiperSupport();

  if (readyVoiceIds.has(voiceId)) {
    return;
  }

  if (preloadPromise && preloadVoiceId === voiceId) {
    await preloadPromise;
    return;
  }

  try {
    preloadVoiceId = voiceId;
    preloadPromise = (async () => {
      const stored = await piperTTS.stored();
      if (stored.includes(voiceId)) {
        readyVoiceIds.add(voiceId);
        return;
      }

      await piperTTS.download(voiceId, (progress) => {
        const percent = Math.round((progress.loaded * 100) / progress.total);
        onProgress?.(percent);
      });

      readyVoiceIds.add(voiceId);
    })();

    await preloadPromise;
  } catch (error) {
    resetPiperSession();
    logRendererDiagnostic({
      level: "warn",
      scope: "tts.preload",
      message: "Failed to preload Piper voice",
      details: errorDetails(error),
    });
    throw new Error(describeTTSError(error));
  } finally {
    preloadPromise = null;
    preloadVoiceId = null;
  }
}

export async function speak(
  text: string,
  onStatus?: StatusCallback,
  voiceId: string = DEFAULT_VOICE_ID,
): Promise<void> {
  stop();

  if (!text.trim()) return;

  try {
    onStatus?.({ state: "downloading" });

    await preloadVoice(voiceId, (percent) => {
      onStatus?.({ state: "downloading", progress: percent });
    });

    onStatus?.({ state: "synthesizing" });
    const wav = await synthesizeSpeech(text, voiceId);

    const audio = new Audio();
    audio.src = URL.createObjectURL(wav);

    currentAudio = audio;
    audio.playbackRate = currentSpeed;

    audio.onplay = () => onStatus?.({ state: "speaking" });
    audio.onended = () => {
      cleanup();
      onStatus?.({ state: "idle" });
    };
    audio.onerror = () => {
      const message = describeAudioPlaybackFailure(audio);
      logRendererDiagnostic({
        level: "error",
        scope: "tts.audio",
        message,
        details: errorDetails(audio.error),
      });
      cleanup();
      onStatus?.({ state: "error", error: message });
    };

    await audio.play();
  } catch (error) {
    cleanup();
    const message = describeTTSError(error);
    logRendererDiagnostic({
      level: "error",
      scope: "tts.speak",
      message,
      details: errorDetails(error),
    });
    onStatus?.({ state: "error", error: message });
  }
}

export function stop(): void {
  if (currentAudio) {
    currentAudio.pause();
    if (currentAudio.src) {
      URL.revokeObjectURL(currentAudio.src);
    }
  }
  cleanup();
}

export function setPlaybackRate(speed: PlaybackSpeed): void {
  currentSpeed = speed;
  if (currentAudio) {
    currentAudio.playbackRate = speed;
  }
}

export function getPlaybackRate(): PlaybackSpeed {
  return currentSpeed;
}

export function isSpeaking(): boolean {
  return currentAudio !== null && !currentAudio.paused;
}

function cleanup(): void {
  if (currentAudio?.src) {
    URL.revokeObjectURL(currentAudio.src);
  }
  currentAudio = null;
}

function validatePiperSupport(): void {
  if (typeof navigator === "undefined" || navigator.storage === undefined) {
    throw new Error("Browser storage is unavailable. Piper requires a secure browser context.");
  }

  if (typeof navigator.storage.getDirectory !== "function") {
    throw new Error(
      "This browser build does not support the storage API Piper needs for voice models.",
    );
  }
}

async function synthesizeSpeech(text: string, voiceId: string): Promise<Blob> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const session = await piperTTS.TtsSession.create({
        voiceId,
        wasmPaths: PIPER_WASM_PATHS,
      });
      return await session.predict(text);
    } catch (error) {
      lastError = error;
      resetPiperSession();
      if (attempt === 0) {
        logRendererDiagnostic({
          level: "warn",
          scope: "tts.session",
          message: "Piper session initialization failed; retrying with a fresh session.",
          details: errorDetails(error),
        });
        continue;
      }
    }
  }

  throw lastError;
}

function resetPiperSession(): void {
  piperTTS.TtsSession._instance = null;
}

function describeTTSError(error: unknown): string {
  const message = errorMessage(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("load failed")
  ) {
    return "Piper could not download its voice or runtime files. Check your connection and firewall.";
  }

  if (
    normalized.includes("wasm") ||
    normalized.includes("onnx") ||
    normalized.includes("backend") ||
    normalized.includes("pthread")
  ) {
    return "Piper failed to initialize its speech runtime in this app build.";
  }

  if (normalized.includes("storage")) {
    return "Piper could not access browser storage for its voice model cache.";
  }

  return message || "Piper TTS failed to load.";
}

function describeAudioPlaybackFailure(audio: HTMLAudioElement): string {
  const mediaError = audio.error;
  if (!mediaError) {
    return "Audio playback failed.";
  }

  switch (mediaError.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Audio playback was interrupted.";
    case MediaError.MEDIA_ERR_NETWORK:
      return "Audio playback failed because the generated audio could not be read.";
    case MediaError.MEDIA_ERR_DECODE:
      return "Audio playback failed because the generated Piper audio could not be decoded.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "Audio playback failed because this app build rejected the generated Piper audio.";
    default:
      return "Audio playback failed.";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function errorDetails(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  if (error === undefined) {
    return undefined;
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}
