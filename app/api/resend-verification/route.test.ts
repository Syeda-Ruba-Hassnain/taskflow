import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/services/auth.service", () => ({
  authService: {
    prepareVerificationResend: vi.fn(),
    sendVerificationEmail: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/verification-token.repository", () => ({
  verificationTokenRepository: {
    deleteByEmail: vi.fn(() => "deleteByEmail-query"),
    create: vi.fn(() => "create-query"),
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
import { verificationTokenRepository } from "@/lib/repositories/verification-token.repository";
import { rateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors/app-error";

const prepareMock = vi.mocked(authService.prepareVerificationResend);
const sendMock = vi.mocked(authService.sendVerificationEmail);
const transactionMock = vi.mocked(prisma.$transaction);
const deleteByEmailMock = vi.mocked(verificationTokenRepository.deleteByEmail);
const createMock = vi.mocked(verificationTokenRepository.create);
const rateLimitMock = vi.mocked(rateLimit);

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({
    success: true,
    remaining: 2,
    resetAt: new Date(),
  });
  transactionMock.mockResolvedValue(undefined as never);
  sendMock.mockResolvedValue(undefined);
});

describe("POST /api/resend-verification", () => {
  it("returns 400 for a missing/invalid email", async () => {
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(400);
    expect(prepareMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    rateLimitMock.mockResolvedValue({
      success: false,
      remaining: 0,
      resetAt: new Date(),
    });

    const response = await POST(makeRequest({ email: "jane@example.com" }));

    expect(response.status).toBe(429);
    expect(prepareMock).not.toHaveBeenCalled();
  });

  // Security guarantee: no account, and an already-verified account, must
  // both produce the same response as a genuine unverified account with no
  // side effects — the route never learns (or leaks) which case it was.
  it("does not touch the database or send an email when the service declines to send", async () => {
    prepareMock.mockResolvedValue({ shouldSend: false });

    const response = await POST(makeRequest({ email: "jane@example.com" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(body.message).toMatch(/if an unverified account exists/i);
  });

  it("replaces the old token and sends a new verification email when eligible", async () => {
    prepareMock.mockResolvedValue({
      shouldSend: true,
      name: "Jane",
      email: "jane@example.com",
      rawToken: "raw-token",
      tokenHash: "token-hash",
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    await POST(makeRequest({ email: "jane@example.com" }));

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(deleteByEmailMock).toHaveBeenCalledWith("jane@example.com");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "jane@example.com",
        token: "token-hash",
      })
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Jane",
        email: "jane@example.com",
        rawToken: "raw-token",
        tokenHash: "token-hash",
      })
    );
  });

  it("returns the same 200 message whether or not a resend is actually sent", async () => {
    prepareMock.mockResolvedValue({ shouldSend: false });
    const declinedResponse = await POST(
      makeRequest({ email: "verified@example.com" })
    );
    const declinedBody = await declinedResponse.json();

    prepareMock.mockResolvedValue({
      shouldSend: true,
      name: "Jane",
      email: "jane@example.com",
      rawToken: "raw-token",
      tokenHash: "token-hash",
      expiresAt: new Date(),
    });
    const sentResponse = await POST(
      makeRequest({ email: "jane@example.com" })
    );
    const sentBody = await sentResponse.json();

    expect(declinedBody.message).toBe(sentBody.message);
  });

  it("returns 500 when the verification email fails to send", async () => {
    prepareMock.mockResolvedValue({
      shouldSend: true,
      name: "Jane",
      email: "jane@example.com",
      rawToken: "raw-token",
      tokenHash: "token-hash",
      expiresAt: new Date(),
    });
    sendMock.mockRejectedValue(
      new AppError("We couldn't send the verification email. Please try again.", 500)
    );

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(makeRequest({ email: "jane@example.com" }));

    expect(response.status).toBe(500);

    consoleErrorSpy.mockRestore();
  });

  it("returns 500 without leaking details for an unexpected failure", async () => {
    prepareMock.mockRejectedValue(new Error("connection refused"));

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(makeRequest({ email: "jane@example.com" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).not.toMatch(/connection refused/);

    consoleErrorSpy.mockRestore();
  });
});
