import bcrypt from "bcryptjs";
import crypto from "crypto";

import {
  userRepository,
  UserRepository,
} from "@/lib/repositories/user.repository";
import {
  verificationTokenRepository,
  VerificationTokenRepository,
} from "@/lib/repositories/verification-token.repository";
import {
  passwordResetTokenRepository,
  PasswordResetTokenRepository,
} from "@/lib/repositories/password-reset-token.repository";
import { hashToken } from "@/lib/auth/token";
import { sendVerificationEmail, sendPasswordResetEmail } from "@/lib/email/email.service";
import { AppError } from "@/lib/errors/app-error";
import { NotFoundError } from "@/lib/errors/not-found-error";
import { ValidationError } from "@/lib/errors/validation-error";
import { ConflictError } from "@/lib/errors/conflict-error";

// ==================================
// AUTH SERVICE
// ==================================
//
// Orchestration layer for the authentication domain.
// Coordinates repositories and business rules (hashing,
// token generation, expiry checks, transactions). It never
// touches Prisma directly, reads Request objects, or returns
// HTTP responses — that stays in the route handlers.

export class AuthService {
  constructor(
    private readonly users: UserRepository = userRepository,
    readonly verificationTokens: VerificationTokenRepository = verificationTokenRepository,
    readonly passwordResetTokens: PasswordResetTokenRepository = passwordResetTokenRepository
  ) {}

  async updateProfile(
    userId: number,
    data: { name: string }
  ) {
    return this.users.updateProfile(
      userId,
      data
    );
  }

  async changePassword(
    userId: number,
    data: {
      currentPassword: string;
      newPassword: string;
    }
  ): Promise<void> {
    const user = await this.users.findById(
      userId,
      {
        id: true,
        email: true,
        password: true,
      }
    );

    if (!user) {
      throw new NotFoundError(
        "Account not found."
      );
    }

    const passwordMatches =
      await bcrypt.compare(
        data.currentPassword,
        user.password
      );

    if (!passwordMatches) {
      throw new ValidationError(
        "Your current password is incorrect."
      );
    }

    const sameAsCurrentPassword =
      await bcrypt.compare(
        data.newPassword,
        user.password
      );

    if (sameAsCurrentPassword) {
      throw new ValidationError(
        "Your new password must be different from your current password."
      );
    }

    const hashedPassword =
      await bcrypt.hash(
        data.newPassword,
        12
      );

    await this.users.updatePassword(
      user.id,
      hashedPassword
    );

    // Any previously issued password
    // reset links should no longer work.
    await this.passwordResetTokens.deleteByEmail(
      user.email
    );
  }

  // Validates the account owner's password. Does not perform the
  // deletion itself: the route runs the multi-table cleanup inside a
  // single `prisma.$transaction`, which this service cannot do without
  // importing Prisma directly (forbidden — see class-level comment).
  async deleteAccount(
    userId: number,
    password: string
  ): Promise<{
    id: number;
    email: string;
  }> {
    const user = await this.users.findById(
      userId,
      {
        id: true,
        email: true,
        password: true,
      }
    );

    if (!user) {
      throw new NotFoundError(
        "Account not found."
      );
    }

    const passwordMatches =
      await bcrypt.compare(
        password,
        user.password
      );

    if (!passwordMatches) {
      throw new ValidationError(
        "Your password is incorrect."
      );
    }

    return {
      id: user.id,
      email: user.email,
    };
  }

  // Validates the new-account request and prepares everything needed
  // to persist it. Does not create the user/token rows itself: the
  // route creates both inside a single `prisma.$transaction`, which
  // this service cannot do without importing Prisma directly
  // (forbidden — see class-level comment).
  async prepareRegistration(data: {
    name: string;
    email: string;
    password: string;
  }): Promise<{
    hashedPassword: string;
    rawToken: string;
    tokenHash: string;
    expiresAt: Date;
  }> {
    const appUrl =
      process.env
        .NEXT_PUBLIC_APP_URL;

    if (
      !process.env.BREVO_API_KEY ||
      !appUrl
    ) {
      console.error(
        "Missing BREVO_API_KEY or NEXT_PUBLIC_APP_URL"
      );

      throw new AppError(
        "Email verification is not configured.",
        500
      );
    }

    const existingUser =
      await this.users.findByEmail(
        data.email,
        { id: true }
      );

    if (existingUser) {
      throw new ConflictError(
        "An account with this email already exists."
      );
    }

    const hashedPassword =
      await bcrypt.hash(
        data.password,
        12
      );

    const rawToken =
      crypto
        .randomBytes(32)
        .toString("hex");

    const tokenHash =
      hashToken(rawToken);

    // Verification link expires
    // in 1 hour.

    const expiresAt =
      new Date(
        Date.now() +
          60 * 60 * 1000
      );

    return {
      hashedPassword,
      rawToken,
      tokenHash,
      expiresAt,
    };
  }

  // Sends the "welcome" verification email after the user + token
  // rows have already been persisted by the route. On failure, the
  // unusable token is removed but the account is deliberately kept —
  // the user can request another verification email.
  async completeRegistration(data: {
    name: string;
    email: string;
    rawToken: string;
  }): Promise<void> {
    // verification URL is constructed inside the email helper.

    const emailResult = await sendVerificationEmail({
      name: data.name,
      email: data.email,
      rawToken: data.rawToken,
    });

    if (emailResult.error) {
      console.error("Verification email error:", emailResult.error);

      // Remove the unusable verification token.
      await this.verificationTokens.deleteByEmail(data.email);

      throw new AppError(
        "Your account was created, but we could not send the verification email. Please try resending it.",
        500,
        { accountCreated: true }
      );
    }
  }

  // Silently no-ops for a non-existent account (never reveal whether
  // an account exists for a submitted email) and fully owns
  // persistence itself — unlike the other multi-write endpoints, this
  // one already performs its two writes as independent statements
  // rather than inside a `prisma.$transaction`, so nothing here needs
  // to touch Prisma.
  async forgotPassword(
    email: string
  ): Promise<void> {
    const user =
      await this.users.findByEmail(
        email,
        {
          id: true,
          name: true,
          email: true,
        }
      );

    if (!user) {
      return;
    }

    const appUrl =
      process.env
        .NEXT_PUBLIC_APP_URL;

    if (
      !process.env.BREVO_API_KEY ||
      !appUrl
    ) {
      console.error(
        "Missing BREVO_API_KEY or NEXT_PUBLIC_APP_URL"
      );

      throw new AppError(
        "Password reset is temporarily unavailable.",
        500
      );
    }

    // Only the newest reset link
    // should remain usable.

    await this.passwordResetTokens.deleteByEmail(
      user.email
    );

    const rawToken =
      crypto
        .randomBytes(32)
        .toString("hex");

    const tokenHash =
      hashToken(rawToken);

    // Reset link remains valid for one hour.
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.passwordResetTokens.create({
      email: user.email,
      token: tokenHash,
      expiresAt,
    });

    const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

    const { error: emailError } = await sendPasswordResetEmail({
      name: user.name,
      email: user.email,
      resetUrl,
    });

    if (emailError) {
      console.error("Password reset email error:", emailError);

      // The raw token was never successfully delivered.
      // Remove its database hash so an unusable token isn't kept.

      await this.passwordResetTokens.deleteMany({
        token: tokenHash,
      });

      throw new AppError(
        "We couldn't send the password reset email. Please try again later.",
        500
      );
    }
  }

  // Validates the reset token and new password. Does not persist the
  // change itself: the route updates the password and clears the
  // token inside a single `prisma.$transaction`, which this service
  // cannot do without importing Prisma directly (forbidden — see
  // class-level comment).
  async resetPassword(data: {
    token: string;
    newPassword: string;
  }): Promise<{
    userId: number;
    userEmail: string;
    hashedPassword: string;
  }> {
    const tokenHash = hashToken(
      data.token
    );

    const resetToken =
      await this.passwordResetTokens.findByHash(
        tokenHash
      );

    if (!resetToken) {
      throw new ValidationError(
        "This password reset link is invalid or has already been used."
      );
    }

    if (
      resetToken.expiresAt <
      new Date()
    ) {
      await this.passwordResetTokens.delete(
        resetToken.id
      );

      throw new ValidationError(
        "This password reset link has expired. Please request a new one."
      );
    }

    const user =
      await this.users.findByEmail(
        resetToken.email,
        {
          id: true,
          email: true,
          password: true,
        }
      );

    if (!user) {
      await this.passwordResetTokens.deleteByEmail(
        resetToken.email
      );

      throw new ValidationError(
        "This password reset link is no longer valid."
      );
    }

    const samePassword =
      await bcrypt.compare(
        data.newPassword,
        user.password
      );

    if (samePassword) {
      throw new ValidationError(
        "Your new password must be different from your current password."
      );
    }

    const hashedPassword =
      await bcrypt.hash(
        data.newPassword,
        12
      );

    return {
      userId: user.id,
      userEmail: user.email,
      hashedPassword,
    };
  }

  // Validates the verification token. Does not persist the result
  // itself: the route marks the user verified and clears the token
  // inside a single `prisma.$transaction`, which this service cannot
  // do without importing Prisma directly (forbidden — see class-level
  // comment).
  async verifyEmail(
    token: string
  ): Promise<{
    userId: number;
    userEmail: string;
  }> {
    const tokenHash = hashToken(
      token
    );

    const verificationToken =
      await this.verificationTokens.findByHash(
        tokenHash
      );

    if (!verificationToken) {
      throw new ValidationError(
        "This verification link is invalid or has already been used."
      );
    }

    if (
      verificationToken.expiresAt <
      new Date()
    ) {
      await this.verificationTokens.delete(
        verificationToken.id
      );

      throw new ValidationError(
        "This verification link has expired."
      );
    }

    const user =
      await this.users.findByEmail(
        verificationToken.email,
        {
          id: true,
          email: true,
          emailVerified: true,
        }
      );

    if (!user) {
      await this.verificationTokens.deleteByEmail(
        verificationToken.email
      );

      throw new ValidationError(
        "This verification link is no longer valid."
      );
    }

    if (user.emailVerified) {
      await this.verificationTokens.deleteByEmail(
        user.email
      );

      throw new ValidationError(
        "This verification link is invalid or has already been used."
      );
    }

    return {
      userId: user.id,
      userEmail: user.email,
    };
  }

  // Silently declines for a non-existent or already-verified account
  // (never reveal account existence/verification status) and prepares
  // everything needed for a resend. Does not persist the replacement
  // token itself: the route swaps it inside a single
  // `prisma.$transaction`, which this service cannot do without
  // importing Prisma directly (forbidden — see class-level comment).
  async prepareVerificationResend(
    email: string
  ): Promise<
    | { shouldSend: false }
    | {
        shouldSend: true;
        name: string | null;
        email: string;
        rawToken: string;
        tokenHash: string;
        expiresAt: Date;
      }
  > {
    const appUrl =
      process.env
        .NEXT_PUBLIC_APP_URL;

    if (
      !process.env.BREVO_API_KEY ||
      !appUrl
    ) {
      console.error(
        "Missing BREVO_API_KEY or NEXT_PUBLIC_APP_URL"
      );

      throw new AppError(
        "Email verification is not configured.",
        500
      );
    }

    const user =
      await this.users.findByEmail(
        email,
        {
          email: true,
          name: true,
          emailVerified: true,
        }
      );

    if (
      !user ||
      user.emailVerified
    ) {
      return { shouldSend: false };
    }

    const rawToken =
      crypto
        .randomBytes(32)
        .toString("hex");

    const tokenHash =
      hashToken(rawToken);

    const expiresAt =
      new Date(
        Date.now() +
          60 * 60 * 1000
      );

    return {
      shouldSend: true,
      name: user.name,
      email: user.email,
      rawToken,
      tokenHash,
      expiresAt,
    };
  }

  // Sends the "resend" verification email after the route has already
  // persisted the replacement token. On failure, the unusable token's
  // hash is removed so it can't be used.
  async sendVerificationEmail(data: {
    name: string | null;
    email: string;
    rawToken: string;
    tokenHash: string;
  }): Promise<void> {
    // verification URL is constructed inside the email helper.

    const { error } = await sendVerificationEmail({
      name: data.name,
      email: data.email,
      rawToken: data.rawToken,
    });

    if (error) {
      console.error("Resend verification error:", error);

      // The email containing the raw token wasn't delivered, so its hash should not remain valid.

      await this.verificationTokens.deleteMany({ token: data.tokenHash });

      throw new AppError(
        "We couldn't send the verification email. Please try again.",
        500
      );
    }
  }
}

export const authService = new AuthService();
