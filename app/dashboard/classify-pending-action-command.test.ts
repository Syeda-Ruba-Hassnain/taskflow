import { describe, it, expect } from "vitest";
import { classifyPendingActionCommand } from "./Dashboard";

// classifyPendingActionCommand is the SAME function handleVoiceCommand
// calls directly (both voice and text funnel through it — see
// AITextControl/VoiceControl both wiring onSubmit/onTranscript to
// handleVoiceCommand) — so these tests exercise exactly the runtime
// decision logic, not a parallel copy of it.
describe("classifyPendingActionCommand", () => {
  it('confirms on "yes" and its accepted variants', () => {
    for (const phrase of [
      "yes",
      "Yes",
      "yeah",
      "yep",
      "yes please",
      "confirm",
      "do it",
      "go ahead",
    ]) {
      expect(classifyPendingActionCommand(phrase)).toBe("confirm");
    }
  });

  it('confirms on "yes." — trailing punctuation is stripped before matching', () => {
    expect(classifyPendingActionCommand("yes.")).toBe("confirm");
    expect(classifyPendingActionCommand("Yes.")).toBe("confirm");
    expect(classifyPendingActionCommand("confirm.")).toBe("confirm");
  });

  it('cancels on "no" and its accepted variants', () => {
    for (const phrase of ["no", "No", "cancel", "don't", "never mind", "stop"]) {
      expect(classifyPendingActionCommand(phrase)).toBe("cancel");
    }
  });

  it('cancels on "no." — trailing punctuation is stripped before matching', () => {
    expect(classifyPendingActionCommand("no.")).toBe("cancel");
    expect(classifyPendingActionCommand("No.")).toBe("cancel");
    expect(classifyPendingActionCommand("cancel.")).toBe("cancel");
  });

  it('treats "yes delete the task" as a new command, not an automatic confirmation', () => {
    // Full-string match only — a longer sentence that merely contains
    // "yes" must never auto-confirm.
    expect(classifyPendingActionCommand("yes delete the task")).toBe(
      "replace"
    );
  });

  it("treats an unrelated command as a replacement, not confirm/cancel", () => {
    expect(
      classifyPendingActionCommand("create a task called buy milk")
    ).toBe("replace");
    expect(classifyPendingActionCommand("rename finish fyp")).toBe(
      "replace"
    );
  });
});
