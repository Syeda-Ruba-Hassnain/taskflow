import { z } from "zod";
import { AIIntent } from "@/lib/types/ai";
import type { PendingAIAction } from "@/lib/types/ai-execution";
import { AIResponseError } from "@/lib/errors/ai-response-error";
import { ValidationError } from "@/lib/errors/validation-error";

const PrioritySchema = z.enum(["low", "medium", "high"]);

// Optional, not required: kept backward-compatible so a response that
// predates this field (or a model hiccup that omits it) still
// validates — the confirmation policy treats a missing value the same
// as "high" (see needsConfidenceClarification).
const ConfidenceSchema = z.enum(["high", "medium", "low"]);

const TaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  priority: PrioritySchema.optional(),
  category: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  completed: z.boolean().optional(),
});

const TaskChangesSchema = TaskSchema.partial();

const TaskQuerySchema = z.object({
  title: z.string().optional(),
  category: z.string().optional(),
  completed: z.boolean().optional(),
  priority: PrioritySchema.optional(),
});

export const AIResponseSchema = z.object({
  intent: z.nativeEnum(AIIntent),

  task: TaskSchema.nullable().optional(),

  changes: TaskChangesSchema.nullable().optional(),

  query: TaskQuerySchema.nullable().optional(),

  confidence: ConfidenceSchema.optional(),
});

export type ValidatedAIResponse = z.infer<typeof AIResponseSchema>;

export function validateAIResponse(data: unknown): ValidatedAIResponse {
  try {
    return AIResponseSchema.parse(data);
  } catch {
    throw new AIResponseError(
      "The AI returned a response that did not match the expected format."
    );
  }
}

// ==================================
// PENDING ACTION (CONFIRMATION)
// ==================================
//
// Validates the client-echoed PendingAIAction on POST /api/ai/intent's
// { confirm } branch. Deliberately only accepts the two intents the
// confirmation policy actually produces today (delete_task,
// delete_all_tasks) — see PendingAIAction's own doc comment for why
// the type is broader than what's validated here. Ownership is NOT
// checked here: taskId/taskIds are only ever used downstream scoped to
// the authenticated session's userId (never a client-supplied one), so
// a stale or foreign id fails safely at the repository layer instead.
const PendingActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal(AIIntent.DELETE_TASK),
    taskId: z.number().int().positive(),
    taskTitle: z.string(),
  }),
  z.object({
    intent: z.literal(AIIntent.DELETE_ALL_TASKS),
    taskIds: z.array(z.number().int().positive()),
    taskCount: z.number().int().nonnegative(),
  }),
]);

export function validatePendingAction(data: unknown): PendingAIAction {
  const result = PendingActionSchema.safeParse(data);

  if (!result.success) {
    throw new ValidationError(
      "The confirmation request was invalid or has expired. Please try the command again."
    );
  }

  return result.data;
}

