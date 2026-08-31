// Push-to-talk session state machine for VoiceControl. Framework- and
// DOM-free (uses only global setTimeout/clearTimeout, available in both
// the browser and Node/vitest) so the timing/submission logic can be unit
// tested without a real SpeechRecognition instance or a DOM.
//
// Model: the user's own start/stop action is the authoritative boundary of
// an utterance. A result's `isFinal` flag never triggers submission by
// itself — in continuous mode it just means one phrase segment finished,
// not that the user is done talking. Submission happens only via
// requestStop() (explicit stop, or the silence-fallback timer calling it
// on the caller's behalf), optionally waiting a short grace period for a
// trailing final result that arrives just after stop.

export type VoiceSessionCallbacks = {
  /** Ask the underlying recognizer to start capturing audio. */
  startRecognition: () => void;
  /** Ask the underlying recognizer to stop capturing audio. */
  stopRecognition: () => void;
  /**
   * Called once per utterance with the final transcript. May return a
   * promise (e.g. the AI round trip); onProcessingChange stays true until
   * it settles, so "processing" reflects the whole request, not just
   * local recognition.
   */
  onSubmit: (transcript: string) => void | Promise<unknown>;
  onListeningChange?: (listening: boolean) => void;
  onProcessingChange?: (processing: boolean) => void;
  onTranscriptChange?: (transcript: string) => void;
  /**
   * Stop was requested but nothing was ever heard — nothing to submit.
   * `wasConfirmationMode` reflects the mode of the session that just
   * found nothing to submit (the controller's own authoritative
   * `confirmationMode` at the moment of submission) — callers use it to
   * show a confirmation-specific "no response" state instead of the
   * generic "Didn't catch anything" message, without having to
   * re-derive session mode themselves from timing-sensitive
   * listening-state changes.
   */
  onNothingHeard?: (wasConfirmationMode: boolean) => void;
  /** A submitted utterance's onSubmit call has fully settled (success or failure). */
  onSettled?: () => void;
  /**
   * A recognizer-level error (SpeechRecognitionErrorEvent.error, or a
   * synthetic code like "start-failed" for a start() call that threw
   * synchronously). `fatal` is true for errors where retrying is pointless
   * (permission/device unavailable) — the caller should show a clear
   * message and stop, rather than let the session silently keep retrying.
   */
  onRecognitionError?: (error: string, fatal: boolean) => void;
};

export type VoiceSessionOptions = {
  /**
   * How long to wait after an explicit stop for a trailing final result,
   * when the last known result wasn't already final. ~500-800ms: long
   * enough for Chrome's typical post-speech finalization, short enough to
   * stay imperceptible.
   */
  graceMs?: number;
  /**
   * Silence-fallback: if the user forgets to stop, auto-stop after this
   * long with no speech activity. Deliberately longer than graceMs — this
   * is a safety net, not the primary submission path.
   */
  safetyMs?: number;
  /** Delay before restarting recognition after an unexpected drop. */
  restartDelayMs?: number;
  /**
   * Silence-fallback used in place of safetyMs for the duration of a
   * confirmationMode session (see requestStart's confirmationMode
   * param). Deliberately shorter than safetyMs: a confirmation only
   * ever expects a single word ("yes"/"no"), never an open-ended
   * command the user might still be composing, so there's no reason to
   * tax a no-response confirmation with the same several seconds of
   * dead air a normal command gets before its own safety net kicks in.
   * It's armed/re-armed by the exact same armSafetyTimer() calls as
   * safetyMs (handleStart, handleSpeechEnd) — just a shorter duration
   * for that one case — so a user who's mid-word when it (re)arms still
   * gets the usual reset-on-speech behavior, not a hard cutoff.
   * Doesn't affect safetyMs or any non-confirmation session.
   */
  confirmationSafetyMs?: number;
};

const DEFAULT_GRACE_MS = 700;
const DEFAULT_SAFETY_MS = 4500;
const DEFAULT_RESTART_DELAY_MS = 250;
// See VoiceSessionOptions.confirmationSafetyMs's doc comment for why
// this is shorter than DEFAULT_SAFETY_MS.
const DEFAULT_CONFIRMATION_SAFETY_MS = 3000;

// Errors where the browser fundamentally can't give us audio — retrying
// (the unexpected-end auto-restart below) would just fail the same way
// again, silently, forever. Everything else (network, no-speech, aborted
// while not our own stop) is treated as transient and allowed to retry.
const FATAL_ERRORS = new Set([
  "not-allowed",
  "audio-capture",
  "service-not-allowed",
]);

export class VoiceSessionController {
  private readonly callbacks: VoiceSessionCallbacks;
  private readonly graceMs: number;
  private readonly safetyMs: number;
  private readonly restartDelayMs: number;
  private readonly confirmationSafetyMs: number;

  // Full transcript for the utterance in progress, across any internal
  // restarts (see handleEnd).
  private transcript = "";
  // Transcript carried forward from before the most recent internal
  // restart — Chrome's results list restarts at index 0 on every
  // recognition.start(), so without this, text heard before a restart
  // would be silently dropped instead of appended to.
  private sessionPrefix = "";
  private lastResultFinal = false;
  private hasSubmitted = false;
  // True from requestStop() until submission — further results are still
  // recorded (a trailing final one can end the grace wait early) but no
  // longer keep the session "actively listening".
  private finishing = false;
  // True from the moment requestStart() is called (not from the browser's
  // onstart — that fires asynchronously, and a second click during that
  // gap must not be allowed to call recognition.start() again, since
  // Chrome throws InvalidStateError for a start() on an already-starting
  // instance). False again once handleEnd()/handleError() confirms the
  // browser session is actually done. This is what makes requestStart()
  // safe to call from a rapid double click.
  private sessionActive = false;
  // Set for the duration of a session started via requestStart(true) —
  // a short-lived listen for an explicit yes/no reply to a pending
  // confirmation, as opposed to an open-ended task command. The ONLY
  // thing this changes is when a session ends: see handleResult below.
  // graceMs/safetyMs/restartDelayMs are untouched either way, so a
  // confirmation session that (unusually) never gets a final result
  // still falls back to the exact same silence timeout as any other
  // session — it just never has to wait that long for the common case
  // of a short, cleanly-recognized "yes"/"no".
  private confirmationMode = false;
  // Set by a fatal handleError() so the immediately-following handleEnd()
  // doesn't auto-restart into the same failure forever.
  private suppressAutoRestart = false;

  private safetyTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    callbacks: VoiceSessionCallbacks,
    options: VoiceSessionOptions = {}
  ) {
    this.callbacks = callbacks;
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.safetyMs = options.safetyMs ?? DEFAULT_SAFETY_MS;
    this.restartDelayMs =
      options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS;
    this.confirmationSafetyMs =
      options.confirmationSafetyMs ?? DEFAULT_CONFIRMATION_SAFETY_MS;
  }

  // ==================================
  // USER-INITIATED ACTIONS
  // ==================================

  /**
   * Begin a new utterance. Resets all state from any previous one. A
   * no-op if a session is already starting or active — this is the
   * single guard that makes a rapid double click / double tap safe: the
   * second call never reaches recognition.start() at all. The same
   * guard is what makes it safe for a caller to invoke this
   * automatically (e.g. to start listening for a confirmation reply)
   * without worrying about racing a manual mic click — whichever call
   * wins, the other is a no-op.
   *
   * @param confirmationMode Pass true for a short "listen for an
   * explicit yes/no reply" session — see the confirmationMode field's
   * doc comment for exactly what this does and doesn't change.
   */
  requestStart(confirmationMode = false): void {
    if (this.sessionActive) {
      return;
    }

    this.sessionActive = true;
    this.confirmationMode = confirmationMode;
    this.suppressAutoRestart = false;
    this.finishing = false;
    this.hasSubmitted = false;
    this.lastResultFinal = false;
    this.transcript = "";
    this.sessionPrefix = "";
    this.clearSafetyTimer();
    this.clearGraceTimer();
    this.callbacks.onTranscriptChange?.("");
    this.callbacks.onProcessingChange?.(false);
    this.callbacks.startRecognition();
  }

  /**
   * End the utterance: authoritative stop, either from the user or from
   * the silence-fallback timer. Submits immediately if the last result
   * was already final; otherwise waits up to graceMs for a trailing one.
   */
  requestStop(): void {
    if (!this.sessionActive || this.hasSubmitted || this.finishing) {
      return;
    }

    this.finishing = true;
    this.clearSafetyTimer();
    this.callbacks.onProcessingChange?.(true);
    this.callbacks.stopRecognition();

    if (this.lastResultFinal) {
      this.submitNow();
    } else {
      this.graceTimer = setTimeout(() => this.submitNow(), this.graceMs);
    }
  }

  /** Release timers. Call on unmount. */
  dispose(): void {
    this.clearSafetyTimer();
    this.clearGraceTimer();
    this.sessionActive = false;
  }

  // ==================================
  // RECOGNIZER EVENT HANDLERS
  // ==================================

  handleStart(): void {
    this.callbacks.onListeningChange?.(true);
    this.armSafetyTimer();
  }

  handleSpeechStart(): void {
    this.clearSafetyTimer();
  }

  handleSpeechEnd(): void {
    if (this.finishing || this.hasSubmitted) {
      return;
    }
    this.armSafetyTimer();
  }

  /**
   * @param sessionText Transcript accumulated from the *current*
   * recognition sub-session's results (index 0..length-1), already
   * trimmed. The caller (VoiceControl) builds this from the raw
   * SpeechRecognitionEvent — this module stays DOM-free.
   * @param isFinal Whether the last result in that session was final.
   */
  handleResult(sessionText: string, isFinal: boolean): void {
    this.lastResultFinal = isFinal;

    const full = [this.sessionPrefix, sessionText]
      .filter(Boolean)
      .join(" ")
      .trim();
    this.transcript = full;
    this.callbacks.onTranscriptChange?.(full);

    if (this.hasSubmitted) {
      return;
    }

    if (this.finishing && isFinal) {
      // A trailing final result arrived during the post-stop grace
      // window — no need to wait out the rest of it.
      this.submitNow();
      return;
    }

    // Confirmation mode: a final result IS the user's whole reply (a
    // one-or-two-word "yes"/"no", not an open-ended command they might
    // still be building on) — stop right away instead of waiting out
    // the full safety-timer silence window, which is sized for normal
    // commands and would otherwise tax every confirmation with several
    // needless seconds of dead air. requestStop() still runs its usual
    // path (stopRecognition, then an immediate submit since
    // lastResultFinal is already true) — nothing here bypasses it.
    if (this.confirmationMode && isFinal && !this.finishing) {
      this.requestStop();
    }
  }

  handleEnd(): void {
    this.callbacks.onListeningChange?.(false);
    this.clearSafetyTimer();
    this.sessionActive = false;

    if (this.suppressAutoRestart) {
      // A fatal error (permission/device) just ended this session —
      // retrying would only fail the same way again, silently, forever.
      this.suppressAutoRestart = false;
      return;
    }

    if (!this.finishing && !this.hasSubmitted) {
      // Recognition ended without us asking it to (e.g. a Chrome
      // continuous-mode drop) — restart and carry the transcript so far
      // forward instead of losing it.
      this.sessionPrefix = this.transcript;
      this.sessionActive = true;
      setTimeout(() => {
        this.callbacks.startRecognition();
      }, this.restartDelayMs);
    }
  }

  /**
   * A recognizer-level error. Always resets to a clean, restartable
   * state immediately (don't wait for the end event that usually follows
   * — some failure modes, like start() throwing synchronously, never
   * produce one) so a failed session can never leave the mic stuck.
   */
  handleError(error: string): void {
    if (error === "aborted" && this.finishing) {
      // Expected side effect of our own stop()/abort() in some Chrome
      // versions — not a real failure, nothing to surface.
      return;
    }

    const fatal = FATAL_ERRORS.has(error);

    this.sessionActive = false;
    this.suppressAutoRestart = fatal;
    this.clearSafetyTimer();
    this.clearGraceTimer();
    this.callbacks.onListeningChange?.(false);
    this.callbacks.onRecognitionError?.(error, fatal);
  }

  // ==================================
  // INTERNAL
  // ==================================

  private async submitNow(): Promise<void> {
    if (this.hasSubmitted) {
      return;
    }

    this.clearGraceTimer();
    this.hasSubmitted = true;

    const text = this.transcript.trim();

    if (!text) {
      this.callbacks.onProcessingChange?.(false);
      this.callbacks.onNothingHeard?.(this.confirmationMode);
      return;
    }

    try {
      await this.callbacks.onSubmit(text);
    } finally {
      this.callbacks.onProcessingChange?.(false);
      this.callbacks.onSettled?.();
    }
  }

  private armSafetyTimer(): void {
    this.clearSafetyTimer();
    // Confirmation sessions get their own, shorter fallback — see
    // confirmationSafetyMs's doc comment. Both handleStart's initial
    // arm and handleSpeechEnd's re-arm go through this one method, so
    // neither has to know which mode it's in.
    const ms = this.confirmationMode
      ? this.confirmationSafetyMs
      : this.safetyMs;
    this.safetyTimer = setTimeout(() => {
      this.requestStop();
    }, ms);
  }

  private clearSafetyTimer(): void {
    if (this.safetyTimer !== null) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
  }

  private clearGraceTimer(): void {
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }
}
