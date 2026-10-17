"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getClientIp, requirePermission } from "@/lib/auth";
import { doCancelSchema, doCreateSchema, doEditSchema, dispatchCreateSchema } from "@/lib/validation";
import {
  cancelDeliveryOrder,
  createDeliveryOrder,
  editDeliveryOrderQuantity,
} from "@/server/services/delivery-order.service";
import { recordDispatch } from "@/server/services/dispatch.service";
import {
  readJsonField,
  actionFailure,
  actionOk,
  bool,
  str,
  type ActionState,
} from "@/actions/helpers";

type DoItemPayload = { orderItemId: string; qtyMt: string }[];
type DispatchItemPayload = { doItemId: string; qtyMt: string }[];

/** Sales Ops creates a DO, choosing the warehouse manually (Rule 5). */
export async function createDeliveryOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null;
  try {
    const user = await requirePermission("do.create");
    if (bool(formData, "priorityOverride")) {
      // Guard the permission even though the service re-checks the setting.
      await requirePermission("do.priorityOverride");
    }

    const input = doCreateSchema.parse({
      orderId: str(formData, "orderId"),
      warehouseCode: str(formData, "warehouseCode"),
      note: str(formData, "note"),
      priorityOverride: bool(formData, "priorityOverride"),
      overrideReason: str(formData, "overrideReason"),
      items: readJsonField<DoItemPayload>(formData, "payload", []),
    });

    const result = await createDeliveryOrder(
      input,
      { id: user.id, name: user.name, role: user.role },
      await getClientIp(),
    );

    revalidatePath("/sales-ops/delivery-orders");
    revalidatePath("/warehouse/dispatch-orders");
    revalidatePath("/sales-ops/priority");
    revalidatePath("/dashboard");
    createdId = result.deliveryOrder.id;
  } catch (error) {
    return actionFailure(error);
  }

  redirect(`/sales-ops/delivery-orders/${createdId}?created=1`);
}

/**
 * Sales Ops corrects the quantities of a DO before anything is dispatched.
 * The warehouse can never do this.
 */
export async function editDeliveryOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("do.edit");
    const input = doEditSchema.parse({
      doId: str(formData, "doId"),
      reason: str(formData, "reason"),
      items: readJsonField<DoItemPayload>(formData, "payload", []),
    });

    const updated = await editDeliveryOrderQuantity(
      input,
      { id: user.id, name: user.name, role: user.role },
      await getClientIp(),
    );

    revalidatePath("/sales-ops/delivery-orders");
    revalidatePath(`/sales-ops/delivery-orders/${input.doId}`);
    revalidatePath("/warehouse/dispatch-orders");
    revalidatePath("/dashboard");

    return actionOk(
      `${updated.doNo} updated — ${updated.qtyMt} MT is now reserved in ${updated.warehouseName}.`,
    );
  } catch (error) {
    return actionFailure(error);
  }
}

/**
 * Cancels a DO. Only possible while nothing has been dispatched; the reservation
 * is released.
 */
export async function cancelDeliveryOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("do.cancel");
    const input = doCancelSchema.parse({
      doId: str(formData, "doId"),
      reason: str(formData, "reason"),
    });
    await cancelDeliveryOrder(
      input,
      { id: user.id, name: user.name, role: user.role },
      await getClientIp(),
    );
    revalidatePath("/sales-ops/delivery-orders");
    revalidatePath("/warehouse/dispatch-orders");
    revalidatePath("/dashboard");
    return actionOk("Delivery order cancelled and the reserved stock released.");
  } catch (error) {
    return actionFailure(error);
  }
}

/** Warehouse records a dispatch (Rule 6). */
export async function recordDispatchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("dispatch.create");
    const input = dispatchCreateSchema.parse({
      doId: str(formData, "doId"),
      truckNo: str(formData, "truckNo"),
      driverName: str(formData, "driverName"),
      driverPhone: str(formData, "driverPhone"),
      challanNo: str(formData, "challanNo"),
      loadingDate: str(formData, "loadingDate"),
      dispatchDate: str(formData, "dispatchDate"),
      remarks: str(formData, "remarks"),
      items: readJsonField<DispatchItemPayload>(formData, "payload", []),
    });

    const result = await recordDispatch(
      input,
      {
        id: user.id,
        name: user.name,
        role: user.role,
        warehouseCode: user.warehouseId,
      },
      await getClientIp(),
    );

    revalidatePath("/warehouse/dispatch-orders");
    revalidatePath(`/warehouse/dispatch-orders/${input.doId}`);
    revalidatePath("/warehouse/dispatch");
    revalidatePath("/sales-ops/delivery-orders");
    revalidatePath("/dashboard");

    return actionOk(
      `Dispatch recorded — challan ${result.dispatch.challanNo}, ${result.dispatch.qtyMt} MT. DO is now ${
        result.deliveryOrder.statusLabel
      }${result.order.status === "COMPLETED" ? " and the order is complete" : ""}.`,
    );
  } catch (error) {
    return actionFailure(error);
  }
}
