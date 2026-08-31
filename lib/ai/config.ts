import { AppError } from "@/lib/errors/app-error";

const DEFAULT_AI_REQUEST_TIMEOUT_MS = 15_000;

export type AIConfig = {
  groqApiKey: string;
  requestTimeoutMs: number;
};

let cachedConfig: AIConfig | null = null;

/**
 * Resolves and validates the AI pipeline's required environment
 * configuration. Cached after the first successful resolution.
 *
 * Single source of truth for this validation — called both eagerly
 * at server startup (see instrumentation.ts, log-only, never crashes
 * the app) and lazily by the AI client on each request (throws,
 * becomes a clean HTTP response via the route's existing AppError
 * handling).
 */
export function getAIConfig(): AIConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const groqApiKey = process.env.GROQ_API_KEY;

  if (!groqApiKey) {
    console.error("Missing GROQ_API_KEY");
    throw new AppError("AI features are not configured.", 500);
  }

  cachedConfig = {
    groqApiKey,
    requestTimeoutMs: resolveRequestTimeoutMs(),
  };

  return cachedConfig;
}

function resolveRequestTimeoutMs(): number {
  const raw = process.env.AI_REQUEST_TIMEOUT_MS;

  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_AI_REQUEST_TIMEOUT_MS;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(`Invalid AI_REQUEST_TIMEOUT_MS: "${raw}"`);
    throw new AppError(
      "AI features are not configured correctly.",
      500
    );
  }

  return parsed;
}
