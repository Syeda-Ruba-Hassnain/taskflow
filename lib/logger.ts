// ==================================
// LOGGER
// ==================================
//
// A thin, dependency-free wrapper around the native `console`. Every
// call is prefixed with an ISO-8601 timestamp and an uppercase level
// so log output is consistently formatted and greppable regardless of
// which module emitted it, without pulling in a logging library.

type LogLevel = "debug" | "info" | "warn" | "error";

const CONSOLE_METHOD: Record<LogLevel, "debug" | "info" | "warn" | "error"> =
  {
    debug: "debug",
    info: "info",
    warn: "warn",
    error: "error",
  };

function emit(level: LogLevel, message: string, ...meta: unknown[]): void {
  const prefixed = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;

  console[CONSOLE_METHOD[level]](prefixed, ...meta);
}

export const logger = {
  debug: (message: string, ...meta: unknown[]) =>
    emit("debug", message, ...meta),
  info: (message: string, ...meta: unknown[]) =>
    emit("info", message, ...meta),
  warn: (message: string, ...meta: unknown[]) =>
    emit("warn", message, ...meta),
  error: (message: string, ...meta: unknown[]) =>
    emit("error", message, ...meta),
};
