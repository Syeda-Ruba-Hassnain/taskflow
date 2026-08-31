import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/ai/client", () => ({
  parseIntent: vi.fn(),
}));

vi.mock("@/lib/ai/parser", () => ({
  parseAIResponse: vi.fn(),
}));

vi.mock("@/lib/ai/validator", () => ({
  validateAIResponse: vi.fn(),
}));

vi.mock("@/lib/ai/executor", () => ({
  aiExecutor: { execute: vi.fn() },
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
}));

import { POST } from "./route";
import { auth } from "@/auth";
import { parseIntent } from "@/lib/ai/client";
import { parseAIResponse } from "@/lib/ai/parser";
import { validateAIResponse } from "@/lib/ai/validator";
import { aiExecutor } from "@/lib/ai/executor";
import { rateLimit } from "@/lib/rate-limit";
import { aiContextManager } from "@/lib/ai/context/context.manager";
import { AIIntent } from "@/lib/types/ai";
import { AppError } from "@/lib/errors/app-error";
import { ValidationError } from "@/lib/errors/validation-error";
import { NotFoundError } from "@/lib/errors/not-found-error";
import { AIResponseError } from "@/lib/errors/ai-response-error";

const authMock = vi.mocked(auth);

// next-auth v5's `auth` export is overloaded to also work as Next.js
// middleware, so `ReturnType<typeof auth>` resolves to that signature
// rather than the plain session-getter one actually used here. Casting
// through `unknown` (as TS itself suggests) avoids fighting the wrong
// overload just to type a test mock.
function mockSession(session: { user: { id: string } } | null) {
  authMock.mockResolvedValue(
    session as unknown as Awaited<ReturnType<typeof auth>>
  );
}
const parseIntentMock = vi.mocked(parseIntent);
const parseAIResponseMock = vi.mocked(parseAIResponse);
const validateAIResponseMock = vi.mocked(validateAIResponse);
const executeMock = vi.mocked(aiExecutor.execute);
const rateLimitMock = vi.mocked(rateLimit);

const USER_ID = 7;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/ai/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "A task",
    description: null,
    category: "Other",
    priority: "Medium",
    completed: false,
    dueDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: USER_ID,
    ...overrides,
  };
}

describe("POST /api/ai/intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiContextManager.clear(USER_ID);

    mockSession({ user: { id: String(USER_ID) } });

    rateLimitMock.mockResolvedValue({
      success: true,
      remaining: 19,
      resetAt: new Date(),
    });
  });

  describe("authentication", () => {
    it("returns 401 when there is no session", async () => {
      mockSession(null);

      const response = await POST(makeRequest({ transcript: "hi" }));

      expect(response.status).toBe(401);
    });

    it("returns 401 when the session has no usable user id", async () => {
      mockSession({ user: { id: "not-a-number" } });

      const response = await POST(makeRequest({ transcript: "hi" }));

      expect(response.status).toBe(401);
    });
  });

  describe("request validation", () => {
    it("returns 400 when transcript is missing", async () => {
      const response = await POST(makeRequest({}));
      expect(response.status).toBe(400);
    });

    it("returns 400 when transcript is empty after trimming", async () => {
      const response = await POST(makeRequest({ transcript: "   " }));
      expect(response.status).toBe(400);
    });
  });

  describe("rate limiting", () => {
    it("returns 429 and never calls the AI client when rate limited", async () => {
      rateLimitMock.mockResolvedValue({
        success: false,
        remaining: 0,
        resetAt: new Date(),
      });

      const response = await POST(
        makeRequest({ transcript: "list my tasks" })
      );
      const body = await response.json();

      expect(response.status).toBe(429);
      expect(body.success).toBe(false);
      expect(parseIntentMock).not.toHaveBeenCalled();
    });

    it("keys the rate limiter by the authenticated user id", async () => {
      parseIntentMock.mockResolvedValue('{"intent":"list_tasks"}');
      parseAIResponseMock.mockReturnValue({ intent: AIIntent.LIST_TASKS });
      validateAIResponseMock.mockReturnValue({
        intent: AIIntent.LIST_TASKS,
      });
      executeMock.mockResolvedValue([]);

      await POST(makeRequest({ transcript: "list my tasks" }));

      expect(rateLimitMock).toHaveBeenCalledWith(
        expect.objectContaining({ key: `ai-intent:${USER_ID}` })
      );
    });
  });

  describe("successful request", () => {
    it("returns 200 with the expected payload shape", async () => {
      parseIntentMock.mockResolvedValue('{"intent":"list_tasks"}');
      parseAIResponseMock.mockReturnValue({ intent: AIIntent.LIST_TASKS });
      validateAIResponseMock.mockReturnValue({
        intent: AIIntent.LIST_TASKS,
      });
      const tasks = [makeTask({ id: 1 }), makeTask({ id: 2 })];
      executeMock.mockResolvedValue(tasks);

      const response = await POST(
        makeRequest({ transcript: "list my tasks" })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.intent).toBe(AIIntent.LIST_TASKS);
      expect(body.result).toHaveLength(2);
      expect(typeof body.message).toBe("string");
    });
  });

  describe("malformed AI response", () => {
    it("returns 502 when the parser rejects malformed AI output", async () => {
      parseIntentMock.mockResolvedValue("not json");
      parseAIResponseMock.mockImplementation(() => {
        throw new AIResponseError(
          "Failed to parse the AI response as JSON."
        );
      });

      const response = await POST(
        makeRequest({ transcript: "list my tasks" })
      );
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body.success).toBe(false);
      expect(body.error).toBe("Failed to parse the AI response as JSON.");
    });

    it("returns 502 when schema validation fails", async () => {
      parseIntentMock.mockResolvedValue('{"bad":"shape"}');
      parseAIResponseMock.mockReturnValue({ bad: "shape" });
      validateAIResponseMock.mockImplementation(() => {
        throw new AIResponseError(
          "The AI returned a response that did not match the expected format."
        );
      });

      const response = await POST(
        makeRequest({ transcript: "list my tasks" })
      );

      expect(response.status).toBe(502);
    });
  });

  describe("timeout", () => {
    it("returns 504 when the AI client reports a timeout", async () => {
      parseIntentMock.mockRejectedValue(
        new AppError(
          "The AI assistant is taking too long to respond. Please try again.",
          504
        )
      );

      const response = await POST(
        makeRequest({ transcript: "list my tasks" })
      );

      expect(response.status).toBe(504);
    });
  });

  describe("missing configuration", () => {
    it("returns 500 when AI configuration is missing", async () => {
      parseIntentMock.mockRejectedValue(
        new AppError("AI features are not configured.", 500)
      );

      const response = await POST(
        makeRequest({ transcript: "list my tasks" })
      );

      expect(response.status).toBe(500);
    });
  });

  describe("executor failure / AppError propagation", () => {
    it("propagates a ValidationError as 400 with its message", async () => {
      parseIntentMock.mockResolvedValue('{"intent":"create_task"}');
      parseAIResponseMock.mockReturnValue({ intent: AIIntent.CREATE_TASK });
      validateAIResponseMock.mockReturnValue({
        intent: AIIntent.CREATE_TASK,
      });
      executeMock.mockRejectedValue(
        new ValidationError("Task details are required")
      );

      const response = await POST(
        makeRequest({ transcript: "create a task" })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Task details are required");
    });

    it("propagates a NotFoundError as 404", async () => {
      parseIntentMock.mockResolvedValue('{"intent":"complete_task"}');
      parseAIResponseMock.mockReturnValue({
        intent: AIIntent.COMPLETE_TASK,
      });
      validateAIResponseMock.mockReturnValue({
        intent: AIIntent.COMPLETE_TASK,
      });
      executeMock.mockRejectedValue(new NotFoundError("Task not found"));

      const response = await POST(
        makeRequest({ transcript: "complete the grocery task" })
      );

      expect(response.status).toBe(404);
    });

    it("returns a generic 500 and does not leak details for a non-AppError failure", async () => {
      parseIntentMock.mockResolvedValue('{"intent":"list_tasks"}');
      parseAIResponseMock.mockReturnValue({ intent: AIIntent.LIST_TASKS });
      validateAIResponseMock.mockReturnValue({
        intent: AIIntent.LIST_TASKS,
      });
      executeMock.mockRejectedValue(
        new Error("unexpected database explosion")
      );

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const response = await POST(
        makeRequest({ transcript: "list my tasks" })
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("Failed to process AI request.");
      expect(body.error).not.toMatch(/database explosion/);

      consoleErrorSpy.mockRestore();
    });
  });
});
