import { auth } from "@/auth";
import { redirect } from "next/navigation";
import SessionProvider from "@/components/SessionProvider";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Check the user's session on the server
  const session = await auth();

  // No logged-in user → send them to login
  if (!session?.user) {
    redirect("/login");
  }

  // Phase 7 performance audit: only /dashboard (Navbar) and /settings
  // actually call useSession()/signOut() client-side, so only they need
  // next-auth's client SessionProvider — it used to wrap the whole app
  // in the root layout instead. Scoping it here means (a) every other
  // page no longer mounts an unnecessary client component, and (b) since
  // this layout already resolved the session server-side for the
  // redirect check above, passing it into SessionProvider lets the
  // client use it immediately instead of firing its own redundant
  // /api/auth/session fetch on mount.
  return (
    <SessionProvider session={session}>
      {children}
    </SessionProvider>
  );
}