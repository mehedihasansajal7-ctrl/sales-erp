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
  listProducts,
  listWarehouses,
  type CustomerInput,
  type ProductInput,
  type WarehouseInput,
} from "@/server/services/master-data.service";
import { adminResetPassword, createUser, updateUser } from "@/server/services/user.service";
import { errors } from "@/lib/errors";
import {
  BULK_ENTITIES,
  BULK_MAX_ROWS,
  customerKey,
  isBulkEntity,
  parseBulkInput,
  type BulkEntity,
  type BulkReport,
  type BulkRowReport,
} from "@/lib/bulk-import";
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

// ---------------------------------------------------------------------------
// Bulk add: Products / Customers / Warehouses
// ---------------------------------------------------------------------------

export type BulkImportState = ActionState & { report?: BulkReport };

/** "code: Code may contain letters..." - one readable line for the row table. */
function firstIssue(error: { issues: { path: readonly PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid row.";
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Drops empty cells so Zod defaults (unit = MT, credit limit = null) apply. */
function withoutBlanks(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""));
}

/**
 * Validates the pasted rows and, when `commit` is set, creates them through the
 * normal master-data services (so each row is audited and customer codes are
 * generated by the system).
 *
 * Existing records are never overwritten by an import: a code that is already
 * taken, or a customer with the same name and phone, is reported as a duplicate
 * and skipped. Call it first with commit=false to show the preview.
 */
export async function bulkImportMasterDataAction(
  _prev: BulkImportState,
  formData: FormData,
): Promise<BulkImportState> {
  try {
    const entityRaw = str(formData, "entity");
    if (!isBulkEntity(entityRaw)) throw errors.validation("Choose what to import.");
    const entity: BulkEntity = entityRaw;

    const permission =
      entity === "products"
        ? "admin.products"
        : entity === "customers"
          ? "admin.customers"
          : "admin.warehouses";
    const user = await requirePermission(permission);
    const admin = { id: user.id, name: user.name, role: user.role };
    const ip = await getClientIp();
    const commit = bool(formData, "commit");

    const raw = typeof formData.get("text") === "string" ? String(formData.get("text")) : "";
    const parsed = parseBulkInput(entity, raw);

    if (parsed.rows.length === 0) {
      return { ok: false, message: "Nothing to import - paste some rows first." };
    }
    if (parsed.rows.length > BULK_MAX_ROWS) {
      return {
        ok: false,
        message: `Too many rows (${parsed.rows.length}). Import at most ${BULK_MAX_ROWS} rows at a time.`,
      };
    }

    const rows: BulkRowReport[] = [];
    let imported = 0;
    let okCount = 0;
    let invalid = 0;
    let duplicates = 0;

    const pushInvalid = (line: number, label: string, message: string) => {
      invalid += 1;
      rows.push({ line, label, status: "invalid", message });
    };
    const pushDuplicate = (line: number, label: string, message: string) => {
      duplicates += 1;
      rows.push({ line, label, status: "duplicate", message });
    };
    const pushOk = (line: number, label: string) => {
      okCount += 1;
      rows.push({ line, label, status: "ok" });
    };

    if (entity === "products" || entity === "warehouses") {
      const existing = new Set(
        (entity === "products" ? await listProducts() : await listWarehouses()).map((row) => row.code),
      );
      const seen = new Set<string>();

      for (const row of parsed.rows) {
        const schema = entity === "products" ? productSchema : warehouseSchema;
        const result = schema.safeParse({ ...withoutBlanks(row.values), isActive: true });
        if (!result.success) {
          pushInvalid(row.line, row.preview, firstIssue(result.error));
          continue;
        }

        const code = result.data.code;
        if (existing.has(code) || seen.has(code)) {
          pushDuplicate(
            row.line,
            code,
            existing.has(code) ? `${code} already exists.` : `${code} is repeated in this list.`,
          );
          continue;
        }

        seen.add(code);
        if (commit) {
          if (entity === "products") {
            await saveProduct(result.data as ProductInput, admin, ip);
          } else {
            await saveWarehouse(result.data as WarehouseInput, admin, ip);
          }
          imported += 1;
        }
        pushOk(row.line, code);
      }
    } else {
      const existing = new Set(
        (await listCustomers()).map((customer) => customerKey(customer.name, customer.phone)),
      );
      const seen = new Set<string>();

      for (const row of parsed.rows) {
        const result = customerSchema.safeParse(withoutBlanks(row.values));
        if (!result.success) {
          pushInvalid(row.line, row.preview, firstIssue(result.error));
          continue;
        }

        const key = customerKey(result.data.name, result.data.phone ?? null);
        if (existing.has(key) || seen.has(key)) {
          pushDuplicate(
            row.line,
            result.data.name,
            existing.has(key)
              ? `${result.data.name} already exists with this phone.`
              : `${result.data.name} is repeated in this list.`,
          );
          continue;
        }

        seen.add(key);
        if (commit) {
          await saveCustomer(result.data as CustomerInput, admin, ip);
          imported += 1;
        }
        pushOk(row.line, result.data.name);
      }
    }

    const report: BulkReport = {
      entity,
      committed: commit,
      imported,
      ok: okCount,
      invalid,
      duplicates,
      rows,
      ignoredColumns: parsed.ignoredColumns,
      usedHeader: parsed.usedHeader,
    };

    if (commit) {
      if (entity === "products") revalidatePath("/admin/products");
      if (entity === "customers") revalidatePath("/admin/customers");
      if (entity === "warehouses") revalidatePath("/admin/warehouses");
      revalidatePath("/dashboard");
    }

    const label = BULK_ENTITIES[entity].singular;
    const summaryParts = [`${okCount} ${label}${okCount === 1 ? "" : "s"} ready`];
    if (invalid > 0) summaryParts.push(`${invalid} with errors`);
    if (duplicates > 0) summaryParts.push(`${duplicates} already existed`);
    const summary = summaryParts.join(", ");

    return {
      ok: invalid === 0 && duplicates === 0,
      message: commit
        ? `${imported} ${label}${imported === 1 ? "" : "s"} imported (${summary}).`
        : `Check complete - ${summary}. Nothing was saved yet.`,
      report,
    };
  } catch (error) {
    return actionFailure(error);
  }
}
