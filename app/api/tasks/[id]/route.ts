import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { taskService } from "@/lib/services/task.service";
import { serializeTask } from "@/lib/task/task-serializer";
import {
  TaskValidationError,
  parseDueDate,
  validateCategory,
  validateDescriptionForUpdate,
  validatePriority,
  validateTitleForUpdate,
} from "@/lib/task/task-validator";
import { NotFoundError } from "@/lib/errors/not-found-error";
import { logger } from "@/lib/logger";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// ==================================
// UPDATE A TASK
// PATCH /api/tasks/1
// ==================================

export async function PATCH(
  request: Request,
  context: RouteContext
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
    // GET TASK ID
    // ----------------------------------

    const { id } =
      await context.params;

    const taskId = Number(id);

    if (
      !Number.isInteger(taskId) ||
      taskId <= 0
    ) {
      return NextResponse.json(
        {
          error: "Invalid task ID",
        },
        {
          status: 400,
        }
      );
    }

    // ----------------------------------
    // GET UPDATE DATA
    // ----------------------------------
    //
    // Phase 7 performance audit: this used to do a separate
    // getTaskById() ownership pre-check here before validating the
    // body. That was a redundant DB round-trip on the app's most
    // frequent write (every task edit/checkbox toggle) — the update
    // below already re-verifies ownership atomically via
    // updateForUser()'s { id, userId } where-clause and throws
    // NotFoundError (caught below → 404) exactly when the pre-check
    // would have. The only observable difference is a request
    // targeting a task that doesn't exist AND has invalid/empty field
    // data, which now surfaces via the update's own 404 instead of an
    // upfront one.

    const body =
      await request.json();

    const {
      title,
      description,
      category,
      priority,
      completed,
      dueDate,
    } = body;

    const updateData: {
      title?: string;
      description?: string | null;
      category?: string;
      priority?: string;
      completed?: boolean;
      dueDate?: Date | null;
    } = {};

    // ==================================
    // TITLE
    // ==================================

    if (title !== undefined) {
      try {
        updateData.title =
          validateTitleForUpdate(title);
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof
              TaskValidationError
                ? error.message
                : "Task title cannot be empty",
          },
          {
            status: 400,
          }
        );
      }
    }

    // ==================================
    // DESCRIPTION
    // ==================================

    if (description !== undefined) {
      // null or empty string removes
      // the existing description.

      try {
        updateData.description =
          validateDescriptionForUpdate(
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
    }

    // ==================================
    // CATEGORY
    // ==================================

    if (category !== undefined) {
      try {
        updateData.category =
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
    // PRIORITY
    // ==================================

    if (priority !== undefined) {
      try {
        updateData.priority =
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
    // COMPLETED
    // ==================================

    if (completed !== undefined) {
      if (
        typeof completed !==
          "boolean"
      ) {
        return NextResponse.json(
          {
            error:
              "Completed must be true or false",
          },
          {
            status: 400,
          }
        );
      }

      updateData.completed =
        completed;
    }

    // ==================================
    // DUE DATE
    // ==================================

    if (dueDate !== undefined) {
      try {
        updateData.dueDate =
          parseDueDate(dueDate);
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
    }

    // ----------------------------------
    // MAKE SURE SOMETHING WAS SENT
    // ----------------------------------

    if (
      Object.keys(updateData)
        .length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "No valid fields were provided.",
        },
        {
          status: 400,
        }
      );
    }

    // ==================================
    // UPDATE TASK
    // ==================================
    //
    // IMPORTANT:
    // TaskService scopes the mutation to
    // both task ID and logged-in user ID.
    //
    // This prevents another user's task
    // from being updated even if a task
    // ID is manipulated.

    let updatedTask;

    try {
      updatedTask =
        await taskService.updateTask(
          userId,
          taskId,
          updateData
        );
    } catch (error) {
      // ----------------------------------
      // TASK DISAPPEARED / NOT OWNED
      // ----------------------------------

      if (
        error instanceof NotFoundError
      ) {
        return NextResponse.json(
          {
            error: "Task not found",
          },
          {
            status: 404,
          }
        );
      }

      throw error;
    }

    // ==================================
    // SERIALISE RESPONSE
    // ==================================

    return NextResponse.json(
      serializeTask(updatedTask)
    );
  } catch (error) {
    logger.error(
      "Failed to update task",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to update task",
      },
      {
        status: 500,
      }
    );
  }
}

// ==================================
// DELETE A TASK
// DELETE /api/tasks/1
// ==================================

export async function DELETE(
  _request: Request,
  context: RouteContext
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
    // GET TASK ID
    // ----------------------------------

    const { id } =
      await context.params;

    const taskId = Number(id);

    if (
      !Number.isInteger(taskId) ||
      taskId <= 0
    ) {
      return NextResponse.json(
        {
          error: "Invalid task ID",
        },
        {
          status: 400,
        }
      );
    }

    // ==================================
    // DELETE TASK
    // ==================================
    //
    // IMPORTANT:
    // TaskService scopes both the
    // ownership check and the delete
    // itself to task ID + logged-in
    // user ID.

    try {
      await taskService.deleteTask(
        userId,
        taskId
      );
    } catch (error) {
      // ----------------------------------
      // TASK MISSING / NOT OWNED
      // ----------------------------------

      if (
        error instanceof NotFoundError
      ) {
        return NextResponse.json(
          {
            error: "Task not found",
          },
          {
            status: 404,
          }
        );
      }

      throw error;
    }

    // ----------------------------------
    // SUCCESS
    // ----------------------------------

    return NextResponse.json({
      message:
        "Task deleted successfully",
    });
  } catch (error) {
    logger.error(
      "Failed to delete task",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to delete task",
      },
      {
        status: 500,
      }
    );
  }
}