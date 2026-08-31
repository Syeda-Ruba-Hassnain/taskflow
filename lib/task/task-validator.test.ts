import { describe, it, expect } from "vitest";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  TaskValidationError,
  normalizeLabel,
  parseDueDate,
  parseStrictDueDate,
  validateCategory,
  validateDescriptionForCreate,
  validateDescriptionForUpdate,
  validatePriority,
  validateTitleForCreate,
  validateTitleForUpdate,
} from "./task-validator";

describe("validateTitleForCreate", () => {
  it("trims surrounding whitespace", () => {
    expect(validateTitleForCreate("  Buy milk  ")).toBe("Buy milk");
  });

  it("rejects a missing title", () => {
    expect(() => validateTitleForCreate(undefined)).toThrow(
      TaskValidationError
    );
  });

  it("rejects a non-string title", () => {
    expect(() => validateTitleForCreate(123)).toThrow(TaskValidationError);
  });

  it("rejects a whitespace-only title", () => {
    expect(() => validateTitleForCreate("   ")).toThrow(TaskValidationError);
  });

  it("accepts a title exactly at the length limit", () => {
    const title = "a".repeat(MAX_TITLE_LENGTH);
    expect(validateTitleForCreate(title)).toBe(title);
  });

  it("rejects a title one character over the length limit", () => {
    const title = "a".repeat(MAX_TITLE_LENGTH + 1);
    expect(() => validateTitleForCreate(title)).toThrow(
      TaskValidationError
    );
  });
});

describe("validateTitleForUpdate", () => {
  it("trims surrounding whitespace", () => {
    expect(validateTitleForUpdate("  Renamed  ")).toBe("Renamed");
  });

  it("rejects an empty title with a distinct message from create", () => {
    expect(() => validateTitleForUpdate("")).toThrow(
      "Task title cannot be empty"
    );
  });

  // Phase 6 security audit: PATCH previously had no length ceiling here,
  // unlike POST. Guards against that regression.
  it("enforces the same length limit as create", () => {
    const tooLong = "a".repeat(MAX_TITLE_LENGTH + 1);
    expect(() => validateTitleForUpdate(tooLong)).toThrow(
      TaskValidationError
    );
  });

  it("accepts a title exactly at the length limit", () => {
    const title = "a".repeat(MAX_TITLE_LENGTH);
    expect(validateTitleForUpdate(title)).toBe(title);
  });
});

describe("validateDescriptionForCreate", () => {
  it("returns null for undefined", () => {
    expect(validateDescriptionForCreate(undefined)).toBeNull();
  });

  it("returns null for null", () => {
    expect(validateDescriptionForCreate(null)).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(validateDescriptionForCreate("   ")).toBeNull();
  });

  it("trims and keeps a real description", () => {
    expect(validateDescriptionForCreate("  Pick up eggs  ")).toBe(
      "Pick up eggs"
    );
  });

  it("rejects a non-string value", () => {
    expect(() => validateDescriptionForCreate(42)).toThrow(
      TaskValidationError
    );
  });

  it("accepts a description exactly at the length limit", () => {
    const description = "a".repeat(MAX_DESCRIPTION_LENGTH);
    expect(validateDescriptionForCreate(description)).toBe(description);
  });

  it("rejects a description one character over the length limit", () => {
    const tooLong = "a".repeat(MAX_DESCRIPTION_LENGTH + 1);
    expect(() => validateDescriptionForCreate(tooLong)).toThrow(
      TaskValidationError
    );
  });
});

describe("validateDescriptionForUpdate", () => {
  it("returns null for null (clears the description)", () => {
    expect(validateDescriptionForUpdate(null)).toBeNull();
  });

  it("returns null for an empty string (clears the description)", () => {
    expect(validateDescriptionForUpdate("")).toBeNull();
  });

  it("trims and keeps a real description", () => {
    expect(validateDescriptionForUpdate("  Updated notes  ")).toBe(
      "Updated notes"
    );
  });

  it("rejects a non-string value", () => {
    expect(() => validateDescriptionForUpdate(42)).toThrow(
      TaskValidationError
    );
  });

  // Phase 6 security audit: PATCH previously had no length ceiling here,
  // unlike POST. Guards against that regression.
  it("enforces the same length limit as create", () => {
    const tooLong = "a".repeat(MAX_DESCRIPTION_LENGTH + 1);
    expect(() => validateDescriptionForUpdate(tooLong)).toThrow(
      TaskValidationError
    );
  });
});

describe("validateCategory", () => {
  it.each(["Work", "Personal", "Study", "Other"])(
    "accepts %s",
    (category) => {
      expect(validateCategory(category)).toBe(category);
    }
  );

  it("rejects an unknown category", () => {
    expect(() => validateCategory("Chores")).toThrow(TaskValidationError);
  });

  it("is case-sensitive against the allow-list", () => {
    expect(() => validateCategory("work")).toThrow(TaskValidationError);
  });

  it("rejects a non-string value", () => {
    expect(() => validateCategory(null)).toThrow(TaskValidationError);
  });
});

describe("validatePriority", () => {
  it.each(["Low", "Medium", "High"])("accepts %s", (priority) => {
    expect(validatePriority(priority)).toBe(priority);
  });

  it("rejects an unknown priority", () => {
    expect(() => validatePriority("Urgent")).toThrow(TaskValidationError);
  });

  it("is case-sensitive against the allow-list", () => {
    expect(() => validatePriority("high")).toThrow(TaskValidationError);
  });
});

describe("parseDueDate", () => {
  it("returns null when no date is supplied", () => {
    expect(parseDueDate(undefined)).toBeNull();
    expect(parseDueDate(null)).toBeNull();
    expect(parseDueDate("")).toBeNull();
  });

  it("parses a plain YYYY-MM-DD date as UTC midnight", () => {
    const result = parseDueDate("2026-07-30");
    expect(result?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("truncates a longer ISO timestamp to its date portion", () => {
    const result = parseDueDate("2026-07-30T18:45:00.000Z");
    expect(result?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("rejects a non-string value", () => {
    expect(() => parseDueDate(12345)).toThrow(TaskValidationError);
  });

  it("rejects a malformed date string", () => {
    expect(() => parseDueDate("not-a-date")).toThrow(TaskValidationError);
  });

  // Date.UTC silently rolls Feb 31 over into March; the validator must
  // catch that instead of accepting a nonsensical due date.
  it("rejects a calendar date that doesn't exist", () => {
    expect(() => parseDueDate("2026-02-31")).toThrow(TaskValidationError);
  });

  it("rejects whitespace-only input by default", () => {
    expect(() => parseDueDate("   ")).toThrow(TaskValidationError);
  });

  it("treats whitespace-only input as empty when explicitly opted in", () => {
    expect(
      parseDueDate("   ", { treatWhitespaceOnlyAsEmpty: true })
    ).toBeNull();
  });
});

describe("parseStrictDueDate", () => {
  it("returns null for null", () => {
    expect(parseStrictDueDate(null)).toBeNull();
  });

  it("parses a plain YYYY-MM-DD date as UTC midnight", () => {
    const result = parseStrictDueDate("2026-07-30");
    expect(result?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  // Unlike parseDueDate, this requires an exact match — no truncating a
  // longer timestamp string.
  it("rejects a longer timestamp string that parseDueDate would truncate", () => {
    expect(() =>
      parseStrictDueDate("2026-07-30T18:45:00.000Z")
    ).toThrow(TaskValidationError);
  });

  it("rejects a calendar date that doesn't exist", () => {
    expect(() => parseStrictDueDate("2026-02-31")).toThrow(
      TaskValidationError
    );
  });
});

describe("normalizeLabel", () => {
  it("title-cases a lowercase value", () => {
    expect(normalizeLabel("work")).toBe("Work");
  });

  it("title-cases an uppercase value", () => {
    expect(normalizeLabel("WORK")).toBe("Work");
  });

  it("trims surrounding whitespace before casing", () => {
    expect(normalizeLabel("  personal  ")).toBe("Personal");
  });

  it("rejects an empty value", () => {
    expect(() => normalizeLabel("   ")).toThrow(TaskValidationError);
  });
});
