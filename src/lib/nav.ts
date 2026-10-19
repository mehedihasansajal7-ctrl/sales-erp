import type { Role } from "@prisma/client";

/**
 * Role-aware navigation. `roles` lists the roles that may see an item; the
 * corresponding page re-checks the permission server-side, so hiding a link is
 * a UX nicety and never the access control.
 */
export type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles: Role[];
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

const ALL: Role[] = ["ADMIN", "FINANCE", "SALES", "SALES_OPS", "WAREHOUSE", "MANAGEMENT"];
const OPS: Role[] = ["ADMIN", "SALES_OPS"];
const OPS_VIEW: Role[] = ["ADMIN", "SALES_OPS", "MANAGEMENT", "FINANCE"];
const REPORT_ROLES: Role[] = ALL;
const AUDIT_ROLES: Role[] = ["ADMIN", "MANAGEMENT"];

export const NAV: NavSection[] = [
  {
    title: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", roles: ALL }],
  },
  {
    title: "Finance",
    items: [
      { href: "/finance/rates", label: "Publish rates", icon: "BadgeDollarSign", roles: ["ADMIN", "FINANCE"] },
      { href: "/finance/rates/history", label: "Rate history", icon: "History", roles: ALL },
    ],
  },
  {
    title: "Sales",
    items: [
      { href: "/sales/orders/new", label: "New order", icon: "FilePlus2", roles: ["ADMIN", "SALES"] },
      { href: "/sales/orders", label: "Orders", icon: "ClipboardList", roles: ["ADMIN", "SALES", "SALES_OPS", "MANAGEMENT", "FINANCE"] },
    ],
  },
  {
    title: "Sales Operations",
    items: [
      { href: "/sales-ops/approvals", label: "Approval queue", icon: "CheckSquare", roles: OPS },
      { href: "/sales-ops/priority", label: "Priority queue", icon: "ListOrdered", roles: OPS_VIEW },
      { href: "/sales-ops/delivery-orders", label: "Delivery orders", icon: "Truck", roles: OPS_VIEW },
    ],
  },
  {
    title: "Warehouse",
    items: [
      { href: "/warehouse/dispatch-orders", label: "My delivery orders", icon: "PackageCheck", roles: ["ADMIN", "WAREHOUSE", "MANAGEMENT"] },
      { href: "/warehouse/dispatch", label: "Dispatch register", icon: "Route", roles: ["ADMIN", "WAREHOUSE", "MANAGEMENT", "SALES_OPS"] },
      { href: "/warehouse/stock", label: "Stock & inward", icon: "Boxes", roles: ["ADMIN", "WAREHOUSE", "MANAGEMENT", "SALES_OPS", "FINANCE"] },
      { href: "/warehouse/transfers", label: "Stock transfers", icon: "ArrowLeftRight", roles: ["ADMIN", "WAREHOUSE", "SALES_OPS", "MANAGEMENT"] },
      { href: "/warehouse/counts", label: "Physical counts", icon: "ClipboardCheck", roles: ["ADMIN", "WAREHOUSE", "SALES_OPS", "MANAGEMENT"] },
    ],
  },
  {
    title: "Reports",
    items: [{ href: "/reports", label: "All reports", icon: "BarChart3", roles: REPORT_ROLES }],
  },
  {
    title: "Communication",
    items: [{ href: "/chat", label: "Chat", icon: "MessageSquare", roles: ALL }],
  },
  {
    title: "Administration",
    items: [
      { href: "/admin/users", label: "Users & roles", icon: "Users", roles: ["ADMIN"] },
      { href: "/admin/products", label: "Products", icon: "Boxes", roles: ["ADMIN"] },
      { href: "/admin/customers", label: "Customers", icon: "Building2", roles: ["ADMIN"] },
      { href: "/admin/warehouses", label: "Warehouses", icon: "Warehouse", roles: ["ADMIN"] },
      { href: "/admin/settings", label: "Settings", icon: "Settings", roles: ["ADMIN"] },
      { href: "/admin/audit", label: "Audit log", icon: "ScrollText", roles: AUDIT_ROLES },
    ],
  },
];

export function navForRole(role: Role): NavSection[] {
  return NAV.map((section) => ({
    title: section.title,
    items: section.items.filter((item) => item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
}
