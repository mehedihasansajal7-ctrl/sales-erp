import { requirePermission } from "@/lib/auth";
import { listCustomers } from "@/server/services/master-data.service";
import { formatBdt } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, FilterBar, PageHeader, StatusBadge } from "@/components/page-header";
import { CustomerFormDialog, DeactivateButton } from "@/components/forms/admin-forms";
import { BulkImportDialog } from "@/components/forms/bulk-import";

export const dynamic = "force-dynamic";

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; isActive?: string }>;
}) {
  await requirePermission("admin.customers");
  const { q, isActive } = await searchParams;

  const customers = await listCustomers({
    q,
    isActive: isActive === undefined || isActive === "" ? undefined : isActive === "true",
  });

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Credit limit is used by the approval check: exceeding it requires a written Sales Ops override."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
        actions={
          <div className="flex items-center gap-2">
            <BulkImportDialog entity="customers" />
            <CustomerFormDialog />
          </div>
        }
      />

      <FilterBar
        action="/admin/customers"
        q={q}
        placeholder="Search name, code or phone"
        selects={[
          {
            name: "isActive",
            label: "Status",
            value: isActive,
            options: [
              { value: "true", label: "Active" },
              { value: "false", label: "Inactive" },
            ],
          },
        ]}
      />

      <DataTable
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "phone", label: "Phone", render: (row) => row.phone ?? "—" },
          { key: "address", label: "Address", render: (row) => row.address ?? "—" },
          {
            key: "creditLimit",
            label: "Credit limit",
            align: "right",
            render: (row) => (row.creditLimit ? formatBdt(row.creditLimit) : "No limit"),
          },
          {
            key: "isActive",
            label: "Status",
            render: (row) => (
              <StatusBadge
                status={row.isActive ? "ACTIVE" : "CANCELLED"}
                label={row.isActive ? "Active" : "Inactive"}
              />
            ),
          },
          {
            key: "actions",
            label: "",
            align: "right",
            render: (row) => (
              <div className="flex flex-wrap justify-end gap-1">
                <CustomerFormDialog customer={row} />
                {row.isActive ? <DeactivateButton entity="customer" code={row.code} name={row.name} /> : null}
              </div>
            ),
          },
        ]}
        rows={customers}
        rowKey={(row) => row.code}
        emptyMessage="No customers match the filter."
      />

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Why deactivate instead of delete?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          Orders, delivery orders, dispatches and stock ledger rows reference customers. Deactivating
          keeps every historical document explainable while blocking new transactions. Deactivation is
          refused while the customer still has open orders.
        </CardContent>
      </Card>
    </div>
  );
}
