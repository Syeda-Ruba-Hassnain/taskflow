import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { GET } from "./route";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

const queryRawMock = vi.mocked(prisma.$queryRaw);
const loggerErrorMock = vi.mocked(logger.error);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/health", () => {
  it("returns 200 with an ok status when the database is reachable", async () => {
    queryRawMock.mockResolvedValue(undefined as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database.status).toBe("ok");
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it("returns 503 without leaking the underlying error when the database is unreachable", async () => {
    queryRawMock.mockRejectedValue(new Error("connection refused"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.checks.database.status).toBe("error");
    expect(JSON.stringify(body)).not.toMatch(/connection refused/);
  });

  it("logs the failure when the database is unreachable", async () => {
    queryRawMock.mockRejectedValue(new Error("connection refused"));

    await GET();

    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("Health check failed"),
      expect.any(Error)
    );
  });

  it("does not require authentication", async () => {
    // No auth mock exists in this file at all — GET takes no session-
    // derived input and never imports @/auth, so the absence of a mock
    // is itself the assertion: this route cannot depend on a session.
    queryRawMock.mockResolvedValue(undefined as never);

    const response = await GET();

    expect(response.status).toBe(200);
  });
});
