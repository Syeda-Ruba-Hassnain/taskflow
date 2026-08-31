"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // ----------------------------------
  // LOGIN
  // ----------------------------------

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    setError("");

    const normalizedEmail = email
      .trim()
      .toLowerCase();

    // ----------------------------------
    // VALIDATION
    // ----------------------------------

    if (!normalizedEmail) {
      setError("Please enter your email.");
      return;
    }

    if (!password) {
      setError("Please enter your password.");
      return;
    }

    try {
      setLoading(true);

      const result = await signIn("credentials", {
        email: normalizedEmail,
        password,
        redirect: false,
      });

      // ----------------------------------
      // LOGIN FAILED
      // ----------------------------------

      if (result?.error) {
        const authResult = result as typeof result & {
          code?: string;
        };

        // Correct credentials but email
        // has not been verified.
        if (
          authResult.code ===
          "email_not_verified"
        ) {
          setError(
            "Please verify your email before signing in."
          );

          return;
        }

        // Wrong email or password
        setError("Invalid email or password.");
        return;
      }

      // ----------------------------------
      // LOGIN SUCCESSFUL
      // ----------------------------------

      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      console.error("Login error:", error);

      setError(
        "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------------
  // PAGE
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

        {/* Login Card */}

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">

          {/* Heading */}

          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Welcome back
            </h1>

            <p className="mt-2 text-sm text-gray-500">
              Sign in to continue to TaskFlow.
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

          {/* Login Form */}

          <form
            onSubmit={handleSubmit}
            className="mt-6 space-y-5"
          >

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
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError("");
                }}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="min-h-12 w-full rounded-xl border border-gray-300 px-4 text-base text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100 sm:text-sm"
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
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                }}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                className="min-h-12 w-full rounded-xl border border-gray-300 px-4 text-base text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100 sm:text-sm"
              />

              {/* Forgot Password */}

              <div className="mt-2 text-right">
                <Link
                  href="/forgot-password"
                  className="text-sm font-semibold text-gray-600 transition hover:text-gray-900 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            {/* Sign In */}

            <button
              type="submit"
              disabled={loading}
              className="min-h-12 w-full rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {loading
                ? "Signing in..."
                : "Sign In"}
            </button>

          </form>

          {/* Divider */}

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200" />

            <span className="whitespace-nowrap text-xs font-medium text-gray-500">
              New to TaskFlow?
            </span>

            <div className="h-px flex-1 bg-gray-200" />
          </div>

          {/* Register */}

          <Link
            href="/register"
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900"
          >
            Create an account
          </Link>

        </div>
      </div>
    </main>
  );
}