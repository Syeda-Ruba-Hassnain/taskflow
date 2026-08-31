import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { authService } from "@/lib/services/auth.service";
import { logger } from "@/lib/logger";

// ==================================
// UPDATE PROFILE
// PATCH /api/profile
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

    // ----------------------------------
    // READ REQUEST
    // ----------------------------------

    const body =
      await request.json();

    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    // ----------------------------------
    // VALIDATE NAME
    // ----------------------------------

    if (name.length < 2) {
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

    if (name.length > 100) {
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
    // UPDATE LOGGED-IN USER
    // ----------------------------------

    const user =
      await authService.updateProfile(
        userId,
        { name }
      );

    // ----------------------------------
    // SUCCESS
    // ----------------------------------

    return NextResponse.json(
      {
        message:
          "Profile updated successfully.",
        user,
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    logger.error(
      "Profile update error",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while updating your profile.",
      },
      {
        status: 500,
      }
    );
  }
}