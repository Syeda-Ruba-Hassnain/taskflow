import { AIConversationContext } from "./context.types";

// A context is considered stale — and evicted the next time it's
// touched — after this long without any activity from that user.
const AI_CONTEXT_TTL_MS = 30 * 60 * 1000;

export class AIContextStore {
  /**
   * Stores context for each user.
   */
  private readonly contexts = new Map<number, AIConversationContext>();

  /**
   * Get a user's context.
   * Returns undefined if no context exists, or if it has expired.
   */
  get(userId: number): AIConversationContext | undefined {
    return this.getIfActive(userId);
  }

  /**
   * Save or replace a user's context.
   */
  set(context: AIConversationContext): void {
    context.updatedAt = new Date();

    this.contexts.set(context.userId, context);
    this.sweepExpired();
  }

  /**
   * Remove a user's context.
   */
  clear(userId: number): void {
    this.contexts.delete(userId);
  }

  /**
   * Check if a user already has an unexpired context.
   */
  has(userId: number): boolean {
    return this.getIfActive(userId) !== undefined;
  }

  /**
   * Create an empty context if one doesn't exist (or the existing
   * one has expired).
   */
  getOrCreate(userId: number): AIConversationContext {
    const existing = this.getIfActive(userId);

    if (existing) {
      return existing;
    }

    const context: AIConversationContext = {
      userId,
      updatedAt: new Date(),
    };

    this.contexts.set(userId, context);

    return context;
  }

  /**
   * Merge updates into an existing context. Refreshes its expiry,
   * since any update counts as new activity.
   */
  update(
    userId: number,
    updates: Partial<AIConversationContext>
  ): AIConversationContext {
    const context = this.getOrCreate(userId);

    const updatedContext: AIConversationContext = {
      ...context,
      ...updates,
      updatedAt: new Date(),
    };

    this.contexts.set(userId, updatedContext);
    this.sweepExpired();

    return updatedContext;
  }

  // ==================================
  // LIFECYCLE
  // ==================================
  //
  // No background worker/timer: every read and write path above
  // routes through these two methods, so expiry is only ever
  // evaluated (and acted on) as a side effect of real request
  // activity touching the store.

  /**
   * Looks up a context, evicting and returning undefined instead if
   * it has gone stale. The single place expiry is evaluated for a
   * specific key — get/has/getOrCreate all route through this so a
   * stale entry is never silently reused.
   */
  private getIfActive(
    userId: number
  ): AIConversationContext | undefined {
    const context = this.contexts.get(userId);

    if (!context) {
      return undefined;
    }

    if (this.isExpired(context)) {
      this.contexts.delete(userId);
      return undefined;
    }

    return context;
  }

  private isExpired(context: AIConversationContext): boolean {
    return (
      Date.now() - context.updatedAt.getTime() >= AI_CONTEXT_TTL_MS
    );
  }

  /**
   * Opportunistically evicts any other stale entries whenever a
   * write happens, so a user who never returns still eventually has
   * their context reclaimed instead of only entries someone actually
   * looks up again. Still no timer — purely piggybacked on writes
   * from real requests.
   */
  private sweepExpired(): void {
    for (const [userId, context] of this.contexts) {
      if (this.isExpired(context)) {
        this.contexts.delete(userId);
      }
    }
  }
}

export const aiContextStore = new AIContextStore();
