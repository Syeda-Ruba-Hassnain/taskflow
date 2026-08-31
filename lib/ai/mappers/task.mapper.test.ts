import { describe, it, expect } from "vitest";
import {
  toTaskCreateInput,
  toTaskUpdateInput,
  parseDueDate,
  normalizePriority,
  normalizeCategory,
} from "./task.mapper";
import { ValidationError } from "@/lib/errors/validation-error";
import { TaskValidationError } from "@/lib/task/task-validator";
import type { AITask, AITaskChanges } from "@/lib/types/ai";

describe("toTaskCreateInput", () => {
  it("maps a fully-specified task", () => {
    const task: AITask = {
      title: "  Buy milk  ",
      description: "  2%  ",
      priority: "high",
      category: "work",
      dueDate: "2026-08-01",
      completed: true,
    };

    const result = toTaskCreateInput(task, 42);

    expect(result.title).toBe("Buy milk");
    expect(result.description).toBe("2%");
    expect(result.priority).toBe("High");
    expect(result.category).toBe("Work");
    expect(result.dueDate).toEqual(new Date(Date.UTC(2026, 7, 1)));
    expect(result.completed).toBe(true);
    expect(result.user).toEqual({ connect: { id: 42 } });
  });

  it("applies defaults for optional fields", () => {
    const task: AITask = { title: "Buy milk" };

    const result = toTaskCreateInput(task, 1);

    expect(result.description).toBeNull();
    expect(result.priority).toBe("Medium");
    expect(result.category).toBe("Other");
    expect(result.dueDate).toBeNull();
    expect(result.completed).toBe(false);
  });

  it("treats an empty description as null", () => {
    const task: AITask = { title: "Buy milk", description: "   " };

    expect(toTaskCreateInput(task, 1).description).toBeNull();
  });

  it("throws TaskValidationError for a malformed dueDate", () => {
    const task: AITask = { title: "Buy milk", dueDate: "not-a-date" };

    expect(() => toTaskCreateInput(task, 1)).toThrow(TaskValidationError);
  });

  // Regression: normalizeCategory used to only title-case the AI's
  // category (via normalizeLabel), never checking it against the
  // app's VALID_CATEGORIES allow-list the way REST create/update do.
  // That let an AI-supplied category outside Work/Personal/Study/
  // Other reach the database, making the task unreachable through
  // the category filter (which only offers those four values).
  describe("category validation (regression)", () => {
    it.each(["Work", "Personal", "Study", "Other"])(
      "accepts the valid category %s (any casing)",
      (category) => {
        const task: AITask = {
          title: "Buy milk",
          category: category.toLowerCase(),
        };

        expect(toTaskCreateInput(task, 1).category).toBe(category);
      }
    );

    it("rejects an unsupported category instead of persisting it", () => {
      const task: AITask = { title: "Buy milk", category: "Shopping" };

      expect(() => toTaskCreateInput(task, 1)).toThrow(TaskValidationError);
    });
  });
});

describe("toTaskUpdateInput", () => {
  it("maps only the fields that were supplied", () => {
    const changes: AITaskChanges = { title: "Renamed" };

    expect(toTaskUpdateInput(changes)).toEqual({ title: "Renamed" });
  });

  it("maps description, normalizing an empty string to null", () => {
    expect(toTaskUpdateInput({ description: "" })).toEqual({
      description: null,
    });
    expect(toTaskUpdateInput({ description: "Details" })).toEqual({
      description: "Details",
    });
  });

  it("normalizes priority", () => {
    expect(toTaskUpdateInput({ priority: "low" })).toEqual({
      priority: "Low",
    });
  });

  it("normalizes category", () => {
    expect(toTaskUpdateInput({ category: "personal" })).toEqual({
      category: "Personal",
    });
  });

  it("throws ValidationError when category is supplied but blank", () => {
    expect(() => toTaskUpdateInput({ category: "   " })).toThrow(
      ValidationError
    );
  });

  // Regression (update path): same category-validation gap as
  // toTaskCreateInput above, but for AI-driven edits to an existing
  // task's category.
  it.each(["Work", "Personal", "Study", "Other"])(
    "accepts an update to the valid category %s (any casing)",
    (category) => {
      expect(
        toTaskUpdateInput({ category: category.toLowerCase() })
      ).toEqual({ category });
    }
  );

  it("rejects an update to an unsupported category instead of persisting it", () => {
    expect(() => toTaskUpdateInput({ category: "Shopping" })).toThrow(
      TaskValidationError
    );
  });

  it("maps a valid dueDate", () => {
    const result = toTaskUpdateInput({ dueDate: "2026-09-01" });
    expect(result.dueDate).toEqual(new Date(Date.UTC(2026, 8, 1)));
  });

  it("maps a null dueDate (clearing it)", () => {
    expect(toTaskUpdateInput({ dueDate: null })).toEqual({ dueDate: null });
  });

  it("maps completed", () => {
    expect(toTaskUpdateInput({ completed: true })).toEqual({
      completed: true,
    });
  });

  it("maps multiple fields together", () => {
    expect(
      toTaskUpdateInput({ title: "New title", completed: true })
    ).toEqual({ title: "New title", completed: true });
  });

  it("throws ValidationError when no fields are supplied", () => {
    expect(() => toTaskUpdateInput({})).toThrow(ValidationError);
  });

  it("throws TaskValidationError when title is blank", () => {
    expect(() => toTaskUpdateInput({ title: "   " })).toThrow(
      TaskValidationError
    );
  });
});

describe("parseDueDate / normalizePriority / normalizeCategory", () => {
  it("parseDueDate returns null for null", () => {
    expect(parseDueDate(null)).toBeNull();
  });

  it("parseDueDate parses a valid YYYY-MM-DD string", () => {
    expect(parseDueDate("2026-08-01")).toEqual(
      new Date(Date.UTC(2026, 7, 1))
    );
  });

  it("parseDueDate rejects a non-exact-format string", () => {
    expect(() => parseDueDate("2026-08-01T00:00:00Z")).toThrow(
      TaskValidationError
    );
  });

  it("normalizePriority title-cases the value", () => {
    expect(normalizePriority("high")).toBe("High");
  });

  it("normalizeCategory title-cases the value", () => {
    expect(normalizeCategory("work")).toBe("Work");
  });

  it("normalizeCategory rejects a value outside VALID_CATEGORIES", () => {
    expect(() => normalizeCategory("Shopping")).toThrow(TaskValidationError);
  });
});
