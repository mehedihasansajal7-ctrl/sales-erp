/**
 * Bulk master-data import (Products / Customers / Warehouses).
 *
 * The operator pastes rows straight from Excel (tab separated) or from a CSV file.
 * A header row is optional: if the first row looks like a header (it contains known
 * column names) the columns are mapped by name, otherwise the documented column
 * order is assumed. Quoted CSV fields, `;` separated files, CRLF line endings and a
 * UTF-8 BOM are all handled, so nothing has to be "cleaned" before pasting.
 *
 * This module is pure (no database); the server action validates, checks duplicates
 * and writes through the normal services so every imported row is audited.
 */

export type BulkEntity = "products" | "customers" | "warehouses";

export type BulkField = {
  key: string;
  label: string;
  aliases: string[];
  required: boolean;
  hint?: string;
};

export const BULK_ENTITIES: Record<
  BulkEntity,
  { title: string; singular: string; fields: BulkField[]; sample: string[][] }
> = {
  products: {
    title: "Products",
    singular: "product",
    fields: [
      { key: "code", label: "Code", aliases: ["code", "product code", "sku"], required: true },
      { key: "name", label: "Name", aliases: ["name", "product", "product name"], required: true },
      { key: "category", label: "Category", aliases: ["category", "group", "type"], required: true },
      { key: "unit", label: "Unit", aliases: ["unit", "uom"], required: false, hint: "Default MT" },
    ],
    sample: [
      ["FERT-DAP", "DAP Fertilizer", "Fertilizer", "MT"],
      ["COAL-BIT", "Bituminous Coal", "Coal", "MT"],
    ],
  },
  customers: {
    title: "Customers",
    singular: "customer",
    fields: [
      { key: "name", label: "Name", aliases: ["name", "customer", "customer name"], required: true },
      { key: "phone", label: "Phone", aliases: ["phone", "mobile", "contact"], required: false },
      { key: "address", label: "Address", aliases: ["address", "location", "area"], required: false },
      { key: "creditLimit", label: "Credit limit", aliases: ["credit limit", "credit", "limit"], required: false },
    ],
    sample: [
      ["Sonali Traders", "01711223344", "Dhaka", "500000"],
      ["Meghna Agro", "01822334455", "Comilla", "250000"],
    ],
  },
  warehouses: {
    title: "Warehouses",
    singular: "warehouse",
    fields: [
      { key: "code", label: "Code", aliases: ["code", "warehouse code"], required: true },
      { key: "name", label: "Name", aliases: ["name", "warehouse", "warehouse name"], required: true },
      { key: "location", label: "Location", aliases: ["location", "address", "place"], required: false },
    ],
    sample: [
      ["WH-SYL", "Sylhet Warehouse", "Sylhet"],
      ["WH-KHL", "Khulna Ship Point", "Khulna"],
    ],
  },
};

export function isBulkEntity(value: string): value is BulkEntity {
  return value === "products" || value === "customers" || value === "warehouses";
}

/** Identity used to recognise a customer that is already on file: name + phone digits. */
export function customerKey(name: string, phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return `${name.trim().toLowerCase()}|${digits}`;
}

function detectDelimiter(line: string): string {
  const tabs = (line.match(/\t/g) ?? []).length;
  const commas = (line.match(/,/g) ?? []).length;
  const semicolons = (line.match(/;/g) ?? []).length;
  if (tabs >= commas && tabs >= semicolons && tabs > 0) return "\t";
  if (semicolons > commas) return ";";
  return ",";
}

/** RFC-4180-ish splitter: quotes, escaped quotes, tabs/commas/semicolons, CRLF. */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const firstLine = clean.split("\n").find((line) => line.trim() !== "") ?? "";
  const delimiter = detectDelimiter(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i]!;

    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows
    .map((cells) => cells.map((value) => value.trim()))
    .filter((cells) => cells.some((value) => value !== ""));
}

function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export type ParsedBulkRow = {
  /** 1-based line number in the pasted text (header counts as line 1). */
  line: number;
  values: Record<string, string>;
  preview: string;
};

export type ParseResult = {
  rows: ParsedBulkRow[];
  /** Columns that were not recognised, if a header row was used. */
  ignoredColumns: string[];
  /** True when the first line was treated as a column header. */
  usedHeader: boolean;
};

export function parseBulkInput(entity: BulkEntity, text: string): ParseResult {
  const table = parseDelimited(text);
  if (table.length === 0) return { rows: [], ignoredColumns: [], usedHeader: false };

  const fields = BULK_ENTITIES[entity].fields;
  const aliasToKey = new Map<string, string>();
  for (const field of fields) {
    aliasToKey.set(normaliseHeader(field.key), field.key);
    aliasToKey.set(normaliseHeader(field.label), field.key);
    for (const alias of field.aliases) aliasToKey.set(normaliseHeader(alias), field.key);
  }

  const firstCells = table[0]!.map(normaliseHeader);
  const usedHeader = firstCells.some((cell) => aliasToKey.has(cell));

  const columns: (string | null)[] = usedHeader
    ? firstCells.map((cell) => aliasToKey.get(cell) ?? null)
    : fields.map((field) => field.key);

  const ignoredColumns = usedHeader
    ? table[0]!.filter((_, index) => columns[index] === null).map((cell) => cell.trim())
    : [];

  const dataRows = usedHeader ? table.slice(1) : table;

  const rows = dataRows.map((cells, index) => {
    const values: Record<string, string> = {};
    columns.forEach((key, columnIndex) => {
      if (!key) return;
      values[key] = (cells[columnIndex] ?? "").trim();
    });

    // Keep only known keys (a header may map two columns to the same field).
    const preview =
      entity === "customers"
        ? values.name ?? ""
        : `${values.code ?? ""} ${values.name ?? ""}`.trim();

    return { line: index + (usedHeader ? 2 : 1), values, preview };
  });

  return { rows, ignoredColumns, usedHeader };
}

export function templateCsv(entity: BulkEntity): string {
  const { fields, sample } = BULK_ENTITIES[entity];
  const header = fields.map((field) => field.label).join(",");
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = sample.map((row) => row.map(escape).join(","));
  return `\uFEFF${[header, ...lines].join("\r\n")}\r\n`;
}

export type BulkRowStatus = "ok" | "invalid" | "duplicate";

export type BulkRowReport = {
  line: number;
  label: string;
  status: BulkRowStatus;
  message?: string;
};

export type BulkReport = {
  entity: BulkEntity;
  committed: boolean;
  imported: number;
  ok: number;
  invalid: number;
  duplicates: number;
  rows: BulkRowReport[];
  ignoredColumns: string[];
  usedHeader: boolean;
};

export const BULK_MAX_ROWS = 1000;
