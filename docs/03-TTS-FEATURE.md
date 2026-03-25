# Task 03 — Add Read Aloud Feature (Piper TTS)

## Objective

Add a speaker icon button below each AI response. When clicked, it reads the response text aloud using **Piper TTS** — a free, offline, natural-sounding text-to-speech engine that runs directly in the browser via WASM.

The button:

- Shows a speaker icon with "Read aloud" label
- Toggles to a stop icon when speaking
- Strips code blocks, inline code, and terminal output — reads only the prose text
- Works completely offline (no API keys, no internet, no cost)

## Architecture

```
NEW files (zero conflict risk — upstream will never touch these):
├── apps/web/src/lib/tts/
│   ├── tts-engine.ts            ← Piper TTS wrapper (WASM-based, offline)
│   ├── markdown-stripper.ts     ← Strips code/terminal from markdown for clean reading
│   └── useTTS.ts                ← React hook
├── apps/web/src/components/
│   └── ReadAloudButton.tsx      ← Speaker icon button component

MODIFIED (1 existing file, ~3-5 lines added):
└── apps/web/src/components/[MessageComponent].tsx  ← Import + render ReadAloudButton
```

## Step 1: Install Piper TTS Web Package

From the repo root:

```bash
cd apps/web
bun add @mintplex-labs/piper-tts-web
```

This package runs Piper TTS models entirely in the browser using ONNX Runtime WASM. No server, no Python, no binaries. It downloads the voice model once on first use and caches it in IndexedDB for future use.

## Step 2: Create the Markdown Stripper

**Create file: `apps/web/src/lib/tts/markdown-stripper.ts`**

````typescript
/**
 * Strips code blocks, inline code, terminal output, and markdown syntax
 * from a markdown string, returning only prose text suitable for TTS.
 *
 * Given a response like:
 *   "I've updated your config file.
 *    ```json
 *    { "key": "value" }
 *    ```
 *    Then I restarted the server and verified it works."
 *
 * Returns: "I've updated your config file. Then I restarted the server and verified it works."
 */
export function stripMarkdownForTTS(markdown: string): string {
  let text = markdown;

  // 1. Remove fenced code blocks (```...```) — this is the big one
  text = text.replace(/```[\s\S]*?```/g, "");

  // 2. Remove inline code (`...`)
  text = text.replace(/`[^`]+`/g, "");

  // 3. Remove image syntax ![alt](url)
  text = text.replace(/!\[.*?\]\(.*?\)/g, "");

  // 4. Convert links [text](url) to just the link text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // 5. Remove heading markers (keep the text)
  text = text.replace(/^#{1,6}\s+/gm, "");

  // 6. Remove bold/italic markers (keep the text)
  text = text.replace(/\*{1,3}(.*?)\*{1,3}/g, "$1");
  text = text.replace(/_{1,3}(.*?)_{1,3}/g, "$1");

  // 7. Remove horizontal rules
  text = text.replace(/^(-{3,}|\*{3,}|_{3,})$/gm, "");

  // 8. Remove HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // 9. Remove blockquote markers
  text = text.replace(/^>\s?/gm, "");

  // 10. Remove list markers but keep text
  text = text.replace(/^[\s]*[-*+]\s+/gm, "");
  text = text.replace(/^[\s]*\d+\.\s+/gm, "");

  // 11. Collapse multiple newlines/whitespace
  text = text.replace(/\n{2,}/g, ". ");
  text = text.replace(/\n/g, " ");
  text = text.replace(/\s{2,}/g, " ");

  // 12. Clean up any double periods from collapsing
  text = text.replace(/\.{2,}/g, ".");
  text = text.replace(/\.\s*\./g, ".");

  return text.trim();
}
````

## Step 3: Create the Piper TTS Engine

**Create file: `apps/web/src/lib/tts/tts-engine.ts`**

```typescript
/**
 * TTS Engine using Piper TTS via WASM.
 *
 * Uses @mintplex-labs/piper-tts-web which runs Piper voice models
 * entirely in the browser. Models are downloaded once on first use
 * and cached in IndexedDB.
 *
 * Fallback: If Piper fails to load (e.g., WASM not supported),
 * falls back to Web Speech API.
 */
import * as piperTTS from "@mintplex-labs/piper-tts-web";

// ─── Configuration ───────────────────────────────────────────────
// Voice model to use. Browse available voices at:
// https://rhasspy.github.io/piper-samples/
//
// Recommended English voices (voiceId format for piper-tts-web):
//   - "en_US-hfc_female-medium"  — Clear female voice, good quality
//   - "en_US-lessac-medium"      — Professional male voice
//   - "en_US-libritts_r-medium"  — Multi-speaker, natural
//   - "en_US-amy-medium"         — Female, British-tinged
//   - "en_GB-alan-medium"        — British male
//
// "medium" quality is the best balance of quality vs speed.
// "high" quality exists for some voices but is slower.
// "low" is fastest but sounds more robotic.

const DEFAULT_VOICE_ID = "en_US-hfc_female-medium";

// ─── State ───────────────────────────────────────────────────────
let currentAudio: HTMLAudioElement | null = null;
let isModelReady = false;
let modelDownloadProgress = 0;

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
      modelDownloadProgress = percent;
      onProgress?.(percent);
    });

    isModelReady = true;
  } catch (err) {
    console.warn("[TTS] Failed to preload Piper voice:", err);
  }
}

/**
 * Speak text using Piper TTS. Falls back to Web Speech API on failure.
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
    console.warn("[TTS] Piper failed, falling back to Web Speech API:", err);
    cleanup();
    speakWithWebSpeech(text, onStatus);
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
  window.speechSynthesis?.cancel();
  cleanup();
}

/**
 * Check if TTS is currently playing audio.
 */
export function isSpeaking(): boolean {
  return (
    (currentAudio !== null && !currentAudio.paused) || window.speechSynthesis?.speaking === true
  );
}

// ─── Web Speech API Fallback ─────────────────────────────────────

function speakWithWebSpeech(text: string, onStatus?: StatusCallback): void {
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Try to find a natural-sounding voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) => v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Enhanced"),
    );
    if (preferred) utterance.voice = preferred;

    utterance.onstart = () => onStatus?.({ state: "speaking" });
    utterance.onend = () => onStatus?.({ state: "idle" });
    utterance.onerror = () => onStatus?.({ state: "error", error: "Web Speech failed" });

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    onStatus?.({ state: "error", error: "TTS not available" });
  }
}

// ─── Internal ────────────────────────────────────────────────────

function cleanup(): void {
  if (currentAudio?.src) {
    URL.revokeObjectURL(currentAudio.src);
  }
  currentAudio = null;
}
```

## Step 4: Create the React Hook

**Create file: `apps/web/src/lib/tts/useTTS.ts`**

```typescript
import { useState, useCallback, useEffect, useRef } from "react";
import { speak, stop, type TTSStatus } from "./tts-engine";
import { stripMarkdownForTTS } from "./markdown-stripper";

export function useTTS() {
  const [status, setStatus] = useState<TTSStatus>({ state: "idle" });
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      stop(); // Stop TTS when component unmounts
    };
  }, []);

  const safeSetStatus = useCallback((s: TTSStatus) => {
    if (isMounted.current) setStatus(s);
  }, []);

  const speakText = useCallback(
    async (markdown: string) => {
      const text = stripMarkdownForTTS(markdown);
      if (!text) return;
      await speak(text, safeSetStatus);
    },
    [safeSetStatus],
  );

  const stopSpeaking = useCallback(() => {
    stop();
    safeSetStatus({ state: "idle" });
  }, [safeSetStatus]);

  const toggle = useCallback(
    async (markdown: string) => {
      if (status.state === "speaking" || status.state === "synthesizing") {
        stopSpeaking();
      } else {
        await speakText(markdown);
      }
    },
    [status.state, speakText, stopSpeaking],
  );

  return {
    status,
    isSpeaking: status.state === "speaking",
    isLoading: status.state === "downloading" || status.state === "synthesizing",
    speak: speakText,
    stop: stopSpeaking,
    toggle,
  };
}
```

## Step 5: Create the ReadAloudButton Component

**Create file: `apps/web/src/components/ReadAloudButton.tsx`**

```tsx
import { Volume2, VolumeX, Loader2 } from "lucide-react";
import { useTTS } from "../lib/tts/useTTS";

interface ReadAloudButtonProps {
  /** The raw markdown content of the AI response */
  content: string;
}

export function ReadAloudButton({ content }: ReadAloudButtonProps) {
  const { isSpeaking, isLoading, toggle } = useTTS();

  return (
    <button
      onClick={() => toggle(content)}
      disabled={isLoading}
      title={isLoading ? "Loading voice..." : isSpeaking ? "Stop reading" : "Read aloud"}
      className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md
                 text-muted-foreground hover:text-foreground hover:bg-muted
                 transition-colors disabled:opacity-50 disabled:cursor-wait"
    >
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isSpeaking ? (
        <VolumeX className="h-3.5 w-3.5" />
      ) : (
        <Volume2 className="h-3.5 w-3.5" />
      )}
      <span>{isLoading ? "Loading..." : isSpeaking ? "Stop" : "Read aloud"}</span>
    </button>
  );
}
```

## Step 6: Wire ReadAloudButton Into the Chat UI

This is the **only modification to an existing upstream file**. It's minimal — 2-5 lines.

### 6A: Find the Right Component

The AI response is rendered somewhere in `apps/web/src/components/`. Recent PRs split `ChatView.tsx` into sub-components. Run:

```bash
# Find where assistant messages are rendered
grep -rn "assistant\|role.*assistant\|message.*role" \
  --include="*.tsx" apps/web/src/components/ | head -20

# Look for the message bubble/content component
grep -rn "MessageContent\|AssistantMessage\|ChatMessage\|message\.text\|message\.content" \
  --include="*.tsx" apps/web/src/components/ | head -20
```

You're looking for the component that renders an individual AI response bubble — it will have:

- A check like `message.role === "assistant"` or similar
- Rendering of the markdown content (likely via a markdown renderer)

### 6B: Add the Import and Button

At the top of that component file, add the import:

```typescript
import { ReadAloudButton } from "./ReadAloudButton";
```

Then find where the assistant message content is rendered (after the markdown output), and add:

```tsx
{
  /* After the message content render, add the read aloud button */
}
{
  message.role === "assistant" && (
    <div className="mt-1">
      <ReadAloudButton content={message.text} />
    </div>
  );
}
```

### 6C: Verify the Props

The exact prop name for the message text may differ. Check what the component uses:

- `message.text` — most common
- `message.content` — alternative
- `message.markdown` — possible

Use whatever the component already accesses for rendering the markdown.

### Important Notes

- **Only add to completed (non-streaming) messages** — if the component distinguishes between streaming and completed messages, only show the button for completed ones
- **Place the button AFTER the message content**, not before
- The button should appear in the same container/wrapper as the message actions (copy button, etc.) if one exists
- If there's already a message actions bar (with copy, retry, etc.), add the ReadAloudButton there instead of creating a new wrapper

## Step 7: Test

1. Run `bun run dev:desktop`
2. Send a message to the AI and wait for a complete response
3. Look for the "Read aloud" button below the response
4. Click it — first time will take a few seconds to download the voice model (~15-30MB, cached after first use)
5. Verify it reads only the text, not code blocks
6. Click again to stop
7. Test with a response that has mixed text and code blocks

## File Summary

| File                                             | Type                      | Conflict Risk |
| ------------------------------------------------ | ------------------------- | ------------- |
| `apps/web/src/lib/tts/tts-engine.ts`             | NEW                       | None          |
| `apps/web/src/lib/tts/markdown-stripper.ts`      | NEW                       | None          |
| `apps/web/src/lib/tts/useTTS.ts`                 | NEW                       | None          |
| `apps/web/src/components/ReadAloudButton.tsx`    | NEW                       | None          |
| `apps/web/src/components/[MessageComponent].tsx` | MODIFIED (+3-5 lines)     | Low           |
| `apps/web/package.json`                          | MODIFIED (new dependency) | Low           |

## Troubleshooting

### "Voice model fails to download"

The model downloads from Hugging Face CDN. If behind a firewall, the initial download may fail. Workaround: the Web Speech API fallback will kick in automatically.

### "Audio doesn't play"

Electron may block autoplay. The user-initiated click on the button should satisfy autoplay policies. If not, check Electron's webPreferences for autoplayPolicy.

### "Text sounds wrong / reads code"

Check the markdown stripper. Add additional regex patterns for any custom syntax T3 Code uses that isn't standard markdown.

### Changing the Voice

Edit `DEFAULT_VOICE_ID` in `tts-engine.ts`. Browse voices at https://rhasspy.github.io/piper-samples/ — use the voice ID format like `en_US-hfc_female-medium`. Available qualities: `low`, `medium`, `high`.
