import { parseTable } from "@/lib/bulk-import";

/**
 * Bulk stock entry: paste a list of product codes and quantities straight from Excel
 * (tab separated) or load a CSV. Used for opening balances on day one, and for a
 * multi-product inward receipt (one vessel/truck carrying several products).
 */

export type StockBulkMode = "opening" | "inward";

export type StockBulkField = {
  key: string;
  label: string;
  aliases: string[];
  required: boolean;
  hint?: string;
};

export const STOCK_BULK_FIELDS: Record<StockBulkMode, StockBulkField[]> = {
  opening: [
    {
      key: "productCode",
      label: "Product code",
      aliases: ["product", "product code", "code", "sku", "product id"],
      required: true,
    },
    {
      key: "qtyMt",
      label: "Quantity (MT)",
      aliases: ["quantity", "quantity (mt)", "qty", "qty mt", "qty (mt)", "mt"],
      required: true,
    },
    { key: "note", label: "Note", aliases: ["note", "remarks", "remark"], required: false },
  ],
  inward: [
    {
      key: "productCode",
      label: "Product code",
      aliases: ["product", "product code", "code", "sku", "product id"],
      required: true,
    },
    {
      key: "qtyMt",
      label: "Quantity (MT)",
      aliases: ["quantity", "quantity (mt)", "qty", "qty mt", "qty (mt)", "mt"],
      required: true,
    },
    {
      key: "reference",
      label: "Reference",
      aliases: ["reference", "challan", "lc", "challan / lc", "challan no", "lc no"],
      required: false,
    },
    { key: "note", label: "Note", aliases: ["note", "remarks", "remark"], required: false },
  ],
};

export type StockBulkSample = { productCode: string; qtyMt: string; reference?: string; note?: string };

export const STOCK_BULK_SAMPLES: Record<StockBulkMode, StockBulkSample[]> = {
  opening: [
    { productCode: "FERT-UREA", qtyMt: "500.000", note: "Opening as at go-live" },
    { productCode: "COAL-IMPORT", qtyMt: "1200.000" },
  ],
  inward: [
    { productCode: "FERT-UREA", qtyMt: "250.000", reference: "LC-2026-0045" },
    { productCode: "GRAIN-WHEAT", qtyMt: "80.000", reference: "LC-2026-0046" },
  ],
};

export type ParsedStockRow = {
  line: number;
  productCode: string;
  qtyMt: string;
  reference: string;
  note: string;
};

export function parseStockBulkInput(
  mode: StockBulkMode,
  text: string,
): { rows: ParsedStockRow[]; ignoredColumns: string[]; usedHeader: boolean } {
  const fields = STOCK_BULK_FIELDS[mode];
  const table = parseTable(text, fields);

  const rows = table.rows.map((row) => ({
    line: row.line,
    productCode: (row.values.productCode ?? "").toUpperCase(),
    qtyMt: (row.values.qtyMt ?? "").replace(/,/g, ""),
    reference: row.values.reference ?? "",
    note: row.values.note ?? "",
  }));

  return { rows, ignoredColumns: table.ignoredColumns, usedHeader: table.usedHeader };
}

export function stockBulkTemplateCsv(mode: StockBulkMode): string {
  const fields = STOCK_BULK_FIELDS[mode];
  const rows = STOCK_BULK_SAMPLES[mode].map((sample) =>
    fields
      .map((field) => {
        const value = (sample as Record<string, string | undefined>)[field.key] ?? "";
        return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
      })
      .join(","),
  );
  return `\uFEFF${[fields.map((field) => field.label).join(","), ...rows].join("\r\n")}\r\n`;
}

export type StockBulkRowStatus = "ok" | "invalid" | "duplicate";

export type StockBulkRowReport = {
  line: number;
  label: string;
  status: StockBulkRowStatus;
  message?: string;
};

export type StockBulkReport = {
  mode: StockBulkMode;
  committed: boolean;
  imported: number;
  ok: number;
  invalid: number;
  duplicates: number;
  rows: StockBulkRowReport[];
  ignoredColumns: string[];
  usedHeader: boolean;
};

export const STOCK_BULK_MAX_ROWS = 1000;
