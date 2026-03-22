/**
 * Server-side TTS using Kokoro with native ONNX runtime.
 *
 * The model is loaded once at server startup and kept in memory.
 * Synthesis is fast (~100-500ms per sentence on CPU).
 */

import path from "node:path";
import os from "node:os";

const VOICE_ID = "bf_emma";
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let tts: any = null;
let loading = false;
let loadError: string | null = null;
let lastCacheDir: string | undefined;

/**
 * Initialize the Kokoro TTS model. Call this at server startup.
 * Runs in the background — doesn't block the server from starting.
 *
 * @param cacheDir — writable directory for model cache (e.g. stateDir).
 *   Falls back to ~/.kuumba/tts-cache if not provided.
 */
export async function initTTS(cacheDir?: string): Promise<void> {
  if (tts || loading) return;
  loading = true;
  loadError = null;
  if (cacheDir) lastCacheDir = cacheDir;

  try {
    console.log("[tts] Loading Kokoro model (native CPU)...");
    console.log(`[tts] Platform: ${process.platform}, arch: ${process.arch}`);
    console.log(`[tts] CWD: ${process.cwd()}`);
    console.log(`[tts] Home: ${os.homedir()}`);
    const startTime = Date.now();

    // Dynamic import so it doesn't block server startup if missing
    console.log("[tts] Importing kokoro-js...");
    const kokoroModule = await import("kokoro-js");
    const { KokoroTTS } = kokoroModule;
    console.log("[tts] kokoro-js imported successfully");

    // Point the HuggingFace cache to a writable directory.
    // In packaged Electron builds the default cache (relative to the module
    // inside the asar archive) is read-only, so downloads silently fail.
    const ttsCacheDir = cacheDir
      ? path.join(cacheDir, "tts-cache")
      : path.join(os.homedir(), ".kuumba", "tts-cache");

    console.log(`[tts] Model cache directory: ${ttsCacheDir}`);
    console.log(`[tts] Provided cacheDir: ${cacheDir ?? "(none)"}`);

    // kokoro-js re-exports @huggingface/transformers env — set cache paths
    // before loading the model so files go to a writable location.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const hfModule = await import("@huggingface/transformers" as string);
      if (hfModule?.env) {
        hfModule.env.cacheDir = ttsCacheDir;
        hfModule.env.localModelPath = ttsCacheDir;
        console.log("[tts] HuggingFace env.cacheDir set to:", hfModule.env.cacheDir);
        console.log("[tts] HuggingFace env.localModelPath set to:", hfModule.env.localModelPath);
      } else {
        console.warn("[tts] @huggingface/transformers env not found — cache path may be wrong");
      }
    } catch (envErr) {
      console.warn(
        "[tts] Could not set HuggingFace cache dir:",
        envErr instanceof Error ? envErr.message : envErr,
      );
    }

    console.log(`[tts] Calling KokoroTTS.from_pretrained("${MODEL_ID}", dtype: "q4")...`);
    tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q4",
      device: "cpu",
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[tts] Kokoro model loaded successfully in ${elapsed}s`);
    loading = false;
  } catch (err) {
    loading = false;
    const stack = err instanceof Error ? err.stack : String(err);
    loadError = err instanceof Error ? err.message : String(err);
    console.error("[tts] Failed to load Kokoro model:", loadError);
    console.error("[tts] Full error stack:", stack);
  }
}

/**
 * Check if the TTS model is ready for synthesis.
 */
export function isTTSReady(): boolean {
  return tts !== null;
}

/**
 * Return the current TTS status for the /api/tts-status endpoint.
 */
export function getTTSStatus(): { ready: boolean; loading: boolean; error: string | null } {
  return { ready: tts !== null, loading, error: loadError };
}

/**
 * Reset error state and re-attempt model loading.
 */
export async function retryTTS(): Promise<void> {
  if (loading || tts) return;
  // Clear previous failure so initTTS can run again
  tts = null;
  loadError = null;
  loading = false;
  await initTTS(lastCacheDir);
}

/**
 * Synthesize text to WAV audio.
 * Returns an ArrayBuffer containing WAV data.
 */
export async function synthesize(text: string): Promise<ArrayBuffer> {
  if (!tts) {
    if (loadError) {
      throw new Error(`TTS model failed to load: ${loadError}`);
    }
    if (loading) {
      // Wait for model to finish loading (up to 60s)
      const deadline = Date.now() + 60_000;
      while (loading && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!tts) {
        throw new Error("TTS model is still loading. Try again in a moment.");
      }
    } else {
      throw new Error("TTS model is not loaded. Call initTTS() first.");
    }
  }

  const rawAudio = await tts.generate(text, { voice: VOICE_ID });
  const wavBuffer: ArrayBuffer = rawAudio.toWav();
  return wavBuffer;
}
