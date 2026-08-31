"use client";

import { useEffect, useRef } from "react";

export type ToastType =
  | "success"
  | "error"
  | "info";

type ToastProps = {
  message: string;
  type?: ToastType;
  onClose: () => void;
  duration?: number;
  // For an in-flight request's status ("Thinking..."): skips the
  // auto-close timer entirely, since a fixed duration can't know how long
  // the request will actually take. The caller is responsible for
  // replacing/closing it once the request settles.
  persistent?: boolean;
};

export default function Toast({
  message,
  type = "success",
  onClose,
  duration = 3000,
  persistent = false,
}: ToastProps) {
  // Keep latest onClose without restarting timer
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // ----------------------------------
  // AUTO CLOSE
  // ----------------------------------

  useEffect(() => {
    if (persistent) {
      return;
    }

    const timer = window.setTimeout(() => {
      onCloseRef.current();
    }, duration);

    return () => {
      window.clearTimeout(timer);
    };
  }, [duration, message, type, persistent]);

  // ----------------------------------
  // TOAST STYLES
  // ----------------------------------

  const styles = {
    success: {
      container:
        "border-success/50 bg-white",
      iconContainer:
        "bg-success/35 text-success",
      title: "Success",
    },

    error: {
      container:
        "border-danger/40 bg-white",
      iconContainer:
        "bg-danger/15 text-danger-hover",
      title: "Something went wrong",
    },

    info: {
      container:
        "border-info/50 bg-white",
      iconContainer:
        "bg-info/35 text-info",
      title: "Information",
    },
  };

  const currentStyle = styles[type];

  // ----------------------------------
  // UI
  // ----------------------------------

  return (
    <div
      role={type === "error" ? "alert" : "status"}
      aria-live={
        type === "error"
          ? "assertive"
          : "polite"
      }
      className={`
        pointer-events-auto
        flex
        w-full
        items-start
        gap-3
        rounded-2xl
        border
        p-4
        shadow-xl
        ${currentStyle.container}
      `}
    >
      {/* ICON */}

      <div
        className={`
          flex
          h-9
          w-9
          shrink-0
          items-center
          justify-center
          rounded-full
          ${currentStyle.iconContainer}
        `}
      >
        {type === "success" && (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path
              d="M5 12L10 17L19 7"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {type === "error" && (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              strokeWidth="2"
            />

            <path
              d="M12 7V13"
              strokeWidth="2"
              strokeLinecap="round"
            />

            <circle
              cx="12"
              cy="17"
              r="1"
              fill="currentColor"
              stroke="none"
            />
          </svg>
        )}

        {type === "info" && (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              strokeWidth="2"
            />

            <path
              d="M12 11V17"
              strokeWidth="2"
              strokeLinecap="round"
            />

            <circle
              cx="12"
              cy="7"
              r="1"
              fill="currentColor"
              stroke="none"
            />
          </svg>
        )}
      </div>

      {/* CONTENT */}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-charcoal">
          {currentStyle.title}
        </p>

        <p className="mt-0.5 break-words text-sm leading-5 text-muted-gray">
          {message}
        </p>
      </div>

      {/* CLOSE */}

      <button
        type="button"
        onClick={() => onCloseRef.current()}
        aria-label="Close notification"
        className="
          flex
          h-8
          w-8
          shrink-0
          items-center
          justify-center
          rounded-lg
          text-muted-gray
          transition
          hover:bg-primary-light
          hover:text-charcoal
        "
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path
            d="M6 6L18 18M18 6L6 18"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}