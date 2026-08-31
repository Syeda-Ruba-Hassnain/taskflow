import { describe, it, expect } from "vitest";
import { buildIntentMessage } from "./messages";
import { AIIntent } from "@/lib/types/ai";
import type { Task } from "@prisma/client";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Buy milk",
    description: null,
    category: "Personal",
    priority: "High",
    completed: false,
    dueDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: 1,
    ...overrides,
  } as Task;
}

describe("buildIntentMessage", () => {
  describe("array results", () => {
    it("reports a count for search_tasks", () => {
      const result = [makeTask(), makeTask()];
      expect(
        buildIntentMessage(AIIntent.SEARCH_TASKS, result)
      ).toBe("I found matching tasks for you.");
    });

    it("reports a singular search message for one match", () => {
      const result = [makeTask()];
      expect(
        buildIntentMessage(AIIntent.SEARCH_TASKS, result)
      ).toBe("I found one matching task for you.");
    });

    it("reports not-found for search_tasks with zero results, never a false positive", () => {
      const result: Task[] = [];
      expect(
        buildIntentMessage(AIIntent.SEARCH_TASKS, result)
      ).toBe("I couldn't find any matching tasks.");
    });

    it("reports a user-friendly summary for summarize_today", () => {
      const result = [makeTask()];
      expect(
        buildIntentMessage(AIIntent.SUMMARIZE_TODAY, result)
      ).toBe("Here are your tasks due today.");
    });

    it("reports a friendly list message for list_tasks", () => {
      const result = [makeTask(), makeTask(), makeTask()];
      expect(buildIntentMessage(AIIntent.LIST_TASKS, result)).toBe(
        "Here are your tasks."
      );
    });

    it("handles an empty array", () => {
      expect(buildIntentMessage(AIIntent.LIST_TASKS, [])).toBe(
        "Here are your tasks."
      );
    });

    it("reports a count for a confirmed delete_all_tasks", () => {
      const result = [makeTask(), makeTask()];
      expect(
        buildIntentMessage(AIIntent.DELETE_ALL_TASKS, result)
      ).toBe("Deleted 2 tasks.");
    });

    it("uses singular phrasing for a single deleted task", () => {
      const result = [makeTask()];
      expect(
        buildIntentMessage(AIIntent.DELETE_ALL_TASKS, result)
      ).toBe("Deleted 1 task.");
    });

    it("reports nothing-to-delete for an empty delete_all_tasks result", () => {
      expect(
        buildIntentMessage(AIIntent.DELETE_ALL_TASKS, [])
      ).toBe("You didn't have any tasks to delete.");
    });
  });

  describe("single-task results", () => {
    it("confirms creation for create_task", () => {
      const task = makeTask({ title: "Buy milk" });
      expect(buildIntentMessage(AIIntent.CREATE_TASK, task)).toBe(
        'Done — I created "Buy milk".'
      );
    });

    it("reports a completed deletion for delete_task (only ever called post-confirmation)", () => {
      const task = makeTask({ title: "Buy milk" });
      expect(buildIntentMessage(AIIntent.DELETE_TASK, task)).toBe(
        'Deleted "Buy milk".'
      );
    });

    it("confirms completion for complete_task", () => {
      const task = makeTask({ title: "Buy milk" });
      expect(buildIntentMessage(AIIntent.COMPLETE_TASK, task)).toBe(
        'Great, "Buy milk" is now completed.'
      );
    });

    it("confirms reopening for uncomplete_task", () => {
      const task = makeTask({ title: "Buy milk" });
      expect(buildIntentMessage(AIIntent.UNCOMPLETE_TASK, task)).toBe(
        'Okay, I moved "Buy milk" back to pending.'
      );
    });

    it("reports the new (lowercased) priority for change_priority", () => {
      const task = makeTask({ title: "Buy milk", priority: "High" });
      expect(buildIntentMessage(AIIntent.CHANGE_PRIORITY, task)).toBe(
        'Done — I updated "Buy milk" to high priority.'
      );
    });

    it("reports the new category for change_category", () => {
      const task = makeTask({ title: "Buy milk", category: "Work" });
      expect(buildIntentMessage(AIIntent.CHANGE_CATEGORY, task)).toBe(
        'Done — I moved "Buy milk" to Work.'
      );
    });

    it("falls back to a generic update message for update_task", () => {
      const task = makeTask({ title: "Buy milk" });
      expect(buildIntentMessage(AIIntent.UPDATE_TASK, task)).toBe(
        'Done — I updated "Buy milk".'
      );
    });
  });
});
