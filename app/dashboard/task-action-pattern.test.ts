import { describe, it, expect } from "vitest";
import { TASK_ACTION_PATTERN } from "./Dashboard";

// TASK_ACTION_PATTERN decides whether a command is routed to the AI
// backend or intercepted by the local filter shortcut first (see
// handleVoiceCommand). "rename"/"change"/"edit" all have to be on this
// list: without them, a command like "Change Finish FYP to Study
// Report" gets swallowed by parseFilterCommand — its NEW title
// ("Study Report") contains the filter keyword "study", so it gets
// misread as "show my study-category tasks" and the rename never
// reaches the AI at all. This is a bug demonstrated against the real
// pipeline before "change"/"edit" were added here.
describe("TASK_ACTION_PATTERN", () => {
  it("matches rename/change/edit commands", () => {
    expect(TASK_ACTION_PATTERN.test("rename finish fyp to finish final year project")).toBe(true);
    expect(TASK_ACTION_PATTERN.test("change finish fyp to fyp submission")).toBe(true);
    expect(TASK_ACTION_PATTERN.test("edit finish fyp to fyp submission")).toBe(true);
  });

  it("still matches the other existing task-action verbs", () => {
    for (const verb of [
      "create",
      "add",
      "delete",
      "remove",
      "find",
      "search",
      "complete",
      "uncomplete",
      "mark",
      "move",
    ]) {
      expect(TASK_ACTION_PATTERN.test(`${verb} finish fyp`)).toBe(true);
    }
  });

  it("catches rename commands whose new title contains a filter keyword, so they are never misrouted to a local filter", () => {
    // Each of these would otherwise be claimed by parseFilterCommand
    // (category/priority/status keywords) before ever reaching the AI.
    const commands = [
      "change finish fyp to study report",
      "change finish fyp to high priority draft",
      "edit finish fyp to completed report",
      "rename finish fyp to today submission",
    ];

    for (const command of commands) {
      expect(TASK_ACTION_PATTERN.test(command)).toBe(true);
    }
  });

  it("does not match a pure filter/view command with no task-action verb", () => {
    expect(TASK_ACTION_PATTERN.test("show completed tasks")).toBe(false);
    expect(TASK_ACTION_PATTERN.test("sort by priority")).toBe(false);
    expect(TASK_ACTION_PATTERN.test("clear filters")).toBe(false);
  });
});
