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

  // 1. Remove fenced code blocks (```...``` and ~~~...~~~)
  text = text.replace(/```[\s\S]*?```/g, "");
  text = text.replace(/~~~[\s\S]*?~~~/g, "");

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
