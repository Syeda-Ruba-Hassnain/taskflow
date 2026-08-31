import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/token", () => ({
  hashToken: vi.fn((token: string) => `hashed:${token}`),
}));

vi.mock("@/lib/services/auth.service", () => ({
  authService: {
    resetPassword: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/user.repository", () => ({
  userRepository: {
    updatePassword: vi.fn(() => "updatePassword-query"),
  },
}));

vi.mock("@/lib/repositories/password-reset-token.repository", () => ({
  passwordResetTokenRepository: {
    deleteByEmail: vi.fn(() => "deleteByEmail-query"),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
  getClientIp: vi.fn(() => "127.0.0.1"),
  getRetryAfterSeconds: vi.fn(() => 60),
}));

import { POST } from "./route";
import { authService } from "@/lib/services/auth.service";
import prisma from "@/lib/prisma";
import { userRepository } from "@/lib/repositories/user.repository";
import { passwordResetTokenRepository } from "@/lib/repositories/password-reset-token.repository";
import { rateLimit } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/errors/validation-error";

const resetPasswordMock = vi.mocked(authService.resetPassword);
const transactionMock = vi.mocked(prisma.$transaction);
const updatePasswordMock = vi.mocked(userRepository.updatePassword);
const deleteByEmailMock = vi.mocked(passwordResetTokenRepository.deleteByEmail);
const rateLimitMock = vi.mocked(rateLimit);

const VALID_TOKEN = "a".repeat(64);

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({
    success: true,
    remaining: 4,
    resetAt: new Date(),
  });
  resetPasswordMock.mockResolvedValue({
    userId: 1,
    userEmail: "jane@example.com",
    hashedPassword: "hashed-new",
  });
  transactionMock.mockResolvedValue(undefined as never);
});

describe("POST /api/reset-password", () => {
  it("returns 400 when the token is missing", async () => {
    const response = await POST(
      makeRequest({ password: "new-password-1" })
    );

    expect(response.status).toBe(400);
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed token", async () => {
    const response = await POST(
      makeRequest({ token: "not-hex", password: "new-password-1" })
    );

    expect(response.status).toBe(400);
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the password is too short", async () => {
    const response = await POST(
      makeRequest({ token: VALID_TOKEN, password: "short" })
    );

    expect(response.status).toBe(400);
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the password is too long", async () => {
    const response = await POST(
      makeRequest({ token: VALID_TOKEN, password: "a".repeat(129) })
    );

    expect(response.status).toBe(400);
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    rateLimitMock.mockResolvedValue({
      success: false,
      remaining: 0,
      resetAt: new Date(),
    });

    const response = await POST(
      makeRequest({ token: VALID_TOKEN, password: "new-password-1" })
    );

    expect(response.status).toBe(429);
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it("scopes the rate limit to the IP + reset token hash, never the raw token", async () => {
    await POST(
      makeRequest({ token: VALID_TOKEN, password: "new-password-1" })
    );

    expect(rateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `reset-password:127.0.0.1:hashed:${VALID_TOKEN}`,
      })
    );
  });

  it("returns 400 when the token is invalid or expired", async () => {
    resetPasswordMock.mockRejectedValue(
      new ValidationError(
        "This password reset link has expired. Please request a new one."
      )
    );

    const response = await POST(
      makeRequest({ token: VALID_TOKEN, password: "new-password-1" })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/expired/);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("updates the password and clears reset tokens in one transaction", async () => {
    await POST(
      makeRequest({ token: VALID_TOKEN, password: "new-password-1" })
    );

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(updatePasswordMock).toHaveBeenCalledWith(1, "hashed-new");
    expect(deleteByEmailMock).toHaveBeenCalledWith("jane@example.com");
  });

  it("returns 200 with a success message", async () => {
    const response = await POST(
      makeRequest({ token: VALID_TOKEN, password: "new-password-1" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toMatch(/reset/i);
  });

  it("returns 500 without leaking details for an unexpected failure", async () => {
    resetPasswordMock.mockRejectedValue(new Error("connection refused"));

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(
      makeRequest({ token: VALID_TOKEN, password: "new-password-1" })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).not.toMatch(/connection refused/);

    consoleErrorSpy.mockRestore();
  });
});
