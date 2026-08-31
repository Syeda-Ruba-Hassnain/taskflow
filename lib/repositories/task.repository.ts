import prisma from "@/lib/prisma";
import { Prisma, Task } from "@prisma/client";

export class TaskRepository {
  async create(data: Prisma.TaskCreateInput): Promise<Task> {
    return prisma.task.create({ data });
  }

  async findByIdForUser(
    userId: number,
    id: number
  ): Promise<Task | null> {
    return prisma.task.findFirst({
      where: { id, userId },
    });
  }

  async findByUserId(userId: number): Promise<Task[]> {
    return prisma.task.findMany({
      where: { userId },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findByUserIdAndTitle(
    userId: number,
    title: string
  ): Promise<Task | null> {
    return prisma.task.findFirst({
      where: {
        userId,
        title: {
          equals: title,
          mode: "insensitive",
        },
      },
    });
  }

  async searchByUserId(
    userId: number,
    where: Prisma.TaskWhereInput
  ): Promise<Task[]> {
    return prisma.task.findMany({
      where: {
        userId,
        ...where,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  // Ownership is enforced by scoping the update itself to
  // { id, userId }, not by a separate existence check, so this
  // stays atomic. Returns null when no row matched (task missing
  // or not owned by this user).
  async updateForUser(
    userId: number,
    id: number,
    data: Prisma.TaskUpdateInput
  ): Promise<Task | null> {
    const result = await prisma.task.updateMany({
      where: { id, userId },
      data,
    });

    if (result.count === 0) {
      return null;
    }

    return prisma.task.findFirst({
      where: { id, userId },
    });
  }

  // Same ownership-scoped pattern as updateForUser. Returns the
  // deleted task snapshot, or null if missing/not owned.
  //
  // The findFirst below is only there to snapshot the row's data for
  // the return value (callers such as the AI confirmation flow need
  // the task's title after it's gone) — it is NOT what makes this
  // safe against a concurrent delete of the same task (e.g. a
  // double-clicked Delete button, or an AI-confirmed delete racing a
  // manual one). That safety comes entirely from deleteMany's
  // { id, userId } where-clause: unlike `prisma.task.delete()`
  // (which requires a unique where and throws P2025 if the row is
  // already gone), deleteMany atomically deletes at most one
  // matching row and reports how many it actually removed. If a
  // concurrent request already deleted this row, `result.count` is
  // 0 and this returns null just like any other "not found" case,
  // instead of throwing an unhandled Prisma error.
  async deleteForUser(
    userId: number,
    id: number
  ): Promise<Task | null> {
    const existing = await prisma.task.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return null;
    }

    const result = await prisma.task.deleteMany({
      where: { id, userId },
    });

    return result.count > 0 ? existing : null;
  }
}

export const taskRepository = new TaskRepository();