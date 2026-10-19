"use client";

import * as React from "react";
import { bulkImportMasterDataAction, type BulkImportState } from "@/actions/admin";
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
import { Field, Textarea } from "@/components/ui/form";
import { ActionFeedback } from "@/components/forms/shared";
import { BULK_ENTITIES, type BulkEntity } from "@/lib/bulk-import";

const initial: BulkImportState = { ok: false };

/**
 * Bulk add: paste rows straight from Excel (tab separated) or load a CSV file.
 *
 * Two steps on purpose - "Check rows" validates everything and shows exactly what
 * will happen, then "Import" writes only the rows that passed. Nothing is ever
 * overwritten: an existing code (or the same customer name + phone) is reported as
 * a duplicate and skipped.
 */
export function BulkImportDialog({ entity }: { entity: BulkEntity }) {
  const [open, setOpen] = React.useState(false);
  const meta = BULK_ENTITIES[entity];
  const [state, formAction, pending] = React.useActionState(bulkImportMasterDataAction, initial);
  const [text, setText] = React.useState("");

  const report = state.report;
  const canImport = Boolean(report && !report.committed && report.ok > 0);
  const lineCount = text.split(/\r?\n/).filter((line) => line.trim() !== "").length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Bulk add
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bulk add {meta.title.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Paste rows from Excel (tab separated) or from a CSV file. A header row is optional -
            columns are matched by name when a header is present. Existing records are never
            overwritten; duplicates are skipped and reported.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p className="mb-1 font-semibold text-slate-700">Columns (in this order)</p>
            <ol className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
              {meta.fields.map((field, index) => (
                <li key={field.key}>
                  <span className="font-medium text-slate-800">
                    {index + 1}. {field.label}
                  </span>
                  {field.required ? <span className="text-red-600"> *</span> : null}
                  {field.hint ? <span className="text-slate-400"> ({field.hint})</span> : null}
                </li>
              ))}
            </ol>
            <a
              className="font-medium text-emerald-700 underline-offset-4 hover:underline"
              href={`/api/admin/bulk-template/${entity}`}
            >
              Download the CSV template
            </a>
          </div>

          <form action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="entity" value={entity} />

            <Field
              label="Paste rows"
              htmlFor={`bulk-${entity}`}
              hint="One record per line. Blank lines are ignored. Maximum 1000 rows per import."
            >
              <Textarea
                id={`bulk-${entity}`}
                name="text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={9}
                className="font-mono text-xs"
                placeholder={meta.sample.map((row) => row.join("\t")).join("\n")}
                spellCheck={false}
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

            {report ? <BulkReportTable report={report} entity={entity} /> : null}

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
  if (status === "duplicate") return "Duplicate";
  return "Error";
}

function BulkReportTable({
  report,
  entity,
}: {
  report: NonNullable<BulkImportState["report"]>;
  entity: BulkEntity;
}) {
  const visible = report.rows.slice(0, 200);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="success">{report.ok} ready</Badge>
        {report.duplicates > 0 ? <Badge tone="warning">{report.duplicates} duplicate</Badge> : null}
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
              <th className="px-2 py-1.5 font-medium">
                {entity === "customers" ? "Customer" : "Code"}
              </th>
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
