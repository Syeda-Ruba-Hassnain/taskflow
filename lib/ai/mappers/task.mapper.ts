import { Prisma } from "@prisma/client";

import {
  AITask,
  AITaskChanges,
  TaskPriority,
} from "@/lib/types/ai";
import {
  normalizeLabel,
  parseStrictDueDate,
  validateCategory,
  validateTitleForUpdate,
} from "@/lib/task/task-validator";
import { ValidationError } from "@/lib/errors/validation-error";

export function toTaskCreateInput(
  task: AITask,
  userId: number
): Prisma.TaskCreateInput {
  return {
    title: task.title.trim(),
    description: task.description?.trim() || null,
    priority: normalizePriority(task.priority ?? "medium"),
    category: normalizeCategory(task.category ?? "Other"),
    dueDate: parseDueDate(task.dueDate ?? null),
    completed: task.completed ?? false,
    user: {
      connect: { id: userId },
    },
  };
}

export function toTaskUpdateInput(
  changes: AITaskChanges
): Prisma.TaskUpdateInput {
  const data: Prisma.TaskUpdateInput = {};

  if (changes.title !== undefined) {
    data.title = validateTitleForUpdate(changes.title);
  }

  if (changes.description !== undefined) {
    data.description = changes.description?.trim() || null;
  }

  if (changes.priority !== undefined) {
    data.priority = normalizePriority(changes.priority);
  }

  if (changes.category !== undefined) {
    const category = changes.category?.trim();

    if (!category) {
      throw new ValidationError("Task category cannot be empty");
    }

    data.category = normalizeCategory(category);
  }

  if (changes.dueDate !== undefined) {
    data.dueDate = parseDueDate(changes.dueDate);
  }

  if (changes.completed !== undefined) {
    data.completed = changes.completed;
  }

  if (Object.keys(data).length === 0) {
    throw new ValidationError("Task changes are required");
  }

  return data;
}

export function parseDueDate(value: string | null): Date | null {
  return parseStrictDueDate(value);
}

export function normalizePriority(value: TaskPriority): string {
  return normalizeLabel(value);
}

// Case-normalizes the AI-supplied category (e.g. "work" -> "Work" —
// the same obvious, deterministic mapping REST callers get for free
// by matching VALID_CATEGORIES case-sensitively) and then validates
// the result against the app's existing category allow-list via
// validateCategory, the same function POST/PATCH /api/tasks use.
// A category with no deterministic mapping onto Work/Personal/
// Study/Other (e.g. "Shopping") throws TaskValidationError rather
// than silently persisting an unsupported value — callers already
// handle that error the same way they handle any other invalid AI
// task field (see toTaskUpdateInput's title validation above).
export function normalizeCategory(value: string): string {
  return validateCategory(normalizeLabel(value));
}
