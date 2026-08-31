import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AIContextStore } from "./context.store";

// Mirrors AI_CONTEXT_TTL_MS in context.store.ts. Not imported directly
// because that constant is intentionally private/unexported (no
// production code was changed to make this value test-visible) - if
// the real TTL ever changes, this must be updated to match.
const TTL_MS = 30 * 60 * 1000;

describe("AIContextStore", () => {
  let store: AIContextStore;

  beforeEach(() => {
    store = new AIContextStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("create / get", () => {
    it("returns undefined for a user with no context", () => {
      expect(store.get(1)).toBeUndefined();
    });

    it("getOrCreate creates an empty context for a new user", () => {
      const context = store.getOrCreate(1);

      expect(context.userId).toBe(1);
      expect(context.lastTask).toBeUndefined();
      expect(context.lastQuery).toBeUndefined();
      expect(context.updatedAt).toEqual(
        new Date("2026-01-01T00:00:00.000Z")
      );
    });

    it("getOrCreate returns the same context object on a second call", () => {
      const first = store.getOrCreate(1);
      const second = store.getOrCreate(1);

      expect(second).toBe(first);
    });

    it("has() reflects whether a context currently exists", () => {
      expect(store.has(1)).toBe(false);
      store.getOrCreate(1);
      expect(store.has(1)).toBe(true);
    });
  });

  describe("update", () => {
    it("merges updates into the context and refreshes updatedAt", () => {
      store.getOrCreate(1);

      vi.setSystemTime(new Date("2026-01-01T00:10:00.000Z"));
      const updated = store.update(1, { lastQuery: { category: "work" } });

      expect(updated.lastQuery).toEqual({ category: "work" });
      expect(updated.updatedAt).toEqual(
        new Date("2026-01-01T00:10:00.000Z")
      );
    });

    it("creates a context via update() if none existed yet", () => {
      const updated = store.update(2, { lastQuery: { title: "x" } });

      expect(updated.userId).toBe(2);
      expect(store.get(2)).toBeDefined();
    });
  });

  describe("TTL expiry", () => {
    it("still returns the context while within the TTL window", () => {
      store.getOrCreate(1);

      vi.setSystemTime(new Date(Date.now() + TTL_MS - 1000));

      expect(store.get(1)).toBeDefined();
    });

    it("treats a context as expired once the TTL has fully elapsed", () => {
      store.getOrCreate(1);

      vi.setSystemTime(new Date(Date.now() + TTL_MS));

      expect(store.get(1)).toBeUndefined();
    });

    it("refreshing via update() resets the expiry clock", () => {
      store.getOrCreate(1);

      vi.setSystemTime(new Date(Date.now() + TTL_MS - 1000));
      store.update(1, { lastQuery: { title: "still active" } });

      vi.setSystemTime(new Date(Date.now() + TTL_MS - 1000));

      expect(store.get(1)).toBeDefined();
    });
  });

  describe("lazy eviction", () => {
    it("removes an expired entry the next time it is looked up via get()", () => {
      store.getOrCreate(1);
      vi.setSystemTime(new Date(Date.now() + TTL_MS));

      expect(store.get(1)).toBeUndefined();
      expect(store.has(1)).toBe(false);
    });

    it("getOrCreate does not revive an expired context - it creates a fresh one", () => {
      const original = store.getOrCreate(1);
      store.update(1, { lastQuery: { title: "old conversation" } });

      vi.setSystemTime(new Date(Date.now() + TTL_MS));

      const fresh = store.getOrCreate(1);

      expect(fresh).not.toBe(original);
      expect(fresh.lastQuery).toBeUndefined();
    });
  });

  describe("sweepExpired via the write path", () => {
    it("a write for one user opportunistically evicts another user's stale entry", () => {
      store.getOrCreate(1);

      vi.setSystemTime(new Date(Date.now() + TTL_MS));

      // A write for a *different* user should sweep user 1's now-expired
      // entry as a side effect, not just lazily evict it on direct access.
      store.update(2, { lastQuery: { title: "user 2 activity" } });

      expect(store.get(1)).toBeUndefined();
    });

    it("set() also triggers the sweep", () => {
      store.getOrCreate(1);
      vi.setSystemTime(new Date(Date.now() + TTL_MS));

      store.set({
        userId: 2,
        updatedAt: new Date(),
        lastQuery: { title: "fresh" },
      });

      expect(store.get(1)).toBeUndefined();
    });
  });

  describe("expired context recreation", () => {
    it("allows a fresh context to be created for a user whose old one expired", () => {
      store.getOrCreate(1);
      store.update(1, { lastQuery: { title: "first conversation" } });

      vi.setSystemTime(new Date(Date.now() + TTL_MS));
      expect(store.get(1)).toBeUndefined();

      const recreated = store.getOrCreate(1);

      expect(recreated.userId).toBe(1);
      expect(recreated.lastQuery).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("removes a context immediately, independent of TTL", () => {
      store.getOrCreate(1);
      store.clear(1);

      expect(store.get(1)).toBeUndefined();
    });
  });
});
