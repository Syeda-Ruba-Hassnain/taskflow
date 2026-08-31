import { Task } from "@prisma/client";

import { AIContextTask } from "../context.types";

export function toAIContextTask(task: Task): AIContextTask {
  return {
    id: task.id,

    title: task.title,

    description: task.description,

    priority: task.priority.toLowerCase() as
      | "low"
      | "medium"
      | "high",

    category: task.category,

    dueDate: task.dueDate
      ? task.dueDate.toISOString()
      : null,

    completed: task.completed,
  };
}