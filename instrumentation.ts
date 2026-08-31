import { getAIConfig } from "@/lib/ai/config";
import { logger } from "@/lib/logger";

// Runs once when a server instance starts, before any request is
// handled. Only validates — never throws past this point, so a
// missing/invalid AI configuration surfaces immediately in the logs
// without preventing the rest of the app (auth, tasks, dashboard)
// from starting or serving traffic. Actual AI requests still fail
// cleanly with an AppError via getAIConfig(), same as before.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  try {
    getAIConfig();
  } catch (error) {
    logger.error(
      "[startup] AI configuration is invalid:",
      error instanceof Error ? error.message : error
    );
    logger.error(
      "[startup] AI features will return errors until this is fixed."
    );
  }
}
