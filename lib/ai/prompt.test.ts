import { describe, it, expect } from "vitest";
import { getIntentSystemPrompt } from "./prompt";

// The live model (verified via direct calls against the real Groq API,
// not mocked) sometimes hallucinates a plausible-but-wrong "query.title"
// for pronoun-referenced rename commands ("Rename it to X") instead of
// leaving query null — roughly 1 in 5 calls at the time this was
// diagnosed. There is no reliable code-level fix for this (the executor
// can't distinguish a hallucinated query from a real one), so the prompt
// carries the only available mitigation. These assertions exist so that
// prompt edits can't silently drop that guidance again.
describe("getIntentSystemPrompt — update_task / rename guidance", () => {
  const prompt = getIntentSystemPrompt();

  it("instructs the model to put the OLD/identifying title in query and the NEW title in changes", () => {
    expect(prompt).toMatch(/CURRENT\/OLD title/i);
    expect(prompt).toMatch(/query\.title/);
  });

  it("instructs the model to null out task and query for pronoun-only references, not guess", () => {
    expect(prompt).toMatch(/pronoun/i);
    expect(prompt).toMatch(/set both "task" and\s+"query" to null/i);
    expect(prompt).toMatch(/do not invent|do not guess|not invent, guess/i);
  });

  it("includes a worked example for 'Rename X to Y'", () => {
    expect(prompt).toContain("Rename Finish FYP to Finish Final Year Project");
  });

  it("includes a worked example for the pronoun case 'Rename it to Y'", () => {
    expect(prompt).toContain("Rename it to FYP Submission");
  });
});

describe("getIntentSystemPrompt — confidence field", () => {
  const prompt = getIntentSystemPrompt();

  it("requires confidence on every response, as high/medium/low", () => {
    expect(prompt).toMatch(/"confidence" field: "high", "medium", or\s+"low"/i);
    expect(prompt).toMatch(/- confidence/);
  });

  it("instructs high confidence as the default for ordinary/short commands", () => {
    expect(prompt).toMatch(/"high":[\s\S]{0,80}default/i);
    expect(prompt).toMatch(/Do NOT lower confidence just because/i);
  });

  it("instructs low confidence for garbled/nonsensical requests, with the exact malformed example", () => {
    expect(prompt).toContain("Rename blah blah blah blue");
    expect(prompt).toMatch(/"confidence": "low"/);
  });
});

describe("getIntentSystemPrompt — delete_all_tasks", () => {
  const prompt = getIntentSystemPrompt();

  it("lists delete_all_tasks as a supported intent", () => {
    expect(prompt).toMatch(/- delete_all_tasks/);
  });

  it("instructs nulling task/changes/query since nothing needs identifying", () => {
    expect(prompt).toMatch(/delete_all_tasks[\s\S]{0,400}null/);
  });

  it("includes a worked example for 'Delete all my tasks'", () => {
    expect(prompt).toContain("Delete all my tasks");
    expect(prompt).toContain('"intent": "delete_all_tasks"');
  });

  it("warns against using it for one specific task", () => {
    expect(prompt).toMatch(/never use\s+this for one specific task/i);
  });
});
