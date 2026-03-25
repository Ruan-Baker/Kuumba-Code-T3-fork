/**
 * Audio transcription via OpenRouter using Gemini's multimodal audio support.
 *
 * Sends recorded audio as a base64 data URL to Gemini via OpenRouter.
 * Gemini transcribes AND cleans up dev-specific terms in one shot —
 * no separate cleanup call needed.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-2.0-flash-001";

/**
 * Transcribe audio using OpenRouter's Gemini model.
 * Returns cleaned-up text ready to insert into the composer.
 */
export async function transcribeWithOpenRouter(
  audioBlob: Blob,
  apiKey: string,
  projectContext?: string | undefined,
): Promise<string> {
  if (!apiKey) throw new Error("No API key");

  // Convert audio blob to base64 data URL
  const base64Audio = await blobToBase64(audioBlob);
  const mimeType = audioBlob.type || "audio/webm";
  const dataUrl = `data:${mimeType};base64,${base64Audio}`;

  const systemPrompt = [
    "You are a voice transcription assistant for a software developer.",
    "Transcribe the audio accurately, fixing technical terms, variable names, function names, file paths, and programming concepts.",
    "Keep the original meaning and intent.",
    "Only return the transcribed text, nothing else — no quotes, no labels, no prefixes.",
    "Do not add punctuation that wasn't implied. Do not change the structure.",
    projectContext ? `The developer is working on a project called "${projectContext}".` : "",
  ]
    .filter(Boolean)
    .join(" ");

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
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe this audio recording. Return only the spoken text.",
            },
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenRouter transcription failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  // Process in chunks to avoid call stack overflow on large blobs
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
