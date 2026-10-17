"use client";

import * as React from "react";
import {
  deactivateMasterDataAction,
  resetUserPasswordAction,
  saveCustomerAction,
  saveProductAction,
  saveSettingsAction,
  saveUserAction,
  saveWarehouseAction,
} from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Label, Select, Textarea } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ActionFeedback, SubmitButton, useActionForm, type ServerAction } from "@/components/forms/shared";
import { ConfirmActionDialog } from "@/components/forms/confirm-dialog";

/** Generic create/edit dialog used by every master-data screen. */
function EntityDialog({
  action,
  triggerLabel,
  title,
  description,
  confirmLabel,
  fields,
  children,
}: {
  action: ServerAction;
  triggerLabel: string;
  title: string;
  description?: string;
  confirmLabel: string;
  fields?: Record<string, string>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const { state, formAction, pending } = useActionForm(action, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {Object.entries(fields ?? {}).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          {children}
          <ActionFeedback state={state} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pending={pending}>{confirmLabel}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type ProductRow = {
  code: string;
  name: string;
  category: string;
  unit: string;
  isActive: boolean;
};

export function ProductFormDialog({ product }: { product?: ProductRow }) {
  const editing = Boolean(product);
  return (
    <EntityDialog
      action={saveProductAction}
      triggerLabel={editing ? "Edit" : "Add product"}
      title={editing ? `Edit ${product?.name}` : "Add product"}
      description="Products are never deleted — deactivate them instead so history stays intact."
      confirmLabel={editing ? "Save product" : "Create product"}
      fields={editing ? { existingCode: product?.code ?? "" } : undefined}
    >
      {!editing ? (
        <Field label="Code" htmlFor="product-code" required>
          <Input id="product-code" name="code" placeholder="FERT-UREA" required />
        </Field>
      ) : null}
      <Field label="Name" htmlFor="product-name" required>
        <Input id="product-name" name="name" defaultValue={product?.name} required />
      </Field>
      <Field label="Category" htmlFor="product-category" required>
        <Input
          id="product-category"
          name="category"
          defaultValue={product?.category}
          placeholder="Fertilizer / Coal / Grain"
          required
        />
      </Field>
      <Field label="Unit" htmlFor="product-unit" hint="Default MT (metric ton).">
        <Input id="product-unit" name="unit" defaultValue={product?.unit ?? "MT"} />
      </Field>
      <div className="flex items-center gap-2">
        <Checkbox id="product-active" name="isActive" defaultChecked={product?.isActive ?? true} />
        <Label htmlFor="product-active">Active</Label>
      </div>
    </EntityDialog>
  );
}

export type CustomerAdminRow = {
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  creditLimit: string | null;
  isActive: boolean;
};

export function CustomerFormDialog({ customer }: { customer?: CustomerAdminRow }) {
  const editing = Boolean(customer);
  return (
    <EntityDialog
      action={saveCustomerAction}
      triggerLabel={editing ? "Edit" : "Add customer"}
      title={editing ? `Edit ${customer?.name}` : "Add customer"}
      confirmLabel={editing ? "Save customer" : "Create customer"}
      fields={editing ? { existingCode: customer?.code ?? "" } : undefined}
    >
      {!editing ? (
        <Field label="Code" htmlFor="customer-code" required>
          <Input id="customer-code" name="code" placeholder="CUS-001" required />
        </Field>
      ) : null}
      <Field label="Name" htmlFor="customer-name" required>
        <Input id="customer-name" name="name" defaultValue={customer?.name} required />
      </Field>
      <Field label="Phone" htmlFor="customer-phone">
        <Input id="customer-phone" name="phone" defaultValue={customer?.phone ?? ""} />
      </Field>
      <Field label="Address" htmlFor="customer-address">
        <Textarea id="customer-address" name="address" rows={2} defaultValue={customer?.address ?? ""} />
      </Field>
      <Field
        label="Credit limit (৳)"
        htmlFor="customer-limit"
        hint="Leave empty for no limit. Approval warns (with override) when the exposure exceeds it."
      >
        <Input
          id="customer-limit"
          name="creditLimit"
          inputMode="decimal"
          defaultValue={customer?.creditLimit ?? ""}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Checkbox id="customer-active" name="isActive" defaultChecked={customer?.isActive ?? true} />
        <Label htmlFor="customer-active">Active</Label>
      </div>
    </EntityDialog>
  );
}

export type WarehouseAdminRow = {
  code: string;
  name: string;
  location: string | null;
  isActive: boolean;
};

export function WarehouseFormDialog({ warehouse }: { warehouse?: WarehouseAdminRow }) {
  const editing = Boolean(warehouse);
  return (
    <EntityDialog
      action={saveWarehouseAction}
      triggerLabel={editing ? "Edit" : "Add warehouse"}
      title={editing ? `Edit ${warehouse?.name}` : "Add warehouse"}
      confirmLabel={editing ? "Save warehouse" : "Create warehouse"}
      fields={editing ? { existingCode: warehouse?.code ?? "" } : undefined}
    >
      {!editing ? (
        <Field label="Code" htmlFor="warehouse-code" required>
          <Input id="warehouse-code" name="code" placeholder="WH-DHK" required />
        </Field>
      ) : null}
      <Field label="Name" htmlFor="warehouse-name" required>
        <Input id="warehouse-name" name="name" defaultValue={warehouse?.name} required />
      </Field>
      <Field label="Location" htmlFor="warehouse-location">
        <Input id="warehouse-location" name="location" defaultValue={warehouse?.location ?? ""} />
      </Field>
      <div className="flex items-center gap-2">
        <Checkbox id="warehouse-active" name="isActive" defaultChecked={warehouse?.isActive ?? true} />
        <Label htmlFor="warehouse-active">Active</Label>
      </div>
    </EntityDialog>
  );
}

export type UserAdminRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  warehouseCode: string | null;
};

const ROLES = [
  ["ADMIN", "Administrator"],
  ["FINANCE", "Finance"],
  ["SALES", "Salesperson"],
  ["SALES_OPS", "Sales Operations"],
  ["WAREHOUSE", "Warehouse"],
  ["MANAGEMENT", "Management"],
] as const;

export function UserFormDialog({
  user,
  warehouses,
}: {
  user?: UserAdminRow;
  warehouses: { code: string; name: string }[];
}) {
  const editing = Boolean(user);
  return (
    <EntityDialog
      action={saveUserAction}
      triggerLabel={editing ? "Edit" : "Add user"}
      title={editing ? `Edit ${user?.name}` : "Add user"}
      description="Roles are enforced on the server for every action."
      confirmLabel={editing ? "Save user" : "Create user"}
      fields={editing ? { userId: user?.id ?? "" } : undefined}
    >
      <Field label="Name" htmlFor="user-name" required>
        <Input id="user-name" name="name" defaultValue={user?.name} required />
      </Field>
      {!editing ? (
        <>
          <Field label="Email" htmlFor="user-email" required>
            <Input id="user-email" name="email" type="email" required />
          </Field>
          <Field label="Temporary password" htmlFor="user-password" hint="Minimum 8 characters." required>
            <Input id="user-password" name="password" type="password" minLength={8} required />
          </Field>
        </>
      ) : null}
      <Field label="Role" htmlFor="user-role" required>
        <Select id="user-role" name="role" defaultValue={user?.role ?? "SALES"} required>
          {ROLES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Warehouse"
        htmlFor="user-warehouse"
        hint="Required for warehouse users — they only ever see their own warehouse."
      >
        <Select id="user-warehouse" name="warehouseCode" defaultValue={user?.warehouseCode ?? ""}>
          <option value="">— none —</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.code} value={warehouse.code}>
              {warehouse.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex items-center gap-2">
        <Checkbox id="user-active" name="isActive" defaultChecked={user?.isActive ?? true} />
        <Label htmlFor="user-active">Active</Label>
      </div>
    </EntityDialog>
  );
}

export function ResetPasswordDialog({ userId, userName }: { userId: string; userName: string }) {
  return (
    <EntityDialog
      action={resetUserPasswordAction}
      triggerLabel="Reset password"
      title={`Reset password — ${userName}`}
      description="All of this user's sessions are revoked and they must change the password at next sign-in."
      confirmLabel="Reset password"
      fields={{ userId }}
    >
      <Field label="New temporary password" htmlFor={`reset-${userId}`} required>
        <Input id={`reset-${userId}`} name="password" type="password" minLength={8} required />
      </Field>
    </EntityDialog>
  );
}

export function DeactivateButton({
  entity,
  code,
  name,
}: {
  entity: "product" | "customer" | "warehouse";
  code: string;
  name: string;
}) {
  return (
    <ConfirmActionDialog
      action={deactivateMasterDataAction}
      triggerLabel="Deactivate"
      triggerVariant="ghost"
      title={`Deactivate ${name}`}
      description="Master data is never hard-deleted. The record stays for history and reports but cannot be used in new transactions."
      confirmLabel="Deactivate"
      fields={{ entity, code }}
    />
  );
}

export function SettingsForm({
  settings,
  warehouses,
}: {
  settings: Record<string, string>;
  warehouses: { code: string; name: string }[];
}) {
  const { state, formAction, pending } = useActionForm(saveSettingsAction);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-5">
      <div className="flex items-start gap-3 rounded-md border border-slate-200 p-3">
        <Checkbox
          id="credit_check_enabled"
          name="credit_check_enabled"
          defaultChecked={settings.credit_check_enabled !== "false"}
        />
        <div>
          <Label htmlFor="credit_check_enabled">Enable the credit limit check</Label>
          <p className="text-xs text-slate-500">
            When enabled, approving an order that pushes a customer past its credit limit requires a
            written Sales Ops override.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-slate-200 p-3">
        <Checkbox
          id="priority_override_enabled"
          name="priority_override_enabled"
          defaultChecked={settings.priority_override_enabled !== "false"}
        />
        <div>
          <Label htmlFor="priority_override_enabled">Allow delivery priority overrides</Label>
          <p className="text-xs text-slate-500">
            Turn this off to make the per-customer delivery priority rule absolute for every role.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-slate-200 p-3">
        <Checkbox
          id="warehouse_partial_dispatch"
          name="warehouse_partial_dispatch"
          defaultChecked={settings.warehouse_partial_dispatch === "true"}
        />
        <div>
          <Label htmlFor="warehouse_partial_dispatch">
            Allow the warehouse to dispatch less than the DO quantity
          </Label>
          <p className="text-xs text-slate-500">
            Off (default): the warehouse only records the vehicle, driver, challan and dates, and
            dispatches the <strong>full</strong> DO quantity set by Sales Operations. For a smaller
            shipment Sales Ops creates a separate delivery order. Turn this on only if your loading
            really has to be split by the warehouse.
          </p>
        </div>
      </div>

      <Field label="Company name" htmlFor="company_name" required>
        <Input id="company_name" name="company_name" defaultValue={settings.company_name} required />
      </Field>

      <Field label="Company address" htmlFor="company_address">
        <Textarea
          id="company_address"
          name="company_address"
          rows={2}
          defaultValue={settings.company_address}
        />
      </Field>

      <Field label="Default warehouse" htmlFor="default_warehouse" hint="Pre-selected on delivery order forms.">
        <Select id="default_warehouse" name="default_warehouse" defaultValue={settings.default_warehouse ?? ""}>
          <option value="">— none —</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.code} value={warehouse.code}>
              {warehouse.name}
            </option>
          ))}
        </Select>
      </Field>

      <ActionFeedback state={state} />
      <div className="flex justify-end">
        <SubmitButton pending={pending} variant="primary">
          Save settings
        </SubmitButton>
      </div>
    </form>
  );
}
