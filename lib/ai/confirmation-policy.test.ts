import { describe, it, expect } from "vitest";
import {
  DESTRUCTIVE_INTENTS,
  MUTATING_INTENTS,
  isDestructiveIntent,
  isMutatingIntent,
  needsConfidenceClarification,
} from "./confirmation-policy";
import { AIIntent } from "@/lib/types/ai";

describe("isMutatingIntent", () => {
  it("is true for every intent that writes to the database", () => {
    for (const intent of MUTATING_INTENTS) {
      expect(isMutatingIntent(intent)).toBe(true);
    }
  });

  it("is false for read-only and non-task intents", () => {
    for (const intent of [
      AIIntent.LIST_TASKS,
      AIIntent.SEARCH_TASKS,
      AIIntent.SUMMARIZE_TODAY,
      AIIntent.GREETING,
      AIIntent.UNKNOWN,
    ]) {
      expect(isMutatingIntent(intent)).toBe(false);
    }
  });
});

describe("isDestructiveIntent", () => {
  it("is true only for delete_task and delete_all_tasks", () => {
    expect(isDestructiveIntent(AIIntent.DELETE_TASK)).toBe(true);
    expect(isDestructiveIntent(AIIntent.DELETE_ALL_TASKS)).toBe(true);
    expect(DESTRUCTIVE_INTENTS.size).toBe(2);
  });

  it("is false for non-destructive mutating intents", () => {
    for (const intent of [
      AIIntent.CREATE_TASK,
      AIIntent.UPDATE_TASK,
      AIIntent.COMPLETE_TASK,
      AIIntent.UNCOMPLETE_TASK,
      AIIntent.CHANGE_PRIORITY,
      AIIntent.CHANGE_CATEGORY,
    ]) {
      expect(isDestructiveIntent(intent)).toBe(false);
    }
  });
});

describe("needsConfidenceClarification", () => {
  it("never gates non-mutating intents, regardless of confidence", () => {
    for (const intent of [
      AIIntent.LIST_TASKS,
      AIIntent.SEARCH_TASKS,
      AIIntent.SUMMARIZE_TODAY,
      AIIntent.GREETING,
      AIIntent.UNKNOWN,
    ]) {
      expect(needsConfidenceClarification(intent, "low")).toBe(false);
      expect(needsConfidenceClarification(intent, "medium")).toBe(false);
    }
  });

  it("clarifies low confidence for every mutating intent, including destructive ones", () => {
    for (const intent of MUTATING_INTENTS) {
      expect(needsConfidenceClarification(intent, "low")).toBe(true);
    }
  });

  it("clarifies medium confidence for non-destructive mutating intents", () => {
    for (const intent of [
      AIIntent.CREATE_TASK,
      AIIntent.UPDATE_TASK,
      AIIntent.COMPLETE_TASK,
      AIIntent.UNCOMPLETE_TASK,
      AIIntent.CHANGE_PRIORITY,
      AIIntent.CHANGE_CATEGORY,
    ]) {
      expect(needsConfidenceClarification(intent, "medium")).toBe(true);
    }
  });

  it("does NOT clarify medium confidence for destructive intents — confirmation already covers it", () => {
    expect(needsConfidenceClarification(AIIntent.DELETE_TASK, "medium")).toBe(
      false
    );
    expect(
      needsConfidenceClarification(AIIntent.DELETE_ALL_TASKS, "medium")
    ).toBe(false);
  });

  it("never clarifies on high confidence", () => {
    for (const intent of MUTATING_INTENTS) {
      expect(needsConfidenceClarification(intent, "high")).toBe(false);
    }
  });

  it("treats an absent confidence the same as high (backward compatible)", () => {
    for (const intent of MUTATING_INTENTS) {
      expect(needsConfidenceClarification(intent, undefined)).toBe(false);
    }
  });
});
