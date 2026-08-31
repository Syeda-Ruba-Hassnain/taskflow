import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { authService } from "@/lib/services/auth.service";
import { userRepository } from "@/lib/repositories/user.repository";
import { verificationTokenRepository } from "@/lib/repositories/verification-token.repository";
import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger";

// ==================================
// VERIFY EMAIL
// POST /api/verify-email
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

    const token =
      typeof body.token === "string"
        ? body.token.trim()
        : "";

    // ----------------------------------
    // VALIDATE TOKEN
    // ----------------------------------

    if (!token) {
      return NextResponse.json(
        {
          error:
            "Verification token is required.",
        },
        {
          status: 400,
        }
      );
    }

    // randomBytes(32).toString("hex")
    // produces exactly 64 hex characters.

    if (
      !/^[a-f0-9]{64}$/i.test(
        token
      )
    ) {
      return NextResponse.json(
        {
          error:
            "This verification link is invalid.",
        },
        {
          status: 400,
        }
      );
    }

    // ----------------------------------
    // VALIDATE VERIFICATION REQUEST
    // ----------------------------------

    const prepared =
      await authService.verifyEmail(
        token
      );

    // ----------------------------------
    // VERIFY USER + REMOVE TOKENS
    // ----------------------------------

    await prisma.$transaction([
      userRepository.markEmailVerified(
        prepared.userId
      ),

      verificationTokenRepository.deleteByEmail(
        prepared.userEmail
      ),
    ]);

    // ----------------------------------
    // SUCCESS
    // ----------------------------------

    return NextResponse.json({
      message:
        "Your email has been verified successfully.",
    });
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
      "Email verification error",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while verifying your email.",
      },
      {
        status: 500,
      }
    );
  }
}
