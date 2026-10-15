import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isAppError } from "@/lib/errors";
import { buildChallanPrintable, type PrintablePayload } from "@/server/services/print.service";
import { PrintToolbar, PrintView } from "@/components/print-view";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

async function loadPayload(id: string): Promise<PrintablePayload> {
  try {
    return await buildChallanPrintable(id);
  } catch (error) {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  }
}

export default async function PrintChallanPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const payload = await loadPayload(id);

  return (
    <div>
      <PrintToolbar
        pdfHref={`/api/print/challan/${id}`}
        backHref="/warehouse/dispatch"
        printButton={<PrintButton label="Print challan" />}
      />
      <PrintView payload={payload} />
    </div>
  );
}
