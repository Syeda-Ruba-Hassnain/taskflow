import { NextResponse } from "next/server";

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { authService } from "@/lib/services/auth.service";
import { userRepository } from "@/lib/repositories/user.repository";
import { verificationTokenRepository } from "@/lib/repositories/verification-token.repository";
import { passwordResetTokenRepository } from "@/lib/repositories/password-reset-token.repository";
import { AppError } from "@/lib/errors/app-error";
import { RateLimitError } from "@/lib/errors/rate-limit-error";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

// ==================================
// DELETE ACCOUNT
// DELETE /api/delete-account
// ==================================

export async function DELETE(
  request: Request
) {
  try {
    // ----------------------------------
    // AUTHENTICATION
    // ----------------------------------

    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Unauthorized.",
        },
        {
          status: 401,
        }
      );
    }

    // ----------------------------------
    // VALIDATE USER ID
    // ----------------------------------

    const userId = Number(
      session.user.id
    );

    if (
      !Number.isInteger(userId) ||
      userId <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid user session.",
        },
        {
          status: 401,
        }
      );
    }

    // ==================================
    // RATE LIMIT
    // ==================================
    //
    // Maximum:
    // 5 delete-account attempts per user
    // every 15 minutes.
    //
    // Same reasoning as /api/change-password: this endpoint accepts
    // a password as a confirmation factor, so it needs the same
    // protection against online brute-forcing by anyone holding a
    // valid session.

    const rateLimitResult = await rateLimit({
      key: `delete-account:${userId}`,
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });

    if (!rateLimitResult.success) {
      throw new RateLimitError(
        "Too many attempts. Please try again later."
      );
    }

    // ----------------------------------
    // READ REQUEST
    // ----------------------------------

    let body: unknown;

    try {
      body =
        await request.json();
    } catch {
      return NextResponse.json(
        {
          error:
            "Invalid request data.",
        },
        {
          status: 400,
        }
      );
    }

    // ----------------------------------
    // VALIDATE REQUEST BODY
    // ----------------------------------

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid request data.",
        },
        {
          status: 400,
        }
      );
    }

    const { password } =
      body as {
        password?: unknown;
      };

    // ----------------------------------
    // VALIDATE PASSWORD
    // ----------------------------------

    if (
      typeof password !== "string" ||
      password.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Please enter your password to delete your account.",
        },
        {
          status: 400,
        }
      );
    }

    // Prevent unnecessarily large input
    // from being passed to bcrypt.

    if (password.length > 128) {
      return NextResponse.json(
        {
          error:
            "Invalid password.",
        },
        {
          status: 400,
        }
      );
    }

    // ----------------------------------
    // VERIFY CREDENTIALS
    // ----------------------------------

    const user =
      await authService.deleteAccount(
        userId,
        password
      );

    // ==================================
    // DELETE ACCOUNT
    // ==================================
    //
    // All cleanup happens inside one
    // database transaction.
    //
    // If any operation fails, the entire
    // transaction is rolled back.

    await prisma.$transaction(
      async (tx) => {
        // ----------------------------------
        // DELETE VERIFICATION TOKENS
        // ----------------------------------

        await verificationTokenRepository.deleteByEmail(
          user.email,
          tx
        );

        // ----------------------------------
        // DELETE PASSWORD RESET TOKENS
        // ----------------------------------

        await passwordResetTokenRepository.deleteByEmail(
          user.email,
          tx
        );

        // ----------------------------------
        // DELETE USER
        // ----------------------------------
        //
        // Tasks should automatically be
        // deleted if your Prisma Task → User
        // relation uses:
        //
        // onDelete: Cascade

        await userRepository.delete(
          user.id,
          tx
        );
      }
    );

    // ----------------------------------
    // SUCCESS
    // ----------------------------------

    return NextResponse.json(
      {
        message:
          "Your account has been deleted successfully.",
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        {
          error: error.message,
          ...error.details,
        },
        {
          status: error.statusCode,
        }
      );
    }

    logger.error(
      "Delete account error",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while deleting your account.",
      },
      {
        status: 500,
      }
    );
  }
}
