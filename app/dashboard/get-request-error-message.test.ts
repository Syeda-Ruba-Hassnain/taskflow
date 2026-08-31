import { describe, it, expect } from "vitest";
import { getRequestErrorMessage } from "./Dashboard";

// Phase 11: getRequestErrorMessage is the single function every fetch
// catch block in Dashboard.tsx (task CRUD, AI commands, AI-confirmed
// delete) routes its error through before showing it to the user (and,
// for the AI/voice paths, before it's read aloud via speakResponse).
// This is exactly what stands between the user and a raw technical
// string like "Failed to fetch" leaking into the UI.
describe("getRequestErrorMessage", () => {
  it("uses the error's own message when it was deliberately thrown with a user-facing message", () => {
    // Every `!response.ok` branch throws exactly this shape: a plain
    // Error built from the server's own `error` field or a
    // written-for-users fallback.
    const error = new Error("That category isn't supported.");

    expect(
      getRequestErrorMessage(error, "Something went wrong.")
    ).toBe("That category isn't supported.");
  });

  it("falls back instead of surfacing a raw network failure (TypeError)", () => {
    // What fetch() itself throws in Chrome when the network is down —
    // never a message written for a user to read.
    const error = new TypeError("Failed to fetch");

    expect(
      getRequestErrorMessage(error, "Could not load your tasks.")
    ).toBe("Could not load your tasks.");
  });

  it("falls back instead of surfacing a raw JSON parse failure (SyntaxError)", () => {
    // What response.json() throws on a malformed/non-JSON response
    // body (e.g. an upstream proxy error page) — also not user-facing.
    const error = new SyntaxError(
      "Unexpected token < in JSON at position 0"
    );

    expect(
      getRequestErrorMessage(error, "Could not load your tasks.")
    ).toBe("Could not load your tasks.");
  });

  it("falls back for a non-Error thrown value", () => {
    expect(
      getRequestErrorMessage("some string", "Something went wrong.")
    ).toBe("Something went wrong.");
    expect(
      getRequestErrorMessage(undefined, "Something went wrong.")
    ).toBe("Something went wrong.");
  });
});
