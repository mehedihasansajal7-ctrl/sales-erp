import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { ROLE_LABELS } from "@/lib/rbac";
import { listUsers } from "@/server/services/user.service";
import { listWarehouses } from "@/server/services/master-data.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, FilterBar, PageHeader, StatusBadge } from "@/components/page-header";
import { ResetPasswordDialog, UserFormDialog } from "@/components/forms/admin-forms";
import type { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string }>;
}) {
  await requirePermission("admin.users");
  const { q, role } = await searchParams;

  const [users, warehouses] = await Promise.all([
    listUsers({ q, role: (role as Role | "ALL") ?? "ALL" }),
    listWarehouses(),
  ]);

  return (
    <div>
      <PageHeader
        title="Users & roles"
        description="Roles are enforced on the server for every action — hiding a menu item is never the access control."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
        actions={<UserFormDialog warehouses={warehouses.map((w) => ({ code: w.code, name: w.name }))} />}
      />

      <FilterBar
        action="/admin/users"
        q={q}
        placeholder="Search name or email"
        selects={[
          {
            name: "role",
            label: "Role",
            value: role,
            options: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
          },
        ]}
      />

      <DataTable
        columns={[
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "role", label: "Role", render: (row) => ROLE_LABELS[row.role as Role] },
          { key: "warehouseName", label: "Warehouse", render: (row) => row.warehouseName ?? "—" },
          {
            key: "isActive",
            label: "Status",
            render: (row) => (
              <StatusBadge status={row.isActive ? "ACTIVE" : "CANCELLED"} label={row.isActive ? "Active" : "Inactive"} />
            ),
          },
          { key: "lastLoginAt", label: "Last sign-in", render: (row) => formatDateTime(row.lastLoginAt) },
          {
            key: "actions",
            label: "",
            align: "right",
            render: (row) => (
              <div className="flex flex-wrap justify-end gap-1">
                <UserFormDialog
                  warehouses={warehouses.map((w) => ({ code: w.code, name: w.name }))}
                  user={{
                    id: row.id,
                    name: row.name,
                    email: row.email,
                    role: row.role,
                    isActive: row.isActive,
                    warehouseCode: row.warehouseCode,
                  }}
                />
                <ResetPasswordDialog userId={row.id} userName={row.name} />
              </div>
            ),
          },
        ]}
        rows={users}
        rowKey={(row) => row.id}
        emptyMessage="No users match the filter."
      />

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>What each role can do</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
          <p>
            <strong>Finance</strong> — publishes product-wise selling rates; cannot create or approve
            orders.
          </p>
          <p>
            <strong>Salesperson</strong> — creates orders at the published rate and tracks them; cannot
            approve or change a locked rate.
          </p>
          <p>
            <strong>Sales Operations</strong> — approves/rejects orders, creates delivery orders,
            chooses the warehouse, grants priority overrides, short-closes.
          </p>
          <p>
            <strong>Warehouse</strong> — sees only its own warehouse: dispatches against DOs, inward
            stock, transfers, physical counts.
          </p>
          <p>
            <strong>Management</strong> — read-only access to every dashboard and report.
          </p>
          <p>
            <strong>Administrator</strong> — users, products, customers, warehouses, settings and the
            audit log.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
