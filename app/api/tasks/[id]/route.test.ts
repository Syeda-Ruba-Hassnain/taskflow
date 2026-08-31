import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
  },
}));

import { PATCH, DELETE } from "./route";
import { auth } from "@/auth";
import { taskService } from "@/lib/services/task.service";
import { NotFoundError } from "@/lib/errors/not-found-error";

const authMock = vi.mocked(auth);

// See app/api/ai/intent/route.test.ts for why this cast is necessary:
// next-auth v5's `auth` export is overloaded for middleware use, so
// `ReturnType<typeof auth>` doesn't resolve to the plain
// session-getter signature actually used here.
function mockSession(session: { user: { id: string } } | null) {
  authMock.mockResolvedValue(
    session as unknown as Awaited<ReturnType<typeof auth>>
  );
}

const updateTaskMock = vi.mocked(taskService.updateTask);
const deleteTaskMock = vi.mocked(taskService.deleteTask);

const USER_ID = 7;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/tasks/1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "A task",
    description: null,
    category: "Other",
    priority: "Medium",
    completed: false,
    dueDate: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    userId: USER_ID,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession({ user: { id: String(USER_ID) } });
});

describe("PATCH /api/tasks/:id", () => {
  it("returns 401 when there is no session", async () => {
    mockSession(null);

    const response = await PATCH(
      makeRequest({ title: "Renamed" }),
      makeContext("1")
    );

    expect(response.status).toBe(401);
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the session has no usable user id", async () => {
    mockSession({ user: { id: "not-a-number" } });

    const response = await PATCH(
      makeRequest({ title: "Renamed" }),
      makeContext("1")
    );

    expect(response.status).toBe(401);
  });

  it.each(["abc", "0", "-1", "1.5"])(
    "returns 400 for an invalid task id (%s)",
    async (id) => {
      const response = await PATCH(
        makeRequest({ title: "Renamed" }),
        makeContext(id)
      );

      expect(response.status).toBe(400);
      expect(updateTaskMock).not.toHaveBeenCalled();
    }
  );

  it("returns 400 when no valid fields are provided", async () => {
    const response = await PATCH(makeRequest({}), makeContext("1"));

    expect(response.status).toBe(400);
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid title", async () => {
    const response = await PATCH(
      makeRequest({ title: "   " }),
      makeContext("1")
    );

    expect(response.status).toBe(400);
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid category", async () => {
    const response = await PATCH(
      makeRequest({ category: "Chores" }),
      makeContext("1")
    );

    expect(response.status).toBe(400);
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it("returns 400 when completed is not a boolean", async () => {
    const response = await PATCH(
      makeRequest({ completed: "yes" }),
      makeContext("1")
    );

    expect(response.status).toBe(400);
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid due date", async () => {
    const response = await PATCH(
      makeRequest({ dueDate: "not-a-date" }),
      makeContext("1")
    );

    expect(response.status).toBe(400);
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  // The route scopes every update to { id, userId } atomically inside
  // taskService/taskRepository rather than pre-checking ownership, so a
  // task that exists but belongs to someone else surfaces the exact
  // same NotFoundError as a task that doesn't exist at all — this test
  // guards that "not yours" never leaks as anything other than 404.
  it("returns 404 when the task doesn't exist or isn't owned by this user", async () => {
    updateTaskMock.mockRejectedValue(new NotFoundError("Task not found"));

    const response = await PATCH(
      makeRequest({ title: "Renamed" }),
      makeContext("999")
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Task not found");
  });

  it("only forwards fields that were actually supplied", async () => {
    updateTaskMock.mockResolvedValue(makeTask() as never);

    await PATCH(makeRequest({ title: "Renamed" }), makeContext("1"));

    expect(updateTaskMock).toHaveBeenCalledWith(USER_ID, 1, {
      title: "Renamed",
    });
  });

  it("returns 200 with the updated, serialized task on success", async () => {
    updateTaskMock.mockResolvedValue(
      makeTask({ id: 1, title: "Renamed" }) as never
    );

    const response = await PATCH(
      makeRequest({ title: "Renamed" }),
      makeContext("1")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.title).toBe("Renamed");
  });

  it("returns 500 without leaking details for an unexpected failure", async () => {
    updateTaskMock.mockRejectedValue(new Error("connection refused"));

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await PATCH(
      makeRequest({ title: "Renamed" }),
      makeContext("1")
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).not.toMatch(/connection refused/);

    consoleErrorSpy.mockRestore();
  });
});

describe("DELETE /api/tasks/:id", () => {
  function makeDeleteRequest(): Request {
    return new Request("http://localhost/api/tasks/1", {
      method: "DELETE",
    });
  }

  it("returns 401 when there is no session", async () => {
    mockSession(null);

    const response = await DELETE(makeDeleteRequest(), makeContext("1"));

    expect(response.status).toBe(401);
    expect(deleteTaskMock).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-1"])(
    "returns 400 for an invalid task id (%s)",
    async (id) => {
      const response = await DELETE(makeDeleteRequest(), makeContext(id));

      expect(response.status).toBe(400);
      expect(deleteTaskMock).not.toHaveBeenCalled();
    }
  );

  it("returns 404 when the task doesn't exist or isn't owned by this user", async () => {
    deleteTaskMock.mockRejectedValue(new NotFoundError("Task not found"));

    const response = await DELETE(makeDeleteRequest(), makeContext("999"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Task not found");
  });

  it("scopes the delete to the authenticated user", async () => {
    deleteTaskMock.mockResolvedValue(makeTask() as never);

    await DELETE(makeDeleteRequest(), makeContext("1"));

    expect(deleteTaskMock).toHaveBeenCalledWith(USER_ID, 1);
  });

  it("returns 200 with a success message", async () => {
    deleteTaskMock.mockResolvedValue(makeTask() as never);

    const response = await DELETE(makeDeleteRequest(), makeContext("1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toMatch(/deleted/i);
  });

  it("returns 500 without leaking details for an unexpected failure", async () => {
    deleteTaskMock.mockRejectedValue(new Error("connection refused"));

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await DELETE(makeDeleteRequest(), makeContext("1"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).not.toMatch(/connection refused/);

    consoleErrorSpy.mockRestore();
  });
});
