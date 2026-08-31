import prisma from "@/lib/prisma";

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type RateLimitResult = {
  success: boolean;
  remaining: number;
  resetAt: Date;
};

// ==================================
// POSTGRESQL RATE LIMITER
// ==================================

export async function rateLimit({
  key,
  limit,
  windowMs,
}: RateLimitOptions): Promise<RateLimitResult> {
  const now = new Date();

  const newResetAt = new Date(
    now.getTime() + windowMs
  );

  // ----------------------------------
  // FIND EXISTING RATE-LIMIT BUCKET
  // ----------------------------------

  const existing =
    await prisma.rateLimit.findUnique({
      where: {
        key,
      },
    });

  // ----------------------------------
  // NO EXISTING BUCKET
  // ----------------------------------

  if (!existing) {
    const created =
      await prisma.rateLimit.create({
        data: {
          key,
          count: 1,
          resetAt: newResetAt,
        },
      });

    return {
      success: true,
      remaining: Math.max(
        0,
        limit - created.count
      ),
      resetAt: created.resetAt,
    };
  }

  // ----------------------------------
  // WINDOW EXPIRED
  // ----------------------------------

  if (existing.resetAt <= now) {
    const reset =
      await prisma.rateLimit.update({
        where: {
          key,
        },

        data: {
          count: 1,
          resetAt: newResetAt,
        },
      });

    return {
      success: true,
      remaining: Math.max(
        0,
        limit - reset.count
      ),
      resetAt: reset.resetAt,
    };
  }

  // ----------------------------------
  // ALREADY AT LIMIT
  // ----------------------------------

  if (existing.count >= limit) {
    return {
      success: false,
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  // ----------------------------------
  // INCREMENT COUNTER
  // ----------------------------------

  const updated =
    await prisma.rateLimit.update({
      where: {
        key,
      },

      data: {
        count: {
          increment: 1,
        },
      },
    });

  return {
    success:
      updated.count <= limit,

    remaining: Math.max(
      0,
      limit - updated.count
    ),

    resetAt:
      updated.resetAt,
  };
}

// ==================================
// GET CLIENT IP
// ==================================

export function getClientIp(
  request: Request
): string {
  const forwardedFor =
    request.headers.get(
      "x-forwarded-for"
    );

  if (forwardedFor) {
    const firstIp =
      forwardedFor
        .split(",")[0]
        ?.trim();

    if (firstIp) {
      return firstIp;
    }
  }

  const realIp =
    request.headers.get(
      "x-real-ip"
    );

  if (realIp) {
    return realIp.trim();
  }

  // Local development / unknown IP.
  return "unknown";
}

// ==================================
// RETRY-AFTER HELPER
// ==================================

export function getRetryAfterSeconds(
  resetAt: Date
): number {
  return Math.max(
    1,
    Math.ceil(
      (resetAt.getTime() -
        Date.now()) /
        1000
    )
  );
}