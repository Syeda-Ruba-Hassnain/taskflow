import { AIResponseError } from "@/lib/errors/ai-response-error";

// Cap how much of a malformed AI response gets written to logs, so a
// pathological response can't blow up log storage.
const MAX_LOGGED_RESPONSE_LENGTH = 1000;

/**
 * Parses the AI response into a JavaScript object.
 * Removes Markdown code fences if the model accidentally includes them.
 *
 * @param content Raw AI response as a string.
 * @returns Parsed JavaScript object.
 * @throws AIResponseError if the response is empty or invalid JSON.
 */
export function parseAIResponse(content: string): unknown {
  if (!content || content.trim().length === 0) {
    throw new AIResponseError("AI returned an empty response.");
  }

  // Remove Markdown code fences if present
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    // Logged here (not the route) because this is the only place the
    // original parsing error and the raw AI response are both still
    // available — AIResponseError intentionally carries neither, so
    // nothing downstream could log them even if it wanted to.
    console.error("AI_RESPONSE_PARSE_FAILURE", {
      error,
      response:
        cleaned.length > MAX_LOGGED_RESPONSE_LENGTH
          ? `${cleaned.slice(0, MAX_LOGGED_RESPONSE_LENGTH)}…`
          : cleaned,
    });

    throw new AIResponseError(
      "Failed to parse the AI response as JSON."
    );
  }
}