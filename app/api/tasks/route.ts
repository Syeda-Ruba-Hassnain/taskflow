import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { taskService } from "@/lib/services/task.service";
import {
  serializeTask,
  serializeTasks,
} from "@/lib/task/task-serializer";
import {
  TaskValidationError,
  VALID_CATEGORIES,
  VALID_PRIORITIES,
  parseDueDate,
  validateCategory,
  validateDescriptionForCreate,
  validatePriority,
  validateTitleForCreate,
} from "@/lib/task/task-validator";
import { logger } from "@/lib/logger";

// ==================================
// GET LOGGED-IN USER'S TASKS
// GET /api/tasks
// ==================================

export async function GET() {
  try {
    // ----------------------------------
    // CHECK LOGIN
    // ----------------------------------

    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Unauthorized",
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
            "Invalid user session",
        },
        {
          status: 401,
        }
      );
    }

    // ----------------------------------
    // GET USER'S TASKS
    // ----------------------------------
    //
    // IMPORTANT:
    // The userId comes from the
    // authenticated session.
    //
    // A user cannot request another
    // user's tasks by supplying a
    // different userId.

    const tasks =
      await taskService.getUserTasks(
        userId
      );

    // ----------------------------------
    // NORMALISE DUE DATES
    // ----------------------------------

    const serializedTasks =
      serializeTasks(tasks);

    // ----------------------------------
    // SUCCESS
    // ----------------------------------

    return NextResponse.json(
      serializedTasks,
      {
        status: 200,
      }
    );
  } catch (error) {
    logger.error(
      "Failed to fetch tasks",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to fetch tasks",
      },
      {
        status: 500,
      }
    );
  }
}

// ==================================
// CREATE A NEW TASK
// POST /api/tasks
// ==================================

export async function POST(
  request: Request
) {
  try {
    // ----------------------------------
    // CHECK LOGIN
    // ----------------------------------

    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Unauthorized",
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
            "Invalid user session",
        },
        {
          status: 401,
        }
      );
    }

    // ----------------------------------
    // READ REQUEST DATA
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

    const {
      title,
      description,
      category,
      priority,
      dueDate,
    } = body as {
      title?: unknown;
      description?: unknown;
      category?: unknown;
      priority?: unknown;
      dueDate?: unknown;
    };

    // ==================================
    // VALIDATE TITLE
    // ==================================

    let cleanTitle: string;

    try {
      cleanTitle =
        validateTitleForCreate(title);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof
            TaskValidationError
              ? error.message
              : "Task title is required",
        },
        {
          status: 400,
        }
      );
    }

    // ==================================
    // VALIDATE DESCRIPTION
    // ==================================

    let taskDescription:
      | string
      | null = null;

    try {
      taskDescription =
        validateDescriptionForCreate(
          description
        );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof
            TaskValidationError
              ? error.message
              : "Task description must be text",
        },
        {
          status: 400,
        }
      );
    }

    // ==================================
    // VALIDATE CATEGORY
    // ==================================
    //
    // If category isn't supplied,
    // default to Other.
    //
    // If the client explicitly sends
    // an invalid category, reject it
    // instead of silently changing it.

    let taskCategory:
      (typeof VALID_CATEGORIES)[number] =
      "Other";

    if (category !== undefined) {
      try {
        taskCategory =
          validateCategory(category);
      } catch {
        return NextResponse.json(
          {
            error:
              "Invalid category",
          },
          {
            status: 400,
          }
        );
      }
    }

    // ==================================
    // VALIDATE PRIORITY
    // ==================================
    //
    // If priority isn't supplied,
    // default to Medium.
    //
    // Explicit invalid values are
    // rejected.

    let taskPriority:
      (typeof VALID_PRIORITIES)[number] =
      "Medium";

    if (priority !== undefined) {
      try {
        taskPriority =
          validatePriority(priority);
      } catch {
        return NextResponse.json(
          {
            error:
              "Invalid priority",
          },
          {
            status: 400,
          }
        );
      }
    }

    // ==================================
    // PARSE DUE DATE
    // ==================================

    let parsedDueDate:
      | Date
      | null = null;

    try {
      parsedDueDate = parseDueDate(
        dueDate,
        {
          treatWhitespaceOnlyAsEmpty:
            true,
        }
      );
    } catch {
      return NextResponse.json(
        {
          error:
            "Please enter a valid due date.",
        },
        {
          status: 400,
        }
      );
    }

    // ==================================
    // CREATE TASK
    // ==================================
    //
    // IMPORTANT:
    // userId is taken exclusively from
    // the authenticated session.
    //
    // Any userId supplied by the client
    // is ignored.

    const task =
      await taskService.createTask({
        title:
          cleanTitle,

        description:
          taskDescription,

        category:
          taskCategory,

        priority:
          taskPriority,

        completed:
          false,

        dueDate:
          parsedDueDate,

        user: {
          connect: { id: userId },
        },
      });

    // ==================================
    // SERIALISE RESPONSE
    // ==================================

    const serializedTask =
      serializeTask(task);

    // ----------------------------------
    // SUCCESS
    // ----------------------------------

    return NextResponse.json(
      serializedTask,
      {
        status: 201,
      }
    );
  } catch (error) {
    logger.error(
      "Failed to create task",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to create task",
      },
      {
        status: 500,
      }
    );
  }
}