import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { authService } from "@/lib/services/auth.service";
import { userRepository } from "@/lib/repositories/user.repository";
import { verificationTokenRepository } from "@/lib/repositories/verification-token.repository";
import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger";

import {
  rateLimit,
  getClientIp,
  getRetryAfterSeconds,
} from "@/lib/rate-limit";

// ==================================
// REGISTER
// POST /api/register
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

    const { name, email, password } =
      body;

    // ----------------------------------
    // VALIDATE NAME
    // ----------------------------------

    if (
      typeof name !== "string" ||
      name.trim().length < 2
    ) {
      return NextResponse.json(
        {
          error:
            "Name must be at least 2 characters.",
        },
        {
          status: 400,
        }
      );
    }

    const normalizedName =
      name.trim();

    if (
      normalizedName.length > 100
    ) {
      return NextResponse.json(
        {
          error:
            "Name must be 100 characters or fewer.",
        },
        {
          status: 400,
        }
      );
    }

    // ----------------------------------
    // VALIDATE EMAIL
    // ----------------------------------

    if (typeof email !== "string") {
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

    const normalizedEmail =
      email
        .trim()
        .toLowerCase();

    const emailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
      !normalizedEmail ||
      normalizedEmail.length > 254 ||
      !emailRegex.test(
        normalizedEmail
      )
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

    // ----------------------------------
    // VALIDATE PASSWORD
    // ----------------------------------

    if (
      typeof password !== "string" ||
      password.length < 8
    ) {
      return NextResponse.json(
        {
          error:
            "Password must be at least 8 characters.",
        },
        {
          status: 400,
        }
      );
    }

    if (password.length > 128) {
      return NextResponse.json(
        {
          error:
            "Password must be 128 characters or fewer.",
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
    // 5 registration attempts
    // from the same IP
    // every 1 hour.
    //
    // We use the IP rather than email
    // because an attacker could simply
    // keep changing email addresses.

    const ip =
      getClientIp(request);

    const rateLimitResult =
      await rateLimit({
        key:
          `register:${ip}`,

        limit: 5,

        windowMs:
          60 * 60 * 1000,
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
            "Too many registration attempts. Please try again later.",
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
    // VALIDATE + PREPARE ACCOUNT
    // ----------------------------------

    const prepared =
      await authService.prepareRegistration(
        {
          name: normalizedName,
          email: normalizedEmail,
          password,
        }
      );

    // ----------------------------------
    // CREATE USER + HASHED TOKEN
    // ----------------------------------

    const user =
      await prisma.$transaction(
        async (tx) => {
          const newUser =
            await userRepository.create(
              {
                name:
                  normalizedName,

                email:
                  normalizedEmail,

                password:
                  prepared.hashedPassword,

                emailVerified:
                  null,
              },
              tx
            );

          await verificationTokenRepository.create(
            {
              email:
                normalizedEmail,

              // Store only the hash.
              token:
                prepared.tokenHash,

              expiresAt:
                prepared.expiresAt,
            },
            tx
          );

          return newUser;
        }
      );

    // ----------------------------------
    // SEND VERIFICATION EMAIL
    // ----------------------------------

    await authService.completeRegistration(
      {
        name: normalizedName,
        email: normalizedEmail,
        rawToken: prepared.rawToken,
      }
    );

    // ----------------------------------
    // SUCCESS
    // ----------------------------------

    return NextResponse.json(
      {
        message:
          "Account created. Please check your email to verify your account.",

        accountCreated: true,

        user,
      },
      {
        status: 201,
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
      "Registration error",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while creating your account.",
      },
      {
        status: 500,
      }
    );
  }
}
