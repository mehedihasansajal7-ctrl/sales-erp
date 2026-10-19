import { requirePermission } from "@/lib/auth";
import { currentRates } from "@/server/services/rate.service";
import { listProducts } from "@/server/services/master-data.service";
import { formatBdt } from "@/lib/utils";
import { DataTable, PageHeader, StatusBadge } from "@/components/page-header";
import { DeactivateButton, ProductFormDialog } from "@/components/forms/admin-forms";
import { BulkImportDialog } from "@/components/forms/bulk-import";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  await requirePermission("admin.products");

  const [products, rates] = await Promise.all([listProducts(), currentRates()]);
  const rateByCode = new Map(rates.map((entry) => [entry.product.code, entry]));

  return (
    <div>
      <PageHeader
        title="Products"
        description="Bulk commodities traded in MT. Products are deactivated, never deleted, so history stays readable."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
        actions={
          <div className="flex items-center gap-2">
            <BulkImportDialog entity="products" />
            <ProductFormDialog />
          </div>
        }
      />

      <DataTable
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "category", label: "Category" },
          { key: "unit", label: "Unit" },
          {
            key: "rate",
            label: "Current rate",
            align: "right",
            render: (row) =>
              rateByCode.get(row.code)?.hasRate ? (
                formatBdt(rateByCode.get(row.code)?.ratePerMt ?? "0")
              ) : (
                <span className="text-xs font-medium text-amber-700">Not published</span>
              ),
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
                <ProductFormDialog product={row} />
                {row.isActive ? <DeactivateButton entity="product" code={row.code} name={row.name} /> : null}
              </div>
            ),
          },
        ]}
        rows={products}
        rowKey={(row) => row.code}
        emptyMessage="No products configured."
      />
    </div>
  );
}
