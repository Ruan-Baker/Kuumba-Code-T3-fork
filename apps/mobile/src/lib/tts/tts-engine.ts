/**
 * Remote TTS engine — sends text chunks to the paired desktop through
 * the relay, receives synthesized WAV audio, and plays progressively.
 *
 * Playback starts as soon as the first chunk is ready. Subsequent chunks
 * are fetched in parallel so there's no gap between sentences.
 */

export const SPEED_STEPS = [1, 1.25, 1.5, 2] as const;
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

async function fetchChunkAudio(transport: Transport, text: string): Promise<Blob | null> {
  const result = await transport.request<{ audio: string }>("tts.synthesize", { text });
  if (!result?.audio) return null;

  const binary = atob(result.audio);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes.buffer], { type: "audio/wav" });
}

function playBlob(blob: Blob, onStatus?: StatusCallback): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stopped) {
      resolve();
      return;
    }
    const url = URL.createObjectURL(blob);
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
      reject(new Error("Playback failed"));
    };
    audio.play().catch(reject);
  });
}

export async function speak(text: string, onStatus?: StatusCallback | undefined): Promise<void> {
  stop();
  stopped = false;
  if (!text.trim()) return;

  if (!activeTransport) {
    onStatus?.({ state: "error", error: "Not connected to a device" });
    return;
  }

  const transport = activeTransport;
  const chunks = splitIntoChunks(text);
  if (chunks.length === 0) return;

  try {
    onStatus?.({ state: "synthesizing" });

    // Pipeline: fetch chunks ahead while playing current
    const wavCache: Blob[] = [];
    let fetchIndex = 0;
    let fetchDone = false;
    let fetchError: Error | null = null;

    const fetchNext = async () => {
      while (fetchIndex < chunks.length && !stopped) {
        const idx = fetchIndex++;
        try {
          const blob = await fetchChunkAudio(transport, chunks[idx]!);
          if (stopped) return;
          if (blob) wavCache.push(blob);
        } catch (err) {
          fetchError = err instanceof Error ? err : new Error(String(err));
          return;
        }
      }
      fetchDone = true;
    };

    // Start fetching in background
    const fetchPromise = fetchNext();

    // Play chunks as they arrive
    let playIndex = 0;
    while (!stopped) {
      // Wait for next chunk to be ready
      while (wavCache.length <= playIndex && !fetchDone && !fetchError && !stopped) {
        await new Promise((r) => setTimeout(r, 30));
      }
      if (stopped) break;
      if (fetchError) throw fetchError;
      if (playIndex >= wavCache.length) break;

      await playBlob(wavCache[playIndex]!, onStatus);
      playIndex++;
    }

    await fetchPromise;
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

// No-ops — no local model on mobile
export function isKokoroCached(): boolean {
  return false;
}
export function deleteKokoroCache(): void {}
export async function downloadModel(_onStatus?: StatusCallback): Promise<void> {}
