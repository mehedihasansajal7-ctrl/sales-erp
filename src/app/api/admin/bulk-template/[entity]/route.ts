import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errors, toAppError } from "@/lib/errors";
import { isBulkEntity, templateCsv } from "@/lib/bulk-import";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/bulk-template/products|customers|warehouses
 * Downloads a CSV with the exact column headers (plus two example rows) that the
 * bulk import accepts. UTF-8 with BOM so Excel opens the Bangla/`-` characters
 * correctly.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ entity: string }> },
) {
  try {
    const user = await requireUser();
    if (user.role !== "ADMIN") throw errors.forbidden("bulk import");

    const { entity } = await context.params;
    if (!isBulkEntity(entity)) {
      return NextResponse.json({ error: "Unknown data type" }, { status: 404 });
    }

    return new NextResponse(templateCsv(entity), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${entity}-template.csv"`,
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
