import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/services/auth.service", () => ({
  authService: {
    forgotPassword: vi.fn(),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
  getClientIp: vi.fn(() => "127.0.0.1"),
  getRetryAfterSeconds: vi.fn(() => 60),
}));

import { POST } from "./route";
import { authService } from "@/lib/services/auth.service";
import { rateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors/app-error";

const forgotPasswordMock = vi.mocked(authService.forgotPassword);
const rateLimitMock = vi.mocked(rateLimit);

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/forgot-password", {
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
  forgotPasswordMock.mockResolvedValue(undefined);
});

describe("POST /api/forgot-password", () => {
  it("returns 400 for a missing email", async () => {
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(400);
    expect(forgotPasswordMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid email", async () => {
    const response = await POST(makeRequest({ email: "not-an-email" }));

    expect(response.status).toBe(400);
    expect(forgotPasswordMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    rateLimitMock.mockResolvedValue({
      success: false,
      remaining: 0,
      resetAt: new Date(),
    });

    const response = await POST(makeRequest({ email: "jane@example.com" }));

    expect(response.status).toBe(429);
    expect(forgotPasswordMock).not.toHaveBeenCalled();
  });

  it("normalizes the email before passing it to the service", async () => {
    await POST(makeRequest({ email: "  Jane@Example.com  " }));

    expect(forgotPasswordMock).toHaveBeenCalledWith("jane@example.com");
  });

  // Security guarantee: the response must be identical whether or not an
  // account exists for the submitted email — the service itself no-ops
  // silently for a non-existent account, so from the route's perspective
  // both cases look like a successful call.
  it("returns the same 200 message for both existing and non-existent accounts", async () => {
    const responseForExisting = await POST(
      makeRequest({ email: "exists@example.com" })
    );
    const bodyForExisting = await responseForExisting.json();

    const responseForMissing = await POST(
      makeRequest({ email: "missing@example.com" })
    );
    const bodyForMissing = await responseForMissing.json();

    expect(responseForExisting.status).toBe(200);
    expect(responseForMissing.status).toBe(200);
    expect(bodyForExisting.message).toBe(bodyForMissing.message);
  });

  it("returns 500 when password reset email delivery isn't configured", async () => {
    forgotPasswordMock.mockRejectedValue(
      new AppError("Password reset is temporarily unavailable.", 500)
    );

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(makeRequest({ email: "jane@example.com" }));

    expect(response.status).toBe(500);

    consoleErrorSpy.mockRestore();
  });

  it("returns 500 without leaking details for an unexpected failure", async () => {
    forgotPasswordMock.mockRejectedValue(new Error("connection refused"));

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
