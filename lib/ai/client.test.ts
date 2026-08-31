import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock() factories are hoisted above regular top-level statements,
// so anything the factory references (the mock fn, the fake error
// class) must be created via vi.hoisted() - a plain top-level
// `const`/`class` would still be in the temporal dead zone when the
// hoisted factory runs.
const { createMock, FakeAPIConnectionTimeoutError } = vi.hoisted(() => {
  class FakeAPIConnectionTimeoutError extends Error {}

  return {
    createMock: vi.fn(),
    FakeAPIConnectionTimeoutError,
  };
});

vi.mock("openai", () => {
  class MockOpenAI {
    chat = { completions: { create: createMock } };
    constructor() {}
  }

  return {
    default: MockOpenAI,
    APIConnectionTimeoutError: FakeAPIConnectionTimeoutError,
  };
});

vi.mock("./config", () => ({
  getAIConfig: vi.fn(() => ({
    groqApiKey: "test-key",
    requestTimeoutMs: 15000,
  })),
}));

import { parseIntent } from "./client";
import { getAIConfig } from "./config";
import { AppError } from "@/lib/errors/app-error";

const getAIConfigMock = vi.mocked(getAIConfig);

describe("parseIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAIConfigMock.mockReturnValue({
      groqApiKey: "test-key",
      requestTimeoutMs: 15000,
    });
  });

  it("returns the model's message content", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: '{"intent":"list_tasks"}' } }],
    });

    await expect(parseIntent("show my tasks")).resolves.toBe(
      '{"intent":"list_tasks"}'
    );
  });

  it("falls back to an empty JSON object string when content is null", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });

    await expect(parseIntent("show my tasks")).resolves.toBe("{}");
  });

  it("sends the transcript as the user message alongside a system prompt", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: "{}" } }],
    });

    await parseIntent("buy milk tomorrow");

    const [callArgs] = createMock.mock.calls[0];
    expect(callArgs.messages).toEqual([
      { role: "system", content: expect.any(String) },
      { role: "user", content: "buy milk tomorrow" },
    ]);
    expect(callArgs.temperature).toBe(0);
    expect(callArgs.reasoning_effort).toBe("low");
    expect(callArgs.response_format).toEqual({ type: "json_object" });
  });

  it("converts a timeout error into a clean 504 AppError without leaking internal details", async () => {
    createMock.mockRejectedValue(
      new FakeAPIConnectionTimeoutError("Request timed out after 15000ms.")
    );

    try {
      await parseIntent("show my tasks");
      expect.fail("expected parseIntent to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(504);
      expect((error as Error).message).not.toMatch(/timeout|abort|ms\b/i);
    }
  });

  it("re-throws non-timeout errors unchanged", async () => {
    const originalError = new Error("some other SDK failure");
    createMock.mockRejectedValue(originalError);

    await expect(parseIntent("show my tasks")).rejects.toBe(originalError);
  });

  it("propagates a missing-configuration AppError from getAIConfig without calling the SDK", async () => {
    getAIConfigMock.mockImplementation(() => {
      throw new AppError("AI features are not configured.", 500);
    });

    try {
      await parseIntent("show my tasks");
      expect.fail("expected parseIntent to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(500);
    }

    expect(createMock).not.toHaveBeenCalled();
  });
});
