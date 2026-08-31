"use client";

import { Check, Mic, MicOff, Loader2 } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { VoiceSessionController } from "@/lib/voice/voiceSessionController";

// ==================================
// SPEECH RECOGNITION TYPES
// ==================================

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
  onaudioend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type VoiceControlProps = {
  // May return a promise (e.g. the AI round trip) — the button stays in
  // "Processing..." until it settles, so the mic is a single, honest
  // indicator of the whole request, not just local speech recognition.
  onTranscript?: (text: string) => void | Promise<unknown>;
  // True while a pendingAIAction confirmation is up. Suppresses this
  // component's own "Heard: ..."/error boxes (the confirmation panel
  // shows that instead — see T4) — it does NOT drive the click-guard
  // or confirmation-mode-session behavior below; that's decided
  // per-session by whichever call started it (startConfirmationListening
  // vs a manual click), tracked via activeConfirmationRef, not this prop.
  confirmationActive?: boolean;
  onListeningChange?: (listening: boolean) => void;
  /**
   * Fired when a confirmation-mode session's own (shorter) no-response
   * timeout elapses with nothing heard — see
   * VoiceSessionController's confirmationSafetyMs. Deliberately
   * separate from the generic "Didn't catch anything" error shown for
   * a normal session's silence timeout: the caller owns the pending
   * confirmation UI and is in a better position to say "no response
   * heard, use the buttons below" than a floating error box would be.
   */
  onConfirmationTimeout?: () => void;
};

export type VoiceControlHandle = {
  /**
   * Starts a short "listen for an explicit yes/no reply" session
   * without the user clicking the mic — see
   * VoiceSessionController.requestStart's confirmationMode param. A
   * no-op if a session (of either kind) is already active, so calling
   * this while the user has already manually started talking never
   * creates a second session.
   */
  startConfirmationListening: () => void;
  /** Stops whatever session is active, if any, without surfacing a
   * "didn't catch anything" error — for the confirmation modal's
   * Confirm/Cancel buttons, which already know what happened and don't
   * need speech recognition's own opinion about it. */
  stopListening: () => void;
};

// ==================================
// BROWSER SUPPORT DETECTION
// ==================================
// SpeechRecognition availability never changes after load, so this is
// read via useSyncExternalStore instead of effect+state: the client
// snapshot is available synchronously (no render/setState round-trip),
// and getServerSnapshot keeps SSR/hydration consistent.

function subscribeToSpeechRecognitionSupport() {
  return () => {};
}

function getSpeechRecognitionSupport() {
  try {
    if (typeof window === "undefined") return false;
    type LocalWin = {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };

    const win = window as unknown as LocalWin;
    return (
      typeof win.SpeechRecognition === "function" ||
      typeof win.webkitSpeechRecognition === "function"
    );
  } catch {
    return false;
  }
}

function getServerSpeechRecognitionSupport() {
  return false;
}

// Chrome's SpeechRecognitionErrorEvent.error codes, mapped to what the
// user should see. Codes not listed here (or "aborted"/"stop-failed",
// which are expected side effects of our own stop() calls) don't
// surface a message — see onRecognitionError below.
const RECOGNITION_ERROR_MESSAGES: Record<string, string> = {
  "not-allowed":
    "Microphone access was denied. Allow microphone access for this site and try again.",
  "audio-capture":
    "No microphone was found. Check your device and try again.",
  "service-not-allowed":
    "Speech recognition isn't available right now. Try again in a moment.",
  network: "A network error interrupted speech recognition. Try again.",
  "no-speech": "Didn't catch anything. Try again.",
  "start-failed": "Couldn't start the microphone. Try again.",
};

// A brief "Done" state lingers on the button after a request settles, so
// the mic itself confirms completion instead of the user having to look
// elsewhere for confirmation that it's no longer working on anything.
const DONE_DISPLAY_MS = 1500;

const VoiceControl = forwardRef<VoiceControlHandle, VoiceControlProps>(
  function VoiceControl(
    {
      onTranscript,
      confirmationActive = false,
      onListeningChange,
      onConfirmationTimeout,
    },
    ref
  ) {
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onListeningChangeRef = useRef(onListeningChange);
  const onConfirmationTimeoutRef = useRef(onConfirmationTimeout);
  const listeningRef = useRef(false);
  const beginListeningRef =
    useRef<((confirmationMode?: boolean) => void) | null>(null);
  const stopListeningRef = useRef<(() => void) | null>(null);
  const doneTimeoutRef = useRef<number | null>(null);
  // Set right before a Confirm/Cancel-button-driven stop, so the
  // resulting onNothingHeard (if nothing had been said yet) doesn't
  // surface a "Didn't catch anything" error for a stop the user didn't
  // experience as a failed listen.
  const suppressNothingHeardRef = useRef(false);

  // ==================================
  // T7 RACE FIX — see beginListening below for the full trace.
  // ==================================
  //
  // sessionRequestPendingRef: true from the synchronous instant ANY
  // beginListening() call starts, until controller.requestStart() has
  // actually been called (or the attempt is abandoned, e.g. permission
  // denied). This closes the async gap that caused T7: beginListening
  // has to `await navigator.permissions.query(...)` before it can call
  // controller.requestStart(), and the controller's own sessionActive
  // guard only exists from requestStart() onward — it has no way to
  // know a start was ever requested during that gap. Without this ref,
  // a second beginListening() call (automatic confirmation start racing
  // a manual click, or two manual clicks) landing during that gap would
  // sail past the (stale) `listening`/listeningRef check that's the
  // only thing guarding beginListening today, and could reach
  // requestStart() with its own, different confirmationMode — and
  // because whichever call's promise resolves LAST is the one the
  // controller's sessionActive guard actually lets through first, the
  // "loser" could win the mode. That's how a manual click could
  // silently downgrade an automatic confirmation session into a normal
  // one (or the reverse) purely depending on timing — exactly T7's
  // intermittent symptom.
  //
  // activeConfirmationRef: true iff the most recently *requested*
  // session (whether it's still starting or already fully active) was
  // requested with confirmationMode=true. toggleListening uses this
  // alone to decide whether a manual click must be a no-op — it's set
  // at the same synchronous instant as sessionRequestPendingRef, so it
  // already covers both "still starting" and "fully active" without a
  // second check.
  const sessionRequestPendingRef = useRef(false);
  const activeConfirmationRef = useRef(false);

  const supported = useSyncExternalStore(
    subscribeToSpeechRecognitionSupport,
    getSpeechRecognitionSupport,
    getServerSpeechRecognitionSupport
  );
  const [mounted, setMounted] = useState(false);
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [justFinished, setJustFinished] = useState(false);
  const [transcript, setTranscript] = useState("");
  // The read side is intentionally unused — confidence is no longer
  // surfaced in the UI (see the render below), but the tracking itself
  // (this state slot + every setConfidence call from onresult) is left
  // fully intact so the underlying behavior is unchanged.
  const [, setConfidence] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onListeningChangeRef.current = onListeningChange;
  }, [onListeningChange]);

  useEffect(() => {
    onConfirmationTimeoutRef.current = onConfirmationTimeout;
  }, [onConfirmationTimeout]);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    // Defer setting mounted to avoid synchronous setState in effect
    const id = window.setTimeout(() => setMounted(true), 0);

    const API =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!API) {
      console.warn("SpeechRecognition API not available.");
      return;
    }

    const recognition = new API();
    // continuous=true keeps the recognition session open across natural
    // pauses inside a command — with continuous=false, Chrome ends the
    // *entire* session on the first pause it detects, truncating longer
    // commands before the user has even released the mic. The user's own
    // stop action (below, via VoiceSessionController) is what actually
    // ends an utterance now; continuous mode just keeps the session alive
    // long enough for them to be the one who decides that.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    // The startRecognition/stopRecognition callbacks below reference
    // `controller` so they can report a synchronous throw back into it (a
    // start() that throws never gets an onstart *or* an onend from the
    // browser, so handleError is the only way to avoid leaving the
    // session stuck "active" forever) — safe because those callbacks are
    // only ever invoked later, once this whole declaration has finished
    // initializing.
    const controller = new VoiceSessionController(
      {
        startRecognition: () => {
          try {
            recognition.start();
          } catch (startError) {
            console.error(
              "[Voice] recognition.start() threw:",
              startError
            );
            controller.handleError("start-failed");
          }
        },
        stopRecognition: () => {
          try {
            recognition.stop();
          } catch (stopError) {
            console.error(
              "[Voice] recognition.stop() threw:",
              stopError
            );
            controller.handleError("stop-failed");
          }
        },
        onSubmit: (text) => {
          return onTranscriptRef.current?.(text);
        },
        onListeningChange: (isListening) => {
          setListening(isListening);
          onListeningChangeRef.current?.(isListening);
          if (!isListening) {
            // The session (confirmation or not) is fully over — see
            // activeConfirmationRef's doc comment for why this, and
            // not requestStart/requestStop, is what clears it.
            activeConfirmationRef.current = false;
          }
        },
        onProcessingChange: setProcessing,
        onTranscriptChange: setTranscript,
        onNothingHeard: (wasConfirmationMode) => {
          if (suppressNothingHeardRef.current) {
            suppressNothingHeardRef.current = false;
            return;
          }
          if (wasConfirmationMode) {
            // Confirmation's own (shorter) no-response timeout — the
            // pending-confirmation UI owns telling the user about this,
            // not a floating mic error box (see T4: no competing voice
            // statuses).
            onConfirmationTimeoutRef.current?.();
            return;
          }
          setError("Didn't catch anything. Try again.");
        },
        onSettled: () => {
          if (doneTimeoutRef.current !== null) {
            window.clearTimeout(doneTimeoutRef.current);
          }
          setJustFinished(true);
          doneTimeoutRef.current = window.setTimeout(() => {
            setJustFinished(false);
            doneTimeoutRef.current = null;
          }, DONE_DISPLAY_MS);
        },
        onRecognitionError: (code, fatal) => {
          console.error(
            "[Voice] recognition error:",
            code,
            "fatal:",
            fatal
          );

          setProcessing(false);
          setJustFinished(false);

          // Expected side effects of our own stop()/abort() calls, or
          // already logged above with nothing actionable for the user.
          if (code === "aborted" || code === "stop-failed") {
            return;
          }

          setError(
            RECOGNITION_ERROR_MESSAGES[code] ??
              `Speech recognition error (${code}). Try again.`
          );
        },
      },
      // 500-800ms grace window for a trailing final result after stop;
      // 4-5s silence fallback if the user forgets to stop; confirmation
      // sessions (yes/no only) get their own shorter 3s fallback — see
      // confirmationSafetyMs's doc comment.
      {
        graceMs: 700,
        safetyMs: 4500,
        restartDelayMs: 250,
        confirmationSafetyMs: 3000,
      }
    );

    recognition.onstart = () => {
      controller.handleStart();
    };
    recognition.onspeechstart = () => {
      controller.handleSpeechStart();
    };
    recognition.onspeechend = () => controller.handleSpeechEnd();

    recognition.onresult = (event) => {
      let sessionText = "";
      let conf = 0;

      for (let i = 0; i < event.results.length; i++) {
        sessionText += event.results[i][0].transcript + " ";
        conf = event.results[i][0].confidence;
      }

      if (conf > 0) {
        setConfidence(Math.round(conf * 100));
      }

      const last = event.results[event.results.length - 1];
      controller.handleResult(sessionText.trim(), last.isFinal);
    };

    recognition.onerror = (event) => {
      controller.handleError(event.error);
    };

    recognition.onend = () => {
      controller.handleEnd();
    };

    recognitionRef.current = recognition;

    const beginListening = (confirmationMode = false) => {
      // T7 race fix — see sessionRequestPendingRef's doc comment above
      // for the full trace. This check (and the two refs it reads) is
      // what actually closes the gap; everything downstream
      // (controller.requestStart's own sessionActive guard) already
      // worked correctly and is untouched.
      if (sessionRequestPendingRef.current || listeningRef.current) {
        return;
      }

      sessionRequestPendingRef.current = true;
      activeConfirmationRef.current = confirmationMode;
      // A stale suppress flag can be left behind if stopListening() was
      // called after a session had already fully self-submitted (e.g.
      // a voice "yes" ends its own session before
      // confirmPendingAIAction's own stopListening() call reaches the
      // controller, which is then a no-op that never actually consumes
      // this flag via onNothingHeard) — without this reset, that stale
      // `true` would incorrectly suppress a genuine "Didn't catch
      // anything" on this brand-new, unrelated session.
      suppressNothingHeardRef.current = false;

      setJustFinished(false);
      setError("");
      setConfidence(null);

      const requestMicrophone = async () => {
        try {
          if (
            typeof navigator !== "undefined" &&
            "permissions" in navigator
          ) {
            const permissionStatus =
              await navigator.permissions.query({
                name: "microphone",
              });

            if (permissionStatus.state === "denied") {
              setError("Microphone access denied.");
              sessionRequestPendingRef.current = false;
              activeConfirmationRef.current = false;
              return;
            }
          }
        } catch (permissionError) {
          console.warn(
            "Permission API unavailable or failed:",
            permissionError
          );
        }

        // The gap this guard exists for ends here — from this point,
        // controller.requestStart()'s own synchronous sessionActive
        // check is the authoritative guard for the rest of the
        // session's lifecycle.
        sessionRequestPendingRef.current = false;
        controller.requestStart(confirmationMode);
      };

      void requestMicrophone();
    };

    beginListeningRef.current = beginListening;
    stopListeningRef.current = () => {
      controller.requestStop();
    };

    const shortcut = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        if (listeningRef.current) {
          stopListeningRef.current?.();
        } else {
          beginListening();
        }
      }
    };

    window.addEventListener("keydown", shortcut);

    return () => {
      window.removeEventListener("keydown", shortcut);
      controller.dispose();
      beginListeningRef.current = null;
      stopListeningRef.current = null;
      if (doneTimeoutRef.current !== null) {
        window.clearTimeout(doneTimeoutRef.current);
        doneTimeoutRef.current = null;
      }
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
      clearTimeout(id);
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      startConfirmationListening: () => {
        // beginListening's own sessionRequestPendingRef/listeningRef
        // guard (see its doc comment) is the single, authoritative
        // no-op check now — covering "already listening", "already
        // starting", and any competing manual click, all in one place.
        // No need to duplicate any part of that check here.
        beginListeningRef.current?.(true);
      },
      stopListening: () => {
        suppressNothingHeardRef.current = true;
        stopListeningRef.current?.();
      },
    }),
    []
  );

  const toggleListening = () => {
    if (!supported) {
      setError("Speech recognition not supported.");
      return;
    }

    if (!recognitionRef.current) {
      setError("Speech recognition is not initialized yet.");
      return;
    }

    if (activeConfirmationRef.current) {
      // An automatic confirmation-mode session is active or still
      // starting (mid permission-check) — see T7's own trace above.
      // The mic button must be a complete no-op here: not stopping it
      // (the user may be about to say "yes"/"no" and a click shouldn't
      // cut that off) and not starting a second, competing session
      // that could steal the confirmationMode flag out from under it.
      return;
    }

    if (listening) {
      if (!stopListeningRef.current) {
        console.error(
          "[Voice] stop requested but the session isn't ready yet."
        );
        setError("Voice control isn't ready yet. Try again.");
        return;
      }
      stopListeningRef.current();
    } else {
      if (!beginListeningRef.current) {
        console.error(
          "[Voice] start requested but the session isn't ready yet."
        );
        setError("Voice control isn't ready yet. Try again.");
        return;
      }
      beginListeningRef.current();
    }
  };

  // Don't show the unsupported message until the component has mounted
  // and the client-side detection has run; this avoids false negatives
  // during initial client render/hydration.
  if (!mounted) {
    return (
      <div className="sm:shrink-0">
        <button
          type="button"
          disabled
          className="inline-flex h-11 min-w-[150px] items-center justify-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 text-sm font-semibold text-muted-gray"
        >
          <Mic size={16} />
          Initializing...
        </button>
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="flex flex-col gap-2 sm:shrink-0">
        <button
          type="button"
          disabled
          className="inline-flex h-11 min-w-[150px] items-center justify-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 text-sm font-semibold text-muted-gray"
        >
          <Mic size={16} />
          Unsupported
        </button>

        <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger-hover">
          Voice recognition is not supported in this browser.
        </div>
      </div>
    );
  }

  // While a confirmation is pending, the confirmation panel itself
  // (Dashboard) is the ONE place that shows listening/heard/timeout
  // copy — see T4: no competing voice statuses in different places on
  // the page. This button keeps its own generic status text either
  // way (still meaningful on its own, e.g. via the keyboard shortcut),
  // it just no longer duplicates the richer "Say yes or no" copy.
  const status = processing
    ? "Processing..."
    : listening
    ? "Listening..."
    : justFinished
    ? "Done"
    : "Ready";

  return (
    <div className="sm:shrink-0">
      {/* min-w keeps the pill a stable width across all four states
          ("Ready"/"Listening..."/"Processing..."/"Done") instead of
          visibly resizing every time the label changes — sized to fit
          "Processing...", the longest of the four. The keyboard
          shortcut used to be a permanently-visible caption line under
          this button; that made this column taller than the text
          input beside it and stopped the two from reading as one
          component. It's now a title tooltip instead — still
          discoverable on hover/focus, but no longer competing for
          permanent vertical space. */}
      <button
        type="button"
        onClick={toggleListening}
        title="Toggle voice input — Ctrl + Shift + V"
        className={`inline-flex h-11 min-w-[150px] shrink-0 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${
          listening
            ? "border-primary-soft/60 bg-primary-soft/25 text-charcoal"
            : "border-primary/40 bg-primary-light text-charcoal hover:bg-primary/25"
        }`}
      >
        {processing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : listening ? (
          <MicOff size={16} />
        ) : justFinished ? (
          <Check size={16} className="text-success" />
        ) : (
          <Mic size={16} />
        )}

        {status}
      </button>

      {/* Absolutely positioned — anchored to the AI command card's own
          relative wrapper in Dashboard.tsx, not to normal document
          flow — so this floats below the whole command bar instead of
          adding to its height. That was the actual cause of the
          dashboard "jumping" on voice feedback: this used to be a
          normal-flow sibling of the button, so the moment it appeared
          it made VoiceControl's column taller, which made the shared
          row (mic + divider + text input) taller, which made the AI
          card taller, which — via the Add task button's
          lg:items-stretch pairing next to that card — made the button
          stretch too, and shifted every section below it down the
          page. None of that layout math changes what's rendered or
          when (still the exact same two conditions as before); only
          how it's positioned once rendered.

          Suppressed during a pending confirmation — the confirmation
          panel shows its own "Heard: yes/no" and no-response copy
          instead of duplicating it here (see T4). Confidence is
          intentionally not rendered here — it reads as debugging
          information rather than product UI. The underlying
          confidence tracking (confidence state, setConfidence calls
          from onresult) is untouched, just not displayed; still
          available for a future, more deliberate use.

          The (listening || processing || justFinished) guard on the
          "Heard" box is the fix for it otherwise staying visible
          forever: the underlying `transcript` state is never cleared
          back to "" between sessions (by design — the controller/
          onresult logic is untouched), so keying visibility off it
          alone left the last "Heard: ..." permanently on screen, long
          after the mic returned to idle. justFinished already exists
          purely to drive the button's own brief "Done" state and
          self-resets after DONE_DISPLAY_MS (unchanged) — reusing it
          here, instead of adding a new timer, makes this box appear/
          disappear on exactly that same short window: while actively
          listening, through processing, briefly after finishing, then
          gone. Both boxes share one positioned wrapper (rather than
          each being independently absolute) purely so that in the
          practically-impossible case both conditions were ever true
          at once, they'd stack instead of overlapping exactly on top
          of each other. */}
      <div className="pointer-events-none absolute inset-x-0 top-full z-20 mt-1.5 space-y-2">
        {/* line-clamp-2 only bounds the transcript echo (a very long
            dictated command otherwise has no length limit and could
            reach further down the page than intended) — never applied
            to the error box below, since an error's instructions
            ("...try again") are the whole point of showing it and must
            never be cut off. */}
        {transcript && !confirmationActive && (listening || processing || justFinished) && (
          <div className="pointer-events-auto line-clamp-2 rounded-lg bg-primary-light p-2.5 text-sm text-charcoal shadow-md">
            <strong className="font-semibold">Heard:</strong> “{transcript}”
          </div>
        )}

        {error && !confirmationActive && (
          <div className="pointer-events-auto rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-sm text-danger-hover shadow-md">
            {error}
          </div>
        )}
      </div>
    </div>
  );
  }
);

export default VoiceControl;
