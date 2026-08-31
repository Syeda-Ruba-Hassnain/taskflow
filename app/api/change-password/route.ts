import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { authService } from "@/lib/services/auth.service";
import { AppError } from "@/lib/errors/app-error";
import { RateLimitError } from "@/lib/errors/rate-limit-error";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

// ==================================
// CHANGE PASSWORD
// PATCH /api/change-password
// ==================================

export async function PATCH(
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
    // 5 change-password attempts per user
    // every 15 minutes.
    //
    // This endpoint accepts a password (currentPassword) as a
    // confirmation factor. Without a limit here, anyone who gets
    // hold of a valid session (e.g. a stolen/XSS'd cookie, a shared
    // device) could brute-force the account's real password online,
    // since bcrypt.compare alone adds only ~100ms of friction per
    // guess.

    const rateLimitResult = await rateLimit({
      key: `change-password:${userId}`,
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });

    if (!rateLimitResult.success) {
      throw new RateLimitError(
        "Too many password change attempts. Please try again later."
      );
    }

    // ----------------------------------
    // READ REQUEST
    // ----------------------------------

    const body =
      await request.json();

    const currentPassword =
      typeof body.currentPassword ===
      "string"
        ? body.currentPassword
        : "";

    const newPassword =
      typeof body.newPassword ===
      "string"
        ? body.newPassword
        : "";

    // ----------------------------------
    // VALIDATE INPUT
    // ----------------------------------

    if (!currentPassword) {
      return NextResponse.json(
        {
          error:
            "Please enter your current password.",
        },
        {
          status: 400,
        }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        {
          error:
            "New password must be at least 8 characters.",
        },
        {
          status: 400,
        }
      );
    }

    if (newPassword.length > 128) {
      return NextResponse.json(
        {
          error:
            "New password must be 128 characters or fewer.",
        },
        {
          status: 400,
        }
      );
    }

    // ----------------------------------
    // CHANGE PASSWORD
    // ----------------------------------

    await authService.changePassword(
      userId,
      {
        currentPassword,
        newPassword,
      }
    );

    // ----------------------------------
    // SUCCESS
    // ----------------------------------

    return NextResponse.json(
      {
        message:
          "Password changed successfully.",
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
        },
        {
          status: error.statusCode,
        }
      );
    }

    logger.error(
      "Change password error",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while changing your password.",
      },
      {
        status: 500,
      }
    );
  }
}
