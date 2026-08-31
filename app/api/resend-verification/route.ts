import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { authService } from "@/lib/services/auth.service";
import { verificationTokenRepository } from "@/lib/repositories/verification-token.repository";
import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger";

import {
  rateLimit,
  getClientIp,
  getRetryAfterSeconds,
} from "@/lib/rate-limit";

// ==================================
// RESEND VERIFICATION EMAIL
// POST /api/resend-verification
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
    // 3 resend requests per
    // IP + email combination
    // every 15 minutes.

    const ip =
      getClientIp(request);

    const rateLimitResult =
      await rateLimit({
        key:
          `resend-verification:${ip}:${email}`,

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
            "Too many verification email requests. Please try again later.",
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
    // PREPARE RESEND
    // ----------------------------------

    const prepared =
      await authService.prepareVerificationResend(
        email
      );

    if (prepared.shouldSend) {
      // ----------------------------------
      // REPLACE OLD TOKEN
      // ----------------------------------
      //
      // Only the newest verification
      // link should remain valid.

      await prisma.$transaction([
        verificationTokenRepository.deleteByEmail(
          prepared.email
        ),

        verificationTokenRepository.create(
          {
            email: prepared.email,

            // Store hash only.
            token:
              prepared.tokenHash,

            expiresAt:
              prepared.expiresAt,
          }
        ),
      ]);

      await authService.sendVerificationEmail(
        {
          name: prepared.name,
          email: prepared.email,
          rawToken: prepared.rawToken,
          tokenHash:
            prepared.tokenHash,
        }
      );
    }

    // ----------------------------------
    // SUCCESS
    // ----------------------------------
    //
    // Don't reveal whether an account
    // exists or is already verified —
    // the same message is returned
    // in every non-error case.

    return NextResponse.json(
      {
        message:
          "If an unverified account exists for this email, a verification email has been sent.",
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
      "Resend verification error",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong. Please try again.",
      },
      {
        status: 500,
      }
    );
  }
}
