import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseAIResponse } from "./parser";
import { AIResponseError } from "@/lib/errors/ai-response-error";
import { AppError } from "@/lib/errors/app-error";

describe("parseAIResponse", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("valid JSON", () => {
    it("parses a plain JSON object", () => {
      expect(parseAIResponse('{"intent":"list_tasks"}')).toEqual({
        intent: "list_tasks",
      });
    });

    it("strips ```json fences", () => {
      const input = '```json\n{"intent":"list_tasks"}\n```';
      expect(parseAIResponse(input)).toEqual({ intent: "list_tasks" });
    });

    it("strips plain ``` fences", () => {
      const input = '```\n{"intent":"list_tasks"}\n```';
      expect(parseAIResponse(input)).toEqual({ intent: "list_tasks" });
    });

    it("has no opinion on missing fields - that is validator's job", () => {
      expect(parseAIResponse("{}")).toEqual({});
    });

    it("has no opinion on invalid field types - that is validator's job", () => {
      expect(parseAIResponse('{"intent":123}')).toEqual({ intent: 123 });
    });
  });

  describe("empty response", () => {
    it("throws AIResponseError for an empty string", () => {
      expect(() => parseAIResponse("")).toThrow(AIResponseError);
    });

    it("throws AIResponseError for a whitespace-only string", () => {
      expect(() => parseAIResponse("   \n  ")).toThrow(AIResponseError);
    });

    it("never leaks a raw error type for empty input", () => {
      try {
        parseAIResponse("");
        expect.fail("expected parseAIResponse to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect(error).not.toBeInstanceOf(SyntaxError);
      }
    });
  });

  describe("malformed JSON", () => {
    it("throws AIResponseError instead of a raw SyntaxError", () => {
      try {
        parseAIResponse("{not valid json");
        expect.fail("expected parseAIResponse to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(AIResponseError);
        expect(error).toBeInstanceOf(AppError);
        expect(error).not.toBeInstanceOf(SyntaxError);
      }
    });

    it("sets the AIResponseError status code to 502", () => {
      try {
        parseAIResponse("{not valid json");
        expect.fail("expected parseAIResponse to throw");
      } catch (error) {
        expect((error as AppError).statusCode).toBe(502);
      }
    });

    it("does not include the raw SyntaxError text in the thrown message", () => {
      try {
        parseAIResponse("{not valid json");
        expect.fail("expected parseAIResponse to throw");
      } catch (error) {
        expect((error as Error).message).not.toMatch(
          /Unexpected token|position \d/i
        );
      }
    });
  });

  describe("logging", () => {
    it("logs with the AI_RESPONSE_PARSE_FAILURE prefix on malformed JSON", () => {
      try {
        parseAIResponse("{not valid json");
      } catch {
        // expected
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "AI_RESPONSE_PARSE_FAILURE",
        expect.objectContaining({
          error: expect.anything(),
          response: expect.any(String),
        })
      );
    });

    it("does not log for empty-response failures (nothing was parsed)", () => {
      try {
        parseAIResponse("");
      } catch {
        // expected
      }

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("truncates a very large malformed response to 1000 characters plus an ellipsis", () => {
      const hugeInvalidJson = "{" + "a".repeat(2000);

      try {
        parseAIResponse(hugeInvalidJson);
      } catch {
        // expected
      }

      const [, loggedPayload] = consoleErrorSpy.mock.calls[0] as [
        string,
        { response: string }
      ];

      expect(loggedPayload.response.length).toBe(1001);
      expect(loggedPayload.response.endsWith("…")).toBe(true);
    });

    it("does not truncate a response under the limit", () => {
      const smallInvalidJson = "{not valid json";

      try {
        parseAIResponse(smallInvalidJson);
      } catch {
        // expected
      }

      const [, loggedPayload] = consoleErrorSpy.mock.calls[0] as [
        string,
        { response: string }
      ];

      expect(loggedPayload.response).toBe(smallInvalidJson);
    });
  });
});
