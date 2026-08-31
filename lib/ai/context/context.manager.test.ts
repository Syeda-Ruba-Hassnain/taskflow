import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./context.store", () => ({
  aiContextStore: {
    get: vi.fn(),
    update: vi.fn(),
    clear: vi.fn(),
  },
}));

import { AIContextManager } from "./context.manager";
import { aiContextStore } from "./context.store";
import { AIIntent } from "@/lib/types/ai";
import type { Task } from "@prisma/client";
import type { AIContextTask } from "./context.types";

const mockedStore = vi.mocked(aiContextStore);

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Buy milk",
    description: null,
    category: "Personal",
    priority: "Medium",
    completed: false,
    dueDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: 1,
    ...overrides,
  } as Task;
}

describe("AIContextManager", () => {
  let manager: AIContextManager;
  const userId = 1;

  beforeEach(() => {
    manager = new AIContextManager();
    vi.clearAllMocks();
  });

  describe("resolve", () => {
    it("returns the response unchanged when there is no prior context", () => {
      mockedStore.get.mockReturnValue(undefined);

      const response = { intent: AIIntent.LIST_TASKS };
      expect(manager.resolve(userId, response)).toBe(response);
    });

    it("fills in a missing task from the last remembered task", () => {
      const lastTask: AIContextTask = {
        id: 5,
        title: "Buy milk",
        description: "2%",
        priority: "high",
        category: "Personal",
        dueDate: null,
        completed: false,
      };

      mockedStore.get.mockReturnValue({
        userId,
        lastTask,
        updatedAt: new Date(),
      });

      const resolved = manager.resolve(userId, {
        intent: AIIntent.COMPLETE_TASK,
      });

      expect(resolved.task).toEqual({
        title: "Buy milk",
        description: "2%",
        priority: "high",
        category: "Personal",
        dueDate: null,
        completed: false,
      });
    });

    it("does not override a task already present on the response", () => {
      mockedStore.get.mockReturnValue({
        userId,
        lastTask: { id: 5, title: "Old task", completed: false },
        updatedAt: new Date(),
      });

      const resolved = manager.resolve(userId, {
        intent: AIIntent.CREATE_TASK,
        task: { title: "New task" },
      });

      expect(resolved.task).toEqual({ title: "New task" });
    });

    it("fills in a missing query from the last remembered query", () => {
      mockedStore.get.mockReturnValue({
        userId,
        lastQuery: { category: "work" },
        updatedAt: new Date(),
      });

      const resolved = manager.resolve(userId, {
        intent: AIIntent.SEARCH_TASKS,
      });

      expect(resolved.query).toEqual({ category: "work" });
    });

    it("does not override a query already present on the response", () => {
      mockedStore.get.mockReturnValue({
        userId,
        lastQuery: { category: "work" },
        updatedAt: new Date(),
      });

      const resolved = manager.resolve(userId, {
        intent: AIIntent.SEARCH_TASKS,
        query: { category: "personal" },
      });

      expect(resolved.query).toEqual({ category: "personal" });
    });
  });

  describe("remember", () => {
    it("stores a single task result as lastTask", () => {
      const task = makeTask({ id: 9, title: "Buy milk" });

      manager.remember(userId, { intent: AIIntent.CREATE_TASK }, task);

      expect(mockedStore.update).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          lastTask: expect.objectContaining({ id: 9, title: "Buy milk" }),
        })
      );
    });

    it("converts a task's dueDate to an ISO string when present", () => {
      const dueDate = new Date("2026-08-01T00:00:00.000Z");
      const task = makeTask({ id: 9, dueDate });

      manager.remember(userId, { intent: AIIntent.CREATE_TASK }, task);

      expect(mockedStore.update).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          lastTask: expect.objectContaining({
            dueDate: dueDate.toISOString(),
          }),
        })
      );
    });

    it("stores the query alongside an array result when one was supplied", () => {
      const tasks = [makeTask({ id: 1 }), makeTask({ id: 2 })];
      const query = { category: "work" };

      manager.remember(
        userId,
        { intent: AIIntent.SEARCH_TASKS, query },
        tasks
      );

      expect(mockedStore.update).toHaveBeenCalledWith(userId, {
        lastQuery: query,
      });
    });

    it("does not set lastQuery for an array result with no query", () => {
      const tasks = [makeTask()];

      manager.remember(userId, { intent: AIIntent.LIST_TASKS }, tasks);

      expect(mockedStore.update).toHaveBeenCalledWith(userId, {});
    });

    it("does not remember a needsConfirmation result as the last task", () => {
      manager.remember(
        userId,
        { intent: AIIntent.DELETE_TASK },
        {
          needsConfirmation: true,
          message: "Are you sure?",
          action: {
            intent: AIIntent.DELETE_TASK,
            taskId: 1,
            taskTitle: "Finish FYP",
          },
        }
      );

      expect(mockedStore.update).not.toHaveBeenCalled();
    });

    it("does not remember a needsClarification result as the last task", () => {
      manager.remember(
        userId,
        { intent: AIIntent.UPDATE_TASK },
        {
          needsClarification: true,
          message: "Which task did you mean?",
          candidates: [
            {
              id: 1,
              title: "Finish FYP",
              priority: "Medium",
              category: "Other",
              completed: false,
              dueDate: null,
            },
          ],
        }
      );

      expect(mockedStore.update).not.toHaveBeenCalled();
    });
  });

  describe("clear", () => {
    it("delegates to the store's clear method", () => {
      manager.clear(userId);
      expect(mockedStore.clear).toHaveBeenCalledWith(userId);
    });
  });
});
