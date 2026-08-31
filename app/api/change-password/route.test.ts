import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/services/auth.service", () => ({
  authService: {
    changePassword: vi.fn(),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
}));

import { PATCH } from "./route";
import { auth } from "@/auth";
import { authService } from "@/lib/services/auth.service";
import { rateLimit } from "@/lib/rate-limit";
import { NotFoundError } from "@/lib/errors/not-found-error";
import { ValidationError } from "@/lib/errors/validation-error";

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

const changePasswordMock = vi.mocked(authService.changePassword);
const rateLimitMock = vi.mocked(rateLimit);

const USER_ID = 7;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/change-password", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession({ user: { id: String(USER_ID) } });
  rateLimitMock.mockResolvedValue({
    success: true,
    remaining: 4,
    resetAt: new Date(),
  });
});

describe("PATCH /api/change-password", () => {
  it("returns 401 when there is no session", async () => {
    mockSession(null);

    const response = await PATCH(
      makeRequest({ currentPassword: "old", newPassword: "new-password-1" })
    );

    expect(response.status).toBe(401);
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the session has no usable user id", async () => {
    mockSession({ user: { id: "not-a-number" } });

    const response = await PATCH(
      makeRequest({ currentPassword: "old", newPassword: "new-password-1" })
    );

    expect(response.status).toBe(401);
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    rateLimitMock.mockResolvedValue({
      success: false,
      remaining: 0,
      resetAt: new Date(),
    });

    const response = await PATCH(
      makeRequest({ currentPassword: "old", newPassword: "new-password-1" })
    );

    expect(response.status).toBe(429);
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("scopes the rate limit key to the authenticated user", async () => {
    changePasswordMock.mockResolvedValue(undefined);

    await PATCH(
      makeRequest({ currentPassword: "old", newPassword: "new-password-1" })
    );

    expect(rateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: `change-password:${USER_ID}` })
    );
  });

  it("returns 400 when currentPassword is missing", async () => {
    const response = await PATCH(
      makeRequest({ newPassword: "new-password-1" })
    );

    expect(response.status).toBe(400);
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("returns 400 when newPassword is too short", async () => {
    const response = await PATCH(
      makeRequest({ currentPassword: "old", newPassword: "short" })
    );

    expect(response.status).toBe(400);
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("returns 400 when newPassword is too long", async () => {
    const response = await PATCH(
      makeRequest({
        currentPassword: "old",
        newPassword: "a".repeat(129),
      })
    );

    expect(response.status).toBe(400);
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the current password is incorrect", async () => {
    changePasswordMock.mockRejectedValue(
      new ValidationError("Your current password is incorrect.")
    );

    const response = await PATCH(
      makeRequest({ currentPassword: "wrong", newPassword: "new-password-1" })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Your current password is incorrect.");
  });

  it("returns 404 when the account no longer exists", async () => {
    changePasswordMock.mockRejectedValue(new NotFoundError("Account not found."));

    const response = await PATCH(
      makeRequest({ currentPassword: "old", newPassword: "new-password-1" })
    );

    expect(response.status).toBe(404);
  });

  it("forwards the userId and passwords to the service", async () => {
    changePasswordMock.mockResolvedValue(undefined);

    await PATCH(
      makeRequest({ currentPassword: "old", newPassword: "new-password-1" })
    );

    expect(changePasswordMock).toHaveBeenCalledWith(USER_ID, {
      currentPassword: "old",
      newPassword: "new-password-1",
    });
  });

  it("returns 200 with a success message", async () => {
    changePasswordMock.mockResolvedValue(undefined);

    const response = await PATCH(
      makeRequest({ currentPassword: "old", newPassword: "new-password-1" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toMatch(/changed/i);
  });

  it("returns 500 without leaking details for an unexpected failure", async () => {
    changePasswordMock.mockRejectedValue(new Error("connection refused"));

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await PATCH(
      makeRequest({ currentPassword: "old", newPassword: "new-password-1" })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).not.toMatch(/connection refused/);

    consoleErrorSpy.mockRestore();
  });
});
