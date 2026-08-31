import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/services/auth.service", () => ({
  authService: {
    verifyEmail: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/user.repository", () => ({
  userRepository: {
    markEmailVerified: vi.fn(() => "markEmailVerified-query"),
  },
}));

vi.mock("@/lib/repositories/verification-token.repository", () => ({
  verificationTokenRepository: {
    deleteByEmail: vi.fn(() => "deleteByEmail-query"),
  },
}));

import { POST } from "./route";
import { authService } from "@/lib/services/auth.service";
import prisma from "@/lib/prisma";
import { userRepository } from "@/lib/repositories/user.repository";
import { verificationTokenRepository } from "@/lib/repositories/verification-token.repository";
import { ValidationError } from "@/lib/errors/validation-error";

const verifyEmailMock = vi.mocked(authService.verifyEmail);
const transactionMock = vi.mocked(prisma.$transaction);
const markEmailVerifiedMock = vi.mocked(userRepository.markEmailVerified);
const deleteByEmailMock = vi.mocked(verificationTokenRepository.deleteByEmail);

const VALID_TOKEN = "a".repeat(64);

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyEmailMock.mockResolvedValue({
    userId: 1,
    userEmail: "jane@example.com",
  });
  transactionMock.mockResolvedValue(undefined as never);
});

describe("POST /api/verify-email", () => {
  it("returns 400 when the token is missing", async () => {
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(400);
    expect(verifyEmailMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed token", async () => {
    const response = await POST(makeRequest({ token: "not-hex" }));

    expect(response.status).toBe(400);
    expect(verifyEmailMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the token is invalid or already used", async () => {
    verifyEmailMock.mockRejectedValue(
      new ValidationError(
        "This verification link is invalid or has already been used."
      )
    );

    const response = await POST(makeRequest({ token: VALID_TOKEN }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/invalid or has already been used/);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("marks the user verified and clears their token in one transaction", async () => {
    await POST(makeRequest({ token: VALID_TOKEN }));

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(markEmailVerifiedMock).toHaveBeenCalledWith(1);
    expect(deleteByEmailMock).toHaveBeenCalledWith("jane@example.com");
  });

  it("returns 200 with a success message", async () => {
    const response = await POST(makeRequest({ token: VALID_TOKEN }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toMatch(/verified/i);
  });

  it("returns 500 without leaking details for an unexpected failure", async () => {
    verifyEmailMock.mockRejectedValue(new Error("connection refused"));

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(makeRequest({ token: VALID_TOKEN }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).not.toMatch(/connection refused/);

    consoleErrorSpy.mockRestore();
  });
});
