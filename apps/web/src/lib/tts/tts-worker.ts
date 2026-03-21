/**
 * TTS Web Worker — runs Kokoro TTS synthesis off the main thread.
 *
 * Receives text chunks, synthesizes them using Kokoro (ONNX WASM),
 * and posts back PCM audio data. The main thread stays responsive.
 */

// Force ONNX runtime to use single thread (no SharedArrayBuffer needed)
// This must be set BEFORE importing kokoro-js
import { env } from "onnxruntime-web";
env.wasm.numThreads = 1;

import { KokoroTTS } from "kokoro-js";

const VOICE_ID = "bf_emma";
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let tts: KokoroTTS | null = null;
let loading = false;
let loadError: string | null = null;

async function ensureModel(): Promise<KokoroTTS> {
  if (tts) return tts;
  if (loadError) throw new Error(loadError);
  if (loading) {
    // Wait for in-flight load
    while (loading) await new Promise((r) => setTimeout(r, 50));
    if (tts) return tts;
    throw new Error(loadError ?? "Model failed to load");
  }

  loading = true;
  try {
    tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (progress: { status: string; progress?: number }) => {
        if (progress.status === "progress" && progress.progress != null) {
          self.postMessage({
            type: "download-progress",
            percent: Math.round(progress.progress),
          });
        }
      },
    });
    loading = false;
    self.postMessage({ type: "model-ready" });
    return tts;
  } catch (err) {
    loading = false;
    loadError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

self.onmessage = async (event: MessageEvent) => {
  const { type, id, text } = event.data as {
    type: string;
    id: number;
    text: string;
  };

  if (type === "load-model") {
    try {
      await ensureModel();
    } catch (err) {
      self.postMessage({
        type: "error",
        id: -1,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (type === "synthesize") {
    try {
      const model = await ensureModel();
      const rawAudio = await model.generate(text, { voice: VOICE_ID });

      const wavBuffer = rawAudio.toWav();

      self.postMessage({ type: "wav", id, buffer: wavBuffer }, { transfer: [wavBuffer] });
    } catch (err) {
      self.postMessage({
        type: "error",
        id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
};

// Catch any unhandled errors in the worker so they don't crash the main thread
self.onerror = (event) => {
  self.postMessage({
    type: "error",
    id: -1,
    message: typeof event === "string" ? event : "Worker crashed unexpectedly",
  });
};

self.onunhandledrejection = (event) => {
  self.postMessage({
    type: "error",
    id: -1,
    message: event.reason instanceof Error ? event.reason.message : "Worker promise rejection",
  });
};
