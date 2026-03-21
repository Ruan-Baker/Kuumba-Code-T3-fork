/**
 * Whisper speech-to-text via Transformers.js (ONNX Runtime Web).
 *
 * Uses whisper-base (~74MB) downloaded on first use and cached in IndexedDB.
 * Falls back to Web Speech API if Whisper fails.
 */

type ProgressCallback = (progress: { status: string; progress?: number | undefined }) => void;

let pipeline: any = null;
let loading = false;

const MODEL_ID = "Xenova/whisper-base";

export function isWhisperCached(): boolean {
  // Check localStorage flag — set after successful first load
  return localStorage.getItem("kuumba-whisper-downloaded") === "true";
}

export function markWhisperCached(): void {
  localStorage.setItem("kuumba-whisper-downloaded", "true");
}

export async function loadWhisperModel(onProgress?: ProgressCallback): Promise<void> {
  if (pipeline) return;
  if (loading) {
    // Wait for existing load
    while (loading) await new Promise((r) => setTimeout(r, 100));
    return;
  }

  loading = true;
  try {
    // Dynamic import — Transformers.js is heavy, only load when needed
    const { pipeline: createPipeline } = await import("@huggingface/transformers");

    const opts: Record<string, unknown> = {
      dtype: "q8",
      device: "wasm",
    };
    if (onProgress) {
      opts.progress_callback = onProgress;
    }
    pipeline = await createPipeline(
      "automatic-speech-recognition",
      MODEL_ID,
      opts as any,
    );

    markWhisperCached();
  } finally {
    loading = false;
  }
}

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  if (!pipeline) {
    throw new Error("Whisper model not loaded. Call loadWhisperModel() first.");
  }

  // Convert blob to float32 audio data
  const audioBuffer = await blobToAudioBuffer(audioBlob);
  const audioData = audioBuffer.getChannelData(0); // mono

  // Resample to 16kHz if needed (Whisper expects 16kHz)
  const resampled = audioBuffer.sampleRate !== 16000
    ? resample(audioData, audioBuffer.sampleRate, 16000)
    : audioData;

  const result = await pipeline(resampled, {
    language: "en",
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  return (result as { text: string }).text.trim();
}

async function blobToAudioBuffer(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext({ sampleRate: 16000 });
  try {
    return await audioContext.decodeAudioData(arrayBuffer);
  } finally {
    await audioContext.close();
  }
}

function resample(data: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate;
  const newLength = Math.round(data.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(low + 1, data.length - 1);
    const frac = srcIndex - low;
    result[i] = data[low]! * (1 - frac) + data[high]! * frac;
  }
  return result;
}

/**
 * Fallback: Web Speech API transcription.
 */
export function transcribeWithWebSpeech(timeoutMs: number = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      reject(new Error("Speech recognition not supported"));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    const timeout = setTimeout(() => {
      recognition.stop();
      reject(new Error("Speech recognition timed out"));
    }, timeoutMs);

    recognition.onresult = (event: any) => {
      clearTimeout(timeout);
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      resolve(transcript);
    };

    recognition.onerror = (event: any) => {
      clearTimeout(timeout);
      reject(new Error(event.error ?? "Speech recognition failed"));
    };

    recognition.onend = () => {
      clearTimeout(timeout);
    };

    recognition.start();
  });
}
