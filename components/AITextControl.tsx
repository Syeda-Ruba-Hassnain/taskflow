"use client";

import { FormEvent, useState } from "react";
import { Loader2, Send } from "lucide-react";

type AITextControlProps = {
  onSubmit: (text: string) => boolean | Promise<boolean>;
};

// Text-input fallback for the AI assistant. Shares the exact same
// pipeline as VoiceControl (both call handleVoiceCommand in
// Dashboard.tsx) so there's no separate parsing/backend path to
// keep in sync — this component only owns the input field itself.
// onSubmit reports whether the command actually succeeded so the
// input is only cleared on success, mirroring how a form normally
// behaves (a failed submission keeps what you typed so you can fix
// and retry it) — errors/loading themselves are already surfaced
// via the shared toast handling inside onSubmit.
export default function AITextControl({
  onSubmit,
}: AITextControlProps) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    const trimmed = value.trim();

    if (!trimmed || submitting) {
      return;
    }

    setSubmitting(true);

    try {
      const success = await onSubmit(trimmed);

      if (success) {
        setValue("");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-w-0 flex-1 items-center gap-2"
    >
      <label htmlFor="ai-text-command" className="sr-only">
        Type a command for the AI assistant
      </label>

      <input
        id="ai-text-command"
        type="text"
        value={value}
        disabled={submitting}
        onChange={(event) =>
          setValue(event.target.value)
        }
        placeholder="Ask TaskFlow something..."
        className="min-h-11 w-full min-w-0 flex-1 rounded-full border border-gray-200 bg-primary-light/30 px-4 text-sm text-charcoal outline-none transition placeholder:text-muted-gray focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/20"
      />

      <button
        type="submit"
        disabled={submitting || !value.trim()}
        title="Send command"
        className="inline-flex min-h-11 min-w-[92px] shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-white shadow-sm transition hover:brightness-90 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:bg-primary/50"
      >
        {submitting ? (
          <>
            <Loader2
              className="h-4 w-4 animate-spin"
              aria-hidden="true"
            />
            Sending...
          </>
        ) : (
          <>
            <Send size={16} aria-hidden="true" />
            Send
          </>
        )}
      </button>
    </form>
  );
}
