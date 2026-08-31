import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/services/auth.service", () => ({
  authService: {
    deleteAccount: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/user.repository", () => ({
  userRepository: {
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/verification-token.repository", () => ({
  verificationTokenRepository: {
    deleteByEmail: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/password-reset-token.repository", () => ({
  passwordResetTokenRepository: {
    deleteByEmail: vi.fn(),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
}));

import { DELETE } from "./route";
import { auth } from "@/auth";
import { authService } from "@/lib/services/auth.service";
import prisma from "@/lib/prisma";
import { userRepository } from "@/lib/repositories/user.repository";
import { verificationTokenRepository } from "@/lib/repositories/verification-token.repository";
import { passwordResetTokenRepository } from "@/lib/repositories/password-reset-token.repository";
import { rateLimit } from "@/lib/rate-limit";
import { NotFoundError } from "@/lib/errors/not-found-error";
import { ValidationError } from "@/lib/errors/validation-error";

const authMock = vi.mocked(auth);

// See app/api/ai/intent/route.test.ts for why this cast is necessary:
// next-auth v5's `auth` export is overloaded for middleware use, so
// `ReturnType<typeof auth>` doesn't resolve to the plain
// session-getter signature actually used here.
function mockSession(session: { user: { id: string } } | null) {
  authMock.mockResolvedValue(
    session as unknown as Awaited<ReturnType<typeof auth>>
  );
}

const deleteAccountMock = vi.mocked(authService.deleteAccount);
const transactionMock = vi.mocked(prisma.$transaction);
const userDeleteMock = vi.mocked(userRepository.delete);
const verificationDeleteByEmailMock = vi.mocked(
  verificationTokenRepository.deleteByEmail
);
const resetDeleteByEmailMock = vi.mocked(
  passwordResetTokenRepository.deleteByEmail
);
const rateLimitMock = vi.mocked(rateLimit);

const USER_ID = 7;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/delete-account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession({ user: { id: String(USER_ID) } });
  rateLimitMock.mockResolvedValue({
    success: true,
    remaining: 4,
    resetAt: new Date(),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transactionMock.mockImplementation(async (callback: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return callback({} as any);
  });
});

describe("DELETE /api/delete-account", () => {
  it("returns 401 when there is no session", async () => {
    mockSession(null);

    const response = await DELETE(makeRequest({ password: "secret" }));

    expect(response.status).toBe(401);
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the session has no usable user id", async () => {
    mockSession({ user: { id: "not-a-number" } });

    const response = await DELETE(makeRequest({ password: "secret" }));

    expect(response.status).toBe(401);
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    rateLimitMock.mockResolvedValue({
      success: false,
      remaining: 0,
      resetAt: new Date(),
    });

    const response = await DELETE(makeRequest({ password: "secret" }));

    expect(response.status).toBe(429);
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that isn't valid JSON", async () => {
    const request = new Request("http://localhost/api/delete-account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });

    const response = await DELETE(request);

    expect(response.status).toBe(400);
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is an array", async () => {
    const request = new Request("http://localhost/api/delete-account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([]),
    });

    const response = await DELETE(request);

    expect(response.status).toBe(400);
  });

  it("returns 400 when password is missing", async () => {
    const response = await DELETE(makeRequest({}));

    expect(response.status).toBe(400);
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it("returns 400 when password is too long", async () => {
    const response = await DELETE(
      makeRequest({ password: "a".repeat(129) })
    );

    expect(response.status).toBe(400);
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the password is incorrect", async () => {
    deleteAccountMock.mockRejectedValue(
      new ValidationError("Your password is incorrect.")
    );

    const response = await DELETE(makeRequest({ password: "wrong" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Your password is incorrect.");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the account no longer exists", async () => {
    deleteAccountMock.mockRejectedValue(new NotFoundError("Account not found."));

    const response = await DELETE(makeRequest({ password: "secret" }));

    expect(response.status).toBe(404);
  });

  it("deletes verification tokens, reset tokens, and the user inside one transaction", async () => {
    deleteAccountMock.mockResolvedValue({ id: USER_ID, email: "jane@example.com" });

    await DELETE(makeRequest({ password: "secret" }));

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(verificationDeleteByEmailMock).toHaveBeenCalledWith(
      "jane@example.com",
      expect.anything()
    );
    expect(resetDeleteByEmailMock).toHaveBeenCalledWith(
      "jane@example.com",
      expect.anything()
    );
    expect(userDeleteMock).toHaveBeenCalledWith(USER_ID, expect.anything());
  });

  it("returns 200 with a success message", async () => {
    deleteAccountMock.mockResolvedValue({ id: USER_ID, email: "jane@example.com" });

    const response = await DELETE(makeRequest({ password: "secret" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toMatch(/deleted/i);
  });

  it("returns 500 without leaking details for an unexpected failure", async () => {
    deleteAccountMock.mockRejectedValue(new Error("connection refused"));

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await DELETE(makeRequest({ password: "secret" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).not.toMatch(/connection refused/);

    consoleErrorSpy.mockRestore();
  });
});
