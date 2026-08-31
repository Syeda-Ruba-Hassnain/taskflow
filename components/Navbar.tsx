"use client";

import Link from "next/link";
import {
  signOut,
  useSession,
} from "next-auth/react";

export default function Navbar() {
  const { data: session } = useSession();

  // ----------------------------------
  // SIGN OUT
  // ----------------------------------

  const handleSignOut = async () => {
    await signOut({
      redirectTo: "/login",
    });
  };

  // ----------------------------------
  // USER INFORMATION
  // ----------------------------------

  const userName =
    session?.user?.name?.trim() || "User";

  const initial =
    userName.charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-primary-light bg-white/95 shadow-sm backdrop-blur">
      <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:h-[72px] sm:px-6 lg:px-8">

        {/* ==================================
            BRAND
        ================================== */}

        <Link
          href="/dashboard"
          className="group flex min-w-0 shrink-0 items-center gap-2.5 sm:gap-3"
        >
          {/* Logo */}

          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-charcoal text-sm font-bold text-white shadow-sm transition group-hover:opacity-90 sm:h-10 sm:w-10">
            T
          </div>

          {/* Brand text */}

          <div className="min-w-0">
            <p className="text-base font-bold tracking-tight text-charcoal sm:text-lg">
              TaskFlow
            </p>

            <p className="hidden text-[11px] leading-none text-muted-gray sm:block">
              Stay focused. Get things done.
            </p>
          </div>
        </Link>

        {/* ==================================
            USER AREA
        ================================== */}

        {session?.user && (
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">

            {/* ==================================
                DESKTOP / TABLET PROFILE
            ================================== */}

            <Link
              href="/settings"
              aria-label="Open account settings"
              title="Account settings"
              className="group hidden min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-primary-light sm:flex"
            >
              {/* Avatar */}

              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-light text-sm font-bold text-charcoal ring-1 ring-primary/30 transition group-hover:bg-primary/30">
                {initial}
              </div>

              {/* Name + Email */}

              <div className="hidden min-w-0 md:block md:max-w-[150px] lg:max-w-[220px]">
                <p className="truncate text-sm font-semibold text-charcoal">
                  {userName}
                </p>

                <p
                  className="truncate text-xs text-muted-gray"
                  title={
                    session.user.email ?? ""
                  }
                >
                  {session.user.email}
                </p>
              </div>
            </Link>

            {/* ==================================
                MOBILE PROFILE
            ================================== */}

            <Link
              href="/settings"
              aria-label="Open account settings"
              title="Account settings"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-light text-sm font-bold text-charcoal ring-1 ring-primary/30 transition hover:bg-primary/30 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 sm:hidden"
            >
              {initial}
            </Link>

            {/* Divider */}

            <div className="hidden h-8 w-px shrink-0 bg-gray-200 sm:block" />

            {/* ==================================
                SIGN OUT
            ================================== */}

            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sign out"
              title="Sign out"
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 text-sm font-medium text-muted-gray shadow-sm transition hover:border-primary/40 hover:bg-primary-light hover:text-charcoal focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 sm:h-10 sm:px-3.5"
            >
              {/* Sign-out icon */}

              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path
                  d="M10 17L15 12L10 7"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                <path
                  d="M15 12H3"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />

                <path
                  d="M14 4H19C20.1 4 21 4.9 21 6V18C21 19.1 20.1 20 19 20H14"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>

              <span className="hidden xs:inline sm:inline">
                Sign out
              </span>
            </button>

          </div>
        )}

      </nav>
    </header>
  );
}