import { auth } from "@/auth";
import { redirect } from "next/navigation";
import SessionProvider from "@/components/SessionProvider";

// Phase 6 security audit: unlike /dashboard (guarded server-side in both
// its layout.tsx and page.tsx), /settings had no server-side session
// check at all — it's a "use client" page relying solely on useSession().
// The API routes it calls already reject unauthenticated requests with
// 401, so no data was ever exposed, but the page shell itself rendered
// for anyone. This mirrors the dashboard's existing guard for
// consistency with the rest of the app's protected-route pattern.
export default async function SettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Phase 7 performance audit: this page's useSession() used to rely on
  // a SessionProvider mounted at the root layout with no session prop,
  // so it fired its own /api/auth/session fetch on every load even
  // though this layout already resolved the session server-side one
  // line above. Passing that session down lets the client skip the
  // redundant fetch. See app/dashboard/layout.tsx for the same change.
  return (
    <SessionProvider session={session}>
      {children}
    </SessionProvider>
  );
}
