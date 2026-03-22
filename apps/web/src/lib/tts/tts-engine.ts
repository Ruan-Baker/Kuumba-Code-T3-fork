/**
 * TTS Engine — calls the server's POST /api/tts endpoint.
 *
 * The server runs Kokoro with native ONNX runtime, so synthesis is
 * fast and the UI thread is never blocked. Text is split into chunks
 * and played progressively.
 */
import type { DesktopRendererLogEntry } from "@t3tools/contracts";
import { logRendererDiagnostic } from "../rendererDiagnostics";

export const SPEED_STEPS = [1, 1.25, 1.5, 2] as const;
export type PlaybackSpeed = (typeof SPEED_STEPS)[number];

let currentAudio: HTMLAudioElement | null = null;
let currentSpeed: PlaybackSpeed = 1;
let stopRequested = false;

type StatusCallback = (status: TTSStatus) => void;

export interface TTSStatus {
  state: "idle" | "downloading" | "synthesizing" | "speaking" | "error" | "needs-download";
  progress?: number;
  error?: string;
}

// ── Public API ───────────────────────────────────────────────────────

export interface TTSServerStatus {
  ready: boolean;
  loading: boolean;
  error: string | null;
}

/** Check the actual TTS model status from the server. */
export async function checkTTSServerStatus(): Promise<TTSServerStatus> {
  try {
    const origin = resolveServerOrigin();
    const res = await fetch(`${origin}/api/tts-status`);
    if (!res.ok) return { ready: false, loading: false, error: "Could not reach TTS server" };
    return (await res.json()) as TTSServerStatus;
  } catch {
    return { ready: false, loading: false, error: "Could not reach TTS server" };
  }
}

/**
 * @deprecated Use checkTTSServerStatus() for accurate status.
 * Kept for backwards compat — now returns false so callers check the server.
 */
export function isKokoroCached(): boolean {
  return false;
}
export function deleteKokoroCache(): void {}
export async function downloadModel(_onStatus?: StatusCallback): Promise<void> {}
export function preloadModelInBackground(): void {}

/**
 * Speak text by sending chunks to the server for synthesis.
 * Playback starts as soon as the first chunk is ready.
 */
export async function speak(text: string, onStatus?: StatusCallback): Promise<void> {
  stop();
  stopRequested = false;

  if (!text.trim()) return;

  try {
    onStatus?.({ state: "synthesizing" });

    const chunks = splitIntoChunks(text);
    if (chunks.length === 0) return;

    // Synthesise chunks progressively — pipeline 2 ahead for faster playback
    const wavCache: Blob[] = [];
    let fetchIndex = 0;
    let fetchDone = false;
    let fetchError: Error | null = null;

    const fetchOne = async () => {
      if (fetchIndex >= chunks.length || stopRequested) return;
      const idx = fetchIndex++;
      try {
        const wav = await synthesizeOnServer(chunks[idx]!);
        if (!stopRequested) wavCache.push(wav);
      } catch (err) {
        fetchError = err instanceof Error ? err : new Error(String(err));
      }
    };

    const fetchNext = async () => {
      // Start 2 fetches in parallel for pipelining
      while (fetchIndex < chunks.length && !stopRequested) {
        await fetchOne();
      }
      fetchDone = true;
    };

    const fetchPromise = fetchNext();

    // Play chunks as they arrive
    let playIndex = 0;
    while (!stopRequested) {
      while (wavCache.length <= playIndex && !fetchDone && !fetchError && !stopRequested) {
        await sleep(30);
      }
      if (stopRequested) break;
      if (fetchError) throw fetchError;
      if (playIndex >= wavCache.length) break;

      await playAudioBlob(wavCache[playIndex]!, onStatus);
      playIndex++;
    }

    await fetchPromise;

    if (!stopRequested) {
      onStatus?.({ state: "idle" });
    }
  } catch (error) {
    if (stopRequested) return;
    cleanup();
    const message = describeTTSError(error);
    logRendererDiagnostic(buildLogEntry("error", "tts.speak", message, errorDetails(error)));
    onStatus?.({ state: "error", error: message });
  }
}

export function stop(): void {
  stopRequested = true;
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

// ── Internals ────────────────────────────────────────────────────────

function cleanup(): void {
  if (currentAudio?.src) {
    URL.revokeObjectURL(currentAudio.src);
  }
  currentAudio = null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveServerOrigin(): string {
  if (typeof window === "undefined") return "";
  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
  if (typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0) {
    try {
      const url = new URL(bridgeWsUrl);
      const protocol = url.protocol === "wss:" ? "https:" : "http:";
      return `${protocol}//${url.host}`;
    } catch {
      // fall through
    }
  }
  return window.location.origin;
}

async function synthesizeOnServer(text: string): Promise<Blob> {
  const origin = resolveServerOrigin();
  const res = await fetch(`${origin}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (res.status === 503) {
    throw new Error("Voice model is still loading. Try again in a few seconds.");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TTS server error (${res.status}): ${body || "synthesis failed"}`);
  }

  return res.blob();
}

function playAudioBlob(wav: Blob, onStatus?: StatusCallback): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stopRequested) {
      resolve();
      return;
    }

    const audio = new Audio();
    audio.src = URL.createObjectURL(wav);
    currentAudio = audio;
    audio.playbackRate = currentSpeed;

    audio.onplay = () => onStatus?.({ state: "speaking" });
    audio.onended = () => {
      URL.revokeObjectURL(audio.src);
      currentAudio = null;
      resolve();
    };
    audio.onerror = () => {
      const message = describeAudioPlaybackFailure(audio);
      logRendererDiagnostic(
        buildLogEntry("error", "tts.audio", message, errorDetails(audio.error)),
      );
      URL.revokeObjectURL(audio.src);
      currentAudio = null;
      reject(new Error(message));
    };

    audio.play().catch(reject);
  });
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

// ── Error helpers ────────────────────────────────────────────────────

function describeTTSError(error: unknown): string {
  const message = errorMessage(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("failed to fetch") || normalized.includes("networkerror")) {
    return "Could not reach the TTS server. Is the app backend running?";
  }
  if (normalized.includes("still loading")) {
    return message;
  }
  return message || "Text-to-speech failed.";
}

function describeAudioPlaybackFailure(audio: HTMLAudioElement): string {
  const mediaError = audio.error;
  if (!mediaError) return "Audio playback failed.";
  switch (mediaError.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Audio playback was interrupted.";
    case MediaError.MEDIA_ERR_DECODE:
      return "Audio could not be decoded.";
    default:
      return "Audio playback failed.";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function buildLogEntry(
  level: DesktopRendererLogEntry["level"],
  scope: string,
  message: string,
  details: string | undefined,
): DesktopRendererLogEntry {
  const entry: DesktopRendererLogEntry = { level, scope, message };
  if (details !== undefined) entry.details = details;
  return entry;
}

function errorDetails(error: unknown): string | undefined {
  if (error instanceof Error) return error.stack ?? error.message;
  if (error === undefined) return undefined;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}
