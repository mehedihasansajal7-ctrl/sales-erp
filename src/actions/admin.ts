"use server";

import { revalidatePath } from "next/cache";
import { getClientIp, requirePermission } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { setSettings } from "@/lib/settings";
import {
  customerSchema,
  productSchema,
  settingsSchema,
  userCreateSchema,
  userResetPasswordSchema,
  userUpdateSchema,
  warehouseSchema,
} from "@/lib/validation";
import {
  saveCustomer,
  saveProduct,
  saveWarehouse,
  ensureDeactivatable,
  listCustomers,
} from "@/server/services/master-data.service";
import { adminResetPassword, createUser, updateUser } from "@/server/services/user.service";
import { actionFailure, actionOk, bool, str, type ActionState } from "@/actions/helpers";

export async function saveProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("admin.products");
    const input = productSchema.parse({
      code: str(formData, "code") || str(formData, "existingCode"),
      name: str(formData, "name"),
      category: str(formData, "category"),
      unit: str(formData, "unit") || "MT",
      isActive: bool(formData, "isActive"),
    });
    await saveProduct(input, { id: user.id, name: user.name, role: user.role }, await getClientIp());
    revalidatePath("/admin/products");
    return actionOk(`Product ${input.code} saved.`);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function saveCustomerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("admin.customers");
    const input = customerSchema.parse({
      code: str(formData, "existingCode"),
      name: str(formData, "name"),
      phone: str(formData, "phone"),
      address: str(formData, "address"),
      creditLimit: str(formData, "creditLimit") || null,
      isActive: bool(formData, "isActive"),
    });
    await saveCustomer(input, { id: user.id, name: user.name, role: user.role }, await getClientIp());
    revalidatePath("/admin/customers");
    return actionOk(
      input.code ? `Customer ${input.code} saved.` : "Customer created — its code was generated automatically.",
    );
  } catch (error) {
    return actionFailure(error);
  }
}

export async function saveWarehouseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("admin.warehouses");
    const input = warehouseSchema.parse({
      code: str(formData, "code") || str(formData, "existingCode"),
      name: str(formData, "name"),
      location: str(formData, "location"),
      isActive: bool(formData, "isActive"),
    });
    await saveWarehouse(input, { id: user.id, name: user.name, role: user.role }, await getClientIp());
    revalidatePath("/admin/warehouses");
    return actionOk(`Warehouse ${input.code} saved.`);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function saveUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const admin = await requirePermission("admin.users");
    const userId = str(formData, "userId");
    const actor = { id: admin.id, name: admin.name, role: admin.role };
    const ip = await getClientIp();

    if (userId) {
      const input = userUpdateSchema.parse({
        name: str(formData, "name"),
        role: str(formData, "role"),
        warehouseCode: str(formData, "warehouseCode"),
        isActive: bool(formData, "isActive"),
      });
      await updateUser(userId, input, actor, ip);
      revalidatePath("/admin/users");
      return actionOk(`User ${input.name} updated.`);
    }

    const input = userCreateSchema.parse({
      name: str(formData, "name"),
      email: str(formData, "email"),
      password: str(formData, "password"),
      role: str(formData, "role"),
      warehouseCode: str(formData, "warehouseCode"),
      isActive: bool(formData, "isActive"),
    });
    await createUser(input, actor, ip);
    revalidatePath("/admin/users");
    return actionOk(`User ${input.name} created.`);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function resetUserPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const admin = await requirePermission("admin.users");
    const userId = str(formData, "userId");
    const input = userResetPasswordSchema.parse({ password: str(formData, "password") });
    await adminResetPassword(
      userId,
      input.password,
      { id: admin.id, name: admin.name, role: admin.role },
      await getClientIp(),
    );
    revalidatePath("/admin/users");
    return actionOk("Password reset. The user must change it at next sign-in.");
  } catch (error) {
    return actionFailure(error);
  }
}

export async function saveSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("admin.settings");
    const input = settingsSchema.parse({
      credit_check_enabled: bool(formData, "credit_check_enabled") ? "true" : "false",
      priority_override_enabled: bool(formData, "priority_override_enabled") ? "true" : "false",
      warehouse_partial_dispatch: bool(formData, "warehouse_partial_dispatch") ? "true" : "false",
      company_name: str(formData, "company_name"),
      company_address: str(formData, "company_address"),
      default_warehouse: str(formData, "default_warehouse"),
    });

    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) values[key] = String(value ?? "");
    await setSettings(values, user.id);

    await writeAudit({
      userId: user.id,
      userName: user.name,
      action: "UPDATE",
      entity: "system_setting",
      newValue: values,
      ip: await getClientIp(),
    });

    revalidatePath("/admin/settings");
    return actionOk("Settings saved.");
  } catch (error) {
    return actionFailure(error);
  }
}

/**
 * Deactivates master data instead of deleting it (soft-delete), after checking
 * that nothing open depends on the record.
 */
export async function deactivateMasterDataAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const entity = str(formData, "entity");
    const code = str(formData, "code");

    if (entity === "customer") {
      const admin = await requirePermission("admin.customers");
      await ensureDeactivatable("customer", code);
      const current = (await listCustomers({ q: code })).find((c) => c.code === code);
      if (!current) throw new Error("Customer not found");
      await saveCustomer(
        { ...current, isActive: false },
        { id: admin.id, name: admin.name, role: admin.role },
        await getClientIp(),
      );
      revalidatePath("/admin/customers");
    } else if (entity === "product") {
      const admin = await requirePermission("admin.products");
      await ensureDeactivatable("product", code);
      const { listProducts } = await import("@/server/services/master-data.service");
      const current = (await listProducts()).find((p) => p.code === code);
      if (!current) throw new Error("Product not found");
      await saveProduct(
        { ...current, isActive: false },
        { id: admin.id, name: admin.name, role: admin.role },
        await getClientIp(),
      );
      revalidatePath("/admin/products");
    } else if (entity === "warehouse") {
      const admin = await requirePermission("admin.warehouses");
      await ensureDeactivatable("warehouse", code);
      const { listWarehouses } = await import("@/server/services/master-data.service");
      const current = (await listWarehouses()).find((w) => w.code === code);
      if (!current) throw new Error("Warehouse not found");
      await saveWarehouse(
        { ...current, isActive: false },
        { id: admin.id, name: admin.name, role: admin.role },
        await getClientIp(),
      );
      revalidatePath("/admin/warehouses");
    } else {
      throw new Error("Unsupported entity");
    }

    return actionOk(`${entity} ${code} deactivated.`);
  } catch (error) {
    return actionFailure(error);
  }
}
