import { describe, it, expect, afterEach, vi } from "vitest";
import type { AppError as AppErrorType } from "@/lib/errors/app-error";

// getAIConfig() caches its result in a module-level variable, so each
// test that cares about a *fresh* resolution needs an isolated module
// instance - hence resetModules() + a dynamic re-import per test.
//
// AppError is also re-imported dynamically here (rather than via a
// static top-level import) because resetModules() gives the
// dynamically-reimported config.ts its own fresh copy of every module
// it transitively depends on, including lib/errors/app-error - a
// statically-imported AppError class would be a *different* class
// identity from that fresh copy, silently breaking `instanceof`.
async function loadConfig() {
  vi.resetModules();
  const [{ getAIConfig }, { AppError }] = await Promise.all([
    import("./config"),
    import("@/lib/errors/app-error"),
  ]);

  return { getAIConfig, AppError };
}

describe("getAIConfig", () => {
  afterEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.AI_REQUEST_TIMEOUT_MS;
  });

  describe("GROQ_API_KEY", () => {
    it("returns the key when GROQ_API_KEY is set", async () => {
      process.env.GROQ_API_KEY = "test-key-123";

      const { getAIConfig } = await loadConfig();
      const config = getAIConfig();

      expect(config.groqApiKey).toBe("test-key-123");
    });

    it("throws a 500 AppError when GROQ_API_KEY is missing", async () => {
      delete process.env.GROQ_API_KEY;

      const { getAIConfig, AppError } = await loadConfig();

      try {
        getAIConfig();
        expect.fail("expected getAIConfig to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppErrorType).statusCode).toBe(500);
      }
    });
  });

  describe("AI_REQUEST_TIMEOUT_MS", () => {
    it("defaults to 15000ms when unset", async () => {
      process.env.GROQ_API_KEY = "test-key";
      delete process.env.AI_REQUEST_TIMEOUT_MS;

      const { getAIConfig } = await loadConfig();

      expect(getAIConfig().requestTimeoutMs).toBe(15000);
    });

    it("uses a custom value when it is a valid positive integer", async () => {
      process.env.GROQ_API_KEY = "test-key";
      process.env.AI_REQUEST_TIMEOUT_MS = "5000";

      const { getAIConfig } = await loadConfig();

      expect(getAIConfig().requestTimeoutMs).toBe(5000);
    });

    it.each(["-100", "0", "not-a-number", "12.5"])(
      "throws a 500 AppError for an invalid value: %s",
      async (invalidValue) => {
        process.env.GROQ_API_KEY = "test-key";
        process.env.AI_REQUEST_TIMEOUT_MS = invalidValue;

        const { getAIConfig, AppError } = await loadConfig();

        try {
          getAIConfig();
          expect.fail("expected getAIConfig to throw");
        } catch (error) {
          expect(error).toBeInstanceOf(AppError);
          expect((error as AppErrorType).statusCode).toBe(500);
        }
      }
    );
  });

  describe("caching", () => {
    it("caches the resolved config, ignoring env var changes after the first call", async () => {
      process.env.GROQ_API_KEY = "first-key";

      const { getAIConfig } = await loadConfig();
      const first = getAIConfig();

      process.env.GROQ_API_KEY = "second-key";
      const second = getAIConfig();

      expect(second).toBe(first);
      expect(second.groqApiKey).toBe("first-key");
    });

    it("does not cache a failed resolution - a later valid call still succeeds", async () => {
      delete process.env.GROQ_API_KEY;

      const { getAIConfig, AppError } = await loadConfig();

      try {
        getAIConfig();
        expect.fail("expected getAIConfig to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
      }

      process.env.GROQ_API_KEY = "now-set";
      const config = getAIConfig();

      expect(config.groqApiKey).toBe("now-set");
    });
  });
});
