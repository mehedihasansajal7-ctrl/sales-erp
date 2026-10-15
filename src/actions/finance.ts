"use server";

import { revalidatePath } from "next/cache";
import { getClientIp, requirePermission } from "@/lib/auth";
import { ratePublishSchema } from "@/lib/validation";
import { publishRate } from "@/server/services/rate.service";
import { actionFailure, actionOk, str, type ActionState } from "@/actions/helpers";

/** Finance publishes a product rate (Rule 1 — a new rate is always a new row). */
export async function publishRateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("rate.publish");
    const input = ratePublishSchema.parse({
      productCode: str(formData, "productCode"),
      ratePerMt: str(formData, "ratePerMt"),
      effectiveFrom: str(formData, "effectiveFrom"),
      note: str(formData, "note"),
    });

    const result = await publishRate(
      input,
      { id: user.id, name: user.name, role: user.role },
      await getClientIp(),
    );

    revalidatePath("/finance/rates");
    revalidatePath("/finance/rates/history");
    revalidatePath("/dashboard");

    return actionOk(
      `Rate for ${result.rate.productCode} published at ৳${result.rate.ratePerMt.toFixed(2)}/MT${
        result.supersededCount > 0
          ? ` — ${result.supersededCount} earlier rate superseded (history kept)`
          : ""
      }.`,
    );
  } catch (error) {
    return actionFailure(error);
  }
}
