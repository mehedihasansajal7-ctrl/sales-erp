import { notFound } from "next/navigation";
import { requirePermission, type SessionUser } from "@/lib/auth";
import { isAppError } from "@/lib/errors";
import { buildDoPrintable, type PrintablePayload } from "@/server/services/print.service";
import { PrintToolbar, PrintView } from "@/components/print-view";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

async function loadPayload(id: string, user: SessionUser): Promise<PrintablePayload> {
  try {
    return await buildDoPrintable(id, {
      id: user.id,
      name: user.name,
      role: user.role,
      warehouseCode: user.warehouseId,
    });
  } catch (error) {
    if (isAppError(error) && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
}

export default async function PrintDoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("do.view.all");
  const { id } = await params;
  const payload = await loadPayload(id, user);

  return (
    <div>
      <PrintToolbar
        pdfHref={`/api/print/do/${id}`}
        backHref={`/sales-ops/delivery-orders/${id}`}
        printButton={<PrintButton label="Print DO" />}
      />
      <PrintView payload={payload} />
    </div>
  );
}
