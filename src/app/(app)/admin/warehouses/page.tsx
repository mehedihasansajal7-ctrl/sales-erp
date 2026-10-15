import { requirePermission } from "@/lib/auth";
import { listWarehouses, listProducts } from "@/server/services/master-data.service";
import { stockSummary } from "@/server/services/stock.service";
import { formatMt } from "@/lib/utils";
import { DataTable, PageHeader, StatusBadge } from "@/components/page-header";
import { DeactivateButton, WarehouseFormDialog } from "@/components/forms/admin-forms";

export const dynamic = "force-dynamic";

export default async function AdminWarehousesPage() {
  await requirePermission("admin.warehouses");

  const [warehouses, stock, products] = await Promise.all([
    listWarehouses(),
    stockSummary(),
    listProducts(),
  ]);

  void products;

  return (
    <div>
      <PageHeader
        title="Warehouses / ship points"
        description="A warehouse user can only ever see and act on its own warehouse."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
        actions={<WarehouseFormDialog />}
      />

      <DataTable
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "location", label: "Location", render: (row) => row.location ?? "—" },
          {
            key: "stock",
            label: "Products with stock",
            align: "right",
            render: (row) => String(stock.filter((item) => item.warehouseCode === row.code).length),
          },
          {
            key: "onHand",
            label: "Total on hand (MT)",
            align: "right",
            render: (row) =>
              formatMt(
                stock
                  .filter((item) => item.warehouseCode === row.code)
                  .reduce((acc, item) => acc + Number(item.onHandMt), 0),
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
                <WarehouseFormDialog warehouse={row} />
                {row.isActive ? (
                  <DeactivateButton entity="warehouse" code={row.code} name={row.name} />
                ) : null}
              </div>
            ),
          },
        ]}
        rows={warehouses}
        rowKey={(row) => row.code}
        emptyMessage="No warehouses configured."
      />
    </div>
  );
}
