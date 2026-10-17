import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { toAppError } from "@/lib/errors";
import { toZonedDateString, zonedToUtc } from "@/lib/dates";
import { rowsToCsv, reportsToExcel, reportsToPdf } from "@/server/services/export.service";
import { REPORTS, getReport, type ReportKey } from "@/server/services/report.service";

export const dynamic = "force-dynamic";

/**
 * Report export endpoint: /api/reports/<key>/export?format=xlsx|pdf|csv
 * Permission is checked server-side before any report runs.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  try {
    const user = await requirePermission("report.view");
    const { key } = await context.params;
    if (!Object.prototype.hasOwnProperty.call(REPORTS, key)) {
      return NextResponse.json({ error: `Unknown report ${key}` }, { status: 404 });
    }

    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "xlsx").toLowerCase();
    const from = zonedToUtc(url.searchParams.get("from") ?? toZonedDateString(new Date(Date.now() - 30 * 86400000)));
    const toParam = url.searchParams.get("to") ?? toZonedDateString();
    const to = zonedToUtc(`${toParam}T23:59:59`);

    // Anything that is not a known filter is a per-report option (e.g. groupBy),
    // so the export always matches what the screen is showing.
    const known = new Set(["format", "from", "to", "warehouseCode", "customerCode", "productCode"]);
    const options: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      if (!known.has(key) && value !== "") options[key] = value;
    }

    const report = getReport(key as ReportKey);
    const rows = await report.run(
      {
        from,
        to,
        warehouseCode: url.searchParams.get("warehouseCode") ?? undefined,
        customerCode: url.searchParams.get("customerCode") ?? undefined,
        productCode: url.searchParams.get("productCode") ?? undefined,
        options,
      },
      { id: user.id, name: user.name, role: user.role, warehouseCode: user.warehouseId },
    );

    const meta = {
      title: report.title,
      generatedBy: user.name,
      generatedAt: new Date(),
      filterNote: `${toZonedDateString(from)} → ${toParam}`,
    };

    const stamp = `${key}-${toZonedDateString()}`;

    if (format === "csv") {
      const columns = report.columns.map((column) => column.label);
      const data = rows.map((row) => report.columns.map((column) => row[column.key] ?? ""));
      return new NextResponse(rowsToCsv(columns, data), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${stamp}.csv"`,
        },
      });
    }

    if (format === "pdf") {
      const buffer = await reportsToPdf([{ report, rows }], meta);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${stamp}.pdf"`,
        },
      });
    }

    const buffer = await reportsToExcel([{ report, rows }], meta);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${stamp}.xlsx"`,
      },
    });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json({ error: appError.message, code: appError.code }, { status: appError.status });
  }
}
