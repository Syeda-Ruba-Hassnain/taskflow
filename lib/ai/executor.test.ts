import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "@prisma/client";

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    createTask: vi.fn(),
    getTaskByTitle: vi.fn(),
    updateTask: vi.fn(),
    completeTask: vi.fn(),
    uncompleteTask: vi.fn(),
    deleteTask: vi.fn(),
    getUserTasks: vi.fn(),
    searchTasks: vi.fn(),
    getTasksDueToday: vi.fn(),
    findMatchingTask: vi.fn(),
  },
}));

import { AIExecutor } from "./executor";
import { taskService } from "@/lib/services/task.service";
import { AIIntent, AIResponse } from "@/lib/types/ai";
import { ValidationError } from "@/lib/errors/validation-error";
import { NotFoundError } from "@/lib/errors/not-found-error";
import { TaskValidationError } from "@/lib/task/task-validator";
import type { PendingAIAction } from "@/lib/types/ai-execution";

const mockedTaskService = vi.mocked(taskService);

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Existing task",
    description: null,
    category: "Other",
    priority: "Medium",
    completed: false,
    dueDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: 42,
    ...overrides,
  } as Task;
}

describe("AIExecutor", () => {
  let executor: AIExecutor;
  const userId = 42;

  beforeEach(() => {
    executor = new AIExecutor();
    vi.clearAllMocks();
  });

  describe("CREATE_TASK", () => {
    it("calls taskService.createTask with a correctly mapped, normalized input", async () => {
      const created = makeTask({ id: 10, title: "Buy milk" });
      mockedTaskService.createTask.mockResolvedValue(created);

      const ai: AIResponse = {
        intent: AIIntent.CREATE_TASK,
        task: {
          title: "Buy milk",
          priority: "high",
          category: "work",
          dueDate: null,
          description: null,
        },
      };

      const result = await executor.execute(ai, userId);

      expect(result).toBe(created);
      expect(mockedTaskService.createTask).toHaveBeenCalledTimes(1);

      const [callArg] = mockedTaskService.createTask.mock.calls[0];
      expect(callArg.title).toBe("Buy milk");
      expect(callArg.priority).toBe("High");
      expect(callArg.category).toBe("Work");
      expect(callArg.user).toEqual({ connect: { id: userId } });
    });

    it("throws ValidationError when task is missing", async () => {
      const ai: AIResponse = { intent: AIIntent.CREATE_TASK, task: null };

      await expect(executor.execute(ai, userId)).rejects.toThrow(
        ValidationError
      );
      expect(mockedTaskService.createTask).not.toHaveBeenCalled();
    });

    it("throws ValidationError when task title is blank", async () => {
      const ai: AIResponse = {
        intent: AIIntent.CREATE_TASK,
        task: { title: "   " },
      };

      await expect(executor.execute(ai, userId)).rejects.toThrow(
        ValidationError
      );
      expect(mockedTaskService.createTask).not.toHaveBeenCalled();
    });
  });

  describe("UPDATE_TASK", () => {
    it("finds the target task then calls taskService.updateTask with mapped changes", async () => {
      const existing = makeTask({ id: 5, title: "Existing task" });
      mockedTaskService.findMatchingTask.mockResolvedValue(existing);

      const updated = makeTask({ id: 5, title: "Renamed" });
      mockedTaskService.updateTask.mockResolvedValue(updated);

      const ai: AIResponse = {
        intent: AIIntent.UPDATE_TASK,
        query: { title: "old name" },
        changes: { title: "Renamed" },
      };

      const result = await executor.execute(ai, userId);

      // A title change returns { task, previousTitle } — the OLD title
      // comes from the resolved task (what TaskService actually found),
      // never reconstructed from the query/transcript. See BUG 1.
      expect(result).toEqual({
        task: updated,
        previousTitle: "Existing task",
      });
      expect(mockedTaskService.findMatchingTask).toHaveBeenCalledWith(
        userId,
        { title: "old name" }
      );
      expect(mockedTaskService.updateTask).toHaveBeenCalledWith(userId, 5, {
        title: "Renamed",
      });
    });

    it("returns the plain updated task (no previousTitle) when the title itself doesn't change", async () => {
      const existing = makeTask({ id: 5, title: "Existing task" });
      mockedTaskService.findMatchingTask.mockResolvedValue(existing);

      const updated = makeTask({ id: 5, description: "New description" });
      mockedTaskService.updateTask.mockResolvedValue(updated);

      const ai: AIResponse = {
        intent: AIIntent.UPDATE_TASK,
        query: { title: "old name" },
        changes: { description: "New description" },
      };

      const result = await executor.execute(ai, userId);

      expect(result).toBe(updated);
    });

    it("throws ValidationError when changes are empty", async () => {
      mockedTaskService.findMatchingTask.mockResolvedValue(makeTask());

      const ai: AIResponse = {
        intent: AIIntent.UPDATE_TASK,
        query: { title: "x" },
        changes: {},
      };

      await expect(executor.execute(ai, userId)).rejects.toThrow(
        ValidationError
      );
      expect(mockedTaskService.updateTask).not.toHaveBeenCalled();
    });
  });

  describe("DELETE_TASK", () => {
    it("resolves the target task and returns needsConfirmation, without deleting anything", async () => {
      const existing = makeTask({ id: 7, title: "Finish FYP" });
      mockedTaskService.findMatchingTask.mockResolvedValue(existing);

      const ai: AIResponse = {
        intent: AIIntent.DELETE_TASK,
        query: { title: "x" },
      };

      const result = await executor.execute(ai, userId);

      expect(result).toEqual({
        needsConfirmation: true,
        message: expect.stringContaining("Finish FYP"),
        action: {
          intent: AIIntent.DELETE_TASK,
          taskId: 7,
          taskTitle: "Finish FYP",
        },
      });
      expect(mockedTaskService.deleteTask).not.toHaveBeenCalled();
      expect(mockedTaskService.updateTask).not.toHaveBeenCalled();
      expect(mockedTaskService.completeTask).not.toHaveBeenCalled();
      expect(mockedTaskService.uncompleteTask).not.toHaveBeenCalled();
    });

    it("returns needsClarification (not needsConfirmation) when the target is ambiguous", async () => {
      mockedTaskService.findMatchingTask.mockRejectedValue(
        new ValidationError("Task request is ambiguous")
      );
      const candidates = [
        makeTask({ id: 1, title: "Finish FYP (Work)" }),
        makeTask({ id: 2, title: "Finish FYP (Study)" }),
      ];
      mockedTaskService.searchTasks.mockResolvedValue(candidates);

      const ai: AIResponse = {
        intent: AIIntent.DELETE_TASK,
        query: { title: "Finish FYP" },
      };

      const result = await executor.execute(ai, userId);

      expect(result).toEqual({
        needsClarification: true,
        message: expect.stringContaining("Finish FYP"),
        candidates: [
          {
            id: 1,
            title: "Finish FYP (Work)",
            priority: "Medium",
            category: "Other",
            completed: false,
            dueDate: null,
          },
          {
            id: 2,
            title: "Finish FYP (Study)",
            priority: "Medium",
            category: "Other",
            completed: false,
            dueDate: null,
          },
        ],
      });
      expect(mockedTaskService.deleteTask).not.toHaveBeenCalled();
    });

    // BUG 3: bare titles aren't enough to disambiguate when candidates
    // share a title (the exact scenario that made them "ambiguous" in
    // the first place) — the message must include real distinguishing
    // details pulled from each candidate task.
    it("includes distinguishing details (priority/category/due date/completion) for each candidate, numbered", async () => {
      mockedTaskService.findMatchingTask.mockRejectedValue(
        new ValidationError("Task request is ambiguous")
      );
      const candidates = [
        makeTask({
          id: 1,
          title: "till water",
          priority: "High",
          category: "Personal",
          completed: false,
          dueDate: new Date("2026-08-20T00:00:00.000Z"),
        }),
        makeTask({
          id: 2,
          title: "till water",
          priority: "Low",
          category: "University",
          completed: true,
          dueDate: null,
        }),
      ];
      mockedTaskService.searchTasks.mockResolvedValue(candidates);

      const result = await executor.execute(
        {
          intent: AIIntent.UPDATE_TASK,
          query: { title: "till water" },
          changes: { title: "fill water" },
        },
        userId
      );

      expect(result).toMatchObject({ needsClarification: true });
      const message = (result as { message: string }).message;

      expect(message).toContain("1. till water");
      expect(message).toContain("High priority");
      expect(message).toContain("Personal");
      expect(message).toContain("Due 2026-08-20");
      expect(message).toContain("Not completed");

      expect(message).toContain("2. till water");
      expect(message).toContain("Low priority");
      expect(message).toContain("University");
      expect(message).toContain("No due date");
      expect(message).toContain("Completed");
    });

    it("asks for another distinguishing detail when candidates are genuinely identical", async () => {
      mockedTaskService.findMatchingTask.mockRejectedValue(
        new ValidationError("Task request is ambiguous")
      );
      const identicalCandidates = [
        makeTask({ id: 1, title: "FYP" }),
        makeTask({ id: 2, title: "FYP" }),
      ];
      mockedTaskService.searchTasks.mockResolvedValue(identicalCandidates);

      const result = await executor.execute(
        { intent: AIIntent.DELETE_TASK, query: { title: "FYP" } },
        userId
      );

      expect(result).toMatchObject({
        needsClarification: true,
        message: expect.stringMatching(/identical/i),
      });
      const message = (result as { message: string }).message;
      expect(message).toMatch(/priority|due date|category/i);
    });
  });

  describe("DELETE_ALL_TASKS", () => {
    it("resolves every task the user owns and returns needsConfirmation, without deleting anything", async () => {
      const tasks = [makeTask({ id: 1 }), makeTask({ id: 2 }), makeTask({ id: 3 })];
      mockedTaskService.getUserTasks.mockResolvedValue(tasks);

      const result = await executor.execute(
        { intent: AIIntent.DELETE_ALL_TASKS },
        userId
      );

      expect(result).toEqual({
        needsConfirmation: true,
        message: expect.stringContaining("3"),
        action: {
          intent: AIIntent.DELETE_ALL_TASKS,
          taskIds: [1, 2, 3],
          taskCount: 3,
        },
      });
      expect(mockedTaskService.deleteTask).not.toHaveBeenCalled();
    });

    it("returns needsClarification instead of an empty confirmation when there are no tasks", async () => {
      mockedTaskService.getUserTasks.mockResolvedValue([]);

      const result = await executor.execute(
        { intent: AIIntent.DELETE_ALL_TASKS },
        userId
      );

      expect(result).toEqual({
        needsClarification: true,
        message: expect.any(String),
      });
    });
  });

  describe("confidence-gated clarification", () => {
    it("returns needsClarification for a low-confidence mutating request, without touching the database", async () => {
      const ai: AIResponse = {
        intent: AIIntent.UPDATE_TASK,
        query: { title: "blah blah blah" },
        changes: { title: "blue" },
        confidence: "low",
      };

      const result = await executor.execute(ai, userId);

      expect(result).toEqual({
        needsClarification: true,
        message: expect.any(String),
      });
      expect(mockedTaskService.findMatchingTask).not.toHaveBeenCalled();
      expect(mockedTaskService.updateTask).not.toHaveBeenCalled();
    });

    it("returns needsClarification for medium confidence on a non-destructive intent", async () => {
      const result = await executor.execute(
        {
          intent: AIIntent.COMPLETE_TASK,
          query: { title: "x" },
          confidence: "medium",
        },
        userId
      );

      expect(result).toEqual({
        needsClarification: true,
        message: expect.any(String),
      });
      expect(mockedTaskService.findMatchingTask).not.toHaveBeenCalled();
    });

    it("does NOT clarify medium confidence on a destructive intent — the confirmation step already covers it", async () => {
      const existing = makeTask({ id: 7, title: "Finish FYP" });
      mockedTaskService.findMatchingTask.mockResolvedValue(existing);

      const result = await executor.execute(
        {
          intent: AIIntent.DELETE_TASK,
          query: { title: "Finish FYP" },
          confidence: "medium",
        },
        userId
      );

      expect(result).toMatchObject({ needsConfirmation: true });
    });

    it("executes normally at high confidence", async () => {
      mockedTaskService.findMatchingTask.mockResolvedValue(makeTask({ id: 5 }));
      const updated = makeTask({ id: 5, description: "New description" });
      mockedTaskService.updateTask.mockResolvedValue(updated);

      const result = await executor.execute(
        {
          intent: AIIntent.UPDATE_TASK,
          query: { title: "old" },
          changes: { description: "New description" },
          confidence: "high",
        },
        userId
      );

      expect(result).toBe(updated);
    });

    it("executes normally when confidence is absent (backward compatible)", async () => {
      mockedTaskService.findMatchingTask.mockResolvedValue(makeTask({ id: 5 }));
      const updated = makeTask({ id: 5, description: "New description" });
      mockedTaskService.updateTask.mockResolvedValue(updated);

      const result = await executor.execute(
        {
          intent: AIIntent.UPDATE_TASK,
          query: { title: "old" },
          changes: { description: "New description" },
        },
        userId
      );

      expect(result).toBe(updated);
    });

    it("does not gate non-mutating intents on confidence", async () => {
      const tasks = [makeTask()];
      mockedTaskService.searchTasks.mockResolvedValue(tasks);

      const result = await executor.execute(
        {
          intent: AIIntent.SEARCH_TASKS,
          query: { title: "x" },
          confidence: "low",
        },
        userId
      );

      expect(result).toBe(tasks);
    });
  });

  describe("executeConfirmedAction", () => {
    it("deletes exactly the resolved task for a delete_task action, without re-resolving anything", async () => {
      const deleted = makeTask({ id: 7, title: "Finish FYP" });
      mockedTaskService.deleteTask.mockResolvedValue(deleted);

      const action: PendingAIAction = {
        intent: AIIntent.DELETE_TASK,
        taskId: 7,
        taskTitle: "Finish FYP",
      };

      const result = await executor.executeConfirmedAction(action, userId);

      expect(result).toBe(deleted);
      expect(mockedTaskService.deleteTask).toHaveBeenCalledTimes(1);
      expect(mockedTaskService.deleteTask).toHaveBeenCalledWith(userId, 7);
      expect(mockedTaskService.findMatchingTask).not.toHaveBeenCalled();
    });

    it("deletes every task id in a delete_all_tasks action", async () => {
      mockedTaskService.deleteTask
        .mockResolvedValueOnce(makeTask({ id: 1 }))
        .mockResolvedValueOnce(makeTask({ id: 2 }))
        .mockResolvedValueOnce(makeTask({ id: 3 }));

      const action: PendingAIAction = {
        intent: AIIntent.DELETE_ALL_TASKS,
        taskIds: [1, 2, 3],
        taskCount: 3,
      };

      const result = await executor.executeConfirmedAction(action, userId);

      expect(result).toHaveLength(3);
      expect(mockedTaskService.deleteTask).toHaveBeenCalledTimes(3);
      expect(mockedTaskService.deleteTask).toHaveBeenNthCalledWith(1, userId, 1);
      expect(mockedTaskService.deleteTask).toHaveBeenNthCalledWith(2, userId, 2);
      expect(mockedTaskService.deleteTask).toHaveBeenNthCalledWith(3, userId, 3);
    });

    it("skips an already-gone task in a bulk delete instead of failing the whole batch", async () => {
      mockedTaskService.deleteTask
        .mockResolvedValueOnce(makeTask({ id: 1 }))
        .mockRejectedValueOnce(new NotFoundError("Task not found"))
        .mockResolvedValueOnce(makeTask({ id: 3 }));

      const action: PendingAIAction = {
        intent: AIIntent.DELETE_ALL_TASKS,
        taskIds: [1, 2, 3],
        taskCount: 3,
      };

      const result = await executor.executeConfirmedAction(action, userId);

      expect(result).toHaveLength(2);
    });

    it("rejects a pending action intent the confirmation policy never produces", async () => {
      const action = {
        intent: AIIntent.UPDATE_TASK,
        taskId: 1,
        taskTitle: "x",
        changes: { title: "y" },
      } as PendingAIAction;

      await expect(
        executor.executeConfirmedAction(action, userId)
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("COMPLETE_TASK / UNCOMPLETE_TASK", () => {
    it("completes the resolved task", async () => {
      mockedTaskService.findMatchingTask.mockResolvedValue(
        makeTask({ id: 3 })
      );
      const completed = makeTask({ id: 3, completed: true });
      mockedTaskService.completeTask.mockResolvedValue(completed);

      const result = await executor.execute(
        { intent: AIIntent.COMPLETE_TASK, query: { title: "x" } },
        userId
      );

      expect(result).toBe(completed);
      expect(mockedTaskService.completeTask).toHaveBeenCalledWith(userId, 3);
    });

    it("uncompletes the resolved task", async () => {
      mockedTaskService.findMatchingTask.mockResolvedValue(
        makeTask({ id: 4 })
      );
      const uncompleted = makeTask({ id: 4, completed: false });
      mockedTaskService.uncompleteTask.mockResolvedValue(uncompleted);

      const result = await executor.execute(
        { intent: AIIntent.UNCOMPLETE_TASK, query: { title: "x" } },
        userId
      );

      expect(result).toBe(uncompleted);
      expect(mockedTaskService.uncompleteTask).toHaveBeenCalledWith(
        userId,
        4
      );
    });
  });

  describe("LIST_TASKS", () => {
    it("calls taskService.getUserTasks with the userId", async () => {
      const tasks = [makeTask({ id: 1 }), makeTask({ id: 2 })];
      mockedTaskService.getUserTasks.mockResolvedValue(tasks);

      const result = await executor.execute(
        { intent: AIIntent.LIST_TASKS },
        userId
      );

      expect(result).toBe(tasks);
      expect(mockedTaskService.getUserTasks).toHaveBeenCalledWith(userId);
    });
  });

  describe("SEARCH_TASKS", () => {
    it("calls taskService.searchTasks with the userId and query", async () => {
      const tasks = [makeTask({ id: 9 })];
      mockedTaskService.searchTasks.mockResolvedValue(tasks);

      const query = { category: "work" };
      const result = await executor.execute(
        { intent: AIIntent.SEARCH_TASKS, query },
        userId
      );

      expect(result).toBe(tasks);
      expect(mockedTaskService.searchTasks).toHaveBeenCalledWith(
        userId,
        query
      );
    });
  });

  describe("CHANGE_PRIORITY", () => {
    it("resolves the task and updates its normalized priority", async () => {
      mockedTaskService.findMatchingTask.mockResolvedValue(
        makeTask({ id: 6 })
      );
      const updated = makeTask({ id: 6, priority: "High" });
      mockedTaskService.updateTask.mockResolvedValue(updated);

      const result = await executor.execute(
        {
          intent: AIIntent.CHANGE_PRIORITY,
          query: { title: "x" },
          changes: { priority: "high" },
        },
        userId
      );

      expect(result).toBe(updated);
      expect(mockedTaskService.updateTask).toHaveBeenCalledWith(userId, 6, {
        priority: "High",
      });
    });

    it("throws ValidationError when no priority is supplied, without looking up a task", async () => {
      await expect(
        executor.execute(
          { intent: AIIntent.CHANGE_PRIORITY, query: { title: "x" } },
          userId
        )
      ).rejects.toThrow(ValidationError);
      expect(mockedTaskService.findMatchingTask).not.toHaveBeenCalled();
    });
  });

  describe("CHANGE_CATEGORY", () => {
    it("resolves the task and updates its normalized category", async () => {
      mockedTaskService.findMatchingTask.mockResolvedValue(
        makeTask({ id: 8 })
      );
      const updated = makeTask({ id: 8, category: "Personal" });
      mockedTaskService.updateTask.mockResolvedValue(updated);

      const result = await executor.execute(
        {
          intent: AIIntent.CHANGE_CATEGORY,
          query: { title: "x" },
          changes: { category: "personal" },
        },
        userId
      );

      expect(result).toBe(updated);
      expect(mockedTaskService.updateTask).toHaveBeenCalledWith(userId, 8, {
        category: "Personal",
      });
    });

    it("throws ValidationError when no category is supplied", async () => {
      await expect(
        executor.execute(
          { intent: AIIntent.CHANGE_CATEGORY, query: { title: "x" } },
          userId
        )
      ).rejects.toThrow(ValidationError);
    });

    // Regression: category has no upstream Zod enum constraint the
    // way priority does (lib/ai/validator.ts), so an unsupported
    // value must be rejected here, in normalizeCategory, before it
    // ever reaches taskService.updateTask/the database.
    it("rejects an unsupported category instead of persisting it", async () => {
      mockedTaskService.findMatchingTask.mockResolvedValue(
        makeTask({ id: 8 })
      );

      await expect(
        executor.execute(
          {
            intent: AIIntent.CHANGE_CATEGORY,
            query: { title: "x" },
            changes: { category: "Shopping" },
          },
          userId
        )
      ).rejects.toThrow(TaskValidationError);
      expect(mockedTaskService.updateTask).not.toHaveBeenCalled();
    });
  });

  describe("SUMMARIZE_TODAY", () => {
    it("calls taskService.getTasksDueToday with the userId", async () => {
      const tasks = [makeTask()];
      mockedTaskService.getTasksDueToday.mockResolvedValue(tasks);

      const result = await executor.execute(
        { intent: AIIntent.SUMMARIZE_TODAY },
        userId
      );

      expect(result).toBe(tasks);
      expect(mockedTaskService.getTasksDueToday).toHaveBeenCalledWith(
        userId
      );
    });
  });

  describe("unsupported intent", () => {
    it("throws ValidationError for an intent outside the switch, with no side effects", async () => {
      const ai = { intent: "not_a_real_intent" } as unknown as AIResponse;

      await expect(executor.execute(ai, userId)).rejects.toThrow(
        ValidationError
      );
      expect(mockedTaskService.createTask).not.toHaveBeenCalled();
      expect(mockedTaskService.updateTask).not.toHaveBeenCalled();
      expect(mockedTaskService.findMatchingTask).not.toHaveBeenCalled();
    });
  });
});
