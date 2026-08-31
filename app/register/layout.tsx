import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function RegisterLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  // Already logged in
  if (session?.user) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}