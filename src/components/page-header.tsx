import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, statusTone } from "@/lib/utils";

/** Page title + description + action buttons (used by every screen). */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumb?: { href: string; label: string }[];
}) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 ? (
          <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
            {breadcrumb.map((crumb, index) => (
              <React.Fragment key={crumb.href}>
                {index > 0 ? <span>/</span> : null}
                <Link href={crumb.href} className="hover:underline">
                  {crumb.label}
                </Link>
              </React.Fragment>
            ))}
          </nav>
        ) : null}
        <h1 className="truncate text-lg font-semibold text-slate-900 sm:text-xl">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={statusTone(status)}>{label ?? status.replace(/_/g, " ")}</Badge>;
}

export type Column<T> = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
  render?: (row: T) => React.ReactNode;
};

/** Plain, server-rendered data table. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = "No records found.",
  footer,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  emptyMessage?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn(
                  column.align === "right" && "text-right",
                  column.align === "center" && "text-center",
                  column.headerClassName,
                )}
              >
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={columns.length} message={emptyMessage} />
          ) : (
            rows.map((row, index) => (
              <TableRow key={rowKey(row, index)}>
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      column.align === "right" && "text-right tabular-nums",
                      column.align === "center" && "text-center",
                      column.className,
                    )}
                  >
                    {column.render
                      ? column.render(row)
                      : String((row as Record<string, unknown>)[column.key] ?? "—")}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {footer ? <div className="border-t border-slate-100 px-3 py-2 text-sm">{footer}</div> : null}
    </div>
  );
}

/** Pagination that works without JavaScript (plain links). */
export function Pagination({
  page,
  pageCount,
  total,
  basePath,
  searchParams,
}: {
  page: number;
  pageCount: number;
  total: number;
  basePath: string;
  searchParams?: Record<string, string | undefined>;
}) {
  const buildHref = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      if (value !== undefined && value !== "" && key !== "page") params.set(key, value);
    }
    if (target > 1) params.set("page", String(target));
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
      <p className="text-xs text-slate-500">
        {total} record{total === 1 ? "" : "s"} · page {page} of {pageCount}
      </p>
      <div className="flex items-center gap-1">
        <Button asChild variant="outline" size="sm" disabled={page <= 1}>
          <Link href={buildHref(Math.max(1, page - 1))}>Previous</Link>
        </Button>
        <Button asChild variant="outline" size="sm" disabled={page >= pageCount}>
          <Link href={buildHref(Math.min(pageCount, page + 1))}>Next</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * GET-based search + filters. Submitting reloads the page with query
 * parameters, so filtering keeps working with JavaScript disabled and every
 * filtered view stays linkable/bookmarkable.
 */
export function FilterBar({
  action,
  q,
  placeholder = "Search…",
  selects = [],
  hidden = {},
  children,
}: {
  action: string;
  q?: string;
  placeholder?: string;
  selects?: { name: string; label: string; value?: string; options: { value: string; label: string }[] }[];
  hidden?: Record<string, string>;
  children?: React.ReactNode;
}) {
  return (
    <form
      method="get"
      action={action}
      className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
    >
      {Object.entries(hidden).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <div className="min-w-48 flex-1">
        <Input name="q" defaultValue={q ?? ""} placeholder={placeholder} aria-label="Search" />
      </div>
      {selects.map((select) => (
        <div key={select.name} className="flex flex-col gap-1">
          <label htmlFor={`filter-${select.name}`} className="text-xs font-medium text-slate-500">
            {select.label}
          </label>
          <Select
            id={`filter-${select.name}`}
            name={select.name}
            defaultValue={select.value ?? ""}
            className="min-w-40"
          >
            <option value="">All</option>
            {select.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      ))}
      {children}
      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
  );
}

/** Small key/value list used on detail screens. */
export function DetailList({
  items,
  columns = 2,
}: {
  items: { label: string; value: React.ReactNode }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-3",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-3",
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Horizontal progress bar for delivery progress. */
export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-full max-w-40 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-slate-600">{label ?? `${percent}%`}</span>
    </div>
  );
}
