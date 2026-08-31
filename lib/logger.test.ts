import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "./logger";

describe("logger", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("routes debug() through console.debug", () => {
    logger.debug("a debug message");

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("routes info() through console.info", () => {
    logger.info("an info message");

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("routes warn() through console.warn", () => {
    logger.warn("a warning message");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("routes error() through console.error", () => {
    logger.error("an error message");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("prefixes the message with an ISO-8601 timestamp and the uppercase level", () => {
    logger.error("something broke");

    const [formatted] = errorSpy.mock.calls[0] as [string];

    expect(formatted).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[ERROR\] something broke$/
    );
  });

  it("uses the correct level tag for each method", () => {
    logger.debug("d");
    logger.info("i");
    logger.warn("w");

    expect((debugSpy.mock.calls[0] as [string])[0]).toContain("[DEBUG]");
    expect((infoSpy.mock.calls[0] as [string])[0]).toContain("[INFO]");
    expect((warnSpy.mock.calls[0] as [string])[0]).toContain("[WARN]");
  });

  it("passes additional metadata arguments through unchanged, after the formatted message", () => {
    const meta = { userId: 7, reason: "bad token" };

    logger.warn("suspicious request", meta);

    const call = warnSpy.mock.calls[0] as [string, unknown];

    expect(call[1]).toBe(meta);
  });

  it("supports multiple metadata arguments", () => {
    logger.error("multi", "one", "two", 3);

    const call = errorSpy.mock.calls[0] as [string, ...unknown[]];

    expect(call.slice(1)).toEqual(["one", "two", 3]);
  });

  it("logs with no metadata when none is provided", () => {
    logger.info("just a message");

    expect(infoSpy.mock.calls[0]).toHaveLength(1);
  });
});
