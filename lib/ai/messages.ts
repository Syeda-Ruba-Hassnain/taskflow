import { Task } from "@prisma/client";

import { AIIntent } from "@/lib/types/ai";

/**
 * Builds the user-facing message for a successfully executed AI
 * intent. Only ever called with a REAL Task/Task[] result — a
 * mutation that's still waiting on confirmation or clarification
 * never reaches here (see AIExecutionResult's needsConfirmation/
 * needsClarification variants and the API route, which returns their
 * own `.message` directly instead). In particular, DELETE_TASK here
 * means the task has actually been deleted (via
 * AIExecutor.executeConfirmedAction, after the user confirmed) — the
 * initial "are you sure?" prompt is a separate, executor-authored
 * message on the needsConfirmation result, not this function.
 */
export function buildIntentMessage(
  intent: AIIntent,
  result: Task | Task[]
): string {
  // Checked ahead of the array branch below: the executor returns an
  // empty array for these two intents (there's no task result to
  // report), which would otherwise satisfy Array.isArray(result) and
  // fall through to a task-listing message instead of ever reaching
  // the GREETING/UNKNOWN cases in the switch further down.
  if (intent === AIIntent.GREETING) {
    return "Hello! How can I help you today?";
  }

  if (intent === AIIntent.UNKNOWN) {
    return "I didn't quite understand that. Could you say it another way?";
  }

  if (Array.isArray(result)) {
    switch (intent) {
      case AIIntent.SEARCH_TASKS:
        // The database result — not the LLM's claimed intent — decides
        // whether anything was actually found. An empty array must
        // never be reported as a match.
        if (result.length === 0) {
          return "I couldn't find any matching tasks.";
        }

        return result.length === 1
          ? "I found one matching task for you."
          : "I found matching tasks for you.";

      case AIIntent.SUMMARIZE_TODAY:
        return "Here are your tasks due today.";

      case AIIntent.LIST_TASKS:
        return "Here are your tasks.";

      case AIIntent.DELETE_ALL_TASKS:
        return result.length === 0
          ? "You didn't have any tasks to delete."
          : `Deleted ${result.length} task${
              result.length === 1 ? "" : "s"
            }.`;

      default:
        return "Here are the tasks I found.";
    }
  }

  switch (intent) {
    case AIIntent.CREATE_TASK:
      return `Done — I created "${result.title}".`;

    case AIIntent.DELETE_TASK:
      return `Deleted "${result.title}".`;

    case AIIntent.COMPLETE_TASK:
      return `Great, "${result.title}" is now completed.`;

    case AIIntent.UNCOMPLETE_TASK:
      return `Okay, I moved "${result.title}" back to pending.`;

    case AIIntent.CHANGE_PRIORITY:
      return `Done — I updated "${result.title}" to ${result.priority.toLowerCase()} priority.`;

    case AIIntent.CHANGE_CATEGORY:
      return `Done — I moved "${result.title}" to ${result.category}.`;

    default:
      return `Done — I updated "${result.title}".`;
  }
}
