/**
 * Supported AI intents.
 * Every AI response MUST return one of these.
 */
export enum AIIntent {
  CREATE_TASK = "create_task",
  UPDATE_TASK = "update_task",
  DELETE_TASK = "delete_task",
  DELETE_ALL_TASKS = "delete_all_tasks",
  COMPLETE_TASK = "complete_task",
  UNCOMPLETE_TASK = "uncomplete_task",
  LIST_TASKS = "list_tasks",
  SEARCH_TASKS = "search_tasks",
  CHANGE_PRIORITY = "change_priority",
  CHANGE_CATEGORY = "change_category",
  SUMMARIZE_TODAY = "summarize_today",
  UNKNOWN = "unknown",
  GREETING = "greeting",
}

/**
 * How confident the model is that it understood the request as a
 * coherent instruction. Only consulted by the confirmation policy
 * (lib/ai/confirmation-policy.ts) for mutating intents — "high" (or an
 * absent value, for responses that predate this field) always
 * proceeds normally.
 */
export type AIConfidence = "high" | "medium" | "low";

/**
 * Allowed priority values.
 */
export type TaskPriority = "low" | "medium" | "high";

/**
 * Data required to create a task.
 */
export interface AITask {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  category?: string | null;
  dueDate?: string | null;
  completed?: boolean;
}

/**
 * Used when updating an existing task.
 * Only the changed fields are included.
 */
export interface AITaskChanges {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  category?: string | null;
  dueDate?: string | null;
  completed?: boolean;
}

/**
 * Used for searching tasks.
 */
export interface AITaskQuery {
  title?: string;
  category?: string;
  completed?: boolean;
  priority?: TaskPriority;
}

/**
 * Standard AI response contract.
 */
export interface AIResponse {
  intent: AIIntent;

  task?: AITask | null;

  changes?: AITaskChanges | null;

  query?: AITaskQuery | null;

  confidence?: AIConfidence;
}