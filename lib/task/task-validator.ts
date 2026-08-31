// ==================================
// SHARED TASK VALIDATION
// ==================================
//
// Single source of truth for task field validation, used by both
// the REST API routes (app/api/tasks/*) and the AI pipeline
// (lib/ai/mappers/task.mapper.ts).
//
// Where the REST and AI call sites historically disagreed on
// behavior, that disagreement is preserved here explicitly (see the
// TODO comments below) rather than silently unified, to avoid
// breaking either call site.

export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskValidationError";
  }
}

// ==================================
// ALLOWED VALUES
// ==================================

export const VALID_PRIORITIES = [
  "Low",
  "Medium",
  "High",
] as const;

export type ValidPriority = (typeof VALID_PRIORITIES)[number];

export const VALID_CATEGORIES = [
  "Work",
  "Personal",
  "Study",
  "Other",
] as const;

export type ValidCategory = (typeof VALID_CATEGORIES)[number];

// ==================================
// FIELD LIMITS
// ==================================

export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 2000;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ==================================
// TITLE
// ==================================

/**
 * Validates a title for task creation: required, non-empty,
 * length-limited. Matches the original POST /api/tasks behavior.
 */
export function validateTitleForCreate(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TaskValidationError("Task title is required");
  }

  const cleanTitle = value.trim();

  if (cleanTitle.length > MAX_TITLE_LENGTH) {
    throw new TaskValidationError(
      `Task title must be ${MAX_TITLE_LENGTH} characters or fewer.`
    );
  }

  return cleanTitle;
}

/**
 * Validates a title for task update. Only call this when the
 * caller has already confirmed the field was supplied.
 *
 * Phase 6 security audit: PATCH /api/tasks/:id previously had no
 * length ceiling here (unlike POST /api/tasks), and Prisma's
 * `String` column has no database-level length limit either. That
 * let an authenticated caller PATCH a task with an unbounded-length
 * title, which is a storage/DoS-adjacent risk, not just an
 * inconsistency — so the same MAX_TITLE_LENGTH check used on create
 * is now enforced here too.
 */
export function validateTitleForUpdate(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TaskValidationError("Task title cannot be empty");
  }

  const cleanTitle = value.trim();

  if (cleanTitle.length > MAX_TITLE_LENGTH) {
    throw new TaskValidationError(
      `Task title must be ${MAX_TITLE_LENGTH} characters or fewer.`
    );
  }

  return cleanTitle;
}

// ==================================
// DESCRIPTION
// ==================================

/**
 * Validates a description for task creation. `undefined`/`null`
 * become `null`; an empty string after trimming also becomes
 * `null`. Matches the original POST /api/tasks behavior.
 */
export function validateDescriptionForCreate(
  value: unknown
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TaskValidationError(
      "Task description must be text"
    );
  }

  const cleanDescription = value.trim();

  if (cleanDescription.length > MAX_DESCRIPTION_LENGTH) {
    throw new TaskValidationError(
      `Task description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`
    );
  }

  return cleanDescription !== ""
    ? cleanDescription
    : null;
}

/**
 * Validates a description for task update. Only call this when the
 * caller has already confirmed the field was supplied.
 *
 * Phase 6 security audit: same reasoning as validateTitleForUpdate
 * above — this previously had no length ceiling, unlike
 * POST /api/tasks, allowing an unbounded-length description on
 * update. The same MAX_DESCRIPTION_LENGTH check used on create is
 * now enforced here too.
 */
export function validateDescriptionForUpdate(
  value: unknown
): string | null {
  if (value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new TaskValidationError(
      "Task description must be text"
    );
  }

  const cleanDescription = value.trim();

  if (cleanDescription.length > MAX_DESCRIPTION_LENGTH) {
    throw new TaskValidationError(
      `Task description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`
    );
  }

  return cleanDescription === ""
    ? null
    : cleanDescription;
}

// ==================================
// CATEGORY
// ==================================

/**
 * Validates a category against the fixed allow-list. Used by both
 * POST and PATCH REST routes, which have always applied the same
 * rule here.
 */
export function validateCategory(
  value: unknown
): ValidCategory {
  if (
    typeof value !== "string" ||
    !VALID_CATEGORIES.includes(
      value as ValidCategory
    )
  ) {
    throw new TaskValidationError("Invalid category");
  }

  return value as ValidCategory;
}

// ==================================
// PRIORITY
// ==================================

/**
 * Validates a priority against the fixed allow-list. Used by both
 * POST and PATCH REST routes, which have always applied the same
 * rule here.
 */
export function validatePriority(
  value: unknown
): ValidPriority {
  if (
    typeof value !== "string" ||
    !VALID_PRIORITIES.includes(
      value as ValidPriority
    )
  ) {
    throw new TaskValidationError("Invalid priority");
  }

  return value as ValidPriority;
}

// ==================================
// DUE DATE (REST)
// ==================================

export type ParseDueDateOptions = {
  /**
   * When true, a value that is entirely whitespace (and therefore
   * reduces to an empty string after trimming) is treated the same
   * as "no due date" rather than rejected as invalid.
   *
   * TODO(Phase 2.2): POST /api/tasks originally had this extra
   * guard; PATCH /api/tasks/:id did not, so whitespace-only due
   * dates were silently accepted by POST but rejected by PATCH.
   * That inconsistency is preserved per call site rather than
   * unified. Revisit if/when the two endpoints should agree.
   */
  treatWhitespaceOnlyAsEmpty?: boolean;
};

/**
 * Parses a due date supplied to the REST API. Accepts `YYYY-MM-DD`
 * (optionally as the prefix of a longer string, e.g. an ISO
 * timestamp) and returns a UTC midnight `Date`, or `null` when no
 * due date was supplied.
 */
export function parseDueDate(
  value: unknown,
  options: ParseDueDateOptions = {}
): Date | null {
  const { treatWhitespaceOnlyAsEmpty = false } = options;

  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TaskValidationError(
      "Invalid due date format"
    );
  }

  const dateOnly = value.trim().slice(0, 10);

  if (
    treatWhitespaceOnlyAsEmpty &&
    dateOnly === ""
  ) {
    return null;
  }

  if (!DATE_ONLY_PATTERN.test(dateOnly)) {
    throw new TaskValidationError(
      "Invalid due date format"
    );
  }

  const [year, month, day] = dateOnly
    .split("-")
    .map(Number);

  return buildUtcDateOrThrow(year, month, day);
}

// ==================================
// DUE DATE (AI PIPELINE)
// ==================================

/**
 * Parses a due date supplied by the AI pipeline. Unlike the REST
 * `parseDueDate`, this requires an exact `YYYY-MM-DD` match (no
 * truncation of longer strings) because the AI response schema
 * (lib/ai/validator.ts) already guarantees the value is a string or
 * null before it reaches here.
 *
 * TODO(Phase 2.2): This is stricter than the REST `parseDueDate`
 * (which truncates values like "2026-07-30T00:00:00Z" to their date
 * portion). Preserved as the AI pipeline's existing behavior rather
 * than silently loosening it. Revisit if/when the two should agree.
 */
export function parseStrictDueDate(
  value: string | null
): Date | null {
  if (value === null) {
    return null;
  }

  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new TaskValidationError(
      "Invalid due date format"
    );
  }

  const [year, month, day] = value
    .split("-")
    .map(Number);

  return buildUtcDateOrThrow(year, month, day);
}

function buildUtcDateOrThrow(
  year: number,
  month: number,
  day: number
): Date {
  const date = new Date(
    Date.UTC(year, month - 1, day)
  );

  // Prevent invalid dates such as 2026-02-31, which
  // `Date.UTC` would otherwise silently roll over into March.

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TaskValidationError("Invalid due date");
  }

  return date;
}

// ==================================
// AI PIPELINE LABEL NORMALIZATION
// ==================================

/**
 * Trims a value and title-cases it (first letter uppercase, rest
 * lowercase). Used by the AI pipeline to normalize free-form
 * priority/category values into the same casing the REST API's
 * VALID_PRIORITIES/VALID_CATEGORIES allow-lists use.
 *
 * This function itself does not check the result against either
 * allow-list. Priority values are constrained upstream by the AI
 * response schema's PrioritySchema enum (lib/ai/validator.ts), so
 * in practice they always land on a valid priority. Category has no
 * such upstream constraint, so lib/ai/mappers/task.mapper.ts's
 * normalizeCategory() — the only caller that normalizes category —
 * passes this function's result through validateCategory() before
 * returning it, closing that gap without changing this function's
 * own (casing-only) behavior.
 */
export function normalizeLabel(value: string): string {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    throw new TaskValidationError(
      "Task value cannot be empty"
    );
  }

  return `${trimmedValue[0].toUpperCase()}${trimmedValue.slice(1).toLowerCase()}`;
}
