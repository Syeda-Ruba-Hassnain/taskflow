import { auth } from "@/auth";
import { redirect } from "next/navigation";

import Dashboard from "./Dashboard";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return <Dashboard />;
}