import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ROLE_LABELS } from "@/lib/rbac";
import { navForRole } from "@/lib/nav";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Server-side gate for every page under this layout.
  const user = await requireUser();

  // An administrator reset this password: the account stays unusable until the
  // person chooses their own (the change-password page lives outside this layout).
  if (user.mustChangePassword) redirect("/change-password");

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        roleLabel: ROLE_LABELS[user.role],
        warehouseName: user.warehouseName,
      }}
      sections={navForRole(user.role)}
    >
      {children}
    </AppShell>
  );
}
