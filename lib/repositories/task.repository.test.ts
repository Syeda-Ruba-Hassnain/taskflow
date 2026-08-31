import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "@prisma/client";

// Mocked directly at the Prisma-client boundary (matching the
// project's existing convention — see e.g.
// app/api/delete-account/route.test.ts) so deleteForUser's actual
// query shape (which where-clauses it sends, in what order) can be
// asserted, rather than testing the mock itself.
vi.mock("@/lib/prisma", () => ({
  default: {
    task: {
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { taskRepository } from "./task.repository";
import prisma from "@/lib/prisma";

const mockedPrisma = vi.mocked(prisma, true);

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Finish FYP",
    description: null,
    category: "Study",
    priority: "High",
    completed: false,
    dueDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: 42,
    ...overrides,
  } as Task;
}

describe("TaskRepository.deleteForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression (Phase 10): deleteForUser used to do
  // findFirst({ id, userId }) -> prisma.task.delete({ where: { id } })
  // — a separate check-then-act pair where the actual delete wasn't
  // scoped to userId at all, and used Prisma's unique `delete()`
  // (which throws P2025 if the row is already gone). This suite
  // covers the atomic { id, userId }-scoped deleteMany() replacement.

  it("deletes the task and returns its snapshot when the authenticated user owns it", async () => {
    const task = makeTask({ id: 1, userId: 42 });
    mockedPrisma.task.findFirst.mockResolvedValue(task);
    mockedPrisma.task.deleteMany.mockResolvedValue({ count: 1 });

    const result = await taskRepository.deleteForUser(42, 1);

    expect(result).toEqual(task);
    expect(mockedPrisma.task.findFirst).toHaveBeenCalledWith({
      where: { id: 1, userId: 42 },
    });
    // The actual mutation is scoped to BOTH id and userId — a
    // tampered/foreign id can never reach a row it doesn't own, even
    // if the pre-check above were somehow bypassed.
    expect(mockedPrisma.task.deleteMany).toHaveBeenCalledWith({
      where: { id: 1, userId: 42 },
    });
  });

  it("never deletes another user's task", async () => {
    // The task exists, but belongs to a different user — findFirst
    // is scoped to { id, userId }, so a non-owner's lookup of someone
    // else's task id resolves to null, exactly like "not found".
    mockedPrisma.task.findFirst.mockResolvedValue(null);

    const result = await taskRepository.deleteForUser(999, 1);

    expect(result).toBeNull();
    expect(mockedPrisma.task.findFirst).toHaveBeenCalledWith({
      where: { id: 1, userId: 999 },
    });
    // No pre-check match — the destructive call must never even be
    // attempted for a task this caller doesn't own.
    expect(mockedPrisma.task.deleteMany).not.toHaveBeenCalled();
  });

  it("returns null for a task that doesn't exist", async () => {
    mockedPrisma.task.findFirst.mockResolvedValue(null);

    const result = await taskRepository.deleteForUser(42, 999);

    expect(result).toBeNull();
    expect(mockedPrisma.task.deleteMany).not.toHaveBeenCalled();
  });

  // The actual race: two requests for the SAME task both pass the
  // pre-check (findFirst) before either delete has run — the exact
  // interleaving a double-clicked Delete button, or an AI-confirmed
  // delete overlapping a manual one, can produce. This is what makes
  // this a real concurrency-safety test rather than "call the
  // function twice": deleteMany's { id, userId } scoping guarantees
  // the database lets at most one of the two DELETE statements
  // actually remove the row, and reports back exactly how many rows
  // it removed — count 1 for whichever wins the race, count 0 for
  // the other. Nothing about deleteForUser's own logic is what
  // enforces "only one wins"; that guarantee comes from the
  // database executing each deleteMany atomically. What this test
  // demonstrates is that deleteForUser handles a lost race (count 0)
  // by returning null cleanly, instead of the old delete()-based
  // code throwing an unhandled "record to delete does not exist"
  // error into the caller (surfaced as a raw 500, not a graceful
  // "not found").
  it("handles two concurrent delete requests for the same task without throwing — the loser gets a clean null", async () => {
    const task = makeTask({ id: 7, userId: 42 });

    // Both requests' pre-checks observe the row before either delete
    // has run.
    mockedPrisma.task.findFirst.mockResolvedValue(task);

    // The database can only actually remove the row once: the first
    // deleteMany to execute reports count 1, the second — racing
    // against an already-gone row — reports count 0. (A real
    // concurrent Postgres run guarantees exactly this alternation;
    // this mock stands in for that guarantee the same way the rest
    // of this suite stands in for the database generally.)
    mockedPrisma.task.deleteMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const [winner, loser] = await Promise.all([
      taskRepository.deleteForUser(42, 7),
      taskRepository.deleteForUser(42, 7),
    ]);

    expect(winner).toEqual(task);
    expect(loser).toBeNull();
    // Not "an error was thrown for the loser" — a clean, expected
    // null, exactly like any other already-gone task.
    expect(mockedPrisma.task.deleteMany).toHaveBeenCalledTimes(2);
  });
});
