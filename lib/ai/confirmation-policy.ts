import { AIConfidence, AIIntent } from "@/lib/types/ai";

// Intents that write to the database at all. Confidence-gating and
// destructiveness are only meaningful for these — list/search/summarize/
// greeting/unknown never mutate, so nothing here applies to them.
export const MUTATING_INTENTS: ReadonlySet<AIIntent> = new Set([
  AIIntent.CREATE_TASK,
  AIIntent.UPDATE_TASK,
  AIIntent.DELETE_TASK,
  AIIntent.DELETE_ALL_TASKS,
  AIIntent.COMPLETE_TASK,
  AIIntent.UNCOMPLETE_TASK,
  AIIntent.CHANGE_PRIORITY,
  AIIntent.CHANGE_CATEGORY,
]);

// Intents irreversible enough that the user must explicitly confirm
// before they happen, regardless of how confident the AI was about
// interpreting the request. Kept independent of the confidence gate
// below — a *destructive* intent still needs confirmation even at
// "high" confidence, and confidence is a separate reason to pause.
export const DESTRUCTIVE_INTENTS: ReadonlySet<AIIntent> = new Set([
  AIIntent.DELETE_TASK,
  AIIntent.DELETE_ALL_TASKS,
]);

export function isMutatingIntent(intent: AIIntent): boolean {
  return MUTATING_INTENTS.has(intent);
}

export function isDestructiveIntent(intent: AIIntent): boolean {
  return DESTRUCTIVE_INTENTS.has(intent);
}

/**
 * Whether a mutating intent's own AI-reported confidence is low enough
 * that the request should be clarified instead of acted on. Pure and
 * intentionally tiny — no keyword/blacklist heuristics, just the
 * model's own categorical confidence field (lib/ai/prompt.ts teaches
 * it what "low" means).
 *
 * - Non-mutating intents never need this — nothing to protect.
 * - "low" confidence always needs clarification, for every mutating
 *   intent, including destructive ones: a low-confidence delete still
 *   needs to be clarified rather than quietly turned into a
 *   confirmation prompt for a task the model itself wasn't sure about.
 * - "medium" only needs clarification for NON-destructive intents.
 *   Destructive intents already stop for explicit confirmation
 *   regardless of confidence (see isDestructiveIntent), so "medium"
 *   doesn't need to add anything there.
 * - "high", or an absent confidence field (responses that predate
 *   this field, or a model hiccup that omits it), never triggers
 *   clarification on confidence grounds alone.
 */
export function needsConfidenceClarification(
  intent: AIIntent,
  confidence: AIConfidence | undefined
): boolean {
  if (!isMutatingIntent(intent)) {
    return false;
  }

  if (confidence === "low") {
    return true;
  }

  if (confidence === "medium" && !isDestructiveIntent(intent)) {
    return true;
  }

  return false;
}
