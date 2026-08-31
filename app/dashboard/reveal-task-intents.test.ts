import { describe, it, expect } from "vitest";
import { REVEAL_TASK_INTENTS } from "./Dashboard";
import { AIIntent } from "@/lib/types/ai";

// REVEAL_TASK_INTENTS decides which successful AI intents cause
// runAICommand to scroll to and briefly highlight the affected task
// (see revealTask/mergeTaskIntoState in Dashboard.tsx). This pins down
// the deliberate scope: task-mutating intents where the user asked
// about ONE specific task and can't otherwise tell where it landed.
describe("REVEAL_TASK_INTENTS", () => {
  it("includes rename/update, priority, category, and complete/uncomplete", () => {
    expect(REVEAL_TASK_INTENTS.has(AIIntent.UPDATE_TASK)).toBe(true);
    expect(REVEAL_TASK_INTENTS.has(AIIntent.CHANGE_PRIORITY)).toBe(true);
    expect(REVEAL_TASK_INTENTS.has(AIIntent.CHANGE_CATEGORY)).toBe(true);
    expect(REVEAL_TASK_INTENTS.has(AIIntent.COMPLETE_TASK)).toBe(true);
    expect(REVEAL_TASK_INTENTS.has(AIIntent.UNCOMPLETE_TASK)).toBe(true);
  });

  it("excludes create_task — the user already knows what they just said", () => {
    expect(REVEAL_TASK_INTENTS.has(AIIntent.CREATE_TASK)).toBe(false);
  });

  it("excludes delete_task — handled separately, nothing left to scroll to", () => {
    expect(REVEAL_TASK_INTENTS.has(AIIntent.DELETE_TASK)).toBe(false);
  });

  it("excludes read-only/non-mutating intents", () => {
    expect(REVEAL_TASK_INTENTS.has(AIIntent.LIST_TASKS)).toBe(false);
    expect(REVEAL_TASK_INTENTS.has(AIIntent.SEARCH_TASKS)).toBe(false);
    expect(REVEAL_TASK_INTENTS.has(AIIntent.SUMMARIZE_TODAY)).toBe(false);
    expect(REVEAL_TASK_INTENTS.has(AIIntent.GREETING)).toBe(false);
    expect(REVEAL_TASK_INTENTS.has(AIIntent.UNKNOWN)).toBe(false);
  });
});
