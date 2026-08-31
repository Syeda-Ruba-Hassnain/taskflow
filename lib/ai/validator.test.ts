import { describe, it, expect } from "vitest";
import { validateAIResponse } from "./validator";
import { AIResponseError } from "@/lib/errors/ai-response-error";
import { AppError } from "@/lib/errors/app-error";
import { AIIntent } from "@/lib/types/ai";

describe("validateAIResponse", () => {
  it("accepts a minimal valid response", () => {
    const result = validateAIResponse({ intent: AIIntent.LIST_TASKS });
    expect(result.intent).toBe(AIIntent.LIST_TASKS);
  });

  it("accepts a full valid create_task response", () => {
    const input = {
      intent: AIIntent.CREATE_TASK,
      task: {
        title: "Buy groceries",
        description: null,
        priority: "medium",
        category: null,
        dueDate: "2026-08-01",
        completed: false,
      },
      changes: null,
      query: null,
    };

    expect(validateAIResponse(input)).toEqual(input);
  });

  describe("missing required fields", () => {
    it("throws AIResponseError when intent is missing", () => {
      expect(() => validateAIResponse({})).toThrow(AIResponseError);
    });

    it("throws AIResponseError when task.title is missing", () => {
      expect(() =>
        validateAIResponse({
          intent: AIIntent.CREATE_TASK,
          task: { description: null },
        })
      ).toThrow(AIResponseError);
    });

    it("throws AIResponseError when task.title is empty", () => {
      expect(() =>
        validateAIResponse({
          intent: AIIntent.CREATE_TASK,
          task: { title: "" },
        })
      ).toThrow(AIResponseError);
    });
  });

  describe("invalid enum values", () => {
    it("throws AIResponseError for an intent outside the AIIntent enum", () => {
      expect(() =>
        validateAIResponse({ intent: "not_a_real_intent" })
      ).toThrow(AIResponseError);
    });

    it("throws AIResponseError for an invalid task.priority value", () => {
      expect(() =>
        validateAIResponse({
          intent: AIIntent.CREATE_TASK,
          task: { title: "Test", priority: "urgent" },
        })
      ).toThrow(AIResponseError);
    });

    it("throws AIResponseError for an invalid changes.priority value", () => {
      expect(() =>
        validateAIResponse({
          intent: AIIntent.CHANGE_PRIORITY,
          changes: { priority: "URGENT" },
        })
      ).toThrow(AIResponseError);
    });

    it("throws AIResponseError for an invalid query.priority value", () => {
      expect(() =>
        validateAIResponse({
          intent: AIIntent.SEARCH_TASKS,
          query: { priority: "extreme" },
        })
      ).toThrow(AIResponseError);
    });
  });

  describe("invalid field types", () => {
    it("throws AIResponseError when dueDate is a non-string type", () => {
      expect(() =>
        validateAIResponse({
          intent: AIIntent.CREATE_TASK,
          task: { title: "Test", dueDate: 20260801 },
        })
      ).toThrow(AIResponseError);
    });

    it("does NOT reject a syntactically-string-but-nonsense dueDate value", () => {
      // Documents an intentional boundary: AIResponseSchema only checks
      // that dueDate is a string or null. Calendar-validity (rejecting
      // something like "not-a-date") is enforced downstream by
      // parseStrictDueDate in lib/task/task-validator.ts, not here.
      // This is existing, correct behavior - not a bug to fix.
      const result = validateAIResponse({
        intent: AIIntent.CREATE_TASK,
        task: { title: "Test", dueDate: "not-a-date" },
      });

      expect(result.task?.dueDate).toBe("not-a-date");
    });

    it("throws AIResponseError for an invalid task structure (title as a number)", () => {
      expect(() =>
        validateAIResponse({
          intent: AIIntent.CREATE_TASK,
          task: { title: 12345 },
        })
      ).toThrow(AIResponseError);
    });

    it("throws AIResponseError for an invalid query structure (completed as a string)", () => {
      expect(() =>
        validateAIResponse({
          intent: AIIntent.SEARCH_TASKS,
          query: { completed: "yes" },
        })
      ).toThrow(AIResponseError);
    });

    it("throws AIResponseError for an invalid changes structure (title as an array)", () => {
      expect(() =>
        validateAIResponse({
          intent: AIIntent.UPDATE_TASK,
          changes: { title: ["not", "a", "string"] },
        })
      ).toThrow(AIResponseError);
    });
  });

  describe("error shape", () => {
    it("wraps every schema failure as AIResponseError (AppError), never a raw ZodError", () => {
      try {
        validateAIResponse({ intent: "bogus" });
        expect.fail("expected validateAIResponse to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(AIResponseError);
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).statusCode).toBe(502);
        expect((error as Error).name).not.toBe("ZodError");
      }
    });

    it("does not leak raw Zod issue details in the error message", () => {
      try {
        validateAIResponse({ intent: "bogus" });
        expect.fail("expected validateAIResponse to throw");
      } catch (error) {
        expect((error as Error).message).not.toMatch(/invalid_/);
        expect((error as Error).message).toBe(
          "The AI returned a response that did not match the expected format."
        );
      }
    });
  });
});
