/**
 * Transcript cleanup via OpenRouter API.
 * Uses gemini-2.0-flash-lite for fast, cheap dev-context-aware cleanup.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-2.0-flash-lite-001";

export async function cleanupTranscript(
  rawText: string,
  apiKey: string,
  projectContext?: string | undefined,
): Promise<string> {
  if (!apiKey) return rawText;
  if (!rawText.trim()) return "";

  const systemPrompt = [
    "You are a voice dictation cleanup assistant for a software developer.",
    "Fix transcription errors, especially technical terms, variable names, function names, file paths, and programming concepts.",
    "Keep the original meaning and intent. Only return the cleaned text, nothing else.",
    "Do not add punctuation that wasn't implied. Do not change the structure.",
    "If the text is already correct, return it as-is.",
    projectContext ? `The developer is working on a project called "${projectContext}".` : "",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://kuumba.code",
        "X-Title": "Kuumba Code Mobile",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: rawText },
        ],
        max_tokens: 500,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn("OpenRouter cleanup failed:", response.status);
      return rawText; // Fallback to raw
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return data.choices?.[0]?.message?.content?.trim() ?? rawText;
  } catch (err) {
    console.warn("Transcript cleanup error:", err);
    return rawText; // Fallback to raw on any error
  }
}
