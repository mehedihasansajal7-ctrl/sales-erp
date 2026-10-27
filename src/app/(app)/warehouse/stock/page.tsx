import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { roleHasPermission } from "@/lib/rbac";
import { stockSummary } from "@/server/services/stock.service";
import { listProducts, listWarehouses } from "@/server/services/master-data.service";
import { formatMt } from "@/lib/utils";
import { toZonedDateString } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, PageHeader } from "@/components/page-header";
import { StockEntryPanel } from "@/components/forms/warehouse-forms";
import { BulkStockDialog } from "@/components/forms/stock-bulk-import";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  const user = await requireUser();
  const lockedWarehouseCode = user.role === "WAREHOUSE" ? user.warehouseId : null;

  const [rows, warehouses, products] = await Promise.all([
    stockSummary(lockedWarehouseCode ? { warehouseCode: lockedWarehouseCode } : {}),
    listWarehouses(false),
    listProducts(false),
  ]);

  const canEntry =
    roleHasPermission(user.role, "stock.inward") || roleHasPermission(user.role, "stock.opening");
  const canAdjust = roleHasPermission(user.role, "stock.adjust");

  return (
    <div>
      <PageHeader
        title="Stock balances"
        description="Per warehouse and product: opening, inward, outward, transfers, closing, reserved and available."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
        actions={
          <div className="flex items-center gap-2">
            {canEntry ? (
              <BulkStockDialog
                warehouses={warehouses.map((warehouse) => ({
                  code: warehouse.code,
                  name: warehouse.name,
                }))}
                lockedWarehouseCode={lockedWarehouseCode}
                today={toZonedDateString(new Date())}
              />
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href="/warehouse/stock/ledger">Stock ledger</Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <CardTitle>Balances</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={[
                { key: "warehouseName", label: "Warehouse" },
                { key: "productName", label: "Product" },
                { key: "openingMt", label: "Opening", align: "right", render: (row) => formatMt(row.openingMt) },
                { key: "inwardMt", label: "Inward", align: "right", render: (row) => formatMt(row.inwardMt) },
                {
                  key: "transferInMt",
                  label: "Transfer in",
                  align: "right",
                  render: (row) => formatMt(row.transferInMt),
                },
                {
                  key: "transferOutMt",
                  label: "Transfer out",
                  align: "right",
                  render: (row) => formatMt(row.transferOutMt),
                },
                { key: "outwardMt", label: "Outward", align: "right", render: (row) => formatMt(row.outwardMt) },
                {
                  key: "adjustmentMt",
                  label: "Adjustment",
                  align: "right",
                  render: (row) => formatMt(row.adjustmentMt),
                },
                {
                  key: "onHandMt",
                  label: "Closing",
                  align: "right",
                  render: (row) => <span className="font-medium">{formatMt(row.onHandMt)}</span>,
                },
                { key: "reservedMt", label: "Reserved", align: "right", render: (row) => formatMt(row.reservedMt) },
                {
                  key: "availableMt",
                  label: "Available",
                  align: "right",
                  render: (row) => (
                    <span className="font-semibold text-emerald-700">{formatMt(row.availableMt)}</span>
                  ),
                },
              ]}
              rows={rows}
              rowKey={(row) => `${row.warehouseCode}-${row.productCode}`}
              emptyMessage="No stock recorded yet."
            />
          </CardContent>
        </Card>

        {canEntry ? (
          <Card>
            <CardHeader>
              <CardTitle>Stock entry</CardTitle>
            </CardHeader>
            <CardContent>
              <StockEntryPanel
                warehouses={warehouses.map((warehouse) => ({ code: warehouse.code, name: warehouse.name }))}
                products={products.map((product) => ({ code: product.code, name: product.name }))}
                balances={rows.map((row) => ({
                  warehouseCode: row.warehouseCode,
                  productCode: row.productCode,
                  onHandMt: row.onHandMt,
                  reservedMt: row.reservedMt,
                  availableMt: row.availableMt,
                }))}
                lockedWarehouseCode={canAdjust ? null : lockedWarehouseCode}
                today={toZonedDateString(new Date())}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Read-only</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">
              Your role can view stock but not change it. Warehouse users enter opening stock, inward
              receipts, transfers and physical counts.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
