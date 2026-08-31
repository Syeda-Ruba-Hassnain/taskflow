import OpenAI, { APIConnectionTimeoutError } from "openai";
import { getIntentSystemPrompt } from "./prompt";
import { getAIConfig } from "./config";
import { AppError } from "@/lib/errors/app-error";

let client: OpenAI | null = null;

// Lazily constructs (and memoizes) the AI client, validating required
// configuration first via the centralized getAIConfig(). The OpenAI SDK
// throws its own uncaught error the moment it's constructed with no
// resolvable API key, so config must be resolved before construction,
// not just before use — otherwise a missing key would crash the
// request instead of failing cleanly with an AppError.
function getClient(): OpenAI {
  const config = getAIConfig();

  if (!client) {
    client = new OpenAI({
      apiKey: config.groqApiKey,
      baseURL: "https://api.groq.com/openai/v1",
      timeout: config.requestTimeoutMs,
    });
  }

  return client;
}

export async function parseIntent(transcript: string) {
  try {
    const response = await getClient().chat.completions.create({
      model: process.env.AI_MODEL || "openai/gpt-oss-120b",
      temperature: 0,
      // Groq's gpt-oss models default to "medium" reasoning effort, which
      // spends a few hundred ms generating hidden chain-of-thought tokens
      // before the answer. Intent parsing here is short structured
      // extraction, not open-ended reasoning, so "low" is sufficient and
      // roughly halves response time (measured ~155 reasoning tokens/370ms
      // at medium vs. ~15 reasoning tokens/60ms at low for a typical
      // command, same valid JSON output either way).
      reasoning_effort: "low",
      response_format: {
        type: "json_object",
      },
      messages: [
        {
          role: "system",
          content: getIntentSystemPrompt(),
        },
        {
          role: "user",
          content: transcript,
        },
      ],
    });

    return response.choices[0].message.content ?? "{}";
  } catch (error) {
    if (error instanceof APIConnectionTimeoutError) {
      throw new AppError(
        "The AI assistant is taking too long to respond. Please try again.",
        504
      );
    }

    throw error;
  }
}
