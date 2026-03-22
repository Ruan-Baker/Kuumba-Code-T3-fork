/**
 * Server-side TTS using Kokoro with native ONNX runtime.
 *
 * The model is loaded once at server startup and kept in memory.
 * Synthesis is fast (~100-500ms per sentence on CPU).
 */

const VOICE_ID = "bf_emma";
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let tts: any = null;
let loading = false;
let loadError: string | null = null;

/**
 * Initialize the Kokoro TTS model. Call this at server startup.
 * Runs in the background — doesn't block the server from starting.
 */
export async function initTTS(): Promise<void> {
  if (tts || loading) return;
  loading = true;

  try {
    console.log("[tts] Loading Kokoro model (native CPU)...");
    const startTime = Date.now();

    // Dynamic import so it doesn't block server startup if missing
    const { KokoroTTS } = await import("kokoro-js");

    tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q4",
      device: "cpu",
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[tts] Kokoro model loaded in ${elapsed}s`);
    loading = false;
  } catch (err) {
    loading = false;
    loadError = err instanceof Error ? err.message : String(err);
    console.error("[tts] Failed to load Kokoro model:", loadError);
  }
}

/**
 * Check if the TTS model is ready for synthesis.
 */
export function isTTSReady(): boolean {
  return tts !== null;
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
