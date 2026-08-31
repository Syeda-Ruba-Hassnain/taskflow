import {
  AITaskQuery,
  TaskPriority,
} from "@/lib/types/ai";

/**
 * Lightweight task stored in AI conversation memory.
 * This is NOT a Prisma model.
 */
export interface AIContextTask {
  id: number;

  title: string;

  description?: string | null;

  priority?: TaskPriority;

  category?: string | null;

  dueDate?: string | null;

  completed: boolean;
}

/**
 * Conversation state for one user.
 */
export interface AIConversationContext {
  userId: number;

  /**
   * Last task the conversation referred to.
   */
  lastTask?: AIContextTask;

  /**
   * Last search filter.
   */
  lastQuery?: AITaskQuery;

  /**
   * Last update timestamp.
   */
  updatedAt: Date;
}