import { NextResponse } from "next/server";
import { getClientIp, requireUser, requirePermission } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { toAppError } from "@/lib/errors";
import { renderPrintableToPdf } from "@/server/services/export.service";
import { buildPrintable } from "@/server/services/print.service";

export const dynamic = "force-dynamic";

/**
 * Server-rendered PDF of a printable document:
 *   /api/print/order/<id>    order confirmation
 *   /api/print/do/<id>       delivery order copy
 *   /api/print/challan/<id>  dispatch challan
 */
export async function GET(request: Request, context: { params: Promise<{ type: string; id: string }> }) {
  try {
    const user = await requireUser();
    const { type, id } = await context.params;

    // Printing is a read, but it is still permission-gated per document type.
    if (type === "order") await requirePermission("order.print");
    else if (type === "do") await requirePermission("do.view.all");
    else if (type === "challan") await requirePermission("dispatch.view.all");
    else return NextResponse.json({ error: "Unknown printable document" }, { status: 404 });

    const payload = await buildPrintable(type, id, {
      id: user.id,
      name: user.name,
      role: user.role,
      warehouseCode: user.warehouseId,
    });

    const buffer = await renderPrintableToPdf(payload.document);

    await writeAudit({
      userId: user.id,
      userName: user.name,
      action: "UPDATE",
      entity: type === "order" ? "order" : type === "do" ? "delivery_order" : "dispatch",
      entityId: id,
      newValue: { printed: true, format: "pdf" },
      ip: await getClientIp(),
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${payload.meta.docNo.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`,
      },
    });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json({ error: appError.message, code: appError.code }, { status: appError.status });
  }
}
