import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { zonedToUtc } from "@/lib/dates";
import { listDispatches } from "@/server/services/dispatch.service";
import { listWarehouses } from "@/server/services/master-data.service";
import { formatMt } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataTable, FilterBar, PageHeader, Pagination } from "@/components/page-header";

export const dynamic = "force-dynamic";

/** Rule 6 — the dispatch register (challan-wise vehicle movement history). */
export default async function DispatchRegisterPage({
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

  const [dispatches, warehouses] = await Promise.all([
    listDispatches(
      {
        q: get("q"),
        warehouseCode: get("warehouseCode"),
        from: get("from") ? zonedToUtc(get("from") as string) : undefined,
        to: get("to") ? zonedToUtc(`${get("to")}T23:59:59`) : undefined,
        page: Number(get("page") ?? 1),
        pageSize: 20,
      },
      { id: user.id, name: user.name, role: user.role, warehouseCode: user.warehouseId },
    ),
    listWarehouses(),
  ]);

  return (
    <div>
      <PageHeader
        title="Dispatch register"
        description="Every dispatch with DO, order, customer, truck, driver, challan and quantity."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/reports/dispatch-register">Export to Excel / PDF</Link>
          </Button>
        }
      />

      <FilterBar
        action="/warehouse/dispatch"
        q={get("q")}
        placeholder="Search challan, truck, driver, DO, order or customer"
        selects={[
          {
            name: "warehouseCode",
            label: "Warehouse",
            value: get("warehouseCode"),
            options: warehouses.map((warehouse) => ({ value: warehouse.code, label: warehouse.name })),
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
          { key: "challanNo", label: "Challan" },
          {
            key: "doNo",
            label: "DO",
            render: (row) => (
              <Link href={`/warehouse/dispatch-orders/${row.id}`} className="text-emerald-700 hover:underline">
                {row.doNo}
              </Link>
            ),
          },
          { key: "orderNo", label: "Order" },
          { key: "customerName", label: "Customer" },
          { key: "warehouseName", label: "Warehouse" },
          {
            key: "items",
            label: "Products",
            render: (row) => row.items.map((item) => item.productName).join(", ") || "—",
          },
          { key: "qtyMt", label: "Qty (MT)", align: "right", render: (row) => formatMt(row.qtyMt) },
          { key: "truckNo", label: "Truck" },
          {
            key: "driver",
            label: "Driver",
            render: (row) => (
              <span>
                {row.driverName}
                <span className="block text-xs text-slate-500">{row.driverPhone}</span>
              </span>
            ),
          },
          { key: "loadingDate", label: "Loading", render: (row) => formatDate(row.loadingDate) },
          { key: "dispatchDate", label: "Dispatched", render: (row) => formatDate(row.dispatchDate) },
          { key: "recordedByName", label: "Recorded by" },
          {
            key: "action",
            label: "",
            align: "right",
            render: (row) => (
              <Button asChild size="sm" variant="ghost">
                <Link href={`/print/challan/${row.id}`} target="_blank">
                  Challan
                </Link>
              </Button>
            ),
          },
        ]}
        rows={dispatches.rows}
        rowKey={(row) => row.id}
        emptyMessage="No dispatches match the filter."
      />

      <div className="mt-3">
        <Pagination
          page={dispatches.page}
          pageCount={dispatches.pageCount}
          total={dispatches.total}
          basePath="/warehouse/dispatch"
          searchParams={{
            q: get("q"),
            warehouseCode: get("warehouseCode"),
            from: get("from"),
            to: get("to"),
          }}
        />
      </div>
    </div>
  );
}
