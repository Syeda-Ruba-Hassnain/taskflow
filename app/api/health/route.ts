import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ==================================
// HEALTH CHECK
// GET /api/health
// ==================================
//
// Unauthenticated by design — this is the endpoint a load balancer,
// uptime monitor, or container orchestrator polls to decide whether
// this instance is serving traffic, so it must be reachable without a
// session. It reports liveness (the process is up) and readiness (the
// database is reachable) without exposing any request-derived data or
// internal error detail.

export async function GET() {
  const startedAt = Date.now();

  try {
    // Static, non-parameterized probe query — no user input reaches
    // this call, so there is no injection surface despite using
    // $queryRaw instead of the query builder used everywhere else in
    // the app.
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
        checks: {
          database: {
            status: "ok",
            latencyMs: Date.now() - startedAt,
          },
        },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Health check failed: database unreachable", error);

    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        checks: {
          database: {
            status: "error",
          },
        },
      },
      { status: 503 }
    );
  }
}
