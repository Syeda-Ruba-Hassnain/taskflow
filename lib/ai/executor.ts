import { Task } from "@prisma/client";

import {
  normalizeCategory,
  normalizePriority,
  toTaskCreateInput,
  toTaskUpdateInput,
} from "@/lib/ai/mappers/task.mapper";
import {
  needsConfidenceClarification,
} from "@/lib/ai/confirmation-policy";
import { taskService } from "@/lib/services/task.service";
import {
  AIIntent,
  AIResponse,
  AITask,
  AITaskChanges,
  AITaskQuery,
} from "@/lib/types/ai";
import {
  AIExecutionResult,
  AmbiguousCandidate,
  ClarificationResult,
  PendingAIAction,
} from "@/lib/types/ai-execution";
import { ValidationError } from "@/lib/errors/validation-error";
import { NotFoundError } from "@/lib/errors/not-found-error";

// The exact text TaskService.findMatchingTask's private disambiguate()
// throws for multiple candidates that can't be narrowed down further
// (see lib/services/task.service.ts) — matched here to distinguish
// "ambiguous" from any other ValidationError findMatchingTask can
// throw (e.g. "Task identification is required"), without changing
// that matching algorithm at all.
const AMBIGUOUS_MESSAGE = "Task request is ambiguous";

export class AIExecutor {
  async execute(
    ai: AIResponse,
    userId: number
  ): Promise<AIExecutionResult> {
    if (needsConfidenceClarification(ai.intent, ai.confidence)) {
      return this.clarifyLowConfidence(ai.intent);
    }

    switch (ai.intent) {
      case AIIntent.CREATE_TASK:
        return this.createTask(ai, userId);

      case AIIntent.UPDATE_TASK:
        return this.updateTask(ai, userId);

      case AIIntent.DELETE_TASK:
        return this.deleteTask(ai, userId);

      case AIIntent.DELETE_ALL_TASKS:
        return this.deleteAllTasks(userId);

      case AIIntent.COMPLETE_TASK:
        return this.completeTask(ai, userId);

      case AIIntent.UNCOMPLETE_TASK:
        return this.uncompleteTask(ai, userId);

      case AIIntent.LIST_TASKS:
        return this.listTasks(userId);

      case AIIntent.SEARCH_TASKS:
        return this.searchTasks(ai, userId);

      case AIIntent.CHANGE_PRIORITY:
        return this.changePriority(ai, userId);

      case AIIntent.CHANGE_CATEGORY:
        return this.changeCategory(ai, userId);

      case AIIntent.SUMMARIZE_TODAY:
        return this.summarizeToday(userId);

      case AIIntent.GREETING:
      case AIIntent.UNKNOWN:
        return [];

      default:
        throw new ValidationError(
          `Unsupported AI intent: ${ai.intent}`
        );
    }
  }

  /**
   * Executes a PendingAIAction that the user has already explicitly
   * confirmed — the resolved task id(s)/changes are used exactly as
   * given, never re-resolved or re-interpreted. Never touches the LLM.
   */
  async executeConfirmedAction(
    action: PendingAIAction,
    userId: number
  ): Promise<AIExecutionResult> {
    switch (action.intent) {
      case AIIntent.DELETE_TASK:
        return taskService.deleteTask(userId, action.taskId);

      case AIIntent.DELETE_ALL_TASKS: {
        const deleted: Task[] = [];

        for (const id of action.taskIds) {
          try {
            deleted.push(
              await taskService.deleteTask(userId, id)
            );
          } catch (error) {
            if (!(error instanceof NotFoundError)) {
              throw error;
            }
            // Already gone (deleted since the confirmation was
            // issued, or a stale/tampered id) — skip it rather than
            // failing the whole batch over one task that isn't there
            // anymore.
          }
        }

        return deleted;
      }

      default:
        // Reserved by PendingAIAction's type for future use (see its
        // doc comment) but not produced by the confirmation policy
        // yet — nothing should ever reach here today.
        throw new ValidationError(
          `Confirmation is not supported for "${action.intent}" yet.`
        );
    }
  }

  private async createTask(
    ai: AIResponse,
    userId: number
  ): Promise<AIExecutionResult> {
    const task = this.requireTask(ai.task);
    const title = task.title.trim();

    const existing = await taskService.getTaskByTitle(
      userId,
      title
    );

    if (existing) {
      return {
        duplicate: true,
        task: existing,
      };
    }

    return taskService.createTask(
      toTaskCreateInput(task, userId)
    );
  }

  private async updateTask(
    ai: AIResponse,
    userId: number
  ): Promise<AIExecutionResult> {
    const resolved = await this.resolveTaskOrClarify(ai, userId);

    if (this.isClarification(resolved)) {
      return resolved;
    }

    const changes = this.requireChanges(ai.changes);
    const updated = await taskService.updateTask(
      userId,
      resolved.id,
      toTaskUpdateInput(changes)
    );

    // The title BEFORE the change comes from `resolved` (the task as
    // TaskService actually found it) — never reconstructed from the
    // transcript or the AI's `query.title`, which for a fuzzy match
    // ("rename FYP..." -> "Finish FYP") is only a search term, not the
    // task's real title.
    if (changes.title !== undefined) {
      return { task: updated, previousTitle: resolved.title };
    }

    return updated;
  }

  private async deleteTask(
    ai: AIResponse,
    userId: number
  ): Promise<AIExecutionResult> {
    const resolved = await this.resolveTaskOrClarify(ai, userId);

    if (this.isClarification(resolved)) {
      return resolved;
    }

    // Deletion is destructive, so this only ever resolves the target
    // and asks for explicit confirmation — the actual delete happens
    // later, via executeConfirmedAction, only once the user confirms.
    return {
      needsConfirmation: true,
      message: `Are you sure you want to delete "${resolved.title}"? This can't be undone.`,
      action: {
        intent: AIIntent.DELETE_TASK,
        taskId: resolved.id,
        taskTitle: resolved.title,
      },
    };
  }

  private async deleteAllTasks(
    userId: number
  ): Promise<AIExecutionResult> {
    const tasks = await taskService.getUserTasks(userId);

    if (tasks.length === 0) {
      return {
        needsClarification: true,
        message: "You don't have any tasks to delete.",
      };
    }

    return {
      needsConfirmation: true,
      message: `Are you sure you want to delete all ${tasks.length} of your tasks? This can't be undone.`,
      action: {
        intent: AIIntent.DELETE_ALL_TASKS,
        taskIds: tasks.map((task) => task.id),
        taskCount: tasks.length,
      },
    };
  }

  private async completeTask(
    ai: AIResponse,
    userId: number
  ): Promise<AIExecutionResult> {
    const resolved = await this.resolveTaskOrClarify(ai, userId);

    if (this.isClarification(resolved)) {
      return resolved;
    }

    return taskService.completeTask(userId, resolved.id);
  }

  private async uncompleteTask(
    ai: AIResponse,
    userId: number
  ): Promise<AIExecutionResult> {
    const resolved = await this.resolveTaskOrClarify(ai, userId);

    if (this.isClarification(resolved)) {
      return resolved;
    }

    return taskService.uncompleteTask(userId, resolved.id);
  }

  private async listTasks(
    userId: number
  ): Promise<Task[]> {
    return taskService.getUserTasks(userId);
  }

  private async searchTasks(
    ai: AIResponse,
    userId: number
  ): Promise<Task[]> {
    return taskService.searchTasks(
      userId,
      ai.query
    );
  }

  private async changePriority(
    ai: AIResponse,
    userId: number
  ): Promise<AIExecutionResult> {
    const priority = ai.changes?.priority;

    if (!priority) {
      throw new ValidationError(
        "A new priority is required"
      );
    }

    const resolved = await this.resolveTaskOrClarify(ai, userId);

    if (this.isClarification(resolved)) {
      return resolved;
    }

    return taskService.updateTask(userId, resolved.id, {
      priority: normalizePriority(priority),
    });
  }

  private async changeCategory(
    ai: AIResponse,
    userId: number
  ): Promise<AIExecutionResult> {
    const category =
      ai.changes?.category?.trim();

    if (!category) {
      throw new ValidationError(
        "A new category is required"
      );
    }

    const resolved = await this.resolveTaskOrClarify(ai, userId);

    if (this.isClarification(resolved)) {
      return resolved;
    }

    return taskService.updateTask(userId, resolved.id, {
      category: normalizeCategory(category),
    });
  }

  private async summarizeToday(
    userId: number
  ): Promise<Task[]> {
    return taskService.getTasksDueToday(
      userId
    );
  }

  private async findTask(
    ai: AIResponse,
    userId: number
  ): Promise<Task> {
    return taskService.findMatchingTask(
      userId,
      ai.query ?? ai.task
    );
  }

  /**
   * Same target resolution as findTask, but converts the one expected
   * failure mode — TaskService.findMatchingTask's "ambiguous" error
   * for multiple candidates — into a needsClarification result instead
   * of letting it bubble up as a raw 400. Does not change (or need to
   * inspect the internals of) that matching algorithm at all.
   *
   * The candidate list shown to the user comes from a fresh
   * taskService.searchTasks call using the SAME criteria the AI
   * supplied (title and/or category/priority/completed — whichever
   * findMatchingTask itself was given), not from findMatchingTask's
   * own internal candidate set — that set isn't returned to the
   * caller, and re-deriving it here would mean reaching into and
   * changing the matching algorithm's internals, which is explicitly
   * out of scope. In practice this returns the same or a slightly
   * broader set.
   */
  private async resolveTaskOrClarify(
    ai: AIResponse,
    userId: number
  ): Promise<Task | ClarificationResult> {
    try {
      return await this.findTask(ai, userId);
    } catch (error) {
      if (
        error instanceof ValidationError &&
        error.message === AMBIGUOUS_MESSAGE
      ) {
        const identifyingQuery = ai.query ?? ai.task;

        // ai.task's category can be `null` (AITask), but
        // TaskService.searchTasks' query type only accepts `undefined`
        // for "not specified" (AITaskQuery) — normalize here rather
        // than widening searchTasks' own signature.
        const searchQuery: AITaskQuery | undefined = identifyingQuery
          ? {
              title: identifyingQuery.title,
              category: identifyingQuery.category ?? undefined,
              priority: identifyingQuery.priority,
              completed: identifyingQuery.completed,
            }
          : undefined;

        const matches = searchQuery
          ? await taskService.searchTasks(userId, searchQuery)
          : [];

        return this.buildAmbiguityClarification(
          matches,
          identifyingQuery?.title?.trim()
        );
      }

      throw error;
    }
  }

  /**
   * Builds a clarification that actually helps the user tell the
   * candidates apart — a bare list of titles is useless when they're
   * identical or near-identical (the exact scenario that makes a task
   * "ambiguous" in the first place). Falls back to a distinct message
   * when the candidates are truly indistinguishable by anything this
   * app tracks (title, priority, category, due date, completion).
   */
  private buildAmbiguityClarification(
    matches: Task[],
    searchedTitle: string | undefined
  ): ClarificationResult {
    if (matches.length === 0) {
      return {
        needsClarification: true,
        message:
          "I found multiple matching tasks but couldn't retrieve their details. Could you be more specific about which one you mean?",
      };
    }

    const candidates: AmbiguousCandidate[] = matches.map((task) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      category: task.category,
      completed: task.completed,
      dueDate: task.dueDate
        ? task.dueDate.toISOString().slice(0, 10)
        : null,
    }));

    const message = this.candidatesAreIdentical(matches)
      ? `I found ${matches.length} identical tasks named "${matches[0].title}". Please specify another detail, such as priority, due date, or category.`
      : `I found ${matches.length} tasks${
          searchedTitle ? ` matching "${searchedTitle}"` : ""
        }. Which one did you mean?\n\n${candidates
          .map(
            (candidate, index) =>
              `${index + 1}. ${this.formatCandidateLine(candidate)}`
          )
          .join("\n")}`;

    return { needsClarification: true, message, candidates };
  }

  private formatCandidateLine(candidate: AmbiguousCandidate): string {
    return [
      candidate.title,
      candidate.category,
      `${candidate.priority} priority`,
      candidate.dueDate ? `Due ${candidate.dueDate}` : "No due date",
      candidate.completed ? "Completed" : "Not completed",
    ].join(" — ");
  }

  private candidatesAreIdentical(tasks: Task[]): boolean {
    const [first, ...rest] = tasks;

    return rest.every(
      (task) =>
        task.title === first.title &&
        task.priority === first.priority &&
        task.category === first.category &&
        task.completed === first.completed &&
        (task.dueDate?.getTime() ?? null) ===
          (first.dueDate?.getTime() ?? null)
    );
  }

  private isClarification(
    value: Task | ClarificationResult
  ): value is ClarificationResult {
    return (
      typeof value === "object" &&
      value !== null &&
      "needsClarification" in value
    );
  }

  private clarifyLowConfidence(
    intent: AIIntent
  ): ClarificationResult {
    const messages: Partial<Record<AIIntent, string>> = {
      [AIIntent.CREATE_TASK]:
        "I'm not sure I understood what task you'd like to create. Could you rephrase that?",
      [AIIntent.UPDATE_TASK]:
        "I'm not sure I understood that. Which task would you like to rename or update, and what should change?",
      [AIIntent.COMPLETE_TASK]:
        "I'm not sure which task you'd like to mark complete. Could you rephrase that?",
      [AIIntent.UNCOMPLETE_TASK]:
        "I'm not sure which task you'd like to mark as pending. Could you rephrase that?",
      [AIIntent.CHANGE_PRIORITY]:
        "I'm not sure which task's priority you'd like to change, or to what. Could you rephrase that?",
      [AIIntent.CHANGE_CATEGORY]:
        "I'm not sure which task's category you'd like to change, or to what. Could you rephrase that?",
      [AIIntent.DELETE_TASK]:
        "I'm not sure which task you'd like to delete. Could you rephrase that?",
      [AIIntent.DELETE_ALL_TASKS]:
        "I'm not sure that's what you meant — could you confirm you'd like to delete all of your tasks?",
    };

    return {
      needsClarification: true,
      message:
        messages[intent] ??
        "I'm not sure I understood that request. Could you rephrase it?",
    };
  }

  private requireTask(
    task: AITask | null | undefined
  ): AITask {
    if (!task || !task.title.trim()) {
      throw new ValidationError(
        "Task details are required"
      );
    }

    return task;
  }

  private requireChanges(
    changes: AITaskChanges | null | undefined
  ): AITaskChanges {
    if (
      !changes ||
      Object.keys(changes).length === 0
    ) {
      throw new ValidationError(
        "Task changes are required"
      );
    }

    return changes;
  }
}

export const aiExecutor =
  new AIExecutor();