import { requireUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/rbac";
import { navForRole } from "@/lib/nav";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Server-side gate for every page under this layout.
  const user = await requireUser();

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
