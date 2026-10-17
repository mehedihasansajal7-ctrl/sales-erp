import type { Role } from "@prisma/client";

/**
 * Central permission map: `role -> allowed actions`.
 * Every server route handler, server action and service entry point calls
 * `assertPermission(role, action)` — never the UI alone (spec Section 8).
 */
export const PERMISSIONS = {
  // --- Rates ---------------------------------------------------------------
  "rate.publish": ["FINANCE", "ADMIN"],
  "rate.view": ["FINANCE", "SALES", "SALES_OPS", "WAREHOUSE", "MANAGEMENT", "ADMIN"],

  // --- Orders --------------------------------------------------------------
  "order.create": ["SALES", "ADMIN"],
  "order.view.own": ["SALES"],
  "order.view.all": ["SALES_OPS", "MANAGEMENT", "ADMIN", "FINANCE"],
  "order.approve": ["SALES_OPS", "ADMIN"],
  "order.reject": ["SALES_OPS", "ADMIN"],
  /// Correct the numbers (quantity / rate) of a pending order before approving it.
  "order.editPending": ["SALES_OPS", "ADMIN"],
  "order.cancel": ["SALES_OPS", "ADMIN"],
  "order.shortClose": ["SALES_OPS", "ADMIN"],
  "order.overrideRate": ["SALES_OPS", "ADMIN"],
  "order.print": ["SALES", "SALES_OPS", "MANAGEMENT", "ADMIN", "FINANCE"],

  // --- Delivery orders -----------------------------------------------------
  "do.create": ["SALES_OPS", "ADMIN"],
  /// Correct the quantities of a DO while nothing has been dispatched yet.
  "do.edit": ["SALES_OPS", "ADMIN"],
  "do.view.all": ["SALES_OPS", "MANAGEMENT", "ADMIN", "FINANCE"],
  "do.view.warehouse": ["WAREHOUSE"],
  "do.cancel": ["SALES_OPS", "ADMIN"],
  "do.priorityOverride": ["SALES_OPS", "ADMIN"],

  // --- Dispatch ------------------------------------------------------------
  "dispatch.create": ["WAREHOUSE", "ADMIN"],
  "dispatch.view.warehouse": ["WAREHOUSE"],
  "dispatch.view.all": ["SALES_OPS", "MANAGEMENT", "ADMIN", "FINANCE"],

  // --- Stock ---------------------------------------------------------------
  "stock.view.own": ["WAREHOUSE"],
  "stock.view.all": ["SALES_OPS", "MANAGEMENT", "ADMIN", "FINANCE"],
  "stock.opening": ["WAREHOUSE", "ADMIN"],
  "stock.inward": ["WAREHOUSE", "ADMIN"],
  "stock.adjust": ["ADMIN"],
  "transfer.request": ["WAREHOUSE", "SALES_OPS", "ADMIN"],
  "transfer.approve": ["SALES_OPS", "ADMIN"],
  "transfer.receive": ["WAREHOUSE", "ADMIN"],
  "count.create": ["WAREHOUSE", "ADMIN"],
  "count.approve": ["SALES_OPS", "ADMIN"],

  // --- Reports / dashboards ------------------------------------------------
  "report.view": ["FINANCE", "SALES", "SALES_OPS", "WAREHOUSE", "MANAGEMENT", "ADMIN"],
  "dashboard.view": ["FINANCE", "SALES", "SALES_OPS", "WAREHOUSE", "MANAGEMENT", "ADMIN"],

  // --- Admin ---------------------------------------------------------------
  "admin.users": ["ADMIN"],
  "admin.products": ["ADMIN"],
  "admin.customers": ["ADMIN"],
  "admin.warehouses": ["ADMIN"],
  "admin.settings": ["ADMIN"],
  "audit.view": ["ADMIN", "MANAGEMENT"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function roleHasPermission(role: Role, permission: Permission): boolean {
  const allowed = PERMISSIONS[permission] as readonly Role[];
  return allowed.includes(role);
}

export function permissionsForRole(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => roleHasPermission(role, p));
}

/** True for roles that must never mutate data. */
export function isReadOnlyRole(role: Role): boolean {
  return role === "MANAGEMENT";
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  FINANCE: "Finance",
  SALES: "Salesperson",
  SALES_OPS: "Sales Operations",
  WAREHOUSE: "Warehouse",
  MANAGEMENT: "Management",
};

/** Landing page per role after sign-in (spec Section 7.1). */
export const ROLE_HOME: Record<Role, string> = {
  ADMIN: "/dashboard",
  FINANCE: "/finance/rates",
  SALES: "/sales/orders",
  SALES_OPS: "/sales-ops/approvals",
  WAREHOUSE: "/warehouse/dispatch-orders",
  MANAGEMENT: "/dashboard",
};
