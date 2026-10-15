"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getClientIp, requirePermission } from "@/lib/auth";
import {
  orderApproveSchema,
  orderCancelSchema,
  orderCreateSchema,
  orderRejectSchema,
  orderShortCloseSchema,
  rateOverrideSchema,
} from "@/lib/validation";
import {
  approveOrder,
  cancelOrder,
  createOrder,
  overrideOrderItemRate,
  rejectOrder,
  shortCloseOrder,
} from "@/server/services/order.service";
import { readJsonField, actionFailure, actionOk, str, type ActionState } from "@/actions/helpers";

type ItemPayload = { productCode: string; qtyMt: string }[];

/** Sales creates an order — the rate is copied and locked at creation (Rule 1). */
export async function createOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null;
  try {
    const user = await requirePermission("order.create");
    const input = orderCreateSchema.parse({
      customerCode: str(formData, "customerCode"),
      orderDate: str(formData, "orderDate") || undefined,
      remarks: str(formData, "remarks"),
      items: readJsonField<ItemPayload>(formData, "payload", []),
    });

    const order = await createOrder(
      input,
      { id: user.id, name: user.name, role: user.role },
      await getClientIp(),
    );

    revalidatePath("/sales/orders");
    revalidatePath("/sales-ops/approvals");
    revalidatePath("/dashboard");
    createdId = order.id;
  } catch (error) {
    return actionFailure(error);
  }

  redirect(`/sales/orders/${createdId}?created=1`);
}

export async function approveOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("order.approve");
    const input = orderApproveSchema.parse({
      orderId: str(formData, "orderId"),
      creditOverride: formData.get("creditOverride") === "on",
      overrideReason: str(formData, "overrideReason"),
    });

    await approveOrder(
      input,
      { id: user.id, name: user.name, role: user.role },
      await getClientIp(),
    );

    revalidatePath("/sales-ops/approvals");
    revalidatePath("/sales-ops/priority");
    revalidatePath("/sales/orders");
    revalidatePath("/dashboard");
    return actionOk("Order approved.");
  } catch (error) {
    return actionFailure(error);
  }
}

export async function rejectOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("order.reject");
    const input = orderRejectSchema.parse({
      orderId: str(formData, "orderId"),
      reason: str(formData, "reason"),
    });
    await rejectOrder(input, { id: user.id, name: user.name, role: user.role }, await getClientIp());
    revalidatePath("/sales-ops/approvals");
    revalidatePath("/sales/orders");
    revalidatePath("/dashboard");
    return actionOk("Order rejected.");
  } catch (error) {
    return actionFailure(error);
  }
}

export async function cancelOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("order.cancel");
    const input = orderCancelSchema.parse({
      orderId: str(formData, "orderId"),
      reason: str(formData, "reason"),
    });
    await cancelOrder(input, { id: user.id, name: user.name, role: user.role }, await getClientIp());
    revalidatePath("/sales/orders");
    revalidatePath("/sales-ops/priority");
    revalidatePath("/dashboard");
    return actionOk("Order cancelled and any reservations released.");
  } catch (error) {
    return actionFailure(error);
  }
}

export async function shortCloseOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("order.shortClose");
    const input = orderShortCloseSchema.parse({
      orderId: str(formData, "orderId"),
      reason: str(formData, "reason"),
    });
    await shortCloseOrder(
      input,
      { id: user.id, name: user.name, role: user.role },
      await getClientIp(),
    );
    revalidatePath("/sales/orders");
    revalidatePath("/sales-ops/priority");
    revalidatePath("/dashboard");
    return actionOk("Order short closed. The customer's next order is now unblocked.");
  } catch (error) {
    return actionFailure(error);
  }
}

/** Sales Ops-only rate override on a pending order line (audited). */
export async function overrideOrderItemRateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("order.overrideRate");
    const input = rateOverrideSchema.parse({
      orderItemId: str(formData, "orderItemId"),
      lockedRatePerMt: str(formData, "lockedRatePerMt"),
      reason: str(formData, "reason"),
    });
    const result = await overrideOrderItemRate(
      input,
      { id: user.id, name: user.name, role: user.role },
      await getClientIp(),
    );
    revalidatePath("/sales-ops/approvals");
    revalidatePath("/sales/orders");
    return actionOk(`Rate overridden to ৳${result.lockedRatePerMt}/MT.`);
  } catch (error) {
    return actionFailure(error);
  }
}
