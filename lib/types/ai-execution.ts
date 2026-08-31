import { Task } from "@prisma/client";
import { AIIntent, AITaskChanges } from "./ai";

/**
 * A fully resolved, ready-to-execute mutation, produced once by
 * AIExecutor when a request requires explicit confirmation before it
 * touches the database (see AIExecutor.execute / executeConfirmedAction).
 * Carries the resolved task id(s) and validated changes — never the
 * original transcript — so confirming never re-invokes the LLM and
 * never re-interprets natural language.
 *
 * The update/priority/category/complete/uncomplete branch is part of
 * the type contract (kept general on purpose) but is not produced by
 * the confirmation policy yet — those intents execute immediately per
 * lib/ai/confirmation-policy.ts. AIExecutor.executeConfirmedAction
 * rejects it defensively if ever received.
 */
export type PendingAIAction =
  | {
      intent: AIIntent.DELETE_TASK;
      taskId: number;
      taskTitle: string;
    }
  | {
      intent: AIIntent.DELETE_ALL_TASKS;
      taskIds: number[];
      taskCount: number;
    }
  | {
      intent:
        | AIIntent.UPDATE_TASK
        | AIIntent.CHANGE_PRIORITY
        | AIIntent.CHANGE_CATEGORY
        | AIIntent.COMPLETE_TASK
        | AIIntent.UNCOMPLETE_TASK;
      taskId: number;
      taskTitle: string;
      changes: AITaskChanges;
    };

// Distinguishing metadata shown for each candidate when a task
// reference is ambiguous — enough that "which one did you mean?" is
// actually answerable when several tasks share (or nearly share) a
// title. dueDate is a plain YYYY-MM-DD string (or null), matching the
// client-facing SerializedTask contract used everywhere else.
export type AmbiguousCandidate = {
  id: number;
  title: string;
  priority: string;
  category: string;
  completed: boolean;
  dueDate: string | null;
};

export type ClarificationResult = {
  needsClarification: true;
  message: string;
  candidates?: AmbiguousCandidate[];
};

export type ConfirmationResult = {
  needsConfirmation: true;
  message: string;
  action: PendingAIAction;
};

// update_task's success path when the title itself changed — carries
// the task's title BEFORE the update (captured at resolution time, not
// reconstructed from the transcript/query afterward) so the route can
// build an explicit "Changed X to Y" message. Every other mutating
// intent keeps returning a bare Task; this exists only because
// update_task is the one case where "what changed" isn't otherwise
// recoverable from the post-update Task alone.
export type RenamedResult = {
  task: Task;
  previousTitle: string;
};

export type AIExecutionResult =
  | Task
  | Task[]
  | {
      duplicate: true;
      task: Task;
    }
  | ClarificationResult
  | ConfirmationResult
  | RenamedResult;

export function isClarificationResult(
  result: AIExecutionResult
): result is ClarificationResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "needsClarification" in result
  );
}

export function isConfirmationResult(
  result: AIExecutionResult
): result is ConfirmationResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "needsConfirmation" in result
  );
}

export function isRenamedResult(
  result: AIExecutionResult
): result is RenamedResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "previousTitle" in result
  );
}
