import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/services/auth.service", () => ({
  authService: {
    prepareRegistration: vi.fn(),
    completeRegistration: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/user.repository", () => ({
  userRepository: {
    create: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/verification-token.repository", () => ({
  verificationTokenRepository: {
    create: vi.fn(),
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
import { verificationTokenRepository } from "@/lib/repositories/verification-token.repository";
import { rateLimit } from "@/lib/rate-limit";
import { ConflictError } from "@/lib/errors/conflict-error";
import { AppError } from "@/lib/errors/app-error";

const prepareRegistrationMock = vi.mocked(authService.prepareRegistration);
const completeRegistrationMock = vi.mocked(authService.completeRegistration);
const transactionMock = vi.mocked(prisma.$transaction);
const userCreateMock = vi.mocked(userRepository.create);
const verificationCreateMock = vi.mocked(verificationTokenRepository.create);
const rateLimitMock = vi.mocked(rateLimit);

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  name: "Jane Doe",
  email: "jane@example.com",
  password: "password1",
};

const PREPARED = {
  hashedPassword: "hashed-password",
  rawToken: "raw-token",
  tokenHash: "token-hash",
  expiresAt: new Date("2026-08-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({
    success: true,
    remaining: 4,
    resetAt: new Date(),
  });
  prepareRegistrationMock.mockResolvedValue(PREPARED);
  completeRegistrationMock.mockResolvedValue(undefined);
  userCreateMock.mockResolvedValue({
    id: 1,
    name: "Jane Doe",
    email: "jane@example.com",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transactionMock.mockImplementation(async (callback: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return callback({} as any);
  });
});

describe("POST /api/register", () => {
  it("returns 400 when name is too short", async () => {
    const response = await POST(makeRequest({ ...VALID_BODY, name: "A" }));

    expect(response.status).toBe(400);
    expect(prepareRegistrationMock).not.toHaveBeenCalled();
  });

  it("returns 400 when name is too long", async () => {
    const response = await POST(
      makeRequest({ ...VALID_BODY, name: "A".repeat(101) })
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for an invalid email address", async () => {
    const response = await POST(
      makeRequest({ ...VALID_BODY, email: "not-an-email" })
    );

    expect(response.status).toBe(400);
    expect(prepareRegistrationMock).not.toHaveBeenCalled();
  });

  it("returns 400 when password is too short", async () => {
    const response = await POST(
      makeRequest({ ...VALID_BODY, password: "short" })
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 when password is too long", async () => {
    const response = await POST(
      makeRequest({ ...VALID_BODY, password: "a".repeat(129) })
    );

    expect(response.status).toBe(400);
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    rateLimitMock.mockResolvedValue({
      success: false,
      remaining: 0,
      resetAt: new Date(),
    });

    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(429);
    expect(prepareRegistrationMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the email is already registered", async () => {
    prepareRegistrationMock.mockRejectedValue(
      new ConflictError("An account with this email already exists.")
    );

    const response = await POST(makeRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("An account with this email already exists.");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("creates the user and verification token inside one transaction", async () => {
    await POST(makeRequest(VALID_BODY));

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(userCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Jane Doe",
        email: "jane@example.com",
        password: "hashed-password",
        emailVerified: null,
      }),
      expect.anything()
    );
    expect(verificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "jane@example.com",
        token: "token-hash",
      }),
      expect.anything()
    );
  });

  it("normalizes the email to lowercase and trims whitespace", async () => {
    await POST(
      makeRequest({ ...VALID_BODY, email: "  Jane@Example.com  " })
    );

    expect(prepareRegistrationMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: "jane@example.com" })
    );
  });

  it("returns 201 with the created user on success", async () => {
    const response = await POST(makeRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.accountCreated).toBe(true);
    expect(body.user).toEqual(
      expect.objectContaining({ email: "jane@example.com" })
    );
  });

  it("returns 500 with accountCreated:true when the verification email fails after the user was created", async () => {
    completeRegistrationMock.mockRejectedValue(
      new AppError(
        "Your account was created, but we could not send the verification email. Please try resending it.",
        500,
        { accountCreated: true }
      )
    );

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(makeRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.accountCreated).toBe(true);

    consoleErrorSpy.mockRestore();
  });

  it("returns 500 without leaking details for an unexpected failure", async () => {
    prepareRegistrationMock.mockRejectedValue(
      new Error("connection refused")
    );

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(makeRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).not.toMatch(/connection refused/);

    consoleErrorSpy.mockRestore();
  });
});
