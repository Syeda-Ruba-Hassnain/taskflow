type TaskCardProps = {
  id: number;
  title: string;
  description?: string | null;
  category: string;
  priority: string;
  completed: boolean;
  dueDate: string;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onEdit: (id: number) => void;
  isHighlighted?: boolean;
  highlightTokens?: string[];
  setCardRef?: (id: number, node: HTMLElement | null) => void;
};

// ==================================
// DATE HELPERS
// ==================================

function parseDueDate(
  dueDate: string
): Date | null {
  if (!dueDate) {
    return null;
  }

  /*
   * The API may return either:
   *
   * 2026-07-30
   *
   * or:
   *
   * 2026-07-30T00:00:00.000Z
   *
   * We only need the YYYY-MM-DD part.
   */

  const dateOnly = dueDate.slice(0, 10);

  const [year, month, day] = dateOnly
    .split("-")
    .map(Number);

  if (
    !year ||
    !month ||
    !day
  ) {
    return null;
  }

  const parsedDate = new Date(
    year,
    month - 1,
    day
  );

  // Make sure JavaScript didn't
  // silently correct an invalid date.

  if (
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return null;
  }

  return parsedDate;
}

function getStartOfToday() {
  const today = new Date();

  return new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
}

// ==================================
// TASK CARD
// ==================================

export default function TaskCard({
  id,
  title,
  description,
  category,
  priority,
  completed,
  dueDate,
  onToggle,
  onDelete,
  onEdit,
  isHighlighted,
  highlightTokens,
  setCardRef,
}: TaskCardProps) {
  // ==================================
  // PRIORITY STYLES
  // ==================================

  // Priority is the one badge this round's spec calls out explicit
  // semantic colors for: High reads as genuine danger/urgency, Medium
  // as a lighter caution, Low as intentionally unremarkable (its own
  // "very light mauve/neutral" — never green, so it doesn't read as
  // "safe/done" and get confused with the separate Completed state).
  // High/Medium's text uses the semantic color itself (not Charcoal)
  // now that the deeper Phase-2-professional hex values have enough
  // contrast to read as real text, not just a tint — so "High"
  // actually looks red, "Medium" actually looks amber.
  const priorityStyles = {
    High: {
      badge:
        "bg-danger-bg text-danger ring-danger/25",
      dot: "bg-danger",
    },

    Medium: {
      badge:
        "bg-warning-bg text-warning ring-warning/25",
      dot: "bg-warning",
    },

    Low: {
      badge:
        "bg-primary-light text-charcoal ring-primary/15",
      dot: "bg-primary-soft",
    },
  };

  const priorityDetails =
    priorityStyles[
      priority as keyof typeof priorityStyles
    ] ?? {
      badge:
        "bg-gray-50 text-muted-gray ring-gray-600/10",
      dot: "bg-gray-400",
    };

  // ==================================
  // CATEGORY STYLES
  // ==================================
  //
  // Category is purely organizational, not semantic (unlike priority/
  // completion/overdue), so it deliberately does NOT get a different
  // accent color per category this round — that's exactly the
  // "colored pill for everything" look this phase is moving away
  // from. One neutral badge style for all four; the letter icon is
  // what keeps them scannable.

  const categoryStyles = {
    Work: { icon: "W" },
    Personal: { icon: "P" },
    Study: { icon: "S" },
    Other: { icon: "O" },
  };

  const CATEGORY_BADGE =
    "bg-gray-50 text-muted-gray ring-gray-600/10";

  const categoryDetails =
    categoryStyles[
      category as keyof typeof categoryStyles
    ] ?? categoryStyles.Other;

  // ==================================
  // CLEAN DESCRIPTION
  // ==================================

  const cleanDescription =
    description?.trim() || "";

  // ==================================
  // DUE DATE
  // ==================================

  const taskDueDate =
    parseDueDate(dueDate);

  const today =
    getStartOfToday();

  const tomorrow = new Date(today);

  tomorrow.setDate(
    tomorrow.getDate() + 1
  );

  // ==================================
  // DATE STATUS
  // ==================================

  const isOverdue =
    Boolean(taskDueDate) &&
    !completed &&
    taskDueDate!.getTime() <
      today.getTime();

  const isDueToday =
    Boolean(taskDueDate) &&
    taskDueDate!.getTime() ===
      today.getTime();

  const isDueTomorrow =
    Boolean(taskDueDate) &&
    taskDueDate!.getTime() ===
      tomorrow.getTime();

  // ==================================
  // FORMAT DATE
  // ==================================

  const formattedDueDate =
    taskDueDate
      ? taskDueDate.toLocaleDateString(
          "en-US",
          {
            month: "short",
            day: "numeric",
            year: "numeric",
          }
        )
      : null;

  // ==================================
  // DUE DATE LABEL
  // ==================================

  const getDueDateLabel = () => {
    if (!taskDueDate) {
      return "No due date";
    }

    if (completed) {
      return `Due ${formattedDueDate}`;
    }

    if (isOverdue) {
      return `Overdue · ${formattedDueDate}`;
    }

    if (isDueToday) {
      return `Due today · ${formattedDueDate}`;
    }

    if (isDueTomorrow) {
      return `Due tomorrow · ${formattedDueDate}`;
    }

    return `Due ${formattedDueDate}`;
  };

  const dueDateLabel =
    getDueDateLabel();

  // ==================================
  // DUE DATE COLOUR
  // ==================================

  const getDueDateStyle = () => {
    // Deliberately neutral (Warm Taupe) regardless of urgency — the
    // card's own border color and the STATUS chip below already carry
    // the overdue/due-today signal, so this row doesn't need its own
    // competing color coding on top of that (see the new color
    // system's "use colors intentionally and sparingly" rule).
    return "text-muted-gray";
  };

  const dueDateStyle =
    getDueDateStyle();

  const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const renderHighlightedText = (
    text: string,
    tokens: string[] = []
  ) => {
    if (!tokens.length) {
      return text;
    }

    const pattern = tokens
      .map((token) => escapeRegExp(token))
      .join("|");

    const parts = text.split(
      new RegExp(`(${pattern})`, "gi")
    );

    return parts.map((part, index) => {
      const normalized = part.toLowerCase();
      const isMatch = tokens.some(
        (token) => token.toLowerCase() === normalized
      );

      if (isMatch) {
        return (
          <span
            key={index}
            className="rounded bg-primary/20 px-0.5 text-charcoal"
          >
            {part}
          </span>
        );
      }

      return part;
    });
  };

  // ==================================
  // CARD STYLE
  // ==================================

  const getCardStyle = () => {
    if (completed) {
      return (
        "border-line " +
        "bg-canvas"
      );
    }

    if (isOverdue) {
      return (
        "border-warning bg-white " +
        "shadow-sm hover:border-warning " +
        "hover:shadow-md sm:hover:-translate-y-0.5"
      );
    }

    if (isDueToday) {
      return (
        "border-info bg-white " +
        "shadow-sm hover:border-info " +
        "hover:shadow-md sm:hover:-translate-y-0.5"
      );
    }

    return (
      "border-line bg-white " +
      "shadow-sm hover:border-primary-soft/60 " +
      "hover:shadow-md sm:hover:-translate-y-0.5"
    );
  };

  // ==================================
  // COMPONENT
  // ==================================

  return (
    <article
      ref={(node) =>
        setCardRef?.(id, node)
      }
      tabIndex={isHighlighted ? 0 : -1}
      className={`group rounded-2xl border p-4 transition-all duration-200 sm:p-5 ${getCardStyle()} ${
        isHighlighted
          ? "ring-2 ring-primary/60 bg-primary-light shadow-lg"
          : ""
      }`}
    >
      <div className="flex items-start gap-3 sm:gap-4">

        {/* ==================================
            COMPLETE BUTTON
        ================================== */}

        <button
          type="button"
          onClick={() => onToggle(id)}
          aria-label={
            completed
              ? `Mark ${title} as pending`
              : `Mark ${title} as completed`
          }
          title={
            completed
              ? "Mark as pending"
              : "Mark as completed"
          }
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition active:scale-95 sm:h-6 sm:w-6 ${
            completed
              ? "border-success bg-success text-charcoal"
              : "border-gray-300 bg-white text-transparent hover:border-primary"
          } focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1`}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path
              d="M4 10.5L8 14L16 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* ==================================
            TASK CONTENT
        ================================== */}

        <div className="min-w-0 flex-1">

          {/* ==================================
              TITLE — its own full-width row so it never has to
              share space with (or lose visual weight to) the
              badges/metadata below it. That's the strongest element
              on the card; everything else here is secondary.
          ================================== */}

          <h3
            className={`break-words text-[15px] font-semibold leading-6 sm:text-base ${
              completed
                ? "text-muted-gray line-through"
                : "text-charcoal"
            }`}
          >
            {renderHighlightedText(
              title,
              highlightTokens
            )}
          </h3>

          {/* ==================================
              DESCRIPTION
          ================================== */}

          {cleanDescription && (
            <p className="mt-1.5 whitespace-pre-line break-words text-sm leading-6 text-muted-gray">
              {cleanDescription}
            </p>
          )}

          {/* ==================================
              CATEGORY + PRIORITY — a compact badge row of its own,
              directly under the title. Small and refined rather than
              competing with the title for attention; wraps naturally
              at narrow widths.
          ================================== */}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">

            {/* CATEGORY BADGE */}

            <span
              className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${CATEGORY_BADGE}`}
            >
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-current/10 text-[9px] font-bold">
                {categoryDetails.icon}
              </span>

              {category}
            </span>

            {/* PRIORITY BADGE */}

            <span
              className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${priorityDetails.badge}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${priorityDetails.dot}`}
              />

              {priority}
            </span>

          </div>

          {/* ==================================
              META INFORMATION
          ================================== */}

          <div className="mt-2 flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">

            {/* ==================================
                DUE DATE
            ================================== */}

            <div
              className={`flex min-w-0 items-center gap-1.5 text-xs font-medium ${dueDateStyle}`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                className="h-4 w-4 shrink-0"
                aria-hidden="true"
              >
                <path
                  d="M8 2V5M16 2V5M3 9H21M5 4H19C20.1 4 21 4.9 21 6V20C21 21.1 20.1 22 19 22H5C3.9 22 3 21.1 3 20V6C3 4.9 3.9 4 5 4Z"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>

              <span className="break-words">
                {dueDateLabel}
              </span>
            </div>

            {/* ==================================
                STATUS
            ================================== */}

            <span
              className={`text-xs font-medium ${
                completed
                  ? "rounded-full bg-success-bg px-2 py-0.5 text-success"
                  : isOverdue
                    ? "rounded-full bg-warning-bg px-2 py-0.5 text-warning"
                    : "text-muted-gray"
              }`}
            >
              {completed
                ? "Completed"
                : isOverdue
                  ? "Needs attention"
                  : "In progress"}
            </span>

          </div>

          {/* ==================================
              ACTIONS
          ================================== */}

          <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3.5 sm:pt-4">

            {/* EDIT */}

            <button
              type="button"
              onClick={() => onEdit(id)}
              aria-label={`Edit ${title}`}
              title="Edit task"
              className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-muted-gray transition active:scale-[0.98] hover:bg-primary-light hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 sm:min-h-0 sm:flex-none sm:justify-start sm:px-2.5 sm:py-1.5"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                className="h-4 w-4 shrink-0"
                aria-hidden="true"
              >
                <path
                  d="M12 20H21"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />

                <path
                  d="M16.5 3.5C17.3 2.7 18.7 2.7 19.5 3.5L20.5 4.5C21.3 5.3 21.3 6.7 20.5 7.5L9 19L4 20L5 15L16.5 3.5Z"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>

              Edit
            </button>

            {/* DELETE */}

            <button
              type="button"
              onClick={() => onDelete(id)}
              aria-label={`Delete ${title}`}
              title="Delete task"
              className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-muted-gray transition active:scale-[0.98] hover:bg-danger/10 hover:text-danger-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 focus-visible:ring-offset-1 sm:min-h-0 sm:flex-none sm:justify-start sm:px-2.5 sm:py-1.5"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                className="h-4 w-4 shrink-0"
                aria-hidden="true"
              >
                <path
                  d="M4 7H20"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />

                <path
                  d="M10 11V17M14 11V17"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />

                <path
                  d="M6 7L7 21H17L18 7M9 7V4H15V7"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>

              Delete
            </button>

          </div>
        </div>
      </div>
    </article>
  );
}