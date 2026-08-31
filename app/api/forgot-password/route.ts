import { NextResponse } from "next/server";

import { authService } from "@/lib/services/auth.service";
import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger";

import {
  rateLimit,
  getClientIp,
  getRetryAfterSeconds,
} from "@/lib/rate-limit";

// ==================================
// FORGOT PASSWORD
// POST /api/forgot-password
// ==================================

export async function POST(
  request: Request
) {
  try {
    // ----------------------------------
    // READ REQUEST
    // ----------------------------------

    const body =
      await request.json();

    const email =
      typeof body.email === "string"
        ? body.email
            .trim()
            .toLowerCase()
        : "";

    // ----------------------------------
    // VALIDATE EMAIL
    // ----------------------------------

    const emailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
      !email ||
      email.length > 254 ||
      !emailRegex.test(email)
    ) {
      return NextResponse.json(
        {
          error:
            "Please enter a valid email address.",
        },
        {
          status: 400,
        }
      );
    }

    // ==================================
    // RATE LIMIT
    // ==================================
    //
    // Maximum:
    // 3 password-reset requests
    // per IP + email combination
    // every 15 minutes.
    //
    // This helps prevent reset-email
    // spam and abuse.

    const ip =
      getClientIp(request);

    const rateLimitResult =
      await rateLimit({
        key:
          `forgot-password:${ip}:${email}`,

        limit: 3,

        windowMs:
            15 * 60 * 1000,
      });

    // ----------------------------------
    // RATE LIMIT EXCEEDED
    // ----------------------------------

    if (!rateLimitResult.success) {
      const retryAfter =
        getRetryAfterSeconds(
          rateLimitResult.resetAt
        );

      return NextResponse.json(
        {
          error:
            "Too many password reset requests. Please try again later.",
        },
        {
          status: 429,

          headers: {
            "Retry-After":
              String(retryAfter),
          },
        }
      );
    }

    // ----------------------------------
    // REQUEST PASSWORD RESET
    // ----------------------------------

    await authService.forgotPassword(
      email
    );

    // ----------------------------------
    // SUCCESS
    // ----------------------------------
    //
    // Never reveal whether an account
    // exists for the submitted email —
    // the same message is returned
    // whether or not one does.

    return NextResponse.json(
      {
        message:
          "If an account exists for this email, a password reset link has been sent.",
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
      "Forgot password error",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while processing your request.",
      },
      {
        status: 500,
      }
    );
  }
}
