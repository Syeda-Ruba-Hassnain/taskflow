
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type VerificationStatus =
  | "verifying"
  | "success"
  | "error";

type VerifyEmailClientProps = {
  token: string | null;
};

export default function VerifyEmailClient({
  token,
}: VerifyEmailClientProps) {
  const [status, setStatus] =
    useState<VerificationStatus>(() =>
      token ? "verifying" : "error"
    );

  const [message, setMessage] = useState(() =>
    token
      ? "We're verifying your email..."
      : "This verification link is invalid."
  );

  useEffect(() => {
    // ----------------------------------
    // CHECK TOKEN EXISTS
    // ----------------------------------

    if (!token) {
      return;
    }

    // ----------------------------------
    // VERIFY EMAIL
    // ----------------------------------

    const verifyEmail = async () => {
      try {
        const response = await fetch(
          "/api/verify-email",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              token,
            }),
          }
        );

        const data = await response.json();

        // ----------------------------------
        // VERIFICATION FAILED
        // ----------------------------------

        if (!response.ok) {
          throw new Error(
            data.error ||
              "Email verification failed."
          );
        }

        // ----------------------------------
        // VERIFICATION SUCCESSFUL
        // ----------------------------------

        setStatus("success");

        setMessage(
          data.message ||
            "Your email has been verified successfully."
        );
      } catch (error) {
        console.error(
          "Verification error:",
          error
        );

        setStatus("error");

        setMessage(
          error instanceof Error
            ? error.message
            : "Email verification failed."
        );
      }
    };

    verifyEmail();
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm"
      >

        {/* --------------------------------
            VERIFYING
        -------------------------------- */}

        {status === "verifying" && (
          <>
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900" />

            <h1 className="mt-6 text-2xl font-bold text-gray-900">
              Verifying your email
            </h1>

            <p className="mt-3 text-sm leading-6 text-gray-500">
              {message}
            </p>

            <p className="mt-2 text-xs text-gray-500">
              Please don&apos;t close this page.
            </p>
          </>
        )}

        {/* --------------------------------
            SUCCESS
        -------------------------------- */}

        {status === "success" && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl font-bold text-green-700">
              ✓
            </div>

            <h1 className="mt-6 text-2xl font-bold text-gray-900">
              Email verified!
            </h1>

            <p className="mt-3 text-sm leading-6 text-gray-500">
              {message}
            </p>

            <p className="mt-2 text-sm text-gray-500">
              Your TaskFlow account is now ready
              to use.
            </p>

            <Link
              href="/login"
              className="mt-7 inline-block w-full rounded-lg bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-700"
            >
              Continue to Sign In
            </Link>
          </>
        )}

        {/* --------------------------------
            ERROR
        -------------------------------- */}

        {status === "error" && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-2xl font-bold text-red-700">
              !
            </div>

            <h1 className="mt-6 text-2xl font-bold text-gray-900">
              Verification failed
            </h1>

            <p className="mt-3 text-sm leading-6 text-red-600">
              {message}
            </p>

            <p className="mt-3 text-sm text-gray-500">
              The verification link may be
              invalid, expired, or already used.
            </p>

            <Link
              href="/login"
              className="mt-7 inline-block w-full rounded-lg bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-700"
            >
              Back to Sign In
            </Link>
          </>
        )}

      </div>
    </main>
  );
}
