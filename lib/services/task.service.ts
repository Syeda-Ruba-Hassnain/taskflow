import { Prisma, Task } from "@prisma/client";
import { taskRepository } from "@/lib/repositories/task.repository";
import { AITask, AITaskQuery } from "@/lib/types/ai";
import { NotFoundError } from "@/lib/errors/not-found-error";
import { ValidationError } from "@/lib/errors/validation-error";

export class TaskService {
  async createTask(data: Prisma.TaskCreateInput): Promise<Task> {
    return taskRepository.create(data);
  }

  async getTaskById(
    userId: number,
    id: number
  ): Promise<Task | null> {
    return taskRepository.findByIdForUser(userId, id);
  }

  async getUserTasks(userId: number): Promise<Task[]> {
    return taskRepository.findByUserId(userId);
  }

  async getTaskByTitle(
    userId: number,
    title: string
  ): Promise<Task | null> {
    return taskRepository.findByUserIdAndTitle(
      userId,
      title.trim()
    );
  }

  async findMatchingTask(
    userId: number,
    query: AITaskQuery | AITask | null | undefined
  ): Promise<Task> {
    if (!query || !this.hasSearchCriteria(query)) {
      throw new ValidationError("Task identification is required");
    }

    const title = query.title?.trim();

    // No title to identify by — fall back to the AI's other criteria
    // (category/priority/completed) as a direct filter. This is the
    // only case where those fields act as hard requirements.
    if (!title) {
      const matches = await taskRepository.searchByUserId(
        userId,
        this.toTaskWhereInput(query)
      );

      if (matches.length === 0) {
        throw new NotFoundError("Task not found");
      }

      if (matches.length > 1) {
        throw new ValidationError("Task request is ambiguous");
      }

      return matches[0];
    }

    // Title is the user's actual identifier for "which task". The AI
    // sometimes also infers category/priority/completed from
    // descriptive language (e.g. "my work task"), but those guesses
    // are unreliable — ANDing them into the lookup can zero out a
    // perfectly good title match (e.g. the guessed category doesn't
    // match the task's real category). So title alone decides the
    // candidate set; the other fields only disambiguate when the
    // title match itself is non-unique, never rule a title match out.

    const exactTitleMatches = await taskRepository.searchByUserId(userId, {
      title: {
        equals: title,
        mode: "insensitive",
      },
    });

    if (exactTitleMatches.length === 1) {
      return exactTitleMatches[0];
    }

    if (exactTitleMatches.length > 1) {
      return this.disambiguate(exactTitleMatches, query);
    }

    const fuzzyTitleMatches = await taskRepository.searchByUserId(userId, {
      title: {
        contains: title,
        mode: "insensitive",
      },
    });

    if (fuzzyTitleMatches.length === 0) {
      throw new NotFoundError("Task not found");
    }

    if (fuzzyTitleMatches.length > 1) {
      return this.disambiguate(fuzzyTitleMatches, query);
    }

    return fuzzyTitleMatches[0];
  }

  // Narrows a set of same-titled candidates using whatever extra
  // criteria the AI supplied, without ever discarding the title match
  // itself. Throws "ambiguous" only if the extra criteria don't
  // narrow it down to exactly one task.
  private disambiguate(
    candidates: Task[],
    query: AITaskQuery | AITask
  ): Task {
    const narrowed = candidates.filter((task) => {
      if (
        query.category &&
        task.category.toLowerCase() !== query.category.toLowerCase()
      ) {
        return false;
      }

      if (
        query.priority &&
        task.priority.toLowerCase() !== query.priority.toLowerCase()
      ) {
        return false;
      }

      if (
        query.completed !== undefined &&
        task.completed !== query.completed
      ) {
        return false;
      }

      return true;
    });

    if (narrowed.length !== 1) {
      throw new ValidationError("Task request is ambiguous");
    }

    return narrowed[0];
  }

  async searchTasks(
    userId: number,
    query: AITaskQuery | null | undefined
  ): Promise<Task[]> {
    const where = this.toTaskWhereInput(query);

    // A query with no usable criteria (null, every field empty/
    // undefined, or a whitespace-only title) builds an empty `where`.
    // searchByUserId only ever adds `userId` on top of whatever it's
    // given, so an empty `where` would otherwise silently widen to
    // "every task this user owns". A search intent must never degrade
    // into an implicit list-everything — with nothing to identify,
    // the correct answer is zero results, not the whole task list.
    if (Object.keys(where).length === 0) {
      return [];
    }

    return taskRepository.searchByUserId(userId, where);
  }

  async getTasksDueToday(userId: number): Promise<Task[]> {
    const now = new Date();

    const startOfToday = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
      )
    );

    const startOfTomorrow = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1
      )
    );

    return taskRepository.searchByUserId(userId, {
      dueDate: {
        gte: startOfToday,
        lt: startOfTomorrow,
      },
    });
  }

  async updateTask(
    userId: number,
    id: number,
    data: Prisma.TaskUpdateInput
  ): Promise<Task> {
    const updated = await taskRepository.updateForUser(
      userId,
      id,
      data
    );

    return this.ensureFound(updated);
  }

  async deleteTask(
    userId: number,
    id: number
  ): Promise<Task> {
    const deleted = await taskRepository.deleteForUser(
      userId,
      id
    );

    return this.ensureFound(deleted);
  }

  async completeTask(
    userId: number,
    id: number
  ): Promise<Task> {
    const updated = await taskRepository.updateForUser(
      userId,
      id,
      { completed: true }
    );

    return this.ensureFound(updated);
  }

  async uncompleteTask(
    userId: number,
    id: number
  ): Promise<Task> {
    const updated = await taskRepository.updateForUser(
      userId,
      id,
      { completed: false }
    );

    return this.ensureFound(updated);
  }

  private ensureFound(task: Task | null): Task {
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    return task;
  }

  private hasSearchCriteria(query: AITaskQuery | AITask): boolean {
    return (
      query.title !== undefined ||
      query.category !== undefined ||
      query.priority !== undefined ||
      query.completed !== undefined
    );
  }

  private toTaskWhereInput(
    query: AITaskQuery | AITask | null | undefined
  ): Prisma.TaskWhereInput {
    if (!query) {
      return {};
    }

    const where: Prisma.TaskWhereInput = {};

    if (query.title?.trim()) {
      where.title = {
        contains: query.title.trim(),
        mode: "insensitive",
      };
    }

    if (query.category) {
      where.category = {
        equals: query.category,
        mode: "insensitive",
      };
    }

    if (query.priority) {
      where.priority = {
        equals: query.priority,
        mode: "insensitive",
      };
    }

    if (query.completed !== undefined) {
      where.completed = query.completed;
    }

    return where;
  }
}

export const taskService = new TaskService();