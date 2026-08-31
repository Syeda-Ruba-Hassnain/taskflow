"use client";

import type { Session } from "next-auth";
import {
  SessionProvider as NextAuthSessionProvider,
} from "next-auth/react";

export default function SessionProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  // Optional server-resolved session. When provided, next-auth's
  // client SessionProvider uses it as the initial state instead of
  // issuing its own /api/auth/session fetch on mount (see
  // node_modules/next-auth/react.js: `hasInitialSession` skips the
  // initial fetch and marks the client copy as already synced).
  session?: Session | null;
}) {
  return (
    <NextAuthSessionProvider session={session}>
      {children}
    </NextAuthSessionProvider>
  );
}