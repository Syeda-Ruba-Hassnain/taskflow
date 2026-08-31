import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "@prisma/client";

vi.mock("@/lib/repositories/task.repository", () => ({
  taskRepository: {
    create: vi.fn(),
    findByIdForUser: vi.fn(),
    findByUserId: vi.fn(),
    findByUserIdAndTitle: vi.fn(),
    searchByUserId: vi.fn(),
    updateForUser: vi.fn(),
    deleteForUser: vi.fn(),
  },
}));

import { TaskService } from "./task.service";
import { taskRepository } from "@/lib/repositories/task.repository";
import { NotFoundError } from "@/lib/errors/not-found-error";
import { ValidationError } from "@/lib/errors/validation-error";

const mockedRepo = vi.mocked(taskRepository);

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

describe("TaskService.searchTasks", () => {
  let service: TaskService;
  const userId = 42;

  beforeEach(() => {
    service = new TaskService();
    vi.clearAllMocks();
  });

  // AI-05: an AI response classified as search_tasks but carrying no
  // identifying criteria (query is null, or every field on it is
  // empty/undefined) must never fall back to "every task this user
  // owns". searchByUserId only ever adds `userId` on top of whatever
  // where-clause it's given, so an empty where silently becomes
  // "list everything" — a guaranteed-nonexistent search term must
  // still resolve to zero results, not the user's full task list.
  it("returns zero results when query is null, without touching the repository", async () => {
    const result = await service.searchTasks(userId, null);

    expect(result).toEqual([]);
    expect(mockedRepo.searchByUserId).not.toHaveBeenCalled();
  });

  it("returns zero results when query has no usable criteria", async () => {
    const result = await service.searchTasks(userId, {});

    expect(result).toEqual([]);
    expect(mockedRepo.searchByUserId).not.toHaveBeenCalled();
  });

  it("returns zero results for whitespace-only title, without touching the repository", async () => {
    const result = await service.searchTasks(userId, { title: "   " });

    expect(result).toEqual([]);
    expect(mockedRepo.searchByUserId).not.toHaveBeenCalled();
  });

  it("delegates to the repository when a real title is given", async () => {
    const match = makeTask();
    mockedRepo.searchByUserId.mockResolvedValue([match]);

    const result = await service.searchTasks(userId, {
      title: "Finish FYP",
    });

    expect(result).toEqual([match]);
    expect(mockedRepo.searchByUserId).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        title: { contains: "Finish FYP", mode: "insensitive" },
      })
    );
  });

  it("returns whatever the database finds for a nonexistent title — zero rows, not the full list", async () => {
    mockedRepo.searchByUserId.mockResolvedValue([]);

    const result = await service.searchTasks(userId, {
      title: "Definitely Nonexistent Task 12345",
    });

    expect(result).toEqual([]);
  });

  it("delegates when only a non-title criterion (category) is given", async () => {
    const match = makeTask({ category: "Work" });
    mockedRepo.searchByUserId.mockResolvedValue([match]);

    const result = await service.searchTasks(userId, {
      category: "Work",
    });

    expect(result).toEqual([match]);
    expect(mockedRepo.searchByUserId).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        category: { equals: "Work", mode: "insensitive" },
      })
    );
  });
});

// Task identification for rename/edit (and complete/delete/priority/
// category-change) commands — the AI never supplies a raw task id, so
// this is the sole mechanism that turns "Finish FYP" into a specific
// row. Previously untested at this layer (only exercised indirectly
// via executor.test.ts, which mocks findMatchingTask away entirely).
describe("TaskService.findMatchingTask", () => {
  let service: TaskService;
  const userId = 42;

  beforeEach(() => {
    service = new TaskService();
    vi.clearAllMocks();
  });

  it("throws ValidationError when given no identifying criteria at all", async () => {
    await expect(
      service.findMatchingTask(userId, null)
    ).rejects.toThrow(ValidationError);
    await expect(
      service.findMatchingTask(userId, {})
    ).rejects.toThrow(ValidationError);
    expect(mockedRepo.searchByUserId).not.toHaveBeenCalled();
  });

  it("returns a unique exact, case-insensitive title match without ever checking fuzzy", async () => {
    const match = makeTask({ title: "Finish FYP" });
    mockedRepo.searchByUserId.mockResolvedValueOnce([match]);

    const result = await service.findMatchingTask(userId, {
      title: "finish fyp",
    });

    expect(result).toBe(match);
    expect(mockedRepo.searchByUserId).toHaveBeenCalledTimes(1);
    expect(mockedRepo.searchByUserId).toHaveBeenCalledWith(userId, {
      title: { equals: "finish fyp", mode: "insensitive" },
    });
  });

  it("falls back to a fuzzy (contains) match when there is no exact match", async () => {
    const match = makeTask({ title: "Finish FYP Report" });
    mockedRepo.searchByUserId
      .mockResolvedValueOnce([]) // exact match: none
      .mockResolvedValueOnce([match]); // fuzzy match: one

    const result = await service.findMatchingTask(userId, {
      title: "FYP",
    });

    expect(result).toBe(match);
    expect(mockedRepo.searchByUserId).toHaveBeenNthCalledWith(2, userId, {
      title: { contains: "FYP", mode: "insensitive" },
    });
  });

  it("throws NotFoundError when neither an exact nor a fuzzy match exists", async () => {
    mockedRepo.searchByUserId
      .mockResolvedValueOnce([]) // exact
      .mockResolvedValueOnce([]); // fuzzy

    await expect(
      service.findMatchingTask(userId, { title: "Nonexistent Task" })
    ).rejects.toThrow(NotFoundError);
  });

  it("reports ambiguity when multiple exact-title matches can't be narrowed down", async () => {
    const a = makeTask({ id: 1, title: "Finish FYP", category: "Study" });
    const b = makeTask({ id: 2, title: "Finish FYP", category: "Study" });
    mockedRepo.searchByUserId.mockResolvedValueOnce([a, b]);

    await expect(
      service.findMatchingTask(userId, { title: "Finish FYP" })
    ).rejects.toThrow(ValidationError);
  });

  it("disambiguates multiple exact-title matches using a secondary criterion (category)", async () => {
    const work = makeTask({ id: 1, title: "Finish FYP", category: "Work" });
    const study = makeTask({ id: 2, title: "Finish FYP", category: "Study" });
    mockedRepo.searchByUserId.mockResolvedValueOnce([work, study]);

    const result = await service.findMatchingTask(userId, {
      title: "Finish FYP",
      category: "Study",
    });

    expect(result).toBe(study);
  });

  it("reports ambiguity when multiple fuzzy-title matches can't be narrowed down", async () => {
    const a = makeTask({ id: 1, title: "Finish FYP Draft" });
    const b = makeTask({ id: 2, title: "Finish FYP Report" });
    mockedRepo.searchByUserId
      .mockResolvedValueOnce([]) // exact: none
      .mockResolvedValueOnce([a, b]); // fuzzy: two

    await expect(
      service.findMatchingTask(userId, { title: "FYP" })
    ).rejects.toThrow(ValidationError);
  });

  it("falls back to non-title criteria as a hard filter when no title is given", async () => {
    const match = makeTask({ category: "Work" });
    mockedRepo.searchByUserId.mockResolvedValueOnce([match]);

    const result = await service.findMatchingTask(userId, {
      category: "Work",
    });

    expect(result).toBe(match);
    expect(mockedRepo.searchByUserId).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        category: { equals: "Work", mode: "insensitive" },
      })
    );
  });
});

// Phase 10: TaskService.deleteTask is the single service-layer entry
// point both the manual Delete button (via DELETE /api/tasks/:id)
// and the AI-confirmed delete flow (via AIExecutor.executeConfirmedAction)
// call — see app/api/tasks/[id]/route.ts and lib/ai/executor.ts. Its
// own logic is a thin pass-through to taskRepository.deleteForUser
// (exercised directly, with a real Prisma mock, in
// lib/repositories/task.repository.test.ts); what's tested here is
// just that TaskService correctly turns the repository's null/task
// result into the NotFoundError-or-Task contract both callers rely
// on.
describe("TaskService.deleteTask", () => {
  let service: TaskService;
  const userId = 42;

  beforeEach(() => {
    service = new TaskService();
    vi.clearAllMocks();
  });

  it("returns the deleted task when the repository confirms the delete", async () => {
    const deleted = makeTask({ id: 5 });
    mockedRepo.deleteForUser.mockResolvedValue(deleted);

    const result = await service.deleteTask(userId, 5);

    expect(result).toBe(deleted);
    expect(mockedRepo.deleteForUser).toHaveBeenCalledWith(userId, 5);
  });

  it("throws NotFoundError when the repository returns null (missing, not owned, or already deleted by a concurrent request)", async () => {
    mockedRepo.deleteForUser.mockResolvedValue(null);

    await expect(service.deleteTask(userId, 5)).rejects.toThrow(
      NotFoundError
    );
  });
});
