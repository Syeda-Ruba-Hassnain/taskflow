import { describe, it, expect, vi, afterEach } from "vitest";
import {
  VoiceSessionController,
  VoiceSessionCallbacks,
} from "./voiceSessionController";

function makeCallbacks(overrides: Partial<VoiceSessionCallbacks> = {}) {
  return {
    startRecognition: vi.fn<() => void>(),
    stopRecognition: vi.fn<() => void>(),
    onSubmit: vi.fn<(transcript: string) => void | Promise<unknown>>(),
    onListeningChange: vi.fn<(listening: boolean) => void>(),
    onProcessingChange: vi.fn<(processing: boolean) => void>(),
    onTranscriptChange: vi.fn<(transcript: string) => void>(),
    onNothingHeard: vi.fn<(wasConfirmationMode: boolean) => void>(),
    onSettled: vi.fn<() => void>(),
    onRecognitionError: vi.fn<(error: string, fatal: boolean) => void>(),
    ...overrides,
  };
}

describe("VoiceSessionController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("push-to-talk start: requestStart begins recognition, listening flips true only on handleStart", () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb);

    controller.requestStart();

    expect(cb.startRecognition).toHaveBeenCalledTimes(1);
    expect(cb.onListeningChange).not.toHaveBeenCalledWith(true);

    controller.handleStart();

    expect(cb.onListeningChange).toHaveBeenCalledWith(true);
  });

  it("explicit stop submits once, immediately, when the last result was already final", () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb);

    controller.requestStart();
    controller.handleStart();
    controller.handleResult("find finish fyp", true);
    controller.requestStop();

    expect(cb.stopRecognition).toHaveBeenCalledTimes(1);
    expect(cb.onSubmit).toHaveBeenCalledTimes(1);
    expect(cb.onSubmit).toHaveBeenCalledWith("find finish fyp");
  });

  it("includes a delayed final result that arrives during the post-stop grace window", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, { graceMs: 700 });

    controller.requestStart();
    controller.handleStart();
    controller.handleResult("create a task called finish fyp", false);
    controller.requestStop();

    expect(cb.onSubmit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    controller.handleResult(
      "create a task called finish fyp with high priority",
      true
    );

    expect(cb.onSubmit).toHaveBeenCalledTimes(1);
    expect(cb.onSubmit).toHaveBeenCalledWith(
      "create a task called finish fyp with high priority"
    );

    // The grace timer would have fired at 700ms — confirm it doesn't
    // cause a second submission now that the final already resolved it.
    vi.advanceTimersByTime(700);
    expect(cb.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits the best-available interim text if the grace period elapses with no final result", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, { graceMs: 700 });

    controller.requestStart();
    controller.handleStart();
    controller.handleResult("mark it completed", false);
    controller.requestStop();

    vi.advanceTimersByTime(700);

    expect(cb.onSubmit).toHaveBeenCalledTimes(1);
    expect(cb.onSubmit).toHaveBeenCalledWith("mark it completed");
  });

  it("auto-stops and submits after safetyMs of silence (fallback for a forgotten stop)", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, {
      safetyMs: 4500,
      graceMs: 700,
    });

    controller.requestStart();
    controller.handleStart();
    controller.handleResult("mark it completed", true);

    vi.advanceTimersByTime(4500);

    expect(cb.stopRecognition).toHaveBeenCalledTimes(1);
    expect(cb.onSubmit).toHaveBeenCalledWith("mark it completed");
  });

  it("does not auto-stop while the safety timer keeps getting cleared by resumed speech", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, { safetyMs: 1000 });

    controller.requestStart();
    controller.handleStart();

    vi.advanceTimersByTime(900);
    controller.handleSpeechStart();
    vi.advanceTimersByTime(900);

    expect(cb.stopRecognition).not.toHaveBeenCalled();
  });

  it("never submits twice even if requestStop is called again", () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb);

    controller.requestStart();
    controller.handleStart();
    controller.handleResult("delete the milk task", true);
    controller.requestStop();
    controller.requestStop();

    expect(cb.onSubmit).toHaveBeenCalledTimes(1);
    expect(cb.stopRecognition).toHaveBeenCalledTimes(1);
  });

  it("ignores a stray result that arrives after submission already happened", () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb);

    controller.requestStart();
    controller.handleStart();
    controller.handleResult("hello", true);
    controller.requestStop();
    expect(cb.onSubmit).toHaveBeenCalledTimes(1);

    controller.handleResult("hello there", true);

    expect(cb.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not carry transcript text from a previous utterance into a new one", () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb);

    controller.requestStart();
    controller.handleStart();
    controller.handleResult("first command", true);
    controller.requestStop();
    expect(cb.onSubmit).toHaveBeenNthCalledWith(1, "first command");
    // The browser fires `end` once recognition.stop() actually completes —
    // that's what the real app waits for before allowing a new session.
    controller.handleEnd();

    controller.requestStart();
    controller.handleStart();
    controller.handleResult("second command", true);
    controller.requestStop();
    expect(cb.onSubmit).toHaveBeenNthCalledWith(2, "second command");
  });

  it("keeps processing true until the onSubmit promise settles", async () => {
    let resolveSubmit: () => void = () => {};
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    const cb = makeCallbacks({ onSubmit: vi.fn(() => submitPromise) });
    const controller = new VoiceSessionController(cb);

    controller.requestStart();
    controller.handleStart();
    controller.handleResult("create a task", true);
    controller.requestStop();

    expect(cb.onProcessingChange).toHaveBeenLastCalledWith(true);

    resolveSubmit();
    await submitPromise;
    await Promise.resolve();

    expect(cb.onProcessingChange).toHaveBeenLastCalledWith(false);
    expect(cb.onSettled).toHaveBeenCalledTimes(1);
  });

  it("preserves the transcript across an unexpected recognition restart", () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, {
      restartDelayMs: 10,
    });

    controller.requestStart();
    controller.handleStart();
    controller.handleResult("create a task called finish", false);
    controller.handleEnd();
    controller.handleStart();
    controller.handleResult("fyp with high priority", true);
    controller.requestStop();

    expect(cb.onSubmit).toHaveBeenCalledWith(
      "create a task called finish fyp with high priority"
    );
  });

  it("does not call onSubmit when nothing was heard before stop", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, { graceMs: 700 });

    controller.requestStart();
    controller.handleStart();
    controller.requestStop();

    vi.advanceTimersByTime(700);

    expect(cb.onSubmit).not.toHaveBeenCalled();
    expect(cb.onNothingHeard).toHaveBeenCalledTimes(1);
    expect(cb.onProcessingChange).toHaveBeenLastCalledWith(false);
  });

  it("a second requestStart while already active never calls startRecognition again (double-click race)", () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb);

    controller.requestStart();
    // Simulates a second click landing before the browser's onstart has
    // fired — sessionActive is already true from the first call.
    controller.requestStart();
    controller.requestStart();

    expect(cb.startRecognition).toHaveBeenCalledTimes(1);
  });

  it("requestStop is a no-op if no session was ever started", () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb);

    controller.requestStop();

    expect(cb.stopRecognition).not.toHaveBeenCalled();
    expect(cb.onSubmit).not.toHaveBeenCalled();
  });

  it("a fatal error surfaces to the caller and prevents the auto-restart that would otherwise follow", () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, {
      restartDelayMs: 10,
    });

    controller.requestStart();
    controller.handleStart();
    controller.handleError("not-allowed");

    expect(cb.onRecognitionError).toHaveBeenCalledWith("not-allowed", true);
    expect(cb.onListeningChange).toHaveBeenLastCalledWith(false);

    // The browser fires `end` right after `error` in practice.
    controller.handleEnd();

    expect(cb.startRecognition).toHaveBeenCalledTimes(1);
  });

  it("a non-fatal error still allows the normal unexpected-end auto-restart", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, {
      restartDelayMs: 10,
    });

    controller.requestStart();
    controller.handleStart();
    controller.handleError("network");
    controller.handleEnd();

    expect(cb.onRecognitionError).toHaveBeenCalledWith("network", false);

    vi.advanceTimersByTime(10);

    expect(cb.startRecognition).toHaveBeenCalledTimes(2);
  });

  it("a failed start (start() throwing, reported via handleError) leaves the session restartable", () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb);

    controller.requestStart();
    // No handleStart() ever arrives — recognition.start() threw
    // synchronously, so the browser never began a session and never
    // fires onend either. handleError is the only signal we get.
    controller.handleError("start-failed");

    expect(cb.onRecognitionError).toHaveBeenCalledWith(
      "start-failed",
      false
    );

    controller.requestStart();

    expect(cb.startRecognition).toHaveBeenCalledTimes(2);
  });

  it('an "aborted" error from our own stop() is swallowed, not surfaced', () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb);

    controller.requestStart();
    controller.handleStart();
    controller.handleResult("delete the milk task", true);
    controller.requestStop();

    controller.handleError("aborted");

    expect(cb.onRecognitionError).not.toHaveBeenCalled();
  });

  // ==================================
  // CONFIRMATION MODE
  // ==================================
  //
  // requestStart(true) — a short "listen for an explicit yes/no reply"
  // session. Deliberately reuses every existing guard/timer; the only
  // behavior change is submitting immediately on a final result instead
  // of waiting out the safety-timer silence window.

  it("confirmation mode: a final result stops and submits immediately, without waiting for safetyMs", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, {
      safetyMs: 4500,
      graceMs: 700,
    });

    controller.requestStart(true);
    controller.handleStart();
    controller.handleResult("yes", true);

    // No timer advance at all — this is the point: a normal session
    // would still be waiting out the safety timer here.
    expect(cb.stopRecognition).toHaveBeenCalledTimes(1);
    expect(cb.onSubmit).toHaveBeenCalledTimes(1);
    expect(cb.onSubmit).toHaveBeenCalledWith("yes");
  });

  it("confirmation mode: works the same for a negative reply", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, {
      safetyMs: 4500,
      graceMs: 700,
    });

    controller.requestStart(true);
    controller.handleStart();
    controller.handleResult("no", true);

    expect(cb.stopRecognition).toHaveBeenCalledTimes(1);
    expect(cb.onSubmit).toHaveBeenCalledWith("no");
  });

  it("confirmation mode: stops listening (onListeningChange false) right after the final result, not after safetyMs", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, { safetyMs: 4500 });

    controller.requestStart(true);
    controller.handleStart();
    controller.handleResult("yes", true);
    controller.handleEnd();

    expect(cb.onListeningChange).toHaveBeenLastCalledWith(false);
    // Advancing well past safetyMs must not cause any further activity —
    // the session already ended on its own.
    vi.advanceTimersByTime(4500);
    expect(cb.stopRecognition).toHaveBeenCalledTimes(1);
  });

  it("confirmation mode: a duplicate/trailing final result never causes a second submission", () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb);

    controller.requestStart(true);
    controller.handleStart();
    controller.handleResult("yes", true);
    controller.handleResult("yes", true);

    expect(cb.onSubmit).toHaveBeenCalledTimes(1);
    expect(cb.stopRecognition).toHaveBeenCalledTimes(1);
  });

  it("confirmation mode: a timeout with nothing heard never submits and never mutates anything", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, {
      safetyMs: 4500,
      graceMs: 700,
    });

    controller.requestStart(true);
    controller.handleStart();

    // No handleResult at all — nothing was heard.
    vi.advanceTimersByTime(4500 + 700);

    expect(cb.onSubmit).not.toHaveBeenCalled();
    expect(cb.onNothingHeard).toHaveBeenCalledTimes(1);
  });

  it("confirmation mode: a manual requestStart() while confirmation listening is active does not start a second session", () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb);

    controller.requestStart(true);
    // Simulates the user clicking the mic button while the automatic
    // confirmation-listening session is already active.
    controller.requestStart();

    expect(cb.startRecognition).toHaveBeenCalledTimes(1);

    // The already-active confirmation session is still in effect: a
    // final result still fast-stops instead of waiting for safetyMs.
    controller.handleStart();
    controller.handleResult("yes", true);
    expect(cb.onSubmit).toHaveBeenCalledWith("yes");
  });

  it("normal (non-confirmation) sessions are unaffected: a final result still waits for an explicit stop", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, { safetyMs: 4500 });

    controller.requestStart();
    controller.handleStart();
    controller.handleResult("mark it completed", true);

    expect(cb.stopRecognition).not.toHaveBeenCalled();
    expect(cb.onSubmit).not.toHaveBeenCalled();

    controller.requestStop();
    expect(cb.onSubmit).toHaveBeenCalledWith("mark it completed");
  });

  // ==================================
  // CONFIRMATION-SPECIFIC NO-RESPONSE TIMEOUT (T5)
  // ==================================
  //
  // confirmationMode sessions use confirmationSafetyMs instead of
  // safetyMs for their silence fallback — see that option's own doc
  // comment for why. These tests prove it's actually shorter in
  // practice (not just a smaller default value nobody exercises) and
  // that it never touches safetyMs's own behavior for normal sessions.

  it("confirmation mode: the default no-response timeout fires well before the normal safetyMs would", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    // Defaults only: safetyMs 4500ms, confirmationSafetyMs 3000ms.
    const controller = new VoiceSessionController(cb);

    controller.requestStart(true);
    controller.handleStart();

    // Nothing heard at all — advance only to the confirmation timeout,
    // well short of the normal 4500ms safetyMs. requestStop() (fired
    // by the timeout) stops recognition immediately; submitNow() then
    // waits out the usual graceMs for a trailing result before giving
    // up, same as any other stop.
    vi.advanceTimersByTime(3000);
    expect(cb.stopRecognition).toHaveBeenCalledTimes(1);
    expect(cb.onSubmit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(700);
    expect(cb.onNothingHeard).toHaveBeenCalledWith(true);
    expect(cb.onSubmit).not.toHaveBeenCalled();

    controller.handleEnd();
    expect(cb.onListeningChange).toHaveBeenLastCalledWith(false);
  });

  it("normal (non-confirmation) sessions still wait the full safetyMs, never the shorter confirmation one", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb); // defaults

    controller.requestStart();
    controller.handleStart();

    // Past confirmationSafetyMs (3000ms) but short of safetyMs
    // (4500ms) — a normal session must not have stopped yet.
    vi.advanceTimersByTime(3000);
    expect(cb.stopRecognition).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1500);
    expect(cb.stopRecognition).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(700);
    expect(cb.onNothingHeard).toHaveBeenCalledWith(false);
  });

  it("a custom confirmationSafetyMs is honored independently of a much longer safetyMs", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, {
      safetyMs: 10000,
      confirmationSafetyMs: 1200,
    });

    controller.requestStart(true);
    controller.handleStart();

    vi.advanceTimersByTime(1200);
    expect(cb.stopRecognition).toHaveBeenCalledTimes(1);

    // The much longer normal safetyMs never factors into a
    // confirmation session at all.
    vi.advanceTimersByTime(10000);
    expect(cb.stopRecognition).toHaveBeenCalledTimes(1);
  });

  it("a confirmation no-response timeout never mutates anything: onSubmit is never called and the session stops cleanly", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb, {
      confirmationSafetyMs: 500,
    });

    controller.requestStart(true);
    controller.handleStart();

    vi.advanceTimersByTime(500 + 700);

    expect(cb.onSubmit).not.toHaveBeenCalled();
    expect(cb.onNothingHeard).toHaveBeenCalledTimes(1);
    expect(cb.onNothingHeard).toHaveBeenCalledWith(true);
    expect(cb.onProcessingChange).toHaveBeenLastCalledWith(false);
  });

  // ==================================
  // T7 RACE REGRESSION (controller-level guarantee the VoiceControl
  // fix relies on)
  // ==================================
  //
  // The actual T7 race lived in VoiceControl, in the async gap before
  // requestStart() is ever called (see beginListening's own comments) —
  // not unit-testable here without jsdom/RTL. What IS testable, and
  // what the VoiceControl-level fix depends on, is that the controller
  // itself never lets a later requestStart() call silently change the
  // mode of an already-active session. These tests lock that guarantee.

  it("rapid, repeated requestStart calls in any mode never start a second session or change the active session's mode", () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb);

    controller.requestStart(true);
    controller.requestStart(false);
    controller.requestStart(true);
    controller.requestStart(false);

    expect(cb.startRecognition).toHaveBeenCalledTimes(1);

    // The FIRST call's mode wins for the whole session — a final
    // result still fast-stops exactly like a normal confirmation
    // session, proving the later no-op calls never downgraded it.
    controller.handleStart();
    controller.handleResult("yes", true);

    expect(cb.onSubmit).toHaveBeenCalledWith("yes");
    expect(cb.stopRecognition).toHaveBeenCalledTimes(1);
  });

  it("rapid, repeated requestStart calls started in normal mode never get upgraded into confirmation mode", () => {
    const cb = makeCallbacks();
    const controller = new VoiceSessionController(cb);

    controller.requestStart(false);
    controller.requestStart(true);
    controller.requestStart(true);

    controller.handleStart();
    controller.handleResult("mark it completed", true);

    // If the later requestStart(true) calls had won, this would have
    // fast-stopped immediately instead of waiting for an explicit stop.
    expect(cb.stopRecognition).not.toHaveBeenCalled();
    expect(cb.onSubmit).not.toHaveBeenCalled();

    controller.requestStop();
    expect(cb.onSubmit).toHaveBeenCalledWith("mark it completed");
  });
});
