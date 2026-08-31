import { Task } from "@prisma/client";

// ==================================
// SHARED TASK SERIALIZATION
// ==================================
//
// Single source of truth for shaping a Prisma `Task` into the JSON
// the client sees, used by both the REST API routes
// (app/api/tasks/*) and the AI pipeline (app/api/ai/intent/route.ts).
//
// The only transformation applied is `dueDate`: Prisma returns a
// `Date | null`, but the client-facing contract has always been a
// `YYYY-MM-DD` string (or `null`). Every other field passes through
// unchanged, so nullable fields (`description`), `completed`,
// `category`, and `priority` all keep their existing shapes.

export type SerializedTask = Omit<Task, "dueDate"> & {
  dueDate: string | null;
};

export function serializeTask(task: Task): SerializedTask {
  return {
    ...task,

    dueDate: task.dueDate
      ? task.dueDate.toISOString().slice(0, 10)
      : null,
  };
}

export function serializeTasks(
  tasks: Task[]
): SerializedTask[] {
  return tasks.map(serializeTask);
}
