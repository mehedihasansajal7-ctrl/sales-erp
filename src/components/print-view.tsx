import Link from "next/link";
import type { PrintablePayload } from "@/server/services/print.service";

/** Clean, print-ready rendering of a printable document (A4, hides the app chrome). */
export function PrintView({ payload }: { payload: PrintablePayload }) {
  return (
    <div className="print-area mx-auto max-w-3xl bg-white p-6 text-slate-900 shadow-sm print:p-0 print:shadow-none">
      <header className="border-b border-slate-300 pb-3">
        <h1 className="text-lg font-bold">{payload.meta.company || "Bulk Commodity Trading Ltd."}</h1>
        {payload.meta.companyAddress ? (
          <p className="text-xs text-slate-600">{payload.meta.companyAddress}</p>
        ) : null}
        <p className="mt-2 text-base font-semibold">{payload.meta.title}</p>
        <p className="text-sm text-slate-600">
          {payload.meta.docNo}
          {payload.meta.status ? ` · ${payload.meta.status}` : ""}
        </p>
      </header>

      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2 print:grid-cols-2">
        {payload.keyValues.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b border-dotted border-slate-200 py-1">
            <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className="text-right text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      {payload.tables.map((table, index) => (
        <section key={`${table.title}-${index}`} className="mt-5">
          {table.title ? <h2 className="mb-1 text-sm font-semibold">{table.title}</h2> : null}
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-50">
                {table.columns.map((column, columnIndex) => (
                  <th
                    key={`${column}-${columnIndex}`}
                    className={`px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600 ${
                      table.align?.[columnIndex] === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-slate-100">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={`px-2 py-1 ${
                        table.align?.[cellIndex] === "right" ? "text-right tabular-nums" : "text-left"
                      }`}
                    >
                      {cell === "" ? "\u00a0" : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {payload.notes.length > 0 ? (
        <ul className="mt-4 list-disc pl-5 text-xs text-slate-600">
          {payload.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <footer className="mt-10 grid grid-cols-3 gap-6 print:grid-cols-3">
        {payload.signatures.map((label) => (
          <div key={label} className="border-t border-slate-400 pt-1 text-center text-xs text-slate-600">
            {label}
          </div>
        ))}
      </footer>
    </div>
  );
}

/** Wraps a print view with the toolbar that is hidden when printing. */
export function PrintToolbar({
  pdfHref,
  backHref,
  printButton,
}: {
  pdfHref: string;
  backHref: string;
  printButton?: React.ReactNode;
}) {
  return (
    <div className="no-print mx-auto mb-3 flex max-w-3xl flex-wrap items-center justify-between gap-2">
      <Link href={backHref} className="text-sm text-slate-600 underline-offset-4 hover:underline">
        ← Back
      </Link>
      <div className="flex items-center gap-2">
        {printButton}
        <a
          href={pdfHref}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
        >
          Download PDF
        </a>
      </div>
    </div>
  );
}
