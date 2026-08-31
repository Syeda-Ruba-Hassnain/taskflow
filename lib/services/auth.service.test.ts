import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/user.repository", () => ({
  userRepository: {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    updateProfile: vi.fn(),
    updatePassword: vi.fn(),
    markEmailVerified: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/verification-token.repository", () => ({
  verificationTokenRepository: {
    create: vi.fn(),
    findByHash: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    deleteByEmail: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/password-reset-token.repository", () => ({
  passwordResetTokenRepository: {
    create: vi.fn(),
    findByHash: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    deleteByEmail: vi.fn(),
  },
}));

vi.mock("@/lib/auth/token", () => ({
  hashToken: vi.fn(),
}));

vi.mock("@/lib/email/email.service", () => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

import bcrypt from "bcryptjs";
import { authService } from "./auth.service";
import { userRepository } from "@/lib/repositories/user.repository";
import { verificationTokenRepository } from "@/lib/repositories/verification-token.repository";
import { passwordResetTokenRepository } from "@/lib/repositories/password-reset-token.repository";
import { hashToken } from "@/lib/auth/token";
import { sendVerificationEmail, sendPasswordResetEmail } from "@/lib/email/email.service";
import { verificationHtml } from "@/lib/email/templates";
import { AppError } from "@/lib/errors/app-error";
import { NotFoundError } from "@/lib/errors/not-found-error";
import { ValidationError } from "@/lib/errors/validation-error";
import { ConflictError } from "@/lib/errors/conflict-error";

// bcryptjs's compare/hash are overloaded with a callback-based signature
// (returning void) alongside the promise-based one actually used by the
// service, so `vi.mocked` resolves to the wrong (void-returning) overload
// without an explicit cast to the signature this codebase uses.
const compareMock = vi.mocked(bcrypt.compare) as unknown as Mock<
  (password: string, hash: string) => Promise<boolean>
>;
const hashMock = vi.mocked(bcrypt.hash) as unknown as Mock<
  (password: string, salt: number | string) => Promise<string>
>;
const findByIdMock = vi.mocked(userRepository.findById);
const findByEmailMock = vi.mocked(userRepository.findByEmail);
const updateProfileMock = vi.mocked(userRepository.updateProfile);
const updatePasswordMock = vi.mocked(userRepository.updatePassword);
const hashTokenMock = vi.mocked(hashToken);
const sendVerificationMock = vi.mocked(sendVerificationEmail);
const sendPasswordResetMock = vi.mocked(sendPasswordResetEmail);

const verificationDeleteMock = vi.mocked(verificationTokenRepository.delete);
const verificationDeleteManyMock = vi.mocked(
  verificationTokenRepository.deleteMany
);
const verificationDeleteByEmailMock = vi.mocked(
  verificationTokenRepository.deleteByEmail
);
const verificationFindByHashMock = vi.mocked(
  verificationTokenRepository.findByHash
);

const resetDeleteMock = vi.mocked(passwordResetTokenRepository.delete);
const resetDeleteManyMock = vi.mocked(passwordResetTokenRepository.deleteMany);
const resetDeleteByEmailMock = vi.mocked(
  passwordResetTokenRepository.deleteByEmail
);
const resetFindByHashMock = vi.mocked(passwordResetTokenRepository.findByHash);
const resetCreateMock = vi.mocked(passwordResetTokenRepository.create);

const ORIGINAL_ENV = { ...process.env };

// Mirrors the shape of resend's actual `Response<T>` union so the
// error-path tests don't need to fight the SDK's type for a mocked failure.
function mockEmailFailure() {
  sendVerificationMock.mockResolvedValue({ error: { message: "delivery failed" } } as unknown as Awaited<ReturnType<typeof sendVerificationEmail>>);
  sendPasswordResetMock.mockResolvedValue({ error: { message: "delivery failed" } } as unknown as Awaited<ReturnType<typeof sendPasswordResetEmail>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BREVO_API_KEY = "test-brevo-key";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  hashTokenMock.mockImplementation((token: string) => `hashed:${token}`);
  sendVerificationMock.mockResolvedValue({ error: null } as unknown as Awaited<ReturnType<typeof sendVerificationEmail>>);
  sendPasswordResetMock.mockResolvedValue({ error: null } as unknown as Awaited<ReturnType<typeof sendPasswordResetEmail>>);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("changePassword", () => {
  it("throws NotFoundError when the account doesn't exist", async () => {
    findByIdMock.mockResolvedValue(null as never);

    await expect(
      authService.changePassword(1, {
        currentPassword: "old-password",
        newPassword: "new-password-1",
      })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ValidationError when the current password is incorrect", async () => {
    findByIdMock.mockResolvedValue({
      id: 1,
      email: "user@example.com",
      password: "hashed-old",
    } as never);
    compareMock.mockResolvedValueOnce(false);

    await expect(
      authService.changePassword(1, {
        currentPassword: "wrong",
        newPassword: "new-password-1",
      })
    ).rejects.toThrow(ValidationError);

    expect(updatePasswordMock).not.toHaveBeenCalled();
  });

  it("throws ValidationError when the new password matches the current password", async () => {
    findByIdMock.mockResolvedValue({
      id: 1,
      email: "user@example.com",
      password: "hashed-old",
    } as never);
    compareMock.mockResolvedValueOnce(true); // current password matches
    compareMock.mockResolvedValueOnce(true); // new password === current

    await expect(
      authService.changePassword(1, {
        currentPassword: "old-password",
        newPassword: "old-password",
      })
    ).rejects.toThrow(ValidationError);

    expect(updatePasswordMock).not.toHaveBeenCalled();
  });

  it("hashes and persists the new password, and invalidates existing reset tokens", async () => {
    findByIdMock.mockResolvedValue({
      id: 1,
      email: "user@example.com",
      password: "hashed-old",
    } as never);
    compareMock.mockResolvedValueOnce(true); // current password matches
    compareMock.mockResolvedValueOnce(false); // new password differs
    hashMock.mockResolvedValue("hashed-new" as never);

    await authService.changePassword(1, {
      currentPassword: "old-password",
      newPassword: "new-password-1",
    });

    expect(hashMock).toHaveBeenCalledWith("new-password-1", 12);
    expect(updatePasswordMock).toHaveBeenCalledWith(1, "hashed-new");
    expect(resetDeleteByEmailMock).toHaveBeenCalledWith("user@example.com");
  });
});

describe("updateProfile", () => {
  it("delegates directly to the user repository", async () => {
    updateProfileMock.mockResolvedValue({
      id: 1,
      name: "Jane Doe",
      email: "jane@example.com",
    });

    const result = await authService.updateProfile(1, { name: "Jane Doe" });

    expect(updateProfileMock).toHaveBeenCalledWith(1, { name: "Jane Doe" });
    expect(result).toEqual({
      id: 1,
      name: "Jane Doe",
      email: "jane@example.com",
    });
  });
});

describe("deleteAccount", () => {
  it("throws NotFoundError when the account doesn't exist", async () => {
    findByIdMock.mockResolvedValue(null as never);

    await expect(
      authService.deleteAccount(1, "password")
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ValidationError when the password is incorrect", async () => {
    findByIdMock.mockResolvedValue({
      id: 1,
      email: "user@example.com",
      password: "hashed",
    } as never);
    compareMock.mockResolvedValue(false);

    await expect(
      authService.deleteAccount(1, "wrong-password")
    ).rejects.toThrow(ValidationError);
  });

  it("returns the account id/email on success without deleting anything itself", async () => {
    findByIdMock.mockResolvedValue({
      id: 1,
      email: "user@example.com",
      password: "hashed",
    } as never);
    compareMock.mockResolvedValue(true);

    const result = await authService.deleteAccount(1, "correct-password");

    expect(result).toEqual({ id: 1, email: "user@example.com" });
  });
});

describe("prepareRegistration", () => {
  it("throws a 500 AppError when BREVO_API_KEY is missing", async () => {
    delete process.env.BREVO_API_KEY;

    await expect(
      authService.prepareRegistration({
        name: "Jane",
        email: "jane@example.com",
        password: "password1",
      })
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it("throws a 500 AppError when NEXT_PUBLIC_APP_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    await expect(
      authService.prepareRegistration({
        name: "Jane",
        email: "jane@example.com",
        password: "password1",
      })
    ).rejects.toBeInstanceOf(AppError);
  });

  it("throws ConflictError when an account already exists for the email", async () => {
    findByEmailMock.mockResolvedValue({ id: 1 } as never);

    await expect(
      authService.prepareRegistration({
        name: "Jane",
        email: "jane@example.com",
        password: "password1",
      })
    ).rejects.toThrow(ConflictError);
  });

  it("hashes the password and generates a raw/hashed token pair with a 1 hour expiry", async () => {
    findByEmailMock.mockResolvedValue(null as never);
    hashMock.mockResolvedValue("hashed-password" as never);

    const before = Date.now();
    const result = await authService.prepareRegistration({
      name: "Jane",
      email: "jane@example.com",
      password: "password1",
    });
    const after = Date.now();

    expect(hashMock).toHaveBeenCalledWith("password1", 12);
    expect(result.hashedPassword).toBe("hashed-password");
    expect(result.rawToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.tokenHash).toBe(`hashed:${result.rawToken}`);
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 60 * 60 * 1000
    );
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(
      after + 60 * 60 * 1000
    );
  });
});

describe("completeRegistration", () => {
  it("sends a verification email with an escaped name and the raw token in the URL", async () => {
    await authService.completeRegistration({
      name: "Jane",
      email: "jane@example.com",
      rawToken: "raw-token-value",
    });

    expect(sendVerificationMock).toHaveBeenCalledTimes(1);
    const args = sendVerificationMock.mock.calls[0][0];

    expect(args.email).toBe("jane@example.com");
    const generated = verificationHtml(args.name, `http://localhost:3000/verify-email?token=${args.rawToken}`);
    expect(generated).toContain("http://localhost:3000/verify-email?token=raw-token-value");
  });

  it("escapes HTML special characters in the user-supplied name", async () => {
    await authService.completeRegistration({
      name: "<script>alert(1)</script>",
      email: "jane@example.com",
      rawToken: "raw-token-value",
    });

    const args = sendVerificationMock.mock.calls[0][0];
    const generated = verificationHtml(args.name, `http://localhost:3000/verify-email?token=${args.rawToken}`);

    expect(generated).not.toContain("<script>alert(1)</script>");
    expect(generated).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("deletes the now-unusable verification token and throws when the email fails to send", async () => {
    mockEmailFailure();

    await expect(
      authService.completeRegistration({
        name: "Jane",
        email: "jane@example.com",
        rawToken: "raw-token-value",
      })
    ).rejects.toMatchObject({
      statusCode: 500,
      details: { accountCreated: true },
    });

    expect(verificationDeleteByEmailMock).toHaveBeenCalledWith(
      "jane@example.com"
    );
  });
});

describe("forgotPassword", () => {
  it("silently no-ops when no account exists for the email", async () => {
    findByEmailMock.mockResolvedValue(null as never);

    await authService.forgotPassword("nobody@example.com");

    expect(resetDeleteByEmailMock).not.toHaveBeenCalled();
    expect(sendPasswordResetMock).not.toHaveBeenCalled();
  });

  it("throws a 500 AppError when email delivery isn't configured", async () => {
    findByEmailMock.mockResolvedValue({
      id: 1,
      name: "Jane",
      email: "jane@example.com",
    } as never);
    delete process.env.BREVO_API_KEY;

    await expect(
      authService.forgotPassword("jane@example.com")
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it("clears prior reset tokens, creates a new one, and emails the raw token", async () => {
    findByEmailMock.mockResolvedValue({
      id: 1,
      name: "Jane",
      email: "jane@example.com",
    } as never);

    await authService.forgotPassword("jane@example.com");

    expect(resetDeleteByEmailMock).toHaveBeenCalledWith("jane@example.com");
    expect(resetCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: "jane@example.com" })
    );

    const args = sendPasswordResetMock.mock.calls[0][0];
    expect(args.email).toBe("jane@example.com");
    // The resetUrl should include the raw token parameter.
    expect(args.resetUrl).toMatch(/reset-password\?token=[a-f0-9]{64}/);
  });

  it("removes the unusable reset token hash and throws when the email fails to send", async () => {
    findByEmailMock.mockResolvedValue({
      id: 1,
      name: "Jane",
      email: "jane@example.com",
    } as never);
    mockEmailFailure();

    await expect(
      authService.forgotPassword("jane@example.com")
    ).rejects.toMatchObject({ statusCode: 500 });

    expect(resetDeleteManyMock).toHaveBeenCalled();
  });
});

describe("resetPassword", () => {
  it("throws ValidationError when the token doesn't exist", async () => {
    resetFindByHashMock.mockResolvedValue(null as never);

    await expect(
      authService.resetPassword({
        token: "raw-token",
        newPassword: "new-password-1",
      })
    ).rejects.toThrow(ValidationError);
  });

  it("deletes and rejects an expired token", async () => {
    resetFindByHashMock.mockResolvedValue({
      id: 5,
      email: "jane@example.com",
      expiresAt: new Date(Date.now() - 1000),
    } as never);

    await expect(
      authService.resetPassword({
        token: "raw-token",
        newPassword: "new-password-1",
      })
    ).rejects.toThrow(ValidationError);

    expect(resetDeleteMock).toHaveBeenCalledWith(5);
  });

  it("deletes tokens and rejects when the associated user no longer exists", async () => {
    resetFindByHashMock.mockResolvedValue({
      id: 5,
      email: "jane@example.com",
      expiresAt: new Date(Date.now() + 1000 * 60),
    } as never);
    findByEmailMock.mockResolvedValue(null as never);

    await expect(
      authService.resetPassword({
        token: "raw-token",
        newPassword: "new-password-1",
      })
    ).rejects.toThrow(ValidationError);

    expect(resetDeleteByEmailMock).toHaveBeenCalledWith("jane@example.com");
  });

  it("rejects when the new password matches the current password", async () => {
    resetFindByHashMock.mockResolvedValue({
      id: 5,
      email: "jane@example.com",
      expiresAt: new Date(Date.now() + 1000 * 60),
    } as never);
    findByEmailMock.mockResolvedValue({
      id: 1,
      email: "jane@example.com",
      password: "hashed-old",
    } as never);
    compareMock.mockResolvedValue(true);

    await expect(
      authService.resetPassword({
        token: "raw-token",
        newPassword: "same-as-current",
      })
    ).rejects.toThrow(ValidationError);
  });

  it("returns the hashed password for the route to persist", async () => {
    resetFindByHashMock.mockResolvedValue({
      id: 5,
      email: "jane@example.com",
      expiresAt: new Date(Date.now() + 1000 * 60),
    } as never);
    findByEmailMock.mockResolvedValue({
      id: 1,
      email: "jane@example.com",
      password: "hashed-old",
    } as never);
    compareMock.mockResolvedValue(false);
    hashMock.mockResolvedValue("hashed-new" as never);

    const result = await authService.resetPassword({
      token: "raw-token",
      newPassword: "new-password-1",
    });

    expect(result).toEqual({
      userId: 1,
      userEmail: "jane@example.com",
      hashedPassword: "hashed-new",
    });
  });
});

describe("verifyEmail", () => {
  it("throws ValidationError when the token doesn't exist", async () => {
    verificationFindByHashMock.mockResolvedValue(null as never);

    await expect(authService.verifyEmail("raw-token")).rejects.toThrow(
      ValidationError
    );
  });

  it("deletes and rejects an expired token", async () => {
    verificationFindByHashMock.mockResolvedValue({
      id: 9,
      email: "jane@example.com",
      expiresAt: new Date(Date.now() - 1000),
    } as never);

    await expect(authService.verifyEmail("raw-token")).rejects.toThrow(
      ValidationError
    );

    expect(verificationDeleteMock).toHaveBeenCalledWith(9);
  });

  it("deletes tokens and rejects when the associated user no longer exists", async () => {
    verificationFindByHashMock.mockResolvedValue({
      id: 9,
      email: "jane@example.com",
      expiresAt: new Date(Date.now() + 60000),
    } as never);
    findByEmailMock.mockResolvedValue(null as never);

    await expect(authService.verifyEmail("raw-token")).rejects.toThrow(
      ValidationError
    );

    expect(verificationDeleteByEmailMock).toHaveBeenCalledWith(
      "jane@example.com"
    );
  });

  it("rejects an already-verified account without revealing that distinction beyond a generic message", async () => {
    verificationFindByHashMock.mockResolvedValue({
      id: 9,
      email: "jane@example.com",
      expiresAt: new Date(Date.now() + 60000),
    } as never);
    findByEmailMock.mockResolvedValue({
      id: 1,
      email: "jane@example.com",
      emailVerified: new Date(),
    } as never);

    await expect(authService.verifyEmail("raw-token")).rejects.toThrow(
      "This verification link is invalid or has already been used."
    );

    expect(verificationDeleteByEmailMock).toHaveBeenCalledWith(
      "jane@example.com"
    );
  });

  it("returns the user id/email on success", async () => {
    verificationFindByHashMock.mockResolvedValue({
      id: 9,
      email: "jane@example.com",
      expiresAt: new Date(Date.now() + 60000),
    } as never);
    findByEmailMock.mockResolvedValue({
      id: 1,
      email: "jane@example.com",
      emailVerified: null,
    } as never);

    const result = await authService.verifyEmail("raw-token");

    expect(result).toEqual({ userId: 1, userEmail: "jane@example.com" });
  });
});

describe("prepareVerificationResend", () => {
  it("throws a 500 AppError when email delivery isn't configured", async () => {
    delete process.env.BREVO_API_KEY;

    await expect(
      authService.prepareVerificationResend("jane@example.com")
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it("declines without error when no account exists (does not reveal existence)", async () => {
    findByEmailMock.mockResolvedValue(null as never);

    const result = await authService.prepareVerificationResend(
      "jane@example.com"
    );

    expect(result).toEqual({ shouldSend: false });
  });

  it("declines without error when the account is already verified (does not reveal status)", async () => {
    findByEmailMock.mockResolvedValue({
      email: "jane@example.com",
      name: "Jane",
      emailVerified: new Date(),
    } as never);

    const result = await authService.prepareVerificationResend(
      "jane@example.com"
    );

    expect(result).toEqual({ shouldSend: false });
  });

  it("prepares a fresh token for an unverified account", async () => {
    findByEmailMock.mockResolvedValue({
      email: "jane@example.com",
      name: "Jane",
      emailVerified: null,
    } as never);

    const result = await authService.prepareVerificationResend(
      "jane@example.com"
    );

    expect(result.shouldSend).toBe(true);
    if (result.shouldSend) {
      expect(result.rawToken).toMatch(/^[a-f0-9]{64}$/);
      expect(result.tokenHash).toBe(`hashed:${result.rawToken}`);
    }
  });
});

describe("sendVerificationEmail", () => {
  it("sends the email with the raw token in the URL", async () => {
    await authService.sendVerificationEmail({
      name: "Jane",
      email: "jane@example.com",
      rawToken: "raw-token-value",
      tokenHash: "hashed-token-value",
    });

    const args = sendVerificationMock.mock.calls[0][0];
    expect(args.email).toBe("jane@example.com");
    const generated = verificationHtml(args.name, `http://localhost:3000/verify-email?token=${args.rawToken}`);
    expect(generated).toContain("http://localhost:3000/verify-email?token=raw-token-value");
  });

  it("falls back to 'there' and escapes a missing/null name", async () => {
    await authService.sendVerificationEmail({
      name: null,
      email: "jane@example.com",
      rawToken: "raw-token-value",
      tokenHash: "hashed-token-value",
    });

    const args = sendVerificationMock.mock.calls[0][0];
    const generated = verificationHtml(args.name, `http://localhost:3000/verify-email?token=${args.rawToken}`);
    expect(generated).toContain("Hi there,");
  });

  it("removes the unusable token hash and throws when the email fails to send", async () => {
    mockEmailFailure();

    await expect(
      authService.sendVerificationEmail({
        name: "Jane",
        email: "jane@example.com",
        rawToken: "raw-token-value",
        tokenHash: "hashed-token-value",
      })
    ).rejects.toMatchObject({ statusCode: 500 });

    expect(verificationDeleteManyMock).toHaveBeenCalledWith({
      token: "hashed-token-value",
    });
  });
});
