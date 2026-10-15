import { requireUser } from "@/lib/auth";
import { zonedToUtc, formatDateTime } from "@/lib/dates";
import prisma from "@/lib/prisma";
import { listProducts, listWarehouses } from "@/server/services/master-data.service";
import { formatMt } from "@/lib/utils";
import { DataTable, FilterBar, PageHeader, Pagination } from "@/components/page-header";

export const dynamic = "force-dynamic";

/** Rule 7 — immutable movement ledger. */
export default async function StockLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const get = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const page = Math.max(1, Number(get("page") ?? 1));
  const pageSize = 25;
  const warehouseCode = user.role === "WAREHOUSE" ? (user.warehouseId ?? "__none__") : get("warehouseCode");

  const where = {
    ...(warehouseCode ? { warehouseId: warehouseCode } : {}),
    ...(get("productCode") ? { productCode: get("productCode") as string } : {}),
    ...(get("movementType") ? { movementType: get("movementType") as never } : {}),
    ...(get("from") || get("to")
      ? {
          createdAt: {
            ...(get("from") ? { gte: zonedToUtc(get("from") as string) } : {}),
            ...(get("to") ? { lte: zonedToUtc(`${get("to")}T23:59:59`) } : {}),
          },
        }
      : {}),
  };

  const [rows, total, warehouses, products] = await Promise.all([
    prisma.stockLedger.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { warehouse: true, product: true, creator: { select: { name: true } } },
    }),
    prisma.stockLedger.count({ where }),
    listWarehouses(),
    listProducts(),
  ]);

  return (
    <div>
      <PageHeader
        title="Stock ledger"
        description="Every movement is an immutable row with the balance after the movement. Reserve/unreserve rows carry the reserved delta."
        breadcrumb={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/warehouse/stock", label: "Stock" },
        ]}
      />

      <FilterBar
        action="/warehouse/stock/ledger"
        placeholder="Filter by warehouse, product, movement and dates"
        selects={[
          {
            name: "warehouseCode",
            label: "Warehouse",
            value: get("warehouseCode"),
            options: warehouses.map((warehouse) => ({ value: warehouse.code, label: warehouse.name })),
          },
          {
            name: "productCode",
            label: "Product",
            value: get("productCode"),
            options: products.map((product) => ({ value: product.code, label: product.name })),
          },
          {
            name: "movementType",
            label: "Movement",
            value: get("movementType"),
            options: [
              "OPENING",
              "INWARD",
              "OUTWARD",
              "TRANSFER_IN",
              "TRANSFER_OUT",
              "ADJUSTMENT",
              "RESERVE",
              "UNRESERVE",
            ].map((value) => ({ value, label: value.replace(/_/g, " ") })),
          },
        ]}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-xs font-medium text-slate-500">
            From
          </label>
          <input
            id="from"
            type="date"
            name="from"
            defaultValue={get("from") ?? ""}
            className="h-9 rounded-md border border-slate-300 px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-xs font-medium text-slate-500">
            To
          </label>
          <input
            id="to"
            type="date"
            name="to"
            defaultValue={get("to") ?? ""}
            className="h-9 rounded-md border border-slate-300 px-3 text-sm"
          />
        </div>
      </FilterBar>

      <DataTable
        columns={[
          { key: "when", label: "When", render: (row) => formatDateTime(row.createdAt) },
          { key: "warehouse", label: "Warehouse", render: (row) => row.warehouse.name },
          { key: "product", label: "Product", render: (row) => row.product.name },
          {
            key: "movementType",
            label: "Movement",
            render: (row) => row.movementType.replace(/_/g, " "),
          },
          { key: "qtyMt", label: "Qty (MT)", align: "right", render: (row) => formatMt(row.qtyMt.toString()) },
          {
            key: "balanceAfter",
            label: "On hand after",
            align: "right",
            render: (row) => formatMt(row.balanceAfter.toString()),
          },
          {
            key: "reservedAfter",
            label: "Reserved after",
            align: "right",
            render: (row) => formatMt(row.reservedAfter.toString()),
          },
          { key: "reference", label: "Reference", render: (row) => `${row.refType ?? "—"} ${row.refId ? `· ${row.refId.slice(0, 8)}` : ""}` },
          { key: "note", label: "Note", render: (row) => row.note ?? "—" },
          { key: "user", label: "By", render: (row) => row.creator?.name ?? "system" },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        emptyMessage="No stock movements match the filter."
      />

      <div className="mt-3">
        <Pagination
          page={page}
          pageCount={Math.max(1, Math.ceil(total / pageSize))}
          total={total}
          basePath="/warehouse/stock/ledger"
          searchParams={{
            warehouseCode: get("warehouseCode"),
            productCode: get("productCode"),
            movementType: get("movementType"),
            from: get("from"),
            to: get("to"),
          }}
        />
      </div>
    </div>
  );
}
