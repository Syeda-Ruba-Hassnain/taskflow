import { describe, it, expect, vi, beforeEach } from "vitest";

// The only genuinely EXTERNAL dependency mocked in this file is the
// LLM itself (the `openai` package, pointed at Groq) - the parser,
// validator, context manager/store, executor, task mappers, and
// TaskService's own business logic (ownership scoping, ensureFound,
// search-criteria checks) all run for real.
//
// One deliberate exception: lib/repositories/task.repository is
// mocked, because it's a thin Prisma wrapper that requires a live
// Postgres connection this test environment doesn't have. That's a
// persistence-boundary mock, not a business-logic one - TaskService's
// real code still runs against it.

// vi.mock() factories are hoisted above regular top-level statements,
// so anything the factory references must be created via vi.hoisted().
const { createMock, FakeAPIConnectionTimeoutError } = vi.hoisted(() => {
  class FakeAPIConnectionTimeoutError extends Error {}

  return {
    createMock: vi.fn(),
    FakeAPIConnectionTimeoutError,
  };
});

vi.mock("openai", () => {
  class MockOpenAI {
    chat = { completions: { create: createMock } };
    constructor() {}
  }

  return {
    default: MockOpenAI,
    APIConnectionTimeoutError: FakeAPIConnectionTimeoutError,
  };
});

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
}));

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

import { POST } from "@/app/api/ai/intent/route";
import { auth } from "@/auth";
import { rateLimit } from "@/lib/rate-limit";
import { taskRepository } from "@/lib/repositories/task.repository";
import { aiContextManager } from "@/lib/ai/context/context.manager";

const authMock = vi.mocked(auth);
const rateLimitMock = vi.mocked(rateLimit);
const repoMock = vi.mocked(taskRepository);

const USER_ID = 99;

function makeRequest(transcript: string): Request {
  return new Request("http://localhost/api/ai/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  });
}

function makeConfirmRequest(confirm: object): Request {
  return new Request("http://localhost/api/ai/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm }),
  });
}

function mockLLMReply(json: object | string) {
  createMock.mockResolvedValue({
    choices: [
      {
        message: {
          content: typeof json === "string" ? json : JSON.stringify(json),
        },
      },
    ],
  });
}

function makeStoredTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "Buy milk",
    description: null,
    category: "Other",
    priority: "Medium",
    completed: false,
    dueDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: USER_ID,
    ...overrides,
  };
}

describe("AI pipeline integration (route -> client -> parser -> validator -> executor)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GROQ_API_KEY = "test-key";
    delete process.env.AI_REQUEST_TIMEOUT_MS;

    // next-auth v5's `auth` export is overloaded to also work as
    // Next.js middleware, so ReturnType<typeof auth> resolves to that
    // signature rather than the plain session-getter one used here.
    authMock.mockResolvedValue({
      user: { id: String(USER_ID) },
    } as unknown as Awaited<ReturnType<typeof auth>>);
    rateLimitMock.mockResolvedValue({
      success: true,
      remaining: 19,
      resetAt: new Date(),
    });
    aiContextManager.clear(USER_ID);
  });

  it("creates a task end-to-end from a natural-language transcript", async () => {
    mockLLMReply({
      intent: "create_task",
      task: {
        title: "Buy milk",
        priority: "high",
        category: "personal",
        dueDate: null,
        description: null,
      },
    });

    repoMock.create.mockResolvedValue(
      makeStoredTask({ priority: "High", category: "Personal" }) as never
    );

    const response = await POST(makeRequest("buy milk"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.intent).toBe("create_task");
    expect(body.result.title).toBe("Buy milk");

    // Confirms real mapping/normalization ran end-to-end (not just
    // pass-through): "high"/"personal" from the model became
    // "High"/"Personal" before reaching the repository boundary.
    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Buy milk",
        priority: "High",
        category: "Personal",
      })
    );
  });

  it("returns 502 when the LLM returns non-JSON text (real parser rejects it)", async () => {
    mockLLMReply("Sure! Here's your task: {not actually json");

    const response = await POST(makeRequest("buy milk"));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.success).toBe(false);
    expect(repoMock.create).not.toHaveBeenCalled();
  });

  it("returns 502 when the LLM returns valid JSON failing schema validation (real validator rejects it)", async () => {
    mockLLMReply({ intent: "not_a_real_intent" });

    const response = await POST(makeRequest("buy milk"));

    expect(response.status).toBe(502);
  });

  it("returns 504 when the LLM call times out (real client maps it)", async () => {
    createMock.mockRejectedValue(
      new FakeAPIConnectionTimeoutError("timed out")
    );

    const response = await POST(makeRequest("buy milk"));

    expect(response.status).toBe(504);
  });

  it("resolves a follow-up command using real conversation context across two requests", async () => {
    // Turn 1: create a task. The route's real aiContextManager.remember()
    // stores it as "lastTask" after this call.
    mockLLMReply({
      intent: "create_task",
      task: {
        title: "Buy milk",
        priority: "medium",
        category: "personal",
        dueDate: null,
        description: null,
      },
    });

    const stored = makeStoredTask({ category: "Personal" });
    repoMock.create.mockResolvedValue(stored as never);

    const firstResponse = await POST(makeRequest("buy milk"));
    expect(firstResponse.status).toBe(200);

    // Turn 2: "mark it done" - the model doesn't repeat the task
    // details, relying on the real AIContextManager.resolve() to fill
    // in `task` from turn 1 before the executor searches for it.
    mockLLMReply({
      intent: "complete_task",
      changes: { completed: true },
    });

    repoMock.searchByUserId.mockResolvedValue([stored] as never);
    repoMock.updateForUser.mockResolvedValue({
      ...stored,
      completed: true,
    } as never);

    const response = await POST(makeRequest("mark it done"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.completed).toBe(true);

    // The search that resolved "it" was seeded from the remembered
    // task, not from anything in turn 2's transcript.
    expect(repoMock.searchByUserId).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        title: expect.objectContaining({
          equals: "Buy milk",
          mode: "insensitive",
        }),
      })
    );
  });

  describe("rename / edit (update_task)", () => {
    it("renames a task end-to-end from a natural-language transcript", async () => {
      // Real shape returned by the live model for "Rename Finish FYP to
      // Finish Final Year Project" — the old title identifies the task
      // (query), the new title is the change (changes).
      mockLLMReply({
        intent: "update_task",
        task: null,
        changes: { title: "Finish Final Year Project" },
        query: { title: "Finish FYP" },
      });

      const existing = makeStoredTask({ id: 5, title: "Finish FYP" });
      repoMock.searchByUserId.mockResolvedValue([existing] as never);

      const renamed = { ...existing, title: "Finish Final Year Project" };
      repoMock.updateForUser.mockResolvedValue(renamed as never);

      const response = await POST(
        makeRequest("Rename Finish FYP to Finish Final Year Project")
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.intent).toBe("update_task");
      expect(body.result.title).toBe("Finish Final Year Project");

      // BUG 1: the message must explicitly name BOTH the real old
      // title (from the resolved task, not the AI's query text) and
      // the real new title — not a generic "I updated the task."
      expect(body.message).toBe(
        'Changed "Finish FYP" to "Finish Final Year Project".'
      );

      // The OLD title located the row; the update itself only ever
      // wrote the NEW title, never a partial/merged value.
      expect(repoMock.searchByUserId).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({
          title: { equals: "Finish FYP", mode: "insensitive" },
        })
      );
      expect(repoMock.updateForUser).toHaveBeenCalledWith(
        USER_ID,
        existing.id,
        { title: "Finish Final Year Project" }
      );
    });

    it("BUG 1: uses the task's REAL title for a fuzzy match, not the AI's partial query text", async () => {
      // The AI's query is a fuzzy search term ("FYP"), not the task's
      // actual full title ("Finish FYP") — the rename message must use
      // the real resolved title, never the query text itself.
      mockLLMReply({
        intent: "update_task",
        task: null,
        changes: { title: "Final Year Project" },
        query: { title: "FYP" },
      });

      const existing = makeStoredTask({ id: 5, title: "Finish FYP" });
      // Exact match returns nothing for "FYP" (real title is "Finish
      // FYP") — falls through to the fuzzy/contains match.
      repoMock.searchByUserId
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([existing] as never);

      const renamed = { ...existing, title: "Final Year Project" };
      repoMock.updateForUser.mockResolvedValue(renamed as never);

      const response = await POST(makeRequest("Rename FYP to Final Year Project"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.message).toBe(
        'Changed "Finish FYP" to "Final Year Project".'
      );
    });

    it('renames the last-discussed task for a pronoun command ("rename it to X") via real conversation context', async () => {
      mockLLMReply({
        intent: "create_task",
        task: {
          title: "Finish FYP",
          priority: "medium",
          category: "study",
          dueDate: null,
          description: null,
        },
      });

      const stored = makeStoredTask({
        id: 5,
        title: "Finish FYP",
        category: "Study",
      });
      repoMock.create.mockResolvedValue(stored as never);

      const firstResponse = await POST(makeRequest("create Finish FYP"));
      expect(firstResponse.status).toBe(200);

      // Correct shape for a pronoun-only reference: the model leaves
      // both task and query null rather than guessing a title (see
      // lib/ai/prompt.ts's update_task pronoun rule) — real
      // AIContextManager.resolve() fills in the target from turn 1.
      mockLLMReply({
        intent: "update_task",
        task: null,
        changes: { title: "Finish Final Year Project" },
        query: null,
      });

      repoMock.searchByUserId.mockResolvedValue([stored] as never);
      const renamed = { ...stored, title: "Finish Final Year Project" };
      repoMock.updateForUser.mockResolvedValue(renamed as never);

      const response = await POST(
        makeRequest("Rename it to Finish Final Year Project")
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.title).toBe("Finish Final Year Project");
      expect(repoMock.updateForUser).toHaveBeenCalledWith(
        USER_ID,
        stored.id,
        { title: "Finish Final Year Project" }
      );
    });

    // KNOWN LIMITATION — documented, not fixed. The live model
    // occasionally (~1 in 5 calls, measured against the real Groq API)
    // hallucinates a plausible-but-wrong query.title for a pronoun-only
    // rename instead of leaving query null (mitigated but not
    // eliminated by the prompt guidance added alongside this test —
    // see lib/ai/prompt.ts). When that happens, AIExecutor.findTask's
    // `ai.query ?? ai.task` precedence means the hallucinated query is
    // used instead of the correctly context-resolved task. A code-level
    // fix was evaluated and rejected: making context resolution ignore
    // any AI-supplied query would also break the legitimate case where
    // a *real* query on a new, unrelated command must outrank stale
    // context (see the comment in AIContextManager.resolve() above
    // `lastQuery` reuse) — there is no way to tell the two apart once
    // the AI response is all we have. This test pins down the current
    // (imperfect) behavior so a future change to either side is visible
    // here rather than silently shifting.
    it("KNOWN LIMITATION: a hallucinated query on a pronoun rename outranks the correctly resolved context task", async () => {
      mockLLMReply({
        intent: "create_task",
        task: {
          title: "Buy milk",
          priority: "medium",
          category: "personal",
          dueDate: null,
          description: null,
        },
      });

      const stored = makeStoredTask({ id: 5, title: "Buy milk" });
      repoMock.create.mockResolvedValue(stored as never);

      await POST(makeRequest("buy milk"));

      // Simulates the observed hallucination: the model invents a query
      // title unrelated to the real context ("Buy milk") instead of
      // returning query: null.
      mockLLMReply({
        intent: "update_task",
        task: null,
        changes: { title: "Get milk" },
        query: { title: "Hallucinated Task Name" },
      });

      repoMock.searchByUserId.mockResolvedValue([] as never);

      const response = await POST(makeRequest("Rename it to Get milk"));

      // Targets the hallucinated title, not the real "Buy milk" context
      // — and since no task is actually named that, it fails instead of
      // renaming the task the user meant. Documented risk, not a crash.
      expect(response.status).toBe(404);
      expect(repoMock.updateForUser).not.toHaveBeenCalled();
    });

    it("returns 400 (not a generic 500) when the new title exceeds the length limit", async () => {
      const overlongTitle = "A".repeat(201);

      mockLLMReply({
        intent: "update_task",
        task: null,
        changes: { title: overlongTitle },
        query: { title: "Finish FYP" },
      });

      const existing = makeStoredTask({ id: 5, title: "Finish FYP" });
      repoMock.searchByUserId.mockResolvedValue([existing] as never);

      const response = await POST(
        makeRequest(`Rename Finish FYP to ${overlongTitle}`)
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/200 characters or fewer/);
      expect(repoMock.updateForUser).not.toHaveBeenCalled();
    });

    it("returns 404 when the task to rename doesn't exist", async () => {
      mockLLMReply({
        intent: "update_task",
        task: null,
        changes: { title: "New Title" },
        query: { title: "Nonexistent Task" },
      });

      repoMock.searchByUserId.mockResolvedValue([] as never);

      const response = await POST(
        makeRequest("Rename Nonexistent Task to New Title")
      );

      expect(response.status).toBe(404);
      expect(repoMock.updateForUser).not.toHaveBeenCalled();
    });

    it("returns needsClarification with distinguishing details when the target name matches multiple, different tasks", async () => {
      mockLLMReply({
        intent: "update_task",
        task: null,
        changes: { title: "New Title" },
        query: { title: "Finish FYP" },
      });

      const a = makeStoredTask({
        id: 1,
        title: "Finish FYP",
        priority: "High",
        category: "Work",
      });
      const b = makeStoredTask({
        id: 2,
        title: "Finish FYP",
        priority: "Low",
        category: "Personal",
        completed: true,
      });
      repoMock.searchByUserId.mockResolvedValue([a, b] as never);

      const response = await POST(
        makeRequest("Rename Finish FYP to New Title")
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.needsClarification).toBe(true);
      expect(body.message).toMatch(/Finish FYP/);
      expect(body.message).toContain("High priority");
      expect(body.message).toContain("Work");
      expect(body.message).toContain("Low priority");
      expect(body.message).toContain("Personal");
      expect(body.candidates).toEqual([
        {
          id: 1,
          title: "Finish FYP",
          priority: "High",
          category: "Work",
          completed: false,
          dueDate: null,
        },
        {
          id: 2,
          title: "Finish FYP",
          priority: "Low",
          category: "Personal",
          completed: true,
          dueDate: null,
        },
      ]);
      expect(repoMock.updateForUser).not.toHaveBeenCalled();
    });

    it("asks for another detail when the ambiguous candidates are genuinely identical", async () => {
      mockLLMReply({
        intent: "update_task",
        task: null,
        changes: { title: "New Title" },
        query: { title: "Finish FYP" },
      });

      const a = makeStoredTask({ id: 1, title: "Finish FYP" });
      const b = makeStoredTask({ id: 2, title: "Finish FYP" });
      repoMock.searchByUserId.mockResolvedValue([a, b] as never);

      const response = await POST(
        makeRequest("Rename Finish FYP to New Title")
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.needsClarification).toBe(true);
      expect(body.message).toMatch(/identical/i);
      expect(repoMock.updateForUser).not.toHaveBeenCalled();
    });

    it("allows renaming a task to its own current title without erroring", async () => {
      mockLLMReply({
        intent: "update_task",
        task: null,
        changes: { title: "Finish FYP" },
        query: { title: "Finish FYP" },
      });

      const existing = makeStoredTask({ id: 5, title: "Finish FYP" });
      repoMock.searchByUserId.mockResolvedValue([existing] as never);
      repoMock.updateForUser.mockResolvedValue(existing as never);

      const response = await POST(
        makeRequest("Rename Finish FYP to Finish FYP")
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.title).toBe("Finish FYP");
    });
  });

  describe("delete confirmation (delete_task / delete_all_tasks)", () => {
    it("resolves the target and returns needsConfirmation, without deleting anything", async () => {
      mockLLMReply({
        intent: "delete_task",
        task: null,
        changes: null,
        query: { title: "Finish FYP" },
      });

      const existing = makeStoredTask({ id: 5, title: "Finish FYP" });
      repoMock.searchByUserId.mockResolvedValue([existing] as never);

      const response = await POST(makeRequest("Delete Finish FYP"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.needsConfirmation).toBe(true);
      expect(body.action).toEqual({
        intent: "delete_task",
        taskId: 5,
        taskTitle: "Finish FYP",
      });
      expect(repoMock.deleteForUser).not.toHaveBeenCalled();
    });

    it("confirm executes exactly one delete, without ever calling Groq", async () => {
      const existing = makeStoredTask({ id: 5, title: "Finish FYP" });
      repoMock.deleteForUser.mockResolvedValue(existing as never);
      createMock.mockClear();

      const response = await POST(
        makeConfirmRequest({
          intent: "delete_task",
          taskId: 5,
          taskTitle: "Finish FYP",
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.intent).toBe("delete_task");
      expect(body.message).toMatch(/Deleted/);
      expect(repoMock.deleteForUser).toHaveBeenCalledTimes(1);
      expect(repoMock.deleteForUser).toHaveBeenCalledWith(USER_ID, 5);
      // The whole point of the confirm branch: it never touches the LLM.
      expect(createMock).not.toHaveBeenCalled();
    });

    it("confirming twice only ever deletes once — the second confirm targets a task that's already gone", async () => {
      const existing = makeStoredTask({ id: 5, title: "Finish FYP" });
      repoMock.deleteForUser
        .mockResolvedValueOnce(existing as never)
        .mockResolvedValueOnce(null as never);

      const action = { intent: "delete_task", taskId: 5, taskTitle: "Finish FYP" };

      const first = await POST(makeConfirmRequest(action));
      expect(first.status).toBe(200);

      const second = await POST(makeConfirmRequest(action));
      expect(second.status).toBe(404);

      expect(repoMock.deleteForUser).toHaveBeenCalledTimes(2);
    });

    it("fails safely (404) for a stale/tampered task id instead of deleting anything", async () => {
      // deleteForUser scopes by {id, userId} internally and returns
      // null when nothing matches — exactly what happens for a task
      // that isn't (or no longer is) owned by this user.
      repoMock.deleteForUser.mockResolvedValue(null as never);

      const response = await POST(
        makeConfirmRequest({
          intent: "delete_task",
          taskId: 999999,
          taskTitle: "Someone else's task",
        })
      );

      expect(response.status).toBe(404);
      expect(repoMock.deleteForUser).toHaveBeenCalledWith(USER_ID, 999999);
    });

    it("rejects a malformed confirm body (400) instead of executing anything", async () => {
      const response = await POST(
        makeConfirmRequest({ intent: "delete_task", taskId: "not-a-number" })
      );

      expect(response.status).toBe(400);
      expect(repoMock.deleteForUser).not.toHaveBeenCalled();
    });

    it("bulk delete: resolves every task and returns needsConfirmation, without deleting anything", async () => {
      mockLLMReply({
        intent: "delete_all_tasks",
        task: null,
        changes: null,
        query: null,
      });

      const tasks = [
        makeStoredTask({ id: 1 }),
        makeStoredTask({ id: 2 }),
        makeStoredTask({ id: 3 }),
      ];
      repoMock.findByUserId.mockResolvedValue(tasks as never);

      const response = await POST(makeRequest("Delete all my tasks"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.needsConfirmation).toBe(true);
      expect(body.action).toEqual({
        intent: "delete_all_tasks",
        taskIds: [1, 2, 3],
        taskCount: 3,
      });
      expect(repoMock.deleteForUser).not.toHaveBeenCalled();
    });

    it("bulk delete confirm deletes every resolved id exactly once", async () => {
      repoMock.deleteForUser
        .mockResolvedValueOnce(makeStoredTask({ id: 1 }) as never)
        .mockResolvedValueOnce(makeStoredTask({ id: 2 }) as never)
        .mockResolvedValueOnce(makeStoredTask({ id: 3 }) as never);

      const response = await POST(
        makeConfirmRequest({
          intent: "delete_all_tasks",
          taskIds: [1, 2, 3],
          taskCount: 3,
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.message).toMatch(/3/);
      expect(repoMock.deleteForUser).toHaveBeenCalledTimes(3);
    });
  });

  describe("malformed / low-confidence requests never mutate", () => {
    it("returns needsClarification for a low-confidence rename, without touching the database", async () => {
      mockLLMReply({
        intent: "update_task",
        task: null,
        changes: { title: "blue" },
        query: { title: "blah blah blah" },
        confidence: "low",
      });

      const response = await POST(
        makeRequest("Rename blah blah blah blue")
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.needsClarification).toBe(true);
      expect(repoMock.searchByUserId).not.toHaveBeenCalled();
      expect(repoMock.updateForUser).not.toHaveBeenCalled();
    });

    it("still executes a normal request when confidence is absent (backward compatible with older mocked replies)", async () => {
      mockLLMReply({
        intent: "create_task",
        task: { title: "Buy milk", priority: "medium", category: null, dueDate: null, description: null },
      });
      repoMock.create.mockResolvedValue(makeStoredTask() as never);

      const response = await POST(makeRequest("buy milk"));

      expect(response.status).toBe(200);
      expect(repoMock.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("pending action does not corrupt conversation context", () => {
    it("a needsConfirmation response does not overwrite the last successfully resolved task", async () => {
      // Turn 1: create a task, which sets real lastTask context.
      mockLLMReply({
        intent: "create_task",
        task: { title: "Buy milk", priority: "medium", category: "personal", dueDate: null, description: null },
      });
      const stored = makeStoredTask({ id: 1, title: "Buy milk" });
      repoMock.create.mockResolvedValue(stored as never);
      await POST(makeRequest("buy milk"));

      // Turn 2: an unrelated delete request that only reaches
      // needsConfirmation — must not clobber turn 1's context.
      mockLLMReply({
        intent: "delete_task",
        task: null,
        changes: null,
        query: { title: "Finish FYP" },
      });
      const other = makeStoredTask({ id: 2, title: "Finish FYP" });
      repoMock.searchByUserId.mockResolvedValue([other] as never);
      const confirmResponse = await POST(makeRequest("Delete Finish FYP"));
      expect((await confirmResponse.json()).needsConfirmation).toBe(true);

      // Turn 3: "mark it done" — real AIContextManager.resolve() must
      // still fall back to "Buy milk" from turn 1, not "Finish FYP"
      // from the never-executed turn 2.
      mockLLMReply({
        intent: "complete_task",
        changes: { completed: true },
      });
      repoMock.searchByUserId.mockResolvedValue([stored] as never);
      repoMock.updateForUser.mockResolvedValue({
        ...stored,
        completed: true,
      } as never);

      await POST(makeRequest("mark it done"));

      expect(repoMock.searchByUserId).toHaveBeenLastCalledWith(
        USER_ID,
        expect.objectContaining({
          title: expect.objectContaining({ equals: "Buy milk" }),
        })
      );
    });
  });
});
