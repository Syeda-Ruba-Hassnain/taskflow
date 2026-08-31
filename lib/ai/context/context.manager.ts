import { toAIContextTask } from "./mappers/context.mapper";

import { aiContextStore } from "./context.store";
import { AIConversationContext } from "./context.types";

import { AIResponse } from "@/lib/types/ai";
import {
  isClarificationResult,
  isConfirmationResult,
  isRenamedResult,
  type AIExecutionResult,
} from "@/lib/types/ai-execution";

export class AIContextManager {
  /**
   * Resolve missing information in the AI response
   * using previous conversation context.
   */
  resolve(
    userId: number,
    response: AIResponse
  ): AIResponse {
    const context = aiContextStore.get(userId);

    if (!context) {
      return response;
    }

    const resolved: AIResponse = {
      ...response,
    };

    const isPronounQuery = (value: string) =>
      /^(it|that|this|them|those|him|her|task|the task|that task|this task)$/i.test(
        value.trim()
      );

    /**
     * If the user says things like:
     * "make it high priority"
     * "delete it"
     * "move it to tomorrow"
     *
     * reuse the previously resolved task.
     */
    if (!resolved.task && context.lastTask) {
      resolved.task = {
        title: context.lastTask.title,
        description: context.lastTask.description,
        priority: context.lastTask.priority,
        category: context.lastTask.category,
        dueDate: context.lastTask.dueDate,
        completed: context.lastTask.completed,
      };
    }

    if (
      !resolved.task &&
      resolved.query?.title &&
      context.lastTask &&
      isPronounQuery(resolved.query.title)
    ) {
      resolved.task = {
        title: context.lastTask.title,
        description: context.lastTask.description,
        priority: context.lastTask.priority,
        category: context.lastTask.category,
        dueDate: context.lastTask.dueDate,
        completed: context.lastTask.completed,
      };
      resolved.query = undefined;
    }

    /**
     * Reuse the previous search query — but only when this command
     * isn't already targeting a specific task. Otherwise a stale
     * filter from an earlier, unrelated search (e.g. "show completed
     * tasks") would outrank the task just resolved above and the
     * executor would act on whatever that old filter matches instead
     * of the intended task (see AIExecutor.findTask's
     * `ai.query ?? ai.task`, which prefers query when both are set).
     */
    if (!resolved.task && !resolved.query && context.lastQuery) {
      resolved.query = context.lastQuery;
    }

    return resolved;
  }

  /**
   * Save conversation context after a successful AI execution.
   *
   * A needsConfirmation/needsClarification result means nothing was
   * actually resolved/executed yet (the executor stopped short of the
   * database), so it must never be remembered as "the last task" —
   * doing so would make a later pronoun reference ("rename it")
   * resolve to a task that was never actually touched. The API route
   * already never calls remember() with one of these in practice (it
   * returns early), but this guard makes that a real invariant of
   * remember() itself, not just a convention callers have to know.
   */
  remember(
    userId: number,
    response: AIResponse,
    result: AIExecutionResult
  ): void {
    if (isConfirmationResult(result) || isClarificationResult(result)) {
      return;
    }

    // Unwrap update_task's {task, previousTitle} shape (see
    // RenamedResult) down to the plain Task before falling into the
    // normal single-task branch below — remember() only ever cares
    // about the task itself, never the message-building metadata.
    const taskResult = isRenamedResult(result) ? result.task : result;

    const updated: Partial<AIConversationContext> = {};

    if (Array.isArray(taskResult)) {
      if (response.query) {
        updated.lastQuery = response.query;
      }
    } else if (
      taskResult &&
      typeof taskResult === "object" &&
      "duplicate" in taskResult
    ) {
      updated.lastTask = toAIContextTask(taskResult.task);
    } else {
      updated.lastTask = toAIContextTask(taskResult);
    }

    aiContextStore.update(userId, updated);
  }

  /**
   * Clear a user's conversation memory.
   */
  clear(userId: number): void {
    aiContextStore.clear(userId);
  }
}

export const aiContextManager = new AIContextManager();