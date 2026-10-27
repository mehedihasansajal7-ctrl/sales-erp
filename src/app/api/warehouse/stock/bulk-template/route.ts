import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errors, toAppError } from "@/lib/errors";
import { stockBulkTemplateCsv, type StockBulkMode } from "@/lib/stock-bulk";

export const dynamic = "force-dynamic";

/**
 * GET /api/warehouse/stock/bulk-template?mode=opening|inward
 * CSV template for the bulk stock entry (UTF-8 with BOM so Excel opens it cleanly).
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!["ADMIN", "WAREHOUSE"].includes(user.role)) {
      throw errors.forbidden("bulk stock entry");
    }

    const mode: StockBulkMode =
      new URL(request.url).searchParams.get("mode") === "opening" ? "opening" : "inward";

    return new NextResponse(stockBulkTemplateCsv(mode), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="stock-${mode}-template.csv"`,
      },
    });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(
      { error: appError.message, code: appError.code },
      { status: appError.status },
    );
  }
}
