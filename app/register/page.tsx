"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  // Account has been created and now needs verification
  const [awaitingVerification, setAwaitingVerification] =
    useState(false);

  // ----------------------------------
  // REGISTER
  // ----------------------------------

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    setError("");
    setSuccess("");

    const normalizedEmail = email
      .trim()
      .toLowerCase();

    // ----------------------------------
    // CLIENT VALIDATION
    // ----------------------------------

    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }

    if (!normalizedEmail) {
      setError("Please enter your email.");
      return;
    }

    const emailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(normalizedEmail)) {
      setError(
        "Please enter a valid email address."
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

      // ----------------------------------
      // SEND TO REGISTER API
      // ----------------------------------

      const response = await fetch(
        "/api/register",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            name: name.trim(),
            email: normalizedEmail,
            password,
          }),
        }
      );

      const data = await response.json();

      // ----------------------------------
      // INITIAL EMAIL FAILED
      // BUT ACCOUNT WAS CREATED
      // ----------------------------------

      if (
        !response.ok &&
        data.accountCreated === true
      ) {
        setAwaitingVerification(true);

        setError(
          data.error ||
            "Your account was created, but we couldn't send the verification email."
        );

        return;
      }

      // ----------------------------------
      // REGISTRATION FAILED
      // ----------------------------------

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to create account."
        );
      }

      // ----------------------------------
      // REGISTRATION SUCCESSFUL
      // ----------------------------------

      setAwaitingVerification(true);

      setSuccess(
        data.message ||
          "Account created! Check your email for a verification link."
      );
    } catch (error) {
      console.error(
        "Registration error:",
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
  // RESEND VERIFICATION
  // ----------------------------------

  const handleResendVerification =
    async () => {
      setError("");
      setSuccess("");

      const normalizedEmail = email
        .trim()
        .toLowerCase();

      if (!normalizedEmail) {
        setError(
          "Please enter your email address."
        );
        return;
      }

      try {
        setResending(true);

        const response = await fetch(
          "/api/resend-verification",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              email: normalizedEmail,
            }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "We couldn't send the verification email."
          );
        }

        setSuccess(
          data.message ||
            "A new verification email has been sent."
        );
      } catch (error) {
        console.error(
          "Resend verification error:",
          error
        );

        setError(
          error instanceof Error
            ? error.message
            : "Something went wrong. Please try again."
        );
      } finally {
        setResending(false);
      }
    };

  // ----------------------------------
  // CHECK YOUR EMAIL SCREEN
  // ----------------------------------

  if (awaitingVerification) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
        <div className="w-full max-w-md">

          {/* Logo */}

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

          {/* Verification Card */}

          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">

            {/* Email Icon */}

            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-2xl">
              ✉️
            </div>

            <h1 className="mt-5 text-2xl font-bold text-gray-900">
              Check your email
            </h1>

            <p className="mt-3 text-sm leading-6 text-gray-500">
              We&apos;ve created your TaskFlow
              account. Verify your email address
              before signing in.
            </p>

            {/* Email Address */}

            <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3">
              <p className="break-all text-sm font-semibold text-gray-800">
                {email.trim().toLowerCase()}
              </p>
            </div>

            {/* Error */}

            {error && (
              <div
                role="alert"
                className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left text-sm leading-6 text-red-700"
              >
                {error}
              </div>
            )}

            {/* Success */}

            {success && (
              <div
                role="status"
                className="mt-5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-left text-sm leading-6 text-green-700"
              >
                {success}
              </div>
            )}

            {/* Instructions */}

            <p className="mt-5 text-sm leading-6 text-gray-500">
              Click the verification link in the
              email to activate your account.
            </p>

            {/* Resend */}

            <div className="mt-6 border-t border-gray-200 pt-6">
              <p className="text-sm text-gray-500">
                Didn&apos;t receive the email?
              </p>

              <button
                type="button"
                onClick={
                  handleResendVerification
                }
                disabled={resending}
                className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
              >
                {resending
                  ? "Sending..."
                  : "Resend verification email"}
              </button>
            </div>

            {/* Login */}

            <p className="mt-6 text-sm text-gray-500">
              Already verified?{" "}
              <Link
                href="/login"
                className="font-semibold text-gray-900 hover:underline"
              >
                Sign in
              </Link>
            </p>

          </div>
        </div>
      </main>
    );
  }

  // ----------------------------------
  // REGISTRATION FORM
  // ----------------------------------

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">

        {/* Logo */}

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
              Create your account
            </h1>

            <p className="mt-2 text-sm text-gray-500">
              Start organizing your tasks with
              TaskFlow.
            </p>
          </div>

          {/* Error */}

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {/* Form */}

          <form
            onSubmit={handleSubmit}
            className="mt-6 space-y-5"
          >

            {/* Name */}

            <div>
              <label
                htmlFor="name"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Name
              </label>

              <input
                id="name"
                type="text"
                value={name}
                disabled={loading}
                onChange={(event) =>
                  setName(event.target.value)
                }
                placeholder="Your name"
                autoComplete="name"
                required
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-500 disabled:bg-gray-100"
              />
            </div>

            {/* Email */}

            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Email
              </label>

              <input
                id="email"
                type="email"
                value={email}
                disabled={loading}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-500 disabled:bg-gray-100"
              />
            </div>

            {/* Password */}

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Password
              </label>

              <input
                id="password"
                type="password"
                value={password}
                disabled={loading}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                placeholder="At least 8 characters"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-500 disabled:bg-gray-100"
              />
            </div>

            {/* Confirm Password */}

            <div>
              <label
                htmlFor="confirm-password"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Confirm Password
              </label>

              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                disabled={loading}
                onChange={(event) =>
                  setConfirmPassword(
                    event.target.value
                  )
                }
                placeholder="Enter password again"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-500 disabled:bg-gray-100"
              />
            </div>

            {/* Submit */}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {loading
                ? "Creating account..."
                : "Create Account"}
            </button>

          </form>

          {/* Login */}

          <p className="mt-6 text-center text-sm text-gray-500">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold text-gray-900 hover:underline"
            >
              Sign in
            </Link>
          </p>

        </div>
      </div>
    </main>
  );
}