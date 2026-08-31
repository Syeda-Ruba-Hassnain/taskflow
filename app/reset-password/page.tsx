"use client";

import Link from "next/link";
import {
  FormEvent,
  Suspense,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const token = searchParams.get("token") ?? "";

  const [password, setPassword] =
    useState("");

  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [loading, setLoading] =
    useState(false);

  // ----------------------------------
  // SUBMIT NEW PASSWORD
  // ----------------------------------

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    setError("");
    setSuccess("");

    // ----------------------------------
    // VALIDATION
    // ----------------------------------

    if (!token) {
      setError(
        "This password reset link is invalid."
      );
      return;
    }

    if (password.length < 8) {
      setError(
        "Password must be at least 8 characters."
      );
      return;
    }

    if (password.length > 128) {
      setError(
        "Password must be 128 characters or fewer."
      );
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        "/api/reset-password",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            token,
            password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Unable to reset your password."
        );
      }

      setPassword("");
      setConfirmPassword("");

      setSuccess(
        "Your password has been reset successfully."
      );

      // Redirect to login after a short delay.

      window.setTimeout(() => {
        router.push("/login");
      }, 2000);
    } catch (error) {
      console.error(
        "Reset password error:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------------
  // INVALID LINK
  // ----------------------------------

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
        <div className="w-full max-w-md">

          <div className="mb-8 text-center">
            <Link
              href="/"
              className="text-3xl font-bold tracking-tight text-gray-900"
            >
              TaskFlow
            </Link>

            <p className="mt-2 text-sm text-gray-500">
              Organize your work. Get things done.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">

            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-lg font-bold text-red-600">
              !
            </div>

            <h1 className="mt-4 text-2xl font-bold text-gray-900">
              Invalid reset link
            </h1>

            <p className="mt-2 text-sm leading-6 text-gray-500">
              This password reset link is invalid
              or incomplete. Request a new link to
              reset your password.
            </p>

            <Link
              href="/forgot-password"
              className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white transition hover:bg-gray-700"
            >
              Request new reset link
            </Link>

            <Link
              href="/login"
              className="mt-4 inline-block text-sm font-semibold text-gray-600 hover:text-gray-900 hover:underline"
            >
              Back to sign in
            </Link>

          </div>
        </div>
      </main>
    );
  }

  // ----------------------------------
  // RESET PAGE
  // ----------------------------------

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">

        {/* Brand */}

        <div className="mb-8 text-center">
          <Link
            href="/"
            className="text-3xl font-bold tracking-tight text-gray-900"
          >
            TaskFlow
          </Link>

          <p className="mt-2 text-sm text-gray-500">
            Organize your work. Get things done.
          </p>
        </div>

        {/* Card */}

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">

          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Create a new password
            </h1>

            <p className="mt-2 text-sm leading-6 text-gray-500">
              Choose a new password for your
              TaskFlow account.
            </p>
          </div>

          {/* Error */}

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700"
            >
              {error}
            </div>
          )}

          {/* Success */}

          {success && (
            <div
              role="status"
              className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-700"
            >
              {success}

              <p className="mt-1 text-xs">
                Redirecting you to sign in...
              </p>
            </div>
          )}

          {/* Form */}

          {!success && (
            <form
              onSubmit={handleSubmit}
              className="mt-6 space-y-5"
            >

              {/* New password */}

              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  New password
                </label>

                <input
                  id="password"
                  type="password"
                  value={password}
                  disabled={loading}
                  onChange={(event) => {
                    setPassword(
                      event.target.value
                    );
                    setError("");
                  }}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  required
                  className="min-h-12 w-full rounded-xl border border-gray-300 px-4 text-base text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100 sm:text-sm"
                />
              </div>

              {/* Confirm password */}

              <div>
                <label
                  htmlFor="confirm-password"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Confirm new password
                </label>

                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  disabled={loading}
                  onChange={(event) => {
                    setConfirmPassword(
                      event.target.value
                    );
                    setError("");
                  }}
                  placeholder="Enter password again"
                  autoComplete="new-password"
                  required
                  className="min-h-12 w-full rounded-xl border border-gray-300 px-4 text-base text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100 sm:text-sm"
                />
              </div>

              {/* Submit */}

              <button
                type="submit"
                disabled={loading}
                className="min-h-12 w-full rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {loading
                  ? "Resetting password..."
                  : "Reset password"}
              </button>
            </form>
          )}

          {/* Back */}

          {!success && (
            <div className="mt-6 text-center">
              <Link
                href="/login"
                className="text-sm font-semibold text-gray-700 transition hover:text-gray-900 hover:underline"
              >
                ← Back to sign in
              </Link>
            </div>
          )}

        </div>
      </div>
    </main>
  );
}

// ----------------------------------
// PAGE
// ----------------------------------

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-gray-50">
          <p className="text-sm text-gray-500">
            Loading...
          </p>
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}