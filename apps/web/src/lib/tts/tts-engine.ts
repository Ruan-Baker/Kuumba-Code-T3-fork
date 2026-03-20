/**
 * TTS Engine using Piper TTS via WASM.
 *
 * Uses @mintplex-labs/piper-tts-web which runs Piper voice models
 * entirely in the browser. Models are downloaded once on first use
 * and cached in IndexedDB.
 */
import * as piperTTS from "@mintplex-labs/piper-tts-web";

// ─── Configuration ───────────────────────────────────────────────
// Voice model to use. Browse available voices at:
// https://rhasspy.github.io/piper-samples/
//
// "medium" quality is the best balance of quality vs speed.
// "high" quality exists for some voices but is slower.
// "low" is fastest but sounds more robotic.

const DEFAULT_VOICE_ID = "en_US-amy-medium";

// ─── Playback speed ─────────────────────────────────────────────
export const SPEED_STEPS = [1, 1.5, 2] as const;
export type PlaybackSpeed = (typeof SPEED_STEPS)[number];

// ─── State ───────────────────────────────────────────────────────
let currentAudio: HTMLAudioElement | null = null;
let isModelReady = false;
let currentSpeed: PlaybackSpeed = 1;

type StatusCallback = (status: TTSStatus) => void;

export interface TTSStatus {
  state: "idle" | "downloading" | "synthesizing" | "speaking" | "error";
  progress?: number; // 0-100 for download progress
  error?: string;
}

// ─── Piper TTS Functions ─────────────────────────────────────────

/**
 * Pre-download the voice model so first speak() is instant.
 * Call this on app startup or when user enables TTS.
 */
export async function preloadVoice(
  voiceId: string = DEFAULT_VOICE_ID,
  onProgress?: (percent: number) => void,
): Promise<void> {
  try {
    const stored = await piperTTS.stored();
    if (stored.includes(voiceId)) {
      isModelReady = true;
      return;
    }

    await piperTTS.download(voiceId, (progress) => {
      const percent = Math.round((progress.loaded * 100) / progress.total);
      onProgress?.(percent);
    });

    isModelReady = true;
  } catch (err) {
    console.warn("[TTS] Failed to preload Piper voice:", err);
  }
}

/**
 * Speak text using Piper TTS.
 */
export async function speak(
  text: string,
  onStatus?: StatusCallback,
  voiceId: string = DEFAULT_VOICE_ID,
): Promise<void> {
  // Stop any current playback
  stop();

  if (!text.trim()) return;

  try {
    // Notify: downloading/synthesizing
    onStatus?.({ state: "downloading" });

    // Synthesize audio with Piper (downloads model if needed)
    const wav = await piperTTS.predict(
      {
        text,
        voiceId,
      },
      (progress) => {
        const percent = Math.round((progress.loaded * 100) / progress.total);
        onStatus?.({ state: "downloading", progress: percent });
      },
    );

    onStatus?.({ state: "synthesizing" });

    // Create audio element and play
    const audio = new Audio();
    audio.src = URL.createObjectURL(wav);

    currentAudio = audio;
    audio.playbackRate = currentSpeed;

    // Set up event handlers
    audio.onplay = () => onStatus?.({ state: "speaking" });
    audio.onended = () => {
      cleanup();
      onStatus?.({ state: "idle" });
    };
    audio.onerror = () => {
      cleanup();
      onStatus?.({ state: "error", error: "Audio playback failed" });
    };

    await audio.play();
  } catch (err) {
    console.error("[TTS] Piper TTS failed to load or synthesize:", err);
    cleanup();
    onStatus?.({
      state: "error",
      error: "Piper TTS failed to load. Please check your connection and try again.",
    });
  }
}

/**
 * Stop any currently playing audio.
 */
export function stop(): void {
  if (currentAudio) {
    currentAudio.pause();
    if (currentAudio.src) {
      URL.revokeObjectURL(currentAudio.src);
    }
  }
  cleanup();
}

/**
 * Set playback speed. Applies immediately if audio is playing.
 */
export function setPlaybackRate(speed: PlaybackSpeed): void {
  currentSpeed = speed;
  if (currentAudio) {
    currentAudio.playbackRate = speed;
  }
}

/**
 * Get the current playback speed.
 */
export function getPlaybackRate(): PlaybackSpeed {
  return currentSpeed;
}

/**
 * Check if TTS is currently playing audio.
 */
export function isSpeaking(): boolean {
  return currentAudio !== null && !currentAudio.paused;
}

// ─── Internal ────────────────────────────────────────────────────

function cleanup(): void {
  if (currentAudio?.src) {
    URL.revokeObjectURL(currentAudio.src);
  }
  currentAudio = null;
}
