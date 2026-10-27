"use client";

import * as React from "react";
import { bulkStockEntryAction, type StockBulkState } from "@/actions/inventory";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ActionFeedback } from "@/components/forms/shared";
import {
  STOCK_BULK_FIELDS,
  STOCK_BULK_SAMPLES,
  type StockBulkMode,
  type StockBulkReport,
} from "@/lib/stock-bulk";

const initial: StockBulkState = { ok: false };

type WarehouseOption = { code: string; name: string };

/**
 * Bulk stock entry: opening balances on day one, or a multi-product inward receipt
 * (one vessel / truck carrying several products). Same two-step flow as the
 * master-data importer - check first, then import the rows that passed.
 */
export function BulkStockDialog({
  warehouses,
  lockedWarehouseCode,
  today,
  defaultMode = "inward",
}: {
  warehouses: WarehouseOption[];
  lockedWarehouseCode: string | null;
  today: string;
  defaultMode?: StockBulkMode;
}) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<StockBulkMode>(defaultMode);
  const [state, formAction, pending] = React.useActionState(bulkStockEntryAction, initial);
  const [text, setText] = React.useState("");
  const [warehouseCode, setWarehouseCode] = React.useState(lockedWarehouseCode ?? "");
  const [movementDate, setMovementDate] = React.useState(today);

  const report = state.report;
  const canImport = Boolean(report && !report.committed && report.ok > 0);
  const fields = STOCK_BULK_FIELDS[mode];
  const sample = STOCK_BULK_SAMPLES[mode];
  const lineCount = text.split(/\r?\n/).filter((line) => line.trim() !== "").length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Bulk entry
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bulk stock entry</DialogTitle>
          <DialogDescription>
            Paste rows from Excel (tab separated) or from a CSV file. The date applies to every row in
            this batch, so a back-dated receipt is entered with the day the goods actually arrived.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p className="mb-1 font-semibold text-slate-700">Columns (in this order)</p>
            <ol className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
              {fields.map((field, index) => (
                <li key={field.key}>
                  <span className="font-medium text-slate-800">
                    {index + 1}. {field.label}
                  </span>
                  {field.required ? <span className="text-red-600"> *</span> : null}
                </li>
              ))}
            </ol>
            <a
              className="font-medium text-emerald-700 underline-offset-4 hover:underline"
              href={`/api/warehouse/stock/bulk-template?mode=${mode}`}
            >
              Download the CSV template
            </a>
          </div>

          <form action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="mode" value={mode} />

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="What are you entering?" htmlFor="bulk-stock-mode">
                <Select
                  id="bulk-stock-mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value === "opening" ? "opening" : "inward")}
                >
                  <option value="inward">Inward receipt</option>
                  <option value="opening">Opening stock</option>
                </Select>
              </Field>

              <Field label="Warehouse" htmlFor="bulk-stock-warehouse" required>
                <Select
                  id="bulk-stock-warehouse"
                  name="warehouseCode"
                  required
                  value={warehouseCode}
                  disabled={Boolean(lockedWarehouseCode)}
                  onChange={(event) => setWarehouseCode(event.target.value)}
                >
                  <option value="" disabled>
                    Select a warehouse
                  </option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.code} value={warehouse.code}>
                      {warehouse.name}
                    </option>
                  ))}
                </Select>
                {lockedWarehouseCode ? (
                  <input type="hidden" name="warehouseCode" value={lockedWarehouseCode} />
                ) : null}
              </Field>

              <Field label="Entry date" htmlFor="bulk-stock-date" required>
                <Input
                  id="bulk-stock-date"
                  name="movementDate"
                  type="date"
                  value={movementDate}
                  max={today}
                  onChange={(event) => setMovementDate(event.target.value)}
                  required
                />
              </Field>
            </div>

            <Field
              label="Paste rows"
              htmlFor="bulk-stock-text"
              hint="One product per line. Maximum 1000 rows. Opening stock is refused for a product that already has movements."
            >
              <Textarea
                id="bulk-stock-text"
                name="text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={9}
                className="font-mono text-xs"
                spellCheck={false}
                placeholder={sample
                  .map((row) =>
                    [
                      row.productCode,
                      row.qtyMt,
                      ...(mode === "inward" ? [row.reference ?? ""] : []),
                      row.note ?? "",
                    ].join("\t"),
                  )
                  .join("\n")}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
                <input
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setText(await file.text());
                  }}
                />
                Load a .csv file
              </label>
              <span className="text-xs text-slate-500">
                {lineCount > 0 ? `${lineCount} line(s) pasted` : "nothing pasted yet"}
              </span>
            </div>

            <ActionFeedback state={state} />

            {report ? <StockBulkReportTable report={report} /> : null}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button type="submit" name="commit" value="false" variant="secondary" disabled={pending}>
                {pending ? "Working..." : "Check rows"}
              </Button>
              <Button
                type="submit"
                name="commit"
                value="true"
                variant="primary"
                disabled={pending || !canImport}
              >
                Import {report && report.ok > 0 ? `${report.ok} row(s)` : "rows"}
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function statusTone(status: "ok" | "invalid" | "duplicate") {
  if (status === "ok") return "success" as const;
  if (status === "duplicate") return "warning" as const;
  return "danger" as const;
}

function statusLabel(status: "ok" | "invalid" | "duplicate") {
  if (status === "ok") return "Ready";
  if (status === "duplicate") return "Skipped";
  return "Error";
}

function StockBulkReportTable({ report }: { report: StockBulkReport }) {
  const visible = report.rows.slice(0, 200);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="success">{report.ok} ready</Badge>
        {report.duplicates > 0 ? <Badge tone="warning">{report.duplicates} skipped</Badge> : null}
        {report.invalid > 0 ? <Badge tone="danger">{report.invalid} error</Badge> : null}
        {report.committed ? <Badge tone="info">{report.imported} imported</Badge> : null}
        {report.ignoredColumns.length > 0 ? (
          <span className="text-slate-500">Ignored columns: {report.ignoredColumns.join(", ")}</span>
        ) : null}
      </div>

      <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-1.5 font-medium">Line</th>
              <th className="px-2 py-1.5 font-medium">Product</th>
              <th className="px-2 py-1.5 font-medium">Status</th>
              <th className="px-2 py-1.5 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={`${row.line}-${row.label}`} className="border-t border-slate-100">
                <td className="px-2 py-1.5 text-slate-500">{row.line}</td>
                <td className="px-2 py-1.5 font-medium text-slate-800">{row.label || "-"}</td>
                <td className="px-2 py-1.5">
                  <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                </td>
                <td className="px-2 py-1.5 text-slate-600">{row.message ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.rows.length > visible.length ? (
        <p className="text-xs text-slate-500">
          Showing the first {visible.length} of {report.rows.length} rows.
        </p>
      ) : null}
    </div>
  );
}
