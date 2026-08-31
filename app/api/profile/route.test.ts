import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/services/auth.service", () => ({
  authService: {
    updateProfile: vi.fn(),
  },
}));

import { PATCH } from "./route";
import { auth } from "@/auth";
import { authService } from "@/lib/services/auth.service";

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

const updateProfileMock = vi.mocked(authService.updateProfile);

const USER_ID = 7;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession({ user: { id: String(USER_ID) } });
});

describe("PATCH /api/profile", () => {
  it("returns 401 when there is no session", async () => {
    mockSession(null);

    const response = await PATCH(makeRequest({ name: "Jane Doe" }));

    expect(response.status).toBe(401);
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the session has no usable user id", async () => {
    mockSession({ user: { id: "not-a-number" } });

    const response = await PATCH(makeRequest({ name: "Jane Doe" }));

    expect(response.status).toBe(401);
  });

  it("returns 400 when name is too short", async () => {
    const response = await PATCH(makeRequest({ name: "A" }));

    expect(response.status).toBe(400);
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it("returns 400 when name is blank after trimming", async () => {
    const response = await PATCH(makeRequest({ name: "   " }));

    expect(response.status).toBe(400);
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it("returns 400 when name is too long", async () => {
    const response = await PATCH(makeRequest({ name: "A".repeat(101) }));

    expect(response.status).toBe(400);
  });

  it("trims the name before forwarding it to the service", async () => {
    updateProfileMock.mockResolvedValue({
      id: USER_ID,
      name: "Jane Doe",
      email: "jane@example.com",
    });

    await PATCH(makeRequest({ name: "  Jane Doe  " }));

    expect(updateProfileMock).toHaveBeenCalledWith(USER_ID, {
      name: "Jane Doe",
    });
  });

  it("returns 200 with the updated user on success", async () => {
    updateProfileMock.mockResolvedValue({
      id: USER_ID,
      name: "Jane Doe",
      email: "jane@example.com",
    });

    const response = await PATCH(makeRequest({ name: "Jane Doe" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user).toEqual(
      expect.objectContaining({ name: "Jane Doe" })
    );
  });

  it("returns 500 without leaking details for an unexpected failure", async () => {
    updateProfileMock.mockRejectedValue(new Error("connection refused"));

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await PATCH(makeRequest({ name: "Jane Doe" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).not.toMatch(/connection refused/);

    consoleErrorSpy.mockRestore();
  });
});
