/**
 * Remote TTS engine — sends text to the paired desktop through the relay,
 * receives synthesized WAV audio, and plays it on the phone.
 * No model downloads needed.
 */

export const SPEED_STEPS = [1, 1.5, 2] as const;
export type PlaybackSpeed = (typeof SPEED_STEPS)[number];

export interface TTSStatus {
  state: "idle" | "synthesizing" | "speaking" | "error";
  progress?: number | undefined;
  error?: string | undefined;
}

type StatusCallback = (status: TTSStatus) => void;

let currentAudio: HTMLAudioElement | null = null;
let currentSpeed: PlaybackSpeed = 1;
let stopped = false;

interface Transport {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
}

// Stored transport reference — set by useTTS hook
let activeTransport: Transport | null = null;

export function setTransport(transport: Transport | null): void {
  activeTransport = transport;
}

function splitIntoChunks(text: string): string[] {
  const raw = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const segment of raw) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    if (current.length + trimmed.length < 250) {
      current = current ? `${current} ${trimmed}` : trimmed;
    } else {
      if (current) chunks.push(current);
      current = trimmed;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function speak(
  text: string,
  onStatus?: StatusCallback | undefined,
): Promise<void> {
  stop();
  stopped = false;
  if (!text.trim()) return;

  if (!activeTransport) {
    onStatus?.({ state: "error", error: "Not connected to a device" });
    return;
  }

  const chunks = splitIntoChunks(text);
  if (chunks.length === 0) return;

  try {
    for (let i = 0; i < chunks.length; i++) {
      if (stopped) break;

      onStatus?.({ state: "synthesizing", progress: Math.round((i / chunks.length) * 100) });

      const result = await activeTransport.request<{ audio: string }>("tts.synthesize", {
        text: chunks[i],
      });

      if (stopped) break;

      if (!result?.audio) {
        throw new Error("No audio in TTS response");
      }

      // Decode base64 WAV
      const binary = atob(result.audio);
      const bytes = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j++) {
        bytes[j] = binary.charCodeAt(j);
      }

      // Play chunk
      const blob = new Blob([bytes.buffer], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);

      await new Promise<void>((resolve, reject) => {
        if (stopped) { URL.revokeObjectURL(url); resolve(); return; }

        const audio = new Audio(url);
        currentAudio = audio;
        audio.playbackRate = currentSpeed;

        audio.onplay = () => onStatus?.({ state: "speaking" });
        audio.onended = () => {
          URL.revokeObjectURL(url);
          currentAudio = null;
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          currentAudio = null;
          reject(new Error("Audio playback failed"));
        };

        audio.play().catch(reject);
      });
    }

    if (!stopped) onStatus?.({ state: "idle" });
  } catch (error) {
    stop();
    const message = error instanceof Error ? error.message : "TTS failed";
    onStatus?.({ state: "error", error: message });
  }
}

export function stop(): void {
  stopped = true;
  if (currentAudio) {
    currentAudio.pause();
    if (currentAudio.src) URL.revokeObjectURL(currentAudio.src);
    currentAudio = null;
  }
}

export function setPlaybackRate(speed: PlaybackSpeed): void {
  currentSpeed = speed;
  if (currentAudio) currentAudio.playbackRate = speed;
}

export function getPlaybackRate(): PlaybackSpeed {
  return currentSpeed;
}

// These are no-ops now — no local model
export function isKokoroCached(): boolean { return false; }
export function deleteKokoroCache(): void {}
export async function downloadModel(_onStatus?: StatusCallback): Promise<void> {}
