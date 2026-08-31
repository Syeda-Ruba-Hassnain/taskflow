import { describe, it, expect } from "vitest";
import {
  PENDING_ACTION_AFFIRMATIVE_PHRASES,
  PENDING_ACTION_NEGATIVE_PHRASES,
} from "./Dashboard";

// These sets are only ever consulted while a pendingAIAction exists
// (see handleVoiceCommand's interception), matched against the FULL
// normalized command — never as a substring search over an arbitrary
// sentence. These tests pin the exact phrase list the audit called
// for and guard against a typo silently dropping one.
describe("PENDING_ACTION_AFFIRMATIVE_PHRASES", () => {
  it("recognizes every required affirmative phrase", () => {
    for (const phrase of [
      "yes",
      "yeah",
      "yep",
      "yes please",
      "confirm",
      "do it",
      "go ahead",
    ]) {
      expect(PENDING_ACTION_AFFIRMATIVE_PHRASES.has(phrase)).toBe(true);
    }
  });

  it("does not treat an unrelated sentence merely containing 'yes' as affirmative", () => {
    // The set itself only supports exact membership — a longer
    // sentence like "yes I know but not now" is a different string
    // and correctly falls outside it. This is what makes substring
    // matching unnecessary/wrong for this feature.
    expect(
      PENDING_ACTION_AFFIRMATIVE_PHRASES.has("yes i know but not now")
    ).toBe(false);
  });
});

describe("PENDING_ACTION_NEGATIVE_PHRASES", () => {
  it("recognizes every required negative phrase", () => {
    for (const phrase of ["no", "cancel", "dont", "never mind", "stop"]) {
      expect(PENDING_ACTION_NEGATIVE_PHRASES.has(phrase)).toBe(true);
    }
  });

  it("has no overlap with the affirmative set", () => {
    for (const phrase of PENDING_ACTION_NEGATIVE_PHRASES) {
      expect(PENDING_ACTION_AFFIRMATIVE_PHRASES.has(phrase)).toBe(false);
    }
  });
});
