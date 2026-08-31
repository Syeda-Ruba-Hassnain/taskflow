import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getUserTasks: vi.fn(),
    createTask: vi.fn(),
  },
}));

import { GET, POST } from "./route";
import { auth } from "@/auth";
import { taskService } from "@/lib/services/task.service";

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

const getUserTasksMock = vi.mocked(taskService.getUserTasks);
const createTaskMock = vi.mocked(taskService.createTask);

const USER_ID = 7;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

describe("GET /api/tasks", () => {
  it("returns 401 when there is no session", async () => {
    mockSession(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(getUserTasksMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the session has no usable user id", async () => {
    mockSession({ user: { id: "not-a-number" } });

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns the authenticated user's tasks with dueDate serialized to YYYY-MM-DD", async () => {
    getUserTasksMock.mockResolvedValue([
      makeTask({ id: 1, dueDate: new Date("2026-07-30T00:00:00.000Z") }),
      makeTask({ id: 2, dueDate: null }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getUserTasksMock).toHaveBeenCalledWith(USER_ID);
    expect(body).toHaveLength(2);
    expect(body[0].dueDate).toBe("2026-07-30");
    expect(body[1].dueDate).toBeNull();
  });

  it("returns 500 without leaking details when the service throws", async () => {
    getUserTasksMock.mockRejectedValue(new Error("connection refused"));

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).not.toMatch(/connection refused/);

    consoleErrorSpy.mockRestore();
  });
});

describe("POST /api/tasks", () => {
  it("returns 401 when there is no session", async () => {
    mockSession(null);

    const response = await POST(makeRequest({ title: "Buy milk" }));

    expect(response.status).toBe(401);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that isn't valid JSON", async () => {
    const request = new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it("returns 400 when title is missing", async () => {
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(400);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it("returns 400 when title is blank after trimming", async () => {
    const response = await POST(makeRequest({ title: "   " }));

    expect(response.status).toBe(400);
  });

  it("returns 400 for an explicitly invalid category", async () => {
    const response = await POST(
      makeRequest({ title: "Buy milk", category: "Chores" })
    );

    expect(response.status).toBe(400);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an explicitly invalid priority", async () => {
    const response = await POST(
      makeRequest({ title: "Buy milk", priority: "Urgent" })
    );

    expect(response.status).toBe(400);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid due date", async () => {
    const response = await POST(
      makeRequest({ title: "Buy milk", dueDate: "not-a-date" })
    );

    expect(response.status).toBe(400);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it("defaults category to Other and priority to Medium when omitted", async () => {
    createTaskMock.mockResolvedValue(makeTask() as never);

    await POST(makeRequest({ title: "Buy milk" }));

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "Other",
        priority: "Medium",
      })
    );
  });

  it("ignores a client-supplied userId and always scopes creation to the session user", async () => {
    createTaskMock.mockResolvedValue(makeTask() as never);

    await POST(
      // Deliberately probing for a body-driven ownership bypass —
      // userId isn't part of the route's accepted request shape.
      makeRequest({
        title: "Buy milk",
        userId: 999,
      })
    );

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { connect: { id: USER_ID } },
      })
    );
  });

  it("returns 201 with the created, serialized task on success", async () => {
    createTaskMock.mockResolvedValue(
      makeTask({
        id: 10,
        title: "Buy milk",
        dueDate: new Date("2026-08-01T00:00:00.000Z"),
      }) as never
    );

    const response = await POST(
      makeRequest({ title: "Buy milk", dueDate: "2026-08-01" })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe(10);
    expect(body.title).toBe("Buy milk");
    expect(body.dueDate).toBe("2026-08-01");
  });

  it("returns 500 without leaking details when the service throws", async () => {
    createTaskMock.mockRejectedValue(new Error("connection refused"));

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(makeRequest({ title: "Buy milk" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).not.toMatch(/connection refused/);

    consoleErrorSpy.mockRestore();
  });
});
