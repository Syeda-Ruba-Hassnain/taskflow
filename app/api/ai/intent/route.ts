import { NextResponse } from "next/server";

import { auth } from "@/auth";

import { parseIntent } from "@/lib/ai/client";
import { aiContextManager } from "@/lib/ai/context/context.manager";
import { aiExecutor } from "@/lib/ai/executor";
import { buildIntentMessage } from "@/lib/ai/messages";
import { parseAIResponse } from "@/lib/ai/parser";
import {
  validateAIResponse,
  validatePendingAction,
} from "@/lib/ai/validator";
import {
  serializeTask,
  serializeTasks,
} from "@/lib/task/task-serializer";
import { TaskValidationError } from "@/lib/task/task-validator";
import { AppError } from "@/lib/errors/app-error";
import { RateLimitError } from "@/lib/errors/rate-limit-error";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { AIIntent } from "@/lib/types/ai";
import {
  isClarificationResult,
  isConfirmationResult,
  isRenamedResult,
} from "@/lib/types/ai-execution";
import type { Task } from "@prisma/client";

function isGreetingTranscript(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();

  return [
    "hi",
    "hello",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
  ].some((phrase) => normalized === phrase);
}

// Centralized so the AI route's rate-limit budget lives in one place.
// Keyed per authenticated user (not IP) since the cost driver here is
// the signed-in caller, not the network address.
const AI_RATE_LIMIT = {
  limit: 20,
  windowMs: 60 * 1000,
};

// A voice/text command is a short instruction, not a document — this
// is generous for that. Without a cap, the per-minute rate limit above
// only bounds request *count*, not size: a single request with a huge
// transcript still reaches the paid Groq API and is billed/processed
// per character, so size needs its own limit.
const MAX_TRANSCRIPT_LENGTH = 2000;

export async function POST(request: Request) {
  try {
    // ==================================
    // AUTHENTICATE USER
    // ==================================

    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Unauthorized.",
        },
        { status: 401 }
      );
    }

    const userId = Number(session.user.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        { status: 401 }
      );
    }

    // ==================================
    // RATE LIMIT
    // ==================================
    //
    // Maximum:
    // 20 AI requests per user
    // every 1 minute.

    const rateLimitResult = await rateLimit({
      key: `ai-intent:${userId}`,
      ...AI_RATE_LIMIT,
    });

    if (!rateLimitResult.success) {
      throw new RateLimitError(
        "Too many AI requests. Please try again later."
      );
    }

    // ==================================
    // PARSE REQUEST BODY
    // ==================================

    const body = await request.json();

    // ==================================
    // CONFIRMATION BRANCH
    // ==================================
    //
    // A fully resolved PendingAIAction the user has already explicitly
    // confirmed — never touches the LLM, never re-interprets the
    // original transcript. action.taskId/taskIds are only ever used
    // below scoped to THIS request's own authenticated userId (never
    // anything client-supplied), so a stale or foreign id fails safely
    // at the repository layer instead of being trusted.
    if (body && body.confirm !== undefined) {
      const action = validatePendingAction(body.confirm);

      const confirmedResult = await aiExecutor.executeConfirmedAction(
        action,
        userId
      );

      const confirmedMessage = buildIntentMessage(
        action.intent,
        confirmedResult as Task | Task[]
      );

      const serializedConfirmedResult = Array.isArray(confirmedResult)
        ? serializeTasks(confirmedResult)
        : serializeTask(confirmedResult as Task);

      return NextResponse.json({
        success: true,
        intent: action.intent,
        message: confirmedMessage,
        result: serializedConfirmedResult,
      });
    }

    if (!body || typeof body.transcript !== "string") {
      return NextResponse.json(
        {
          error: "Invalid request body. Expected { transcript: string }.",
        },
        { status: 400 }
      );
    }

    const transcript = body.transcript.trim();

    if (!transcript) {
      return NextResponse.json(
        {
          error: "Transcript cannot be empty.",
        },
        { status: 400 }
      );
    }

    if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
      return NextResponse.json(
        {
          error: `Transcript must be ${MAX_TRANSCRIPT_LENGTH} characters or fewer.`,
        },
        { status: 400 }
      );
    }

    // ==================================
    // STEP 1: GET AI RESPONSE
    // ==================================

    const isGreeting = isGreetingTranscript(transcript);
    const parsedResponse = isGreeting
      ? { intent: AIIntent.GREETING, task: null, changes: null, query: null }
      : validateAIResponse(
          parseAIResponse(await parseIntent(transcript))
        );

    const resolvedResponse = aiContextManager.resolve(
      userId,
      parsedResponse
    );

    // ==================================
    // STEP 5: EXECUTE AI INTENT
    // ==================================

    const result = await aiExecutor.execute(
      resolvedResponse,
      userId
    );

    // ==================================
    // STEP 5b: CONFIRMATION / CLARIFICATION
    // ==================================
    //
    // Neither of these ever touched the database — the executor
    // stopped short of the actual taskService mutation. Return the
    // executor's own message/payload directly and stop here: no
    // Task-shaped message to build, and (deliberately) no call to
    // aiContextManager.remember below — a pending confirmation or a
    // clarification ask must never be remembered as "the last task",
    // or a later pronoun reference ("rename it") would resolve to a
    // task that was never actually touched.

    if (isConfirmationResult(result)) {
      return NextResponse.json({
        success: true,
        intent: resolvedResponse.intent,
        message: result.message,
        needsConfirmation: true,
        action: result.action,
      });
    }

    if (isClarificationResult(result)) {
      return NextResponse.json({
        success: true,
        intent: resolvedResponse.intent,
        message: result.message,
        needsClarification: true,
        candidates: result.candidates ?? [],
      });
    }

    // update_task's title-change case: an explicit "Changed X to Y"
    // using the task's REAL title before the edit (captured by the
    // executor at resolution time) and its real new title — not a
    // generic "I updated it" and not reconstructed from the
    // transcript/query. See RenamedResult's doc comment. Unwraps to a
    // plain Task below so serialization and aiContextManager.remember
    // work exactly as they do for every other successful mutation.
    if (isRenamedResult(result)) {
      const renameMessage = `Changed "${result.previousTitle}" to "${result.task.title}".`;

      aiContextManager.remember(
        userId,
        resolvedResponse,
        result.task
      );

      return NextResponse.json({
        success: true,
        intent: resolvedResponse.intent,
        message: renameMessage,
        result: serializeTask(result.task),
      });
    }

    // ==================================
    // STEP 6: BUILD RESULT MESSAGE
    // ==================================

    const duplicateResult =
      typeof result === "object" &&
      result !== null &&
      "duplicate" in result &&
      (result as { duplicate: true }).duplicate === true
        ? (result as {
            duplicate: true;
            task: Task;
          })
        : null;

    const message = duplicateResult
      ? "This task already exists. I've taken you to it."
      : buildIntentMessage(
          resolvedResponse.intent,
          result as Task | Task[]
        );

    // ==================================
    // STEP 7: SAVE CONVERSATION CONTEXT
    // ==================================

    aiContextManager.remember(
      userId,
      resolvedResponse,
      result
    );

    // ==================================
    // STEP 8: RETURN RESULT
    // ==================================
    //
    // The client-facing shape mirrors the REST API exactly, so the
    // response uses the same shared serializer rather than the raw
    // Prisma model (whose `dueDate` is a `Date`, not the
    // `YYYY-MM-DD` string the client expects).

    if (duplicateResult) {
      const serializedTask = serializeTask(
        duplicateResult.task
      );

      return NextResponse.json({
        success: true,
        intent: resolvedResponse.intent,
        message,
        duplicate: true,
        existingTaskId: duplicateResult.task.id,
        existingTask: serializedTask,
        result: serializedTask,
      });
    }

    const actualResult = result as Task | Task[];
    const serializedResult = Array.isArray(actualResult)
      ? serializeTasks(actualResult)
      : serializeTask(actualResult);

    return NextResponse.json({
      success: true,
      intent: resolvedResponse.intent,
      message,
      result: serializedResult,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          ...error.details,
        },
        { status: error.statusCode }
      );
    }

    // Thrown by the shared task-validator (e.g. an AI-supplied title
    // over MAX_TITLE_LENGTH, or one that's blank after trimming) —
    // not an AppError, so without this it would fall through to the
    // generic 500 below and hide a normal validation failure behind
    // an opaque "something went wrong" message.
    if (error instanceof TaskValidationError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 400 }
      );
    }

    logger.error("AI intent request failed", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to process AI request.",
      },
      { status: 500 }
    );
  }
}