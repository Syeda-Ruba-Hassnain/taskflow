"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import Navbar from "@/components/Navbar";
import StatCard from "@/components/StatCard";
import TaskCard from "@/components/TaskCard";
import { Mic, Loader2 } from "lucide-react";
import VoiceControl, {
  VoiceControlHandle,
} from "@/components/VoiceControl";
import AITextControl from "@/components/AITextControl";
import Toast, {
  ToastType,
} from "@/components/Toast";
import { AIIntent } from "@/lib/types/ai";
import type { PendingAIAction } from "@/lib/types/ai-execution";

type Priority = "Low" | "Medium" | "High";

type Category = "Work" | "Personal" | "Study" | "Other";

type Filter =
  | "All"
  | "Pending"
  | "Completed";

type PriorityFilter =
  | "All"
  | "High"
  | "Medium"
  | "Low";

type CategoryFilter =
  | "All"
  | Category;

type DueFilter =
  | "All"
  | "Overdue"
  | "Today"
  | "Tomorrow"
  | "Upcoming";

type SortOption =
  | "Newest"
  | "Oldest"
  | "Priority"
  | "Due Date";

type Task = {
  id: number;
  title: string;
  description: string | null;
  category: Category;
  priority: Priority;
  completed: boolean;
  dueDate: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type AddFormDefaults = Partial<{
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  dueDate: string;
}>;

type ToastState = {
  id: number;
  message: string;
  type: ToastType;
  persistent?: boolean;
};

// ==================================
// DATE HELPERS
// ==================================

const getLocalDate = (date: Date) => {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
};

const getTaskDueDate = (
  dueDate: string | null
) => {
  if (!dueDate) {
    return null;
  }

  const dateOnly = dueDate.slice(0, 10);

  const [year, month, day] = dateOnly
    .split("-")
    .map(Number);

  if (!year || !month || !day) {
    return null;
  }

  const parsedDate = new Date(
    year,
    month - 1,
    day
  );

  if (
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return null;
  }

  return parsedDate;
};

const fetchTasks = async (): Promise<Task[]> => {
  const response = await fetch("/api/tasks");
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to load tasks.");
  }

  return data;
};

// Every request below throws a plain `new Error(...)` with an
// already-user-facing message when the server responds with a
// failure (`!response.ok`) — that's the only kind of thrown error
// meant to reach the user as-is. A request that fails before a
// response even comes back (e.g. the network is down) instead throws
// a browser-native TypeError, e.g. Chrome's `TypeError: Failed to
// fetch` — and a malformed response throws a SyntaxError parsing
// `response.json()`. Both are real errors but their messages are
// implementation-level, not written for users, so this always falls
// back to `fallback` for them instead of surfacing that raw text (or
// worse, having it read aloud by speakResponse).
export function getRequestErrorMessage(
  error: unknown,
  fallback: string
): string {
  return error instanceof Error &&
    !(error instanceof TypeError) &&
    !(error instanceof SyntaxError)
    ? error.message
    : fallback;
}

// ==================================
// FOCUS TRAP
// ==================================
//
// Keeps Tab/Shift+Tab cycling within an open modal instead of
// reaching the dashboard behind it, and moves focus to the first
// logical interactive element when the modal opens (either a
// specific initialFocusRef target, e.g. the task title input, or —
// when no such target applies, e.g. the delete modal — whichever
// focusable element comes first inside the dialog). Escape-to-close
// and focus restoration on close are handled separately (existing
// behaviour) - this only owns the "focus enters and can't leave
// while open" part.

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Words that signal a command targets a specific task action (create,
// find, rename, delete, complete...) rather than a pure view/filter
// change. See handleVoiceCommand for why this has to run before the
// local filter-keyword matching below it.
//
// "rename"/"change"/"edit" all matter here specifically: without them,
// a command like "Change Finish FYP to Study Report" gets misrouted —
// its NEW title ("Study Report") contains the filter keyword "study",
// so parseFilterCommand below would claim it as a category-filter
// command and the rename would never reach the AI at all.
export const TASK_ACTION_PATTERN =
  /\b(create|add|make|new task|rename|change|edit|delete|remove|duplicate|find|search|look for|summarize|complete|uncomplete|reopen|mark|move)\b/;

// After one of these succeeds, the affected task is worth bringing into
// view (see runAICommand's reveal-and-scroll block below) — the user
// asked a specific task to change and can't otherwise tell where it
// landed. create_task deliberately excluded: the user already knows
// what they just typed/said. delete_task is handled separately — the
// deleted task no longer exists to scroll to.
export const REVEAL_TASK_INTENTS: ReadonlySet<AIIntent> = new Set([
  AIIntent.UPDATE_TASK,
  AIIntent.CHANGE_PRIORITY,
  AIIntent.CHANGE_CATEGORY,
  AIIntent.COMPLETE_TASK,
  AIIntent.UNCOMPLETE_TASK,
]);

// Explicit confirm/cancel phrases recognized while a pendingAIAction
// exists (see handleVoiceCommand's interception at the top of the
// function). Matched against the FULL normalized command, not as a
// substring — so this never fires outside a pending-action context and
// never misfires on a longer sentence that merely contains "yes"
// somewhere in it. No word-substitution/normalization here — this is
// exact-phrase recognition of a fixed, deliberately short list, not
// speech correction.
export const PENDING_ACTION_AFFIRMATIVE_PHRASES: ReadonlySet<string> = new Set([
  "yes",
  "yeah",
  "yep",
  "yes please",
  "confirm",
  "do it",
  "go ahead",
]);

export const PENDING_ACTION_NEGATIVE_PHRASES: ReadonlySet<string> = new Set([
  "no",
  "cancel",
  "dont",
  "never mind",
  "stop",
]);

// Module scope (not a component-local const) specifically so it's
// directly unit-testable without rendering the component — no React
// state or closures involved, it's a pure text transform. Only ever
// used to build the string matched against
// PENDING_ACTION_AFFIRMATIVE_PHRASES/PENDING_ACTION_NEGATIVE_PHRASES
// and the local filter-command shortcuts in handleVoiceCommand.
//
// Deliberately limited to trim/lowercase/strip-punctuation — this is
// NOT speech correction (no word substitution, no guessing at
// mis-transcribed words) and must stay that way.
export const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.,!?"'’“”]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type PendingActionVoiceDecision = "confirm" | "cancel" | "replace";

/**
 * Pure decision function extracted from handleVoiceCommand's
 * interception so it's directly unit-testable: given a raw transcript
 * (voice OR text — both funnel through the same path), decides whether
 * it's an explicit confirm/cancel of a pending action, matched against
 * the FULL normalized command only (never a substring — "yes delete
 * the task" is a distinct string from "yes" and correctly falls
 * through to "replace", i.e. treated as a brand-new command).
 */
export function classifyPendingActionCommand(
  transcript: string
): PendingActionVoiceDecision {
  const command = normalizeText(transcript);

  if (PENDING_ACTION_AFFIRMATIVE_PHRASES.has(command)) {
    return "confirm";
  }

  if (PENDING_ACTION_NEGATIVE_PHRASES.has(command)) {
    return "cancel";
  }

  return "replace";
}

function useFocusTrap(
  containerRef: { current: HTMLElement | null },
  active: boolean,
  initialFocusRef?: { current: HTMLElement | null }
) {
  useEffect(() => {
    if (!active) {
      return;
    }

    const focusTimeout = window.setTimeout(() => {
      const container = containerRef.current;

      const target =
        initialFocusRef?.current ??
        container?.querySelector<HTMLElement>(
          FOCUSABLE_SELECTOR
        ) ??
        null;

      target?.focus();
    }, 100);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }

      const container = containerRef.current;

      if (!container) {
        return;
      }

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          FOCUSABLE_SELECTOR
        )
      );

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      const isInside =
        activeElement instanceof Node &&
        container.contains(activeElement);

      if (event.shiftKey) {
        if (!isInside || activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!isInside || activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener(
      "keydown",
      handleKeyDown
    );

    // Some controls (e.g. every field in the Add/Edit modal while a
    // save request is in flight) get `disabled` while they currently
    // hold focus. The browser resolves that by dropping focus to
    // <body> - outside the modal - regardless of Tab/Shift+Tab. If
    // that happens while this modal is still open, pull focus back
    // in immediately (to whatever's still focusable, or the dialog
    // container itself as a last resort) so it's never silently lost.
    const container = containerRef.current;

    const handleFocusOut = () => {
      window.setTimeout(() => {
        if (!containerRef.current) {
          return;
        }

        const activeElement = document.activeElement;

        const isInside =
          activeElement instanceof Node &&
          containerRef.current.contains(activeElement);

        if (isInside) {
          return;
        }

        const fallback =
          containerRef.current.querySelector<HTMLElement>(
            FOCUSABLE_SELECTOR
          );

        (fallback ?? containerRef.current).focus();
      }, 0);
    };

    container?.addEventListener(
      "focusout",
      handleFocusOut
    );

    return () => {
      window.clearTimeout(focusTimeout);

      document.removeEventListener(
        "keydown",
        handleKeyDown
      );

      container?.removeEventListener(
        "focusout",
        handleFocusOut
      );
    };
  }, [active, containerRef, initialFocusRef]);
}

// ==================================
// DASHBOARD
// ==================================

export default function Dashboard() {
  // ==================================
  // TASK STATE
  // ==================================

  const [tasks, setTasks] =
    useState<Task[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const enableVoiceFeedback = true;

  const speakResponse = (message: string) => {
    if (
      !enableVoiceFeedback ||
      typeof window === "undefined" ||
      !("speechSynthesis" in window)
    ) {
      return;
    }

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(
      new SpeechSynthesisUtterance(message)
    );
  };

  // ==================================
  // TOAST
  // ==================================

  const [toast, setToast] =
    useState<ToastState | null>(null);

  const showToast = useCallback(
    (
      message: string,
      type: ToastType = "success",
      persistent = false
    ) => {
      setToast({
        id: Date.now(),
        message,
        type,
        persistent,
      });
    },
    []
  );

  // ==================================
  // FORM
  // ==================================

  const [showForm, setShowForm] =
    useState(false);

  const [
    newTaskTitle,
    setNewTaskTitle,
  ] = useState("");

  const [
    newTaskDescription,
    setNewTaskDescription,
  ] = useState("");

  const [category, setCategory] =
    useState<Category>("Other");

  const [priority, setPriority] =
    useState<Priority>("Medium");

  const [dueDate, setDueDate] =
    useState("");

  const [
    editingTaskId,
    setEditingTaskId,
  ] = useState<number | null>(null);

  const [formError, setFormError] =
    useState("");

  // ==================================
  // SEARCH / FILTER / SORT
  // ==================================

  const [searchQuery, setSearchQuery] =
    useState("");

  const [filter, setFilter] =
    useState<Filter>("All");

  const [
    priorityFilter,
    setPriorityFilter,
  ] = useState<PriorityFilter>("All");

  const [
    categoryFilter,
    setCategoryFilter,
  ] = useState<CategoryFilter>("All");

  const [dueFilter, setDueFilter] =
    useState<DueFilter>("All");

  const [sortOption, setSortOption] =
    useState<SortOption>("Newest");

  const [highlightedTaskIds, setHighlightedTaskIds] =
    useState<number[]>([]);
  const [aiFilteredTaskIds, setAiFilteredTaskIds] =
    useState<number[] | null>(null);
  const [highlightQuery, setHighlightQuery] =
    useState("");
  const [searchBanner, setSearchBanner] =
    useState<string | null>(null);
  const [pendingScrollTaskId, setPendingScrollTaskId] =
    useState<number | null>(null);
  // How long an AI search/duplicate result stays highlighted/scrolled-to
  // before auto-clearing. A voice command's round trip alone can eat
  // several seconds before this highlight even appears — VoiceControl's
  // silence-timeout fallback alone waits up to 3s, on top of LLM and
  // database latency, on top of the "Command received"/result speech
  // synthesis a user naturally waits to finish before looking at the
  // screen. A short window here can expire before a human ever gets to
  // see the result, which looks identical to "the search silently
  // failed." This stays generous so that doesn't happen.
  const HIGHLIGHT_DURATION_MS = 15000;

  const taskCardRefs = useRef<
    Record<number, HTMLElement | null>
  >({});
  const highlightTimeoutRef = useRef<
    number | null
  >(null);

  // Identifies the most recently issued AI request. Voice and text
  // commands both funnel through runAICommand below, and nothing
  // stops two of them from being in flight at once (e.g. a duplicate
  // voice submission of the same utterance, or a second command sent
  // before an earlier one's response arrives). Each call captures its
  // own id and checks it against this ref after every await — if a
  // newer request has since started, this one's response is stale and
  // must not touch aiFilteredTaskIds/highlightedTaskIds/
  // pendingScrollTaskId, or it could clobber a newer, already-applied
  // result with an older one.
  const aiRequestIdRef = useRef(0);

  const clearSearchHighlights = () => {
    setHighlightedTaskIds([]);
    setAiFilteredTaskIds(null);
    setHighlightQuery("");
    setSearchBanner(null);

    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
  };

  const setTaskCardRef = (
    id: number,
    node: HTMLElement | null
  ) => {
    taskCardRefs.current[id] = node;
  };

  const scrollToTask = (id: number) => {
    const node = taskCardRefs.current[id];

    if (node) {
      node.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  };

  // Scrolling/focusing has to happen after React has actually
  // committed the render that puts the target TaskCard in the DOM —
  // calling scrollToTask() synchronously right after the setState
  // calls that trigger that render reads taskCardRefs before the ref
  // callback has run (stale for a filtered-out task, missing
  // entirely for one that was just created). Setting
  // pendingScrollTaskId and reacting to it here, keyed on the state
  // that actually changes what's rendered, guarantees the ref exists
  // by the time this effect body runs *in the common case*.
  //
  // As a bounded safety net for the rest of the cases (ref callbacks
  // for the *specific* target still pending attachment when this
  // passive effect runs, browser-scheduling variance, etc.), this
  // also polls across a few animation frames before giving up — never
  // an open-ended or arbitrary-duration timeout, just enough frames
  // to cover a genuine same-commit ref-attachment gap.
  useEffect(() => {
    if (pendingScrollTaskId === null) {
      return;
    }

    const targetId = pendingScrollTaskId;
    let cancelled = false;
    let frame: number | null = null;
    let attempt = 0;
    const MAX_ATTEMPTS = 30;

    const tryScroll = () => {
      if (cancelled) {
        return;
      }

      const node = taskCardRefs.current[targetId];

      if (node) {
        scrollToTask(targetId);
        node.focus();
        setPendingScrollTaskId(null);
        return;
      }

      attempt += 1;

      if (attempt >= MAX_ATTEMPTS) {
        return;
      }

      frame = requestAnimationFrame(tryScroll);
    };

    // First check runs synchronously — in the common case the ref is
    // already attached and this resolves immediately, with no extra
    // frame delay. Only a genuine gap falls through to rAF polling.
    tryScroll();

    return () => {
      cancelled = true;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [pendingScrollTaskId, tasks, aiFilteredTaskIds]);

  // ==================================
  // DELETE
  // ==================================

  const [
    taskToDelete,
    setTaskToDelete,
  ] = useState<Task | null>(null);
  // Mirrors resolvingPendingAction's role for the AI-driven delete
  // confirmation below — guards confirmDeleteTask against a rapid
  // double click firing two overlapping DELETE requests, and disables
  // both modal buttons for the same reason confirmPendingAIAction's
  // panel does: closing the modal mid-request would let the delete
  // still complete silently afterward, contradicting "Keep task".
  const [isDeletingTask, setIsDeletingTask] =
    useState(false);

  // ==================================
  // AI CONFIRMATION (voice/text-driven)
  // ==================================
  //
  // Deliberately separate state from taskToDelete above: the manual
  // delete button's flow (handleDeleteTask -> taskToDelete -> the
  // modal below -> confirmDeleteTask -> DELETE /api/tasks/:id) is
  // untouched by any of this. An AI-resolved danger action
  // (delete_task / delete_all_tasks) sets pendingAIAction instead, and
  // is confirmed/cancelled either by clicking its own modal below or
  // by an explicit "yes"/"no" voice/text reply — see
  // PENDING_ACTION_AFFIRMATIVE_PHRASES/PENDING_ACTION_NEGATIVE_PHRASES
  // and the interception at the top of handleVoiceCommand.
  const [pendingAIAction, setPendingAIAction] =
    useState<PendingAIAction | null>(null);

  // Imperative handle into VoiceControl (start/stop a listening session
  // without the user clicking the mic) and whether it's currently
  // listening — both exist solely to drive automatic confirmation
  // listening below and the "Listening for confirmation…" copy in the
  // modal; VoiceControl's own click-driven start/stop is untouched.
  const voiceControlRef = useRef<VoiceControlHandle>(null);
  const [voiceListening, setVoiceListening] = useState(false);

  // Confirmation panel state (T4 redesign) — together with
  // pendingAIAction, these fully describe what the ONE coherent
  // confirmation panel below should show at any moment: the pending
  // action itself, whether voice heard a "yes"/"no" yet (and which),
  // whether its own no-response timeout elapsed, and whether the
  // confirmed action is still being carried out. See the panel's own
  // JSX comment for exactly how these combine.
  const [voiceHeard, setVoiceHeard] =
    useState<"yes" | "no" | null>(null);
  const [confirmationTimedOut, setConfirmationTimedOut] =
    useState(false);
  const [resolvingPendingAction, setResolvingPendingAction] =
    useState(false);
  // Idempotency guard shared by confirmPendingAIAction/
  // cancelPendingAIAction: set the instant EITHER one starts handling
  // a pending action, checked by both, so the action executes exactly
  // once no matter how many confirm/cancel signals arrive (a voice
  // "yes" racing a button click, a trailing duplicate transcript,
  // etc.) — a ref, not state, so it's authoritative immediately rather
  // than after the next render. Reset only when a NEW pendingAIAction
  // appears (see the effect below).
  const pendingActionResolvedRef = useRef(false);

  // ==================================
  // REF
  // ==================================

  const taskInputRef =
    useRef<HTMLInputElement>(null);

  // Element that had focus right before each modal opened, so it can
  // be restored when the modal closes — otherwise a keyboard/screen
  // reader user loses their place once the dialog disappears.
  const formTriggerRef =
    useRef<HTMLElement | null>(null);

  const deleteTriggerRef =
    useRef<HTMLElement | null>(null);

  // Single close path for the delete-confirmation modal (cancel,
  // Escape, and a successful delete all go through this) so focus is
  // always restored to whatever opened it.
  const closeDeleteModal = () => {
    setTaskToDelete(null);
    deleteTriggerRef.current?.focus();
  };

  // Modal containers for the Tab/Shift+Tab focus trap — keeps
  // keyboard focus cycling within whichever dialog is open instead
  // of reaching the dashboard underneath.
  const formModalRef =
    useRef<HTMLDivElement>(null);

  const deleteModalRef =
    useRef<HTMLDivElement>(null);

  const pendingActionModalRef =
    useRef<HTMLDivElement>(null);

  useFocusTrap(
    formModalRef,
    showForm,
    taskInputRef
  );
  useFocusTrap(
    deleteModalRef,
    taskToDelete !== null
  );
  useFocusTrap(
    pendingActionModalRef,
    pendingAIAction !== null
  );

  // Automatic confirmation listening (BUG 2 / T7): a danger action
  // waiting on the user shouldn't ALSO require them to click the mic
  // before they can answer it by voice. Starts a short "listen for an
  // explicit yes/no reply" session the moment a confirmation appears,
  // and stops it (a safe no-op if it already stopped on its own — see
  // VoiceControl's stopListening) whenever that confirmation goes away
  // for any reason: a spoken yes/no, a typed reply, the Confirm/Cancel
  // buttons, or a brand-new command replacing it. startConfirmationListening
  // itself no-ops if a session is already active, so this can never
  // start a second SpeechRecognition session on top of a manual click.
  useEffect(() => {
    if (pendingAIAction === null) {
      return;
    }

    // NOTE: the previous confirmation's panel state (voiceHeard/
    // confirmationTimedOut/resolvingPendingAction/pendingActionResolvedRef)
    // is deliberately NOT reset here — setState directly inside an
    // effect body causes a cascading extra render
    // (react-hooks/set-state-in-effect), and pendingActionResolvedRef
    // being a plain ref would already be a stale-by-one-render source
    // of truth for this same reason. Instead every place that sets a
    // NEW pendingAIAction (currently just runAICommand's
    // needsConfirmation branch) resets that state itself, synchronously,
    // in the same event handler — see the comment there.
    const voiceControl = voiceControlRef.current;

    voiceControl?.startConfirmationListening();

    return () => {
      voiceControl?.stopListening();
    };
  }, [pendingAIAction]);

  // Confirmation-specific silence timeout (T5) elapsed with nothing
  // heard — see VoiceControl's onConfirmationTimeout prop and
  // VoiceSessionController's confirmationSafetyMs. Nothing is mutated
  // (the controller never calls onSubmit for an empty transcript) —
  // this only updates what the panel shows; pendingAIAction, and the
  // Cancel/Delete buttons, are untouched and still fully usable.
  const handleConfirmationTimeout = useCallback(() => {
    setConfirmationTimedOut(true);
  }, []);

  type FilterCommandResult =
    | { type: "clear" }
    | { type: "status"; value: Filter }
    | { type: "category"; value: CategoryFilter }
    | { type: "priority"; value: PriorityFilter }
    | { type: "due"; value: DueFilter }
    | { type: "sort"; value: SortOption }
    | { type: "none" };

  const parseFilterCommand = (
    command: string
  ): FilterCommandResult => {
    if (/(?:clear|reset|^all$|all tasks|show all)/.test(command)) {
      return { type: "clear" };
    }

    if (/(?:pending|incomplete)/.test(command)) {
      return { type: "status", value: "Pending" };
    }

    if (/(?:completed|finished|done)/.test(command)) {
      return { type: "status", value: "Completed" };
    }

    if (/(?:work|work tasks)/.test(command)) {
      return { type: "category", value: "Work" };
    }

    if (/(?:personal|personal tasks)/.test(command)) {
      return { type: "category", value: "Personal" };
    }

    if (/(?:study|study tasks)/.test(command)) {
      return { type: "category", value: "Study" };
    }

    if (/(?:other|other tasks)/.test(command)) {
      return { type: "category", value: "Other" };
    }

    if (/(?:high|high priority)/.test(command)) {
      return { type: "priority", value: "High" };
    }

    if (/(?:medium|medium priority)/.test(command)) {
      return { type: "priority", value: "Medium" };
    }

    if (/(?:low|low priority)/.test(command)) {
      return { type: "priority", value: "Low" };
    }

    if (/(?:overdue)/.test(command)) {
      return { type: "due", value: "Overdue" };
    }

    if (/(?:today)/.test(command)) {
      return { type: "due", value: "Today" };
    }

    if (/(?:tomorrow)/.test(command)) {
      return { type: "due", value: "Tomorrow" };
    }

    if (/(?:upcoming)/.test(command)) {
      return { type: "due", value: "Upcoming" };
    }

    if (/(?:sort by priority|sort priority|priority sort|sort.*priority)/.test(command)) {
      return { type: "sort", value: "Priority" };
    }

    if (/(?:sort by due date|sort due date|due date sort|sort.*due)/.test(command)) {
      return { type: "sort", value: "Due Date" };
    }

    if (/(?:newest)/.test(command)) {
      return { type: "sort", value: "Newest" };
    }

    if (/(?:oldest)/.test(command)) {
      return { type: "sort", value: "Oldest" };
    }

    return { type: "none" };
  };

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    filter !== "All" ||
    priorityFilter !== "All" ||
    categoryFilter !== "All" ||
    dueFilter !== "All" ||
    sortOption !== "Newest";

  const clearFilters = () => {
    setSearchQuery("");
    setFilter("All");
    setPriorityFilter("All");
    setCategoryFilter("All");
    setDueFilter("All");
    setSortOption("Newest");
  };

  // ==================================
  // LOAD TASKS
  // ==================================

  // `silent` is for the background reconciliation after an AI command
  // (see runAICommand) — the optimistic merge there already updates
  // local state immediately, so this is just eventual-consistency
  // cleanup and must not flash the loading skeleton or surface an error
  // toast over a result the user has already seen.
  const loadTasks = useCallback(
    async (silent = false) => {
      try {
        if (!silent) {
          setLoading(true);
        }
        const data = await fetchTasks();
        setTasks(data);
      } catch (error) {
        console.error(
          "Failed to fetch tasks:",
          error
        );

        if (!silent) {
          showToast(
            getRequestErrorMessage(
              error,
              "Could not load your tasks."
            ),
            "error"
          );
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [showToast]
  );

  useEffect(() => {
    // Runs once on mount. `loading` already defaults to true, so unlike
    // loadTasks() (reused by runAICommand for manual reloads) this doesn't
    // need to set it synchronously here - only the post-await outcome does.
    let ignore = false;

    fetchTasks()
      .then((data) => {
        if (!ignore) {
          setTasks(data);
        }
      })
      .catch((error) => {
        console.error(
          "Failed to fetch tasks:",
          error
        );

        if (!ignore) {
          showToast(
            getRequestErrorMessage(
              error,
              "Could not load your tasks."
            ),
            "error"
          );
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [showToast]);

  // ==================================
  // DATE VALUES
  // ==================================
  //
  // `today`/`tomorrow` are read as dependencies by the `visibleTasks`
  // useMemo below. A `new Date()` has a fresh object identity on every
  // render even when the calendar day hasn't changed, which previously
  // made that dependency array "change" on every render and defeated
  // the memoization (the filter/sort ran on every Dashboard re-render,
  // e.g. every toast). `todayKey` is a cheap primitive that's stable
  // for the whole day, so `today`/`tomorrow` now only get recomputed
  // (and only then invalidate `visibleTasks`) once the day actually
  // changes — same values, correctly memoized.

  const todayKey = new Date().toDateString();

  // `todayKey` is deliberately a re-computation trigger, not a value
  // read inside the callback above; see the comment block above for why.
  const today = useMemo(
    () => getLocalDate(new Date()),
    [todayKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const tomorrow = useMemo(() => {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    return date;
  }, [today]);

  // ==================================
  // STATISTICS
  // ==================================

  const totalTasks = tasks.length;

  // Phase 13 performance audit: these three previously re-scanned the
  // full `tasks` array on every Dashboard render (a search keystroke,
  // a voice-listening toggle, an unrelated toast — anything), unlike
  // visibleTasks below, which already only recomputes when its actual
  // inputs change. Wrapped the same way, for the same reason — the
  // filter predicates themselves are unchanged.
  const completedTasks = useMemo(
    () =>
      tasks.filter((task) => task.completed)
        .length,
    [tasks]
  );

  const pendingTasks = useMemo(
    () =>
      tasks.filter((task) => !task.completed)
        .length,
    [tasks]
  );

  const overdueTasks = useMemo(
    () =>
      tasks.filter((task) => {
        if (
          task.completed ||
          !task.dueDate
        ) {
          return false;
        }

        const taskDate =
          getTaskDueDate(task.dueDate);

        if (!taskDate) {
          return false;
        }

        return taskDate < today;
      }).length,
    [tasks, today]
  );

  // ==================================
  // FILTER / SEARCH / SORT
  // ==================================

  const visibleTasks = useMemo(() => {
    let result = [...tasks];

    // SEARCH

    const search = searchQuery
      .trim()
      .toLowerCase();

    if (search) {
      result = result.filter(
        (task) => {
          const titleMatches =
            task.title
              .toLowerCase()
              .includes(search);

          const descriptionMatches =
            task.description
              ?.toLowerCase()
              .includes(search) ??
            false;

          const categoryMatches =
            task.category
              .toLowerCase()
              .includes(search);

          return (
            titleMatches ||
            descriptionMatches ||
            categoryMatches
          );
        }
      );
    }

    // STATUS

    if (filter === "Pending") {
      result = result.filter(
        (task) => !task.completed
      );
    }

    if (filter === "Completed") {
      result = result.filter(
        (task) => task.completed
      );
    }

    // PRIORITY

    if (priorityFilter !== "All") {
      result = result.filter(
        (task) =>
          task.priority ===
          priorityFilter
      );
    }

    // CATEGORY

    if (categoryFilter !== "All") {
      result = result.filter(
        (task) =>
          task.category === categoryFilter
      );
    }

    // DUE DATE

    if (dueFilter !== "All") {
      result = result.filter((task) => {
        if (!task.dueDate) {
          return false;
        }

        const taskDate =
          getTaskDueDate(task.dueDate);

        if (!taskDate) {
          return false;
        }

        if (dueFilter === "Overdue") {
          return (
            !task.completed &&
            taskDate < today
          );
        }

        if (dueFilter === "Today") {
          return (
            taskDate.getTime() ===
            today.getTime()
          );
        }

        if (dueFilter === "Tomorrow") {
          return (
            taskDate.getTime() ===
            tomorrow.getTime()
          );
        }

        if (dueFilter === "Upcoming") {
          return taskDate > tomorrow;
        }

        return true;
      });
    }

    // NEWEST

    if (sortOption === "Newest") {
      result.sort((a, b) => {
        if (
          a.createdAt &&
          b.createdAt
        ) {
          return (
            new Date(
              b.createdAt
            ).getTime() -
            new Date(
              a.createdAt
            ).getTime()
          );
        }

        return b.id - a.id;
      });
    }

    // OLDEST

    if (sortOption === "Oldest") {
      result.sort((a, b) => {
        if (
          a.createdAt &&
          b.createdAt
        ) {
          return (
            new Date(
              a.createdAt
            ).getTime() -
            new Date(
              b.createdAt
            ).getTime()
          );
        }

        return a.id - b.id;
      });
    }

    // PRIORITY

    if (sortOption === "Priority") {
      const priorityOrder: Record<
        Priority,
        number
      > = {
        High: 3,
        Medium: 2,
        Low: 1,
      };

      result.sort(
        (a, b) =>
          priorityOrder[b.priority] -
          priorityOrder[a.priority]
      );
    }

    // DUE DATE

    if (sortOption === "Due Date") {
      result.sort((a, b) => {
        const aDate =
          getTaskDueDate(a.dueDate);

        const bDate =
          getTaskDueDate(b.dueDate);

        if (!aDate && !bDate) {
          return 0;
        }

        if (!aDate) {
          return 1;
        }

        if (!bDate) {
          return -1;
        }

        return (
          aDate.getTime() -
          bDate.getTime()
        );
      });
    }

    return result;
  }, [
    tasks,
    searchQuery,
    filter,
    priorityFilter,
    categoryFilter,
    dueFilter,
    sortOption,
    today,
    tomorrow,
  ]);

  // When the AI has resolved specific task(s) (search, duplicate
  // detection, "take me to it"), those tasks must show regardless of
  // whatever local search/status/category/priority/due filters the
  // user currently has active — intersecting with visibleTasks here
  // would silently hide the AI's result any time an active filter
  // didn't happen to include it, with no error and nothing on screen.
  const displayedTasks = useMemo(
    () =>
      aiFilteredTaskIds !== null
        ? tasks.filter((task) =>
            aiFilteredTaskIds.includes(task.id)
          )
        : visibleTasks,
    [aiFilteredTaskIds, tasks, visibleTasks]
  );

  // Initial focus on open (title input for the form modal, the first
  // focusable element for the delete modal) is handled by
  // useFocusTrap above, alongside the Tab/Shift+Tab containment.

  // ==================================
  // BODY SCROLL
  // ==================================

  useEffect(() => {
    if (
      showForm ||
      taskToDelete
    ) {
      document.body.style.overflow =
        "hidden";
    } else {
      document.body.style.overflow =
        "";
    }

    return () => {
      document.body.style.overflow =
        "";
    };
  }, [showForm, taskToDelete]);

  // ==================================
  // RESET FORM
  // ==================================

  const resetForm = () => {
    setNewTaskTitle("");
    setNewTaskDescription("");
    setCategory("Other");
    setPriority("Medium");
    setDueDate("");
    setEditingTaskId(null);
    setFormError("");
    setShowForm(false);

    // Return focus to whatever opened the modal (the "Add task"
    // button or a task's "Edit" button), since it disappears from
    // the DOM otherwise.
    formTriggerRef.current?.focus();
  };

  // Declared here (ahead of its sibling confirmPendingAIAction below,
  // and ahead of its own onClick usage on the AI-confirmation modal's
  // Cancel button) so the Escape-key effect just below can reference
  // it directly — every value it closes over (pendingAIAction,
  // pendingActionResolvedRef, voiceControlRef, showToast,
  // speakResponse) is already declared above this point.
  const cancelPendingAIAction = () => {
    const hadPendingAction = pendingAIAction !== null;

    if (!hadPendingAction || pendingActionResolvedRef.current) {
      return;
    }

    pendingActionResolvedRef.current = true;
    // Same as confirmPendingAIAction (below) — a button-driven cancel
    // while still listening must stop recognition cleanly too.
    voiceControlRef.current?.stopListening();

    setPendingAIAction(null);

    const message = "Okay, I won't do that.";
    showToast(message, "info");
    speakResponse(message);
  };

  // ==================================
  // ESCAPE KEY
  // ==================================

  useEffect(() => {
    const handleKeyDown = (
      event: KeyboardEvent
    ) => {
      if (event.key !== "Escape") {
        return;
      }

      if (saving) {
        return;
      }

      if (taskToDelete) {
        if (isDeletingTask) {
          return;
        }
        closeDeleteModal();
        return;
      }

      // Same Escape-to-dismiss support as the manual delete modal
      // above, and for the same reason: this panel is a role="dialog"
      // aria-modal="true" element, so Escape-closes is the expected
      // keyboard behavior. Mirrors the Cancel button exactly (same
      // cancelPendingAIAction call, same resolvingPendingAction guard
      // that already disables that button while the action is being
      // carried out) — no new behavior, just an additional way to
      // trigger the existing one.
      if (pendingAIAction) {
        if (resolvingPendingAction) {
          return;
        }
        cancelPendingAIAction();
        return;
      }

      if (showForm) {
        resetForm();
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
    // cancelPendingAIAction (like closeDeleteModal/resetForm above,
    // already omitted the same way) is a plain, non-memoized handler
    // — only the STATE values it and this effect read need to force a
    // re-subscription; the handler itself is read fresh via closure on
    // every keydown regardless of whether it's listed here. Listing it
    // would force wrapping it (and speakResponse, and every stable
    // ref/setter it in turn touches) in useCallback for no behavioral
    // benefit — a much larger, unrelated change this fix doesn't need.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showForm,
    taskToDelete,
    saving,
    isDeletingTask,
    pendingAIAction,
    resolvingPendingAction,
  ]);

  // ==================================
  // OPEN ADD FORM
  // ==================================

  const handleOpenAddForm = (
    defaults?: AddFormDefaults
  ) => {
    formTriggerRef.current =
      document.activeElement as HTMLElement;

    setEditingTaskId(null);
    setNewTaskTitle(
      defaults?.title ?? ""
    );
    setNewTaskDescription(
      defaults?.description ?? ""
    );
    setCategory(
      defaults?.category ?? "Other"
    );
    setPriority(
      defaults?.priority ?? "Medium"
    );
    setDueDate(
      defaults?.dueDate ?? ""
    );
    setFormError("");
    setShowForm(true);
  };

  // ==================================
  // VOICE COMMANDS
  // ==================================

  // /api/ai/intent already returns the exact task(s) it created/changed,
  // serialized the same way /api/tasks does — so a single/updated task can
  // be upserted straight into local state instead of refetching the whole
  // list from the database after every command. That refetch was a fully
  // serialized extra round trip sitting in front of the result toast on
  // every successful voice/text command.
  const mergeTaskIntoState = (task: Task) => {
    setTasks((currentTasks) =>
      currentTasks.some((t) => t.id === task.id)
        ? currentTasks.map((t) =>
            t.id === task.id ? task : t
          )
        : [task, ...currentTasks]
    );
  };

  // Brings a single AI-affected task into view: the same
  // aiFilteredTaskIds/highlightedTaskIds/pendingScrollTaskId mechanism
  // the search/duplicate-detection flow below already uses to make a
  // result visible regardless of active filters (aiFilteredTaskIds
  // overrides displayedTasks entirely — see its definition) and then
  // scroll to and briefly highlight it, without touching the user's
  // actual filter/search state. Takes the id directly from the AI's
  // response — never re-searches by title, since the title may have
  // just changed and the id is the one thing guaranteed stable across
  // a rename.
  const revealTask = (id: number) => {
    clearSearchHighlights();
    setAiFilteredTaskIds([id]);
    setHighlightedTaskIds([id]);

    highlightTimeoutRef.current = window.setTimeout(() => {
      clearSearchHighlights();
      setAiFilteredTaskIds(null);
    }, HIGHLIGHT_DURATION_MS);

    setPendingScrollTaskId(id);
  };

  // Executes an AI-resolved danger action the user has explicitly
  // confirmed (voice/text "yes", or clicking the confirmation panel
  // below). Sends the already-resolved PendingAIAction back verbatim —
  // POST /api/ai/intent's confirm branch executes it directly, never
  // touching Groq or re-interpreting anything.
  //
  // Idempotency (a second "yes", or a second click, must never fire
  // this twice) is enforced via pendingActionResolvedRef, checked and
  // set as the very first step — NOT by clearing pendingAIAction
  // upfront the way an earlier version of this function did. That
  // earlier approach closed the panel instantly on "yes", which is
  // exactly why T1 read as "very slow after hearing yes": the panel
  // disappeared immediately, then nothing visible happened for the
  // whole network+DB round trip a real delete requires (the NO path
  // has no such round trip at all — see cancelPendingAIAction — so it
  // was never affected). pendingAIAction, and this panel, now stay up
  // until the request actually settles, showing "Deleting..." for that
  // whole window instead of a UI that looks frozen.
  const confirmPendingAIAction = async () => {
    const action = pendingAIAction;

    if (!action || pendingActionResolvedRef.current) {
      return;
    }

    pendingActionResolvedRef.current = true;
    // Button-driven confirms need this too, not just voice ones — see
    // the "manual button while listening" requirement (T5/tests 8-9).
    // A no-op if the confirmation session already stopped itself.
    voiceControlRef.current?.stopListening();
    setResolvingPendingAction(true);

    showToast("Thinking...", "info", true);

    try {
      const response = await fetch("/api/ai/intent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirm: action }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Sorry, I could not complete that action."
        );
      }

      if (action.intent === AIIntent.DELETE_TASK) {
        const deletedId = (data.result as Task | undefined)?.id ?? action.taskId;

        setTasks((currentTasks) =>
          currentTasks.filter((task) => task.id !== deletedId)
        );

        if (editingTaskId === deletedId) {
          resetForm();
        }
      } else if (action.intent === AIIntent.DELETE_ALL_TASKS) {
        const deletedIds = Array.isArray(data.result)
          ? (data.result as Task[]).map((task) => task.id)
          : action.taskIds;

        setTasks((currentTasks) =>
          currentTasks.filter(
            (task) => !deletedIds.includes(task.id)
          )
        );

        clearSearchHighlights();
        setAiFilteredTaskIds(null);

        if (
          editingTaskId !== null &&
          deletedIds.includes(editingTaskId)
        ) {
          resetForm();
        }
      }

      setPendingAIAction(null);

      showToast(data.message, "success");
      speakResponse(data.message);
    } catch (error) {
      setPendingAIAction(null);

      const message = getRequestErrorMessage(
        error,
        "Sorry, I could not complete that action."
      );

      showToast(message, "error");
      speakResponse(message);
    } finally {
      setResolvingPendingAction(false);
      setVoiceHeard(null);
    }
  };

  // Most commands execute immediately through the backend. Destructive
  // ones (delete_task/delete_all_tasks) instead come back with
  // needsConfirmation — the backend has already resolved the target(s)
  // but deliberately hasn't mutated anything yet — and an unclear/
  // ambiguous/low-confidence one comes back with needsClarification.
  // Returns whether the command succeeded, so callers (voice and text
  // input alike) can decide what to do next — e.g. AITextControl only
  // clears its input once the command it sent actually went through.
  const runAICommand = async (
    transcript: string
  ): Promise<boolean> => {
    const requestId = ++aiRequestIdRef.current;
    const isSuperseded = () =>
      aiRequestIdRef.current !== requestId;

    // "Thinking..." must stay up for the whole request, not a fixed
    // duration — a fixed timer can outrun a slow request and leave the
    // user looking at a UI with no indication anything is still
    // happening. It's always replaced below by a result/error toast
    // once the request actually settles.
    showToast("Thinking...", "info", true);

    try {
      const response = await fetch("/api/ai/intent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ transcript }),
      });

      const data = await response.json();

      // A newer command was issued while this one was still in
      // flight — its response, whatever it turns out to be, must not
      // touch UI state that the newer request already owns.
      if (isSuperseded()) {
        return true;
      }

      if (!response.ok) {
        throw new Error(
          data.error || "Sorry, I could not process that."
        );
      }

      if (data.needsConfirmation && data.action) {
        // Fresh confirmation panel — reset any state left over from a
        // previous one (see the auto-listen effect's own comment for
        // why this lives here and not in that effect).
        pendingActionResolvedRef.current = false;
        setVoiceHeard(null);
        setConfirmationTimedOut(false);
        setResolvingPendingAction(false);

        setPendingAIAction(data.action as PendingAIAction);

        showToast(data.message, "info");
        speakResponse(data.message);
        return true;
      }

      if (data.needsClarification) {
        // Nothing was resolved into a pending action and nothing
        // mutated — just relay the question. The user's next command
        // is processed as a fresh, ordinary command, not a special
        // "answer" the app has to track.
        showToast(data.message, "info");
        speakResponse(data.message);
        return true;
      }

      const isDuplicate = Boolean(
        data.duplicate && data.existingTaskId
      );

      if (isDuplicate) {
        const taskId = data.existingTaskId as number;

        if (data.existingTask) {
          mergeTaskIntoState(data.existingTask as Task);
        }

        clearSearchHighlights();
        setAiFilteredTaskIds([taskId]);
        setHighlightedTaskIds([taskId]);
        setHighlightQuery(
          typeof data.existingTask?.title === "string"
            ? data.existingTask.title
            : ""
        );
        setSearchBanner(data.message);

        if (highlightTimeoutRef.current !== null) {
          window.clearTimeout(highlightTimeoutRef.current);
        }

        highlightTimeoutRef.current = window.setTimeout(
          () => {
            clearSearchHighlights();
            setAiFilteredTaskIds(null);
          },
          HIGHLIGHT_DURATION_MS
        );

        setPendingScrollTaskId(taskId);

        showToast(data.message);
        speakResponse(data.message);
        return true;
      }

      // LIST/SEARCH/SUMMARIZE intents return an array — a read-only view
      // over existing tasks, nothing to merge. Every other successful
      // intent that reaches here (create/update/complete/uncomplete/
      // priority/category) returns the single task it changed.
      if (data.result && !Array.isArray(data.result)) {
        const updatedTask = data.result as Task;

        mergeTaskIntoState(updatedTask);
        // Best-effort reconciliation after the fact — the merge above
        // already reflects the change immediately, so this doesn't block
        // the result message and its failure isn't user-facing.
        void loadTasks(true);

        if (REVEAL_TASK_INTENTS.has(data.intent)) {
          revealTask(updatedTask.id);
        }
      }

      showToast(data.message);
      speakResponse(data.message);

      if (Array.isArray(data.result) && data.result.length > 0) {
        const ids = data.result.map(
          (task: Task) => task.id
        );

        clearSearchHighlights();
        setAiFilteredTaskIds(ids);
        setHighlightedTaskIds(ids);
        setHighlightQuery(
          typeof data.result[0]?.title === "string"
            ? data.result[0].title
            : ""
        );
        setSearchBanner(data.message);

        if (highlightTimeoutRef.current !== null) {
          window.clearTimeout(highlightTimeoutRef.current);
        }

        highlightTimeoutRef.current = window.setTimeout(
          () => {
            clearSearchHighlights();
            setAiFilteredTaskIds(null);
          },
          HIGHLIGHT_DURATION_MS
        );

        setPendingScrollTaskId(ids[0]);
      }

      return true;
    } catch (error) {
      if (isSuperseded()) {
        return false;
      }

      const message = getRequestErrorMessage(
        error,
        "Sorry, I could not process that."
      );

      showToast(message, "error");
      speakResponse(message);

      return false;
    }
  };

  const handleVoiceCommand = async (
    transcript: string
  ): Promise<boolean> => {
    const command = normalizeText(transcript);

    // Active ONLY while a danger action is genuinely waiting on
    // the user — see pendingAIAction's own comment. classifyPending-
    // ActionCommand is the same pure function the tests exercise
    // directly, so there's no risk of the tested logic and the actual
    // runtime behavior drifting apart.
    if (pendingAIAction) {
      const decision = classifyPendingActionCommand(transcript);

      if (decision === "confirm") {
        setVoiceHeard("yes");
        await confirmPendingAIAction();
        return true;
      }

      if (decision === "cancel") {
        setVoiceHeard("no");
        cancelPendingAIAction();
        return true;
      }

      // Any other command replaces the pending action rather than
      // leaving a danger action waiting invisibly for a "yes"
      // that might arrive turns later, out of context — see the
      // pending-action-replacement requirement this satisfies. No
      // cancellation toast here (unlike an explicit "no") since the
      // user is actively issuing a new command, not rejecting the old
      // one.
      setPendingAIAction(null);
    }

    const voiceResponse = (
      message: string,
      type: ToastType = "success"
    ) => {
      showToast(message, type);
      speakResponse(message);
    };

    // Filter/sort/clear and the local stats readout are pure client-side
    // view state — there's no matching AIIntent for them, so they stay
    // local instead of round-tripping through the backend.
    //
    // parseFilterCommand matches on loose keywords ("completed",
    // "pending", "high", "today"...) that also show up constantly
    // inside genuine task commands — "mark it completed", "...priority
    // high", "move it back to pending". Without this guard, those
    // commands were silently swallowed here (e.g. setting the status
    // filter to "Completed" and never calling the AI at all) instead of
    // ever reaching runAICommand. A command naming a specific task
    // action always wins over the local filter shortcut.
    const isTaskActionCommand = TASK_ACTION_PATTERN.test(command);

    const filter = isTaskActionCommand
      ? ({ type: "none" } as const)
      : parseFilterCommand(command);

    const statsMatch = command.match(
      /how\s+many(?:\s+(pending|completed|overdue))?(?:\s+tasks?)?/
    );

    if (statsMatch) {
      const type = statsMatch[1];
      const message =
        type === "pending"
          ? `You have ${pendingTasks} pending tasks.`
          : type === "completed"
          ? `You have ${completedTasks} completed tasks.`
          : type === "overdue"
          ? `You have ${overdueTasks} overdue tasks.`
          : `You have ${totalTasks} tasks.`;

      voiceResponse(message);
      return true;
    }

    if (filter.type === "clear") {
      clearFilters();
      voiceResponse("Filters cleared.");
      return true;
    }

    if (filter.type === "status") {
      setFilter(filter.value);
      voiceResponse(
        `Showing ${filter.value.toLowerCase()} tasks.`
      );
      return true;
    }

    if (filter.type === "category") {
      setCategoryFilter(filter.value);
      voiceResponse(
        `Showing ${filter.value.toLowerCase()} tasks.`
      );
      return true;
    }

    if (filter.type === "priority") {
      setPriorityFilter(filter.value);
      voiceResponse(
        `Showing ${filter.value.toLowerCase()} priority tasks.`
      );
      return true;
    }

    if (filter.type === "due") {
      setDueFilter(filter.value);
      voiceResponse(
        `Showing ${filter.value.toLowerCase()} tasks.`
      );
      return true;
    }

    if (filter.type === "sort") {
      setSortOption(filter.value);
      voiceResponse(
        `Sorted by ${filter.value.toLowerCase()}.`
      );
      return true;
    }

    // Everything else (create/search/list/edit/delete/complete/
    // uncomplete/priority/category) is routed to the AI backend.
    return await runAICommand(transcript);
  };

  // ==================================
  // SAVE TASK
  // ==================================

  const handleSaveTask = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    const cleanTitle =
      newTaskTitle.trim();

    const cleanDescription =
      newTaskDescription.trim();

    if (!cleanTitle) {
      setFormError(
        "Please enter a task title."
      );

      taskInputRef.current?.focus();

      return;
    }

    try {
      setSaving(true);
      setFormError("");

      // EDIT

      if (editingTaskId !== null) {
        const response = await fetch(
          `/api/tasks/${editingTaskId}`,
          {
            method: "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              title: cleanTitle,
              description:
                cleanDescription,
              category,
              priority,
              dueDate,
            }),
          }
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "Failed to update task."
          );
        }

        setTasks(
          (currentTasks) =>
            currentTasks.map(
              (task) =>
                task.id ===
                editingTaskId
                  ? data
                  : task
            )
        );

        resetForm();

        showToast(
          "Task updated successfully.",
          "success"
        );

        return;
      }

      // CREATE

      const response = await fetch(
        "/api/tasks",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            title: cleanTitle,
            description:
              cleanDescription,
            category,
            priority,
            dueDate,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to create task."
        );
      }

      setTasks(
        (currentTasks) => [
          data,
          ...currentTasks,
        ]
      );

      resetForm();

      showToast(
        "Task created successfully.",
        "success"
      );
    } catch (error) {
      console.error(
        "Failed to save task:",
        error
      );

      const message = getRequestErrorMessage(
        error,
        "Failed to save task."
      );

      setFormError(message);

      showToast(
        message,
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  // ==================================
  // EDIT TASK
  // ==================================

  const handleEditTask = (
    id: number
  ) => {
    const taskToEdit = tasks.find(
      (task) => task.id === id
    );

    if (!taskToEdit) {
      showToast(
        "Could not find that task.",
        "error"
      );

      return;
    }

    formTriggerRef.current =
      document.activeElement as HTMLElement;

    setEditingTaskId(
      taskToEdit.id
    );

    setNewTaskTitle(
      taskToEdit.title
    );

    setNewTaskDescription(
      taskToEdit.description ?? ""
    );

    setCategory(
      taskToEdit.category
    );

    setPriority(
      taskToEdit.priority
    );

    setDueDate(
      taskToEdit.dueDate
        ? taskToEdit.dueDate.slice(
            0,
            10
          )
        : ""
    );

    setFormError("");
    setShowForm(true);
  };

  // ==================================
  // TOGGLE
  // ==================================

  const handleToggleTask = async (
    id: number
  ) => {
    const taskToUpdate =
      tasks.find(
        (task) => task.id === id
      );

    if (!taskToUpdate) {
      showToast(
        "Could not find that task.",
        "error"
      );

      return;
    }

    try {
      const response = await fetch(
        `/api/tasks/${id}`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            completed:
              !taskToUpdate.completed,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to update task."
        );
      }

      setTasks(
        (currentTasks) =>
          currentTasks.map(
            (task) =>
              task.id === id
                ? data
                : task
          )
      );

      showToast(
        data.completed
          ? "Task marked as completed."
          : "Task moved back to pending.",
        "success"
      );
    } catch (error) {
      console.error(
        "Failed to update task:",
        error
      );

      showToast(
        getRequestErrorMessage(
          error,
          "Could not update the task."
        ),
        "error"
      );
    }
  };

  // ==================================
  // DELETE
  // ==================================

  const handleDeleteTask = (
    id: number
  ) => {
    const task = tasks.find(
      (task) => task.id === id
    );

    if (task) {
      deleteTriggerRef.current =
        document.activeElement as HTMLElement;

      setTaskToDelete(task);
      return;
    }

    showToast(
      "Could not find that task.",
      "error"
    );
  };

  const confirmDeleteTask =
    async () => {
      if (!taskToDelete || isDeletingTask) {
        return;
      }

      const deletingTask =
        taskToDelete;

      setIsDeletingTask(true);

      try {
        const response =
          await fetch(
            `/api/tasks/${deletingTask.id}`,
            {
              method: "DELETE",
            }
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "Failed to delete task."
          );
        }

        setTasks(
          (currentTasks) =>
            currentTasks.filter(
              (task) =>
                task.id !==
                deletingTask.id
            )
        );

        if (
          editingTaskId ===
          deletingTask.id
        ) {
          resetForm();
        }

        closeDeleteModal();

        showToast(
          "Task deleted successfully.",
          "success"
        );
      } catch (error) {
        console.error(
          "Failed to delete task:",
          error
        );

        showToast(
          getRequestErrorMessage(
            error,
            "Could not delete the task."
          ),
          "error"
        );
      } finally {
        setIsDeletingTask(false);
      }
    };

  // Single derivation of what the confirmation panel's voice-status
  // line shows (T4) — priority order matches how these states actually
  // resolve in practice: once voice has heard an answer, that's the
  // most specific/true thing to say regardless of whether listening
  // technically stopped yet; a timeout only means anything if nothing
  // was heard; "still listening" only applies if none of the above
  // happened yet. Exactly one of these is ever shown — this is the
  // ONE place voice status renders inside the confirmation panel (see
  // VoiceControl's own confirmationActive-suppressed boxes, which
  // deliberately stay quiet during a pending confirmation so nothing
  // competes with this).
  const confirmationVoiceStatus = resolvingPendingAction
    ? { mode: "busy" as const, text: "Deleting…" }
    : voiceHeard === "yes"
    ? { mode: "heard" as const, text: "Heard: “yes”" }
    : voiceHeard === "no"
    ? { mode: "heard" as const, text: "Heard: “no” — cancelled." }
    : confirmationTimedOut
    ? {
        mode: "timeout" as const,
        text: "Didn't hear a response. Use the buttons below, or try again.",
      }
    : voiceListening
    ? { mode: "listening" as const, text: "Listening…" }
    : {
        mode: "idle" as const,
        text: "You can also say “yes” or “no”.",
      };

  // ==================================
  // PAGE
  // ==================================

  return (
    <main className="min-h-screen overflow-x-hidden bg-canvas">
      <Navbar />

      <div className="mx-auto w-full max-w-7xl px-4 pb-10 pt-6 sm:px-6 sm:pb-12 sm:pt-8 lg:px-8 lg:pb-16 lg:pt-10">

        {/* WORKSPACE / GREETING — its own full-width block, never
            squeezed into a column beside anything else. Fixes the
            narrow/half-screen layout bug where this used to sit in a
            flex row next to the AI command controls and lose the
            width fight. */}

        <section className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary sm:text-sm sm:normal-case sm:tracking-normal">
            Workspace
          </p>

          <h1 className="mt-1 text-2xl font-bold tracking-tight text-charcoal sm:text-3xl lg:text-4xl">
            Your tasks
          </h1>

          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-gray sm:text-base">
            Keep track of what needs your
            attention and stay focused on what
            matters.
          </p>
        </section>

        {/* AI COMMAND AREA + ADD TASK — the central interaction point,
            given its own row below the greeting so it always has the
            full container width to reflow in, at every breakpoint. */}

        <section className="mt-5 sm:mt-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            {/*
              Deliberately NOT elevated above the modal overlays below
              (form/delete/pendingAIAction are all `fixed inset-0 z-50`)
              — an earlier version raised this to z-[60] so it stayed
              clickable while a modal was open, but that made the mic
              button, text input, Send button, and shortcut hint
              visibly float on top of/through every modal's backdrop
              (the reported "scattered"/overlapping UI). At default
              stacking, the backdrop now covers this widget exactly
              like the rest of the page whenever any modal is open,
              matching how useFocusTrap already made the text input
              unreachable by keyboard in that state anyway. Nothing
              voice-related actually depended on the elevation:
              automatic confirmation listening starts imperatively via
              voiceControlRef regardless of DOM stacking, a manual mic
              click during an active/starting confirmation session is
              already a deliberate no-op (see activeConfirmationRef in
              VoiceControl), and the Ctrl+Shift+V shortcut is a global
              key listener, not a DOM click.
            */}
            {/* relative: anchors VoiceControl's "Heard"/error status
                strip (absolutely positioned — see VoiceControl's own
                comment on it) to the full width of this card, floating
                below it instead of pushing this card's — and every
                sibling's, including the Add task button next to it via
                lg:items-stretch — height around as voice state
                changes. */}
            <div className="relative min-w-0 flex-1 rounded-2xl border border-primary-light bg-white p-3 shadow-sm transition focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/20 sm:p-3.5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <VoiceControl
                  ref={voiceControlRef}
                  onTranscript={handleVoiceCommand}
                  confirmationActive={pendingAIAction !== null}
                  onListeningChange={setVoiceListening}
                  onConfirmationTimeout={handleConfirmationTimeout}
                />

                <div className="hidden h-9 w-px shrink-0 bg-primary-light sm:block" />

                <AITextControl onSubmit={handleVoiceCommand} />
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleOpenAddForm()}
              className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-90 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 lg:w-auto"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path
                  d="M12 5V19M5 12H19"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>

              Add task
            </button>
          </div>
        </section>

        {/* STATISTICS */}

        {/* mt-8/sm:mt-10 (bumped from mt-6/sm:mt-8) matches the same
            gap the Tasks section below uses relative to Stats — a
            consistent "major section to major section" rhythm — and
            not incidentally gives the AI card's floating Heard/error
            status strip (see VoiceControl) more headroom to clear
            before it would ever reach this row. */}
        <section className="mt-8 grid grid-cols-2 gap-3 sm:mt-10 sm:gap-4 lg:grid-cols-4">

          <StatCard
            title="Total Tasks"
            value={totalTasks}
          />

          <StatCard
            title="Completed"
            value={completedTasks}
          />

          <StatCard
            title="Pending"
            value={pendingTasks}
          />

          <StatCard
            title="Overdue"
            value={overdueTasks}
          />

        </section>

        {/* TASKS */}

        <section className="mt-8 sm:mt-10">

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">

            <div>
              <h2 className="text-lg font-bold tracking-tight text-charcoal sm:text-xl">
                My tasks
              </h2>

              <p className="mt-1 text-xs text-muted-gray sm:text-sm">
                {hasActiveFilters
                  ? `${visibleTasks.length} of ${tasks.length} ${
                      tasks.length === 1
                        ? "task"
                        : "tasks"
                    } shown`
                  : `${tasks.length} ${
                      tasks.length === 1
                        ? "task"
                        : "tasks"
                    }`}
              </p>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="w-fit text-xs font-semibold text-primary transition hover:text-charcoal sm:text-sm"
              >
                Clear filters
              </button>
            )}

          </div>

          {/* SEARCH + FILTERS */}

          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:mt-5 sm:p-4">

            <div className="relative">

              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-gray"
                aria-hidden="true"
              >
                <circle
                  cx="11"
                  cy="11"
                  r="7"
                  strokeWidth="1.8"
                />

                <path
                  d="M16.5 16.5L21 21"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>

              <input
                type="search"
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={(event) => {
                  clearSearchHighlights();
                  setSearchQuery(
                    event.target.value
                  );
                }}
                className="min-h-11 w-full rounded-full border border-gray-200 bg-gray-50/60 py-2.5 pl-10 pr-4 text-base text-charcoal outline-none transition placeholder:text-muted-gray focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/20 sm:text-sm"
              />

            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">

              {/* STATUS */}

              <div>
                <p className="mb-1.5 text-xs font-semibold text-muted-gray">
                  Status
                </p>

                <div className="grid min-h-11 grid-cols-3 rounded-full bg-primary-light p-1">

                  {(
                    [
                      "All",
                      "Pending",
                      "Completed",
                    ] as Filter[]
                  ).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() =>
                        setFilter(option)
                      }
                      className={`rounded-full px-2 text-xs font-semibold transition ${
                        filter === option
                          ? "bg-primary text-white shadow-sm"
                          : "text-muted-gray hover:text-primary"
                      }`}
                    >
                      {option}
                    </button>
                  ))}

                </div>
              </div>

              {/* CATEGORY */}

              <div>
                <label
                  htmlFor="category-filter"
                  className="mb-1.5 block text-xs font-semibold text-muted-gray"
                >
                  Category
                </label>

                <select
                  id="category-filter"
                  value={categoryFilter}
                  onChange={(event) =>
                    setCategoryFilter(
                      event.target
                        .value as CategoryFilter
                    )
                  }
                  className="min-h-11 w-full rounded-full border border-gray-200 bg-white px-3.5 text-sm font-medium text-muted-gray outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/20"
                >
                  <option value="All">
                    All categories
                  </option>

                  <option value="Work">
                    Work
                  </option>

                  <option value="Personal">
                    Personal
                  </option>

                  <option value="Study">
                    Study
                  </option>

                  <option value="Other">
                    Other
                  </option>
                </select>
              </div>

              {/* PRIORITY */}

              <div>
                <label
                  htmlFor="priority-filter"
                  className="mb-1.5 block text-xs font-semibold text-muted-gray"
                >
                  Priority
                </label>

                <select
                  id="priority-filter"
                  value={priorityFilter}
                  onChange={(event) =>
                    setPriorityFilter(
                      event.target
                        .value as PriorityFilter
                    )
                  }
                  className="min-h-11 w-full rounded-full border border-gray-200 bg-white px-3.5 text-sm font-medium text-muted-gray outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/20"
                >
                  <option value="All">
                    All priorities
                  </option>

                  <option value="High">
                    High priority
                  </option>

                  <option value="Medium">
                    Medium priority
                  </option>

                  <option value="Low">
                    Low priority
                  </option>
                </select>
              </div>

              {/* DUE */}

              <div>
                <label
                  htmlFor="due-filter"
                  className="mb-1.5 block text-xs font-semibold text-muted-gray"
                >
                  Due date
                </label>

                <select
                  id="due-filter"
                  value={dueFilter}
                  onChange={(event) =>
                    setDueFilter(
                      event.target
                        .value as DueFilter
                    )
                  }
                  className="min-h-11 w-full rounded-full border border-gray-200 bg-white px-3.5 text-sm font-medium text-muted-gray outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/20"
                >
                  <option value="All">
                    All dates
                  </option>

                  <option value="Overdue">
                    Overdue
                  </option>

                  <option value="Today">
                    Due today
                  </option>

                  <option value="Tomorrow">
                    Due tomorrow
                  </option>

                  <option value="Upcoming">
                    Upcoming
                  </option>
                </select>
              </div>

              {/* SORT */}

              <div>
                <label
                  htmlFor="task-sort"
                  className="mb-1.5 block text-xs font-semibold text-muted-gray"
                >
                  Sort by
                </label>

                <select
                  id="task-sort"
                  value={sortOption}
                  onChange={(event) =>
                    setSortOption(
                      event.target
                        .value as SortOption
                    )
                  }
                  className="min-h-11 w-full rounded-full border border-gray-200 bg-white px-3.5 text-sm font-medium text-muted-gray outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/20"
                >
                  <option value="Newest">
                    Newest first
                  </option>

                  <option value="Oldest">
                    Oldest first
                  </option>

                  <option value="Due Date">
                    Due date
                  </option>

                  <option value="Priority">
                    Priority
                  </option>
                </select>
              </div>

            </div>
          </div>

          {searchBanner && (
            <div className="mt-4 rounded-2xl border border-primary-light bg-primary-light px-4 py-3 text-sm text-charcoal shadow-sm">
              {searchBanner}
            </div>
          )}

          {/* LOADING */}
          {/*
            Skeleton rows instead of a plain "Loading..." message —
            matches the animate-pulse pattern already used for
            settings/page.tsx's own loading state, and roughly mirrors
            a TaskCard's shape so the layout doesn't shift once the
            real cards render in.
          */}

          {loading && (
            <div
              role="status"
              aria-label="Loading your tasks"
              className="mt-5 space-y-3"
            >
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="animate-pulse rounded-2xl border border-gray-200 bg-white p-4 sm:p-5"
                >
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-gray-200 sm:h-6 sm:w-6" />

                    <div className="min-w-0 flex-1 space-y-2.5">
                      <div className="h-4 w-2/3 rounded bg-gray-200" />
                      <div className="h-3 w-1/3 rounded bg-gray-100" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TASK LIST */}

          {!loading &&
            displayedTasks.length > 0 && (
              <div className="mt-5 space-y-3">

                {displayedTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      id={task.id}
                      title={task.title}
                      description={
                        task.description
                      }
                      category={
                        task.category
                      }
                      priority={
                        task.priority
                      }
                      completed={
                        task.completed
                      }
                      dueDate={
                        task.dueDate ?? ""
                      }
                      onToggle={
                        handleToggleTask
                      }
                      onDelete={
                        handleDeleteTask
                      }
                      onEdit={
                        handleEditTask
                      }
                      isHighlighted={
                        highlightedTaskIds.includes(
                          task.id
                        )
                      }
                      highlightTokens={
                        highlightQuery
                          .trim()
                          .split(/\s+/)
                          .filter(Boolean)
                      }
                      setCardRef={setTaskCardRef}
                    />
                  )
                )}

              </div>
            )}

          {/* EMPTY */}

          {!loading &&
            displayedTasks.length === 0 && (
              <div className="mt-5 rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-12 text-center">

                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-light text-primary">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    className="h-6 w-6"
                    aria-hidden="true"
                  >
                    <path
                      d="M9 11L11 13L15 9"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    <path
                      d="M5 4H19C20.1 4 21 4.9 21 6V20C21 21.1 20.1 22 19 22H5C3.9 22 3 21.1 3 20V6C3 4.9 3.9 4 5 4Z"
                      strokeWidth="1.8"
                    />
                  </svg>
                </div>

                <h3 className="mt-4 font-semibold text-charcoal">
                  {hasActiveFilters
                    ? "No tasks match your filters"
                    : "Your task list is empty"}
                </h3>

                <p className="mt-2 text-sm text-muted-gray">
                  {hasActiveFilters
                    ? "Try changing or clearing your current filters."
                    : "Create your first task to get started."}
                </p>

                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-5 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-charcoal transition hover:bg-gray-50"
                  >
                    Clear filters
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleOpenAddForm()}
                    className="mt-5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-90"
                  >
                    Create a task
                  </button>
                )}

              </div>
            )}

        </section>
      </div>

      {/* ==================================
          ADD / EDIT MODAL
      ================================== */}

      {showForm && (
        <div
          ref={formModalRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/40 backdrop-blur-[2px] sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-modal-title"
        >
          <div className="max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-xl sm:rounded-2xl">

            {/* MODAL HEADER */}

            <div className="flex items-start justify-between px-5 pb-4 pt-5 sm:px-6 sm:pt-6">

              <div>
                <h2
                  id="task-modal-title"
                  className="text-xl font-bold tracking-tight text-charcoal"
                >
                  {editingTaskId !== null
                    ? "Edit task"
                    : "Create task"}
                </h2>

                <p className="mt-1 text-sm text-muted-gray">
                  {editingTaskId !== null
                    ? "Make changes to your task."
                    : "Add something to your task list."}
                </p>
              </div>

              <button
                type="button"
                onClick={resetForm}
                disabled={saving}
                aria-label="Close task form"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl leading-none text-muted-gray transition hover:bg-primary-light hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed"
              >
                ×
              </button>

            </div>

            {/* FORM */}

            <form
              onSubmit={handleSaveTask}
              className="px-5 pb-5 sm:px-6 sm:pb-6"
            >

              {/* TITLE */}

              <div>
                <label
                  htmlFor="task-title"
                  className="mb-2 block text-sm font-semibold text-charcoal"
                >
                  What needs to be done?
                </label>

                <input
                  ref={taskInputRef}
                  id="task-title"
                  type="text"
                  value={newTaskTitle}
                  disabled={saving}
                  onChange={(event) => {
                    setNewTaskTitle(
                      event.target.value
                    );

                    setFormError("");
                  }}
                  placeholder="e.g. Finish project report"
                  className={`min-h-11 w-full rounded-xl border bg-white px-4 text-base text-charcoal outline-none transition placeholder:text-muted-gray disabled:bg-gray-100 sm:text-sm ${
                    formError
                      ? "border-danger/50 focus:border-danger focus:ring-4 focus:ring-danger/15"
                      : "border-gray-300 focus:border-primary focus:ring-4 focus:ring-primary/20"
                  }`}
                />

                {formError && (
                  <p
                    role="alert"
                    className="mt-2 text-sm font-medium text-danger-hover"
                  >
                    {formError}
                  </p>
                )}
              </div>

              {/* NOTES */}

              <div className="mt-4">

                <div className="mb-2 flex items-center justify-between gap-3">

                  <label
                    htmlFor="task-description"
                    className="text-sm font-semibold text-charcoal"
                  >
                    Notes
                  </label>

                  <span className="text-xs font-medium text-muted-gray">
                    Optional
                  </span>

                </div>

                <textarea
                  id="task-description"
                  value={newTaskDescription}
                  disabled={saving}
                  onChange={(event) =>
                    setNewTaskDescription(
                      event.target.value
                    )
                  }
                  placeholder="Add any useful details..."
                  rows={2}
                  className="w-full resize-none rounded-xl border border-gray-300 bg-white px-4 py-3 text-base leading-6 text-charcoal outline-none transition placeholder:text-muted-gray focus:border-primary focus:ring-4 focus:ring-primary/20 disabled:bg-gray-100 sm:text-sm"
                />

              </div>

              {/* QUICK OPTIONS */}

              <div className="mt-4 rounded-2xl bg-primary-light/40 p-4">

                <div className="grid gap-4 sm:grid-cols-3">

                  {/* CATEGORY */}

                  <div>
                    <label
                      htmlFor="category"
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-gray"
                    >
                      Category
                    </label>

                    <select
                      id="category"
                      value={category}
                      disabled={saving}
                      onChange={(event) =>
                        setCategory(
                          event.target
                            .value as Category
                        )
                      }
                      className="min-h-11 w-full rounded-full border border-gray-200 bg-white px-3.5 text-sm font-medium text-charcoal outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/20 disabled:bg-gray-100"
                    >
                      <option value="Work">
                        Work
                      </option>

                      <option value="Personal">
                        Personal
                      </option>

                      <option value="Study">
                        Study
                      </option>

                      <option value="Other">
                        Other
                      </option>
                    </select>
                  </div>

                  {/* PRIORITY */}

                  <div>
                    <label
                      htmlFor="priority"
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-gray"
                    >
                      Priority
                    </label>

                    <select
                      id="priority"
                      value={priority}
                      disabled={saving}
                      onChange={(event) =>
                        setPriority(
                          event.target
                            .value as Priority
                        )
                      }
                      className="min-h-11 w-full rounded-full border border-gray-200 bg-white px-3.5 text-sm font-medium text-charcoal outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/20 disabled:bg-gray-100"
                    >
                      <option value="Low">
                        Low
                      </option>

                      <option value="Medium">
                        Medium
                      </option>

                      <option value="High">
                        High
                      </option>
                    </select>
                  </div>

                  {/* DUE DATE */}

                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">

                      <label
                        htmlFor="due-date"
                        className="text-xs font-semibold uppercase tracking-wide text-muted-gray"
                      >
                        Due date
                      </label>

                      {dueDate && (
                        <button
                          type="button"
                          onClick={() =>
                            setDueDate("")
                          }
                          disabled={saving}
                          className="text-xs font-semibold text-primary transition hover:text-charcoal"
                        >
                          Clear
                        </button>
                      )}

                    </div>

                    <input
                      id="due-date"
                      type="date"
                      value={dueDate}
                      disabled={saving}
                      onChange={(event) =>
                        setDueDate(
                          event.target.value
                        )
                      }
                      className="min-h-11 w-full rounded-full border border-gray-200 bg-white px-3.5 text-sm font-medium text-charcoal outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/20 disabled:bg-gray-100"
                    />
                  </div>

                </div>

              </div>

              {/* ACTIONS */}

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">

                <button
                  type="button"
                  onClick={resetForm}
                  disabled={saving}
                  className="min-h-11 rounded-xl px-5 text-sm font-semibold text-muted-gray transition hover:bg-gray-100 hover:text-charcoal focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed sm:min-w-24"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white shadow-sm transition hover:brightness-90 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:bg-primary/50 sm:min-w-32"
                >
                  {saving ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Saving...
                    </>
                  ) : editingTaskId !== null ? (
                    "Save changes"
                  ) : (
                    <>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        className="h-4 w-4"
                        aria-hidden="true"
                      >
                        <path
                          d="M12 5V19M5 12H19"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>

                      Create task
                    </>
                  )}
                </button>

              </div>

            </form>
          </div>
        </div>
      )}

      {/* ==================================
          DELETE CONFIRMATION
      ================================== */}

      {taskToDelete && (
        <div
          ref={deleteModalRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/40 backdrop-blur-[2px] sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
        >
          <div className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl sm:p-6">

            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger/15 text-danger-hover">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                className="h-5 w-5"
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
            </div>

            <h3
              id="delete-modal-title"
              className="mt-4 text-xl font-bold text-charcoal"
            >
              Delete this task?
            </h3>

            <p className="mt-2 break-words text-sm leading-6 text-muted-gray">
              You&apos;re about to permanently
              delete{" "}
              <strong className="font-semibold text-charcoal">
                “{taskToDelete.title}”
              </strong>
              . This action cannot be undone.
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3">

              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={isDeletingTask}
                className="min-h-11 rounded-xl border border-gray-300 px-4 text-sm font-semibold text-muted-gray transition hover:bg-primary-light hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Keep task
              </button>

              <button
                type="button"
                onClick={confirmDeleteTask}
                disabled={isDeletingTask}
                className="min-h-11 rounded-xl bg-danger px-4 text-sm font-semibold text-white transition hover:bg-danger-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeletingTask ? "Deleting…" : "Delete task"}
              </button>

            </div>
          </div>
        </div>
      )}

      {/* ==================================
          AI ACTION CONFIRMATION
          (voice/text-resolved danger actions — see
          pendingAIAction's own comment for why this is a separate
          modal/state from the manual delete one above, sharing the
          same visual/interaction pattern rather than its code)
      ================================== */}

      {pendingAIAction && (
        <div
          ref={pendingActionModalRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/40 backdrop-blur-[2px] sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pending-action-modal-title"
        >
          <div className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl sm:p-6">

            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger/15 text-danger-hover">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                className="h-5 w-5"
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
            </div>

            <h3
              id="pending-action-modal-title"
              className="mt-4 text-xl font-bold text-charcoal"
            >
              {pendingAIAction.intent === AIIntent.DELETE_ALL_TASKS
                ? "Delete all your tasks?"
                : "Delete this task?"}
            </h3>

            {/* Task/count identity — its own line, matching the
                mockup, instead of buried mid-sentence. */}
            {pendingAIAction.intent === AIIntent.DELETE_ALL_TASKS ? (
              <p className="mt-2 text-sm font-semibold text-charcoal">
                {pendingAIAction.taskCount} task
                {pendingAIAction.taskCount === 1 ? "" : "s"}
              </p>
            ) : (
              <p className="mt-2 break-words text-sm font-semibold text-charcoal">
                “{pendingAIAction.taskTitle}”
              </p>
            )}

            <p className="mt-1 text-sm leading-6 text-muted-gray">
              This {pendingAIAction.intent === AIIntent.DELETE_ALL_TASKS
                ? "will"
                : "task will be"}{" "}
              permanently deleted. This action cannot be undone.
            </p>

            {/* ==================================
                VOICE STATUS — the ONE place this panel shows
                listening/heard/timeout state (T4). See
                confirmationVoiceStatus's own comment for the priority
                order between these.
            ================================== */}

            <div
              className={`mt-4 flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium ${
                confirmationVoiceStatus.mode === "listening"
                  ? "border-info/50 bg-info/25 text-info"
                  : confirmationVoiceStatus.mode === "heard"
                  ? "border-success/50 bg-success/25 text-success"
                  : confirmationVoiceStatus.mode === "busy"
                  ? "border-primary-light bg-primary-light text-primary"
                  : confirmationVoiceStatus.mode === "timeout"
                  ? "border-warning/50 bg-warning/25 text-warning"
                  : "border-gray-100 bg-gray-50 text-muted-gray"
              }`}
              aria-live="polite"
            >
              {confirmationVoiceStatus.mode === "busy" ? (
                <Loader2
                  size={16}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : confirmationVoiceStatus.mode === "listening" ? (
                <Mic size={16} aria-hidden="true" />
              ) : null}
              {confirmationVoiceStatus.text}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">

              <button
                type="button"
                onClick={cancelPendingAIAction}
                disabled={resolvingPendingAction}
                className="min-h-11 rounded-xl border border-gray-300 px-4 text-sm font-semibold text-muted-gray transition hover:bg-primary-light hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={confirmPendingAIAction}
                disabled={resolvingPendingAction}
                className="min-h-11 rounded-xl bg-danger px-4 text-sm font-semibold text-white transition hover:bg-danger-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resolvingPendingAction
                  ? "Deleting…"
                  : pendingAIAction.intent === AIIntent.DELETE_ALL_TASKS
                  ? "Delete all"
                  : "Delete task"}
              </button>

            </div>
          </div>
        </div>
      )}

      {/* ==================================
          TOAST
      ================================== */}

      {toast && (
        <div
          className="
            pointer-events-none
            fixed
            left-4
            right-4
            top-20
            z-[9999]
            sm:left-auto
            sm:right-6
            sm:top-24
            sm:w-full
            sm:max-w-sm
          "
        >
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            // Error messages tend to carry more important, sometimes
            // longer information the user needs to actually read (vs.
            // a quick success confirmation) — give them more time
            // before the toast auto-dismisses.
            duration={toast.type === "error" ? 6000 : 3000}
            persistent={toast.persistent}
            onClose={() => {
              setToast(
                (current) =>
                  current?.id ===
                  toast.id
                    ? null
                    : current
              );
            }}
          />
        </div>
      )}

    </main>
  );
}
