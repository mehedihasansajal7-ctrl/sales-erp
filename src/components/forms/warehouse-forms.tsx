"use client";

import {
  createStockCountAction,
  decideStockCountAction,
  decideTransferAction,
  inwardStockAction,
  markTransferInTransitAction,
  openingStockAction,
  receiveTransferAction,
  requestTransferAction,
  stockAdjustmentAction,
} from "@/actions/inventory";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionFeedback, FieldError, SubmitButton, useActionForm } from "@/components/forms/shared";
import { ConfirmActionDialog } from "@/components/forms/confirm-dialog";
import { formatMt } from "@/lib/utils";

type Option = { code: string; name: string };

export function StockEntryPanel({
  warehouses,
  products,
  balances,
  lockedWarehouseCode,
  today,
}: {
  warehouses: Option[];
  products: Option[];
  balances: { warehouseCode: string; productCode: string; onHandMt: string; reservedMt: string; availableMt: string }[];
  lockedWarehouseCode: string | null;
  /** Today in APP_TIMEZONE (YYYY-MM-DD) - the default and the maximum entry date. */
  today: string;
}) {
  const opening = useActionForm(openingStockAction);
  const inward = useActionForm(inwardStockAction);
  const adjustment = useActionForm(stockAdjustmentAction);

  const warehouseField = (
    state: ReturnType<typeof useActionForm>["state"],
    id: string,
  ) => (
    <Field label="Warehouse" htmlFor={id} required>
      <Select
        id={id}
        name="warehouseCode"
        required
        defaultValue={lockedWarehouseCode ?? ""}
        disabled={Boolean(lockedWarehouseCode)}
      >
        <option value="" disabled>
          Select a warehouse
        </option>
        {warehouses.map((warehouse) => (
          <option key={warehouse.code} value={warehouse.code}>
            {warehouse.name}
          </option>
        ))}
      </Select>
      {lockedWarehouseCode ? (
        <input type="hidden" name="warehouseCode" value={lockedWarehouseCode} />
      ) : null}
      <FieldError state={state} name="warehouseCode" />
    </Field>
  );

  const productField = (state: ReturnType<typeof useActionForm>["state"], id: string) => (
    <Field label="Product" htmlFor={id} required>
      <Select id={id} name="productCode" required defaultValue="">
        <option value="" disabled>
          Select a product
        </option>
        {products.map((product) => (
          <option key={product.code} value={product.code}>
            {product.name} ({product.code})
          </option>
        ))}
      </Select>
      <FieldError state={state} name="productCode" />
    </Field>
  );

  return (
    <Tabs defaultValue="inward">
      <TabsList>
        <TabsTrigger value="inward">Inward receipt</TabsTrigger>
        <TabsTrigger value="opening">Opening stock</TabsTrigger>
      </TabsList>

      <TabsContent value="inward">
        <Card>
          <CardHeader>
            <CardTitle>Inward stock entry</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={inward.formAction} className="grid gap-4 sm:grid-cols-2">
              {warehouseField(inward.state, "inward-warehouse")}
              {productField(inward.state, "inward-product")}
              <Field label="Quantity received (MT)" htmlFor="inward-qty" required>
                <Input id="inward-qty" name="qtyMt" inputMode="decimal" placeholder="500.000" required />
                <FieldError state={inward.state} name="qtyMt" />
              </Field>
              <Field label="Reference (challan / LC)" htmlFor="inward-ref">
                <Input id="inward-ref" name="reference" placeholder="LC-2026-0045" />
              </Field>
              <Field
                label="Entry date"
                htmlFor="inward-date"
                required
                hint="The day the goods actually arrived. Past dates are allowed, future dates are not."
              >
                <Input
                  id="inward-date"
                  name="movementDate"
                  type="date"
                  defaultValue={today}
                  max={today}
                  required
                />
                <FieldError state={inward.state} name="movementDate" />
              </Field>
              <Field label="Note (optional)" htmlFor="inward-note" className="sm:col-span-2">
                <Textarea id="inward-note" name="note" rows={2} />
              </Field>
              <div className="sm:col-span-2">
                <ActionFeedback state={inward.state} />
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <SubmitButton pending={inward.pending} variant="primary">
                  Record inward
                </SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="opening">
        <Card>
          <CardHeader>
            <CardTitle>Opening stock</CardTitle>
            <p className="text-sm text-slate-500">
              Allowed once per warehouse and product — later stock changes use inward entries or
              approved physical counts.
            </p>
          </CardHeader>
          <CardContent>
            <form action={opening.formAction} className="grid gap-4 sm:grid-cols-2">
              {warehouseField(opening.state, "opening-warehouse")}
              {productField(opening.state, "opening-product")}
              <Field label="Opening quantity (MT)" htmlFor="opening-qty" required>
                <Input id="opening-qty" name="qtyMt" inputMode="decimal" placeholder="0.000" required />
                <FieldError state={opening.state} name="qtyMt" />
              </Field>
              <Field
                label="Opening date"
                htmlFor="opening-date"
                required
                hint="The date this opening balance belongs to (usually the go-live date)."
              >
                <Input
                  id="opening-date"
                  name="movementDate"
                  type="date"
                  defaultValue={today}
                  max={today}
                  required
                />
                <FieldError state={opening.state} name="movementDate" />
              </Field>
              <Field label="Note (optional)" htmlFor="opening-note">
                <Input id="opening-note" name="note" placeholder="Opening as at 01 Oct 2026" />
              </Field>
              <div className="sm:col-span-2">
                <ActionFeedback state={opening.state} />
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <SubmitButton pending={opening.pending} variant="primary">
                  Save opening stock
                </SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      </TabsContent>

      <div className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Current balances</CardTitle>
          </CardHeader>
          <CardContent>
            {balances.length === 0 ? (
              <p className="text-sm text-slate-500">No stock has been recorded yet.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {balances.map((balance) => (
                  <li
                    key={`${balance.warehouseCode}-${balance.productCode}`}
                    className="rounded-md border border-slate-200 p-3 text-sm"
                  >
                    <p className="font-medium">
                      {balance.warehouseCode} · {balance.productCode}
                    </p>
                    <p className="text-slate-600">
                      On hand {formatMt(balance.onHandMt)} · reserved {formatMt(balance.reservedMt)}
                    </p>
                    <p className="font-medium text-emerald-700">
                      Available {formatMt(balance.availableMt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Admin-only adjustment: rendered only when permitted. */}
      {!lockedWarehouseCode ? (
        <div className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Manual adjustment (administrator)</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={adjustment.formAction} className="grid gap-4 sm:grid-cols-2">
                {warehouseField(adjustment.state, "adjust-warehouse")}
                {productField(adjustment.state, "adjust-product")}
                <Field label="New on-hand quantity (MT)" htmlFor="adjust-qty" required>
                  <Input id="adjust-qty" name="newOnHandMt" inputMode="decimal" required />
                </Field>
                <Field label="Reason" htmlFor="adjust-reason" required>
                  <Input id="adjust-reason" name="reason" required />
                </Field>
                <div className="sm:col-span-2">
                  <ActionFeedback state={adjustment.state} />
                </div>
                <div className="sm:col-span-2 flex justify-end">
                  <SubmitButton pending={adjustment.pending}>Apply adjustment</SubmitButton>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </Tabs>
  );
}

export function TransferRequestForm({
  warehouses,
  products,
  lockedWarehouseCode,
}: {
  warehouses: Option[];
  products: Option[];
  lockedWarehouseCode: string | null;
}) {
  const { state, formAction, pending } = useActionForm(requestTransferAction);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="From warehouse" htmlFor="fromWarehouseCode" required>
        <Select
          id="fromWarehouseCode"
          name="fromWarehouseCode"
          required
          defaultValue={lockedWarehouseCode ?? ""}
          disabled={Boolean(lockedWarehouseCode)}
        >
          <option value="" disabled>
            Select source
          </option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.code} value={warehouse.code}>
              {warehouse.name}
            </option>
          ))}
        </Select>
        {lockedWarehouseCode ? (
          <input type="hidden" name="fromWarehouseCode" value={lockedWarehouseCode} />
        ) : null}
        <FieldError state={state} name="fromWarehouseCode" />
      </Field>
      <Field label="To warehouse" htmlFor="toWarehouseCode" required>
        <Select id="toWarehouseCode" name="toWarehouseCode" required defaultValue="">
          <option value="" disabled>
            Select destination
          </option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.code} value={warehouse.code}>
              {warehouse.name}
            </option>
          ))}
        </Select>
        <FieldError state={state} name="toWarehouseCode" />
      </Field>
      <Field label="Product" htmlFor="transfer-product" required>
        <Select id="transfer-product" name="productCode" required defaultValue="">
          <option value="" disabled>
            Select a product
          </option>
          {products.map((product) => (
            <option key={product.code} value={product.code}>
              {product.name}
            </option>
          ))}
        </Select>
        <FieldError state={state} name="productCode" />
      </Field>
      <Field label="Quantity (MT)" htmlFor="transfer-qty" required>
        <Input id="transfer-qty" name="qtyMt" inputMode="decimal" required />
        <FieldError state={state} name="qtyMt" />
      </Field>
      <Field label="Reason (optional)" htmlFor="transfer-reason" className="sm:col-span-2">
        <Input id="transfer-reason" name="reason" />
      </Field>
      <div className="sm:col-span-2">
        <ActionFeedback state={state} />
      </div>
      <div className="sm:col-span-2 flex justify-end">
        <SubmitButton pending={pending} variant="primary">
          Request transfer
        </SubmitButton>
      </div>
    </form>
  );
}

export function TransferActions({
  transferId,
  transferNo,
  status,
  canApprove,
  canRelease,
  canReceive,
}: {
  transferId: string;
  transferNo: string;
  status: string;
  canApprove: boolean;
  canRelease: boolean;
  canReceive: boolean;
}) {
  if (status === "REQUESTED" && canApprove) {
    return (
      <div className="flex flex-wrap gap-2">
        <ConfirmActionDialog
          action={decideTransferAction as never}
          triggerLabel="Approve"
          triggerVariant="primary"
          title={`Approve ${transferNo}`}
          description="Approving reserves the quantity at the source warehouse so it cannot be allocated elsewhere."
          confirmLabel="Approve transfer"
          fields={{ transferId, approve: "true" }}
        />
        <ConfirmActionDialog
          action={decideTransferAction as never}
          triggerLabel="Reject"
          triggerVariant="destructive"
          title={`Reject ${transferNo}`}
          confirmLabel="Reject transfer"
          fields={{ transferId }}
          requireReason
        />
      </div>
    );
  }

  if (status === "APPROVED" && canRelease) {
    return (
      <ConfirmActionDialog
        action={markTransferInTransitAction as never}
        triggerLabel="Release (in transit)"
        title={`Release ${transferNo}`}
        description="Reduces the on-hand stock at the source warehouse and marks the transfer in transit."
        confirmLabel="Mark in transit"
        fields={{ transferId }}
      />
    );
  }

  if (status === "IN_TRANSIT" && canReceive) {
    return (
      <ConfirmActionDialog
        action={receiveTransferAction as never}
        triggerLabel="Receive"
        triggerVariant="primary"
        title={`Receive ${transferNo}`}
        description="Adds the quantity to this warehouse's on-hand stock."
        confirmLabel="Confirm receipt"
        fields={{ transferId }}
      />
    );
  }

  return <span className="text-xs text-slate-400">No action available</span>;
}

export function CountEntryForm({
  warehouses,
  products,
  lockedWarehouseCode,
}: {
  warehouses: Option[];
  products: Option[];
  lockedWarehouseCode: string | null;
}) {
  const { state, formAction, pending } = useActionForm(createStockCountAction);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Warehouse" htmlFor="count-warehouse" required>
        <Select
          id="count-warehouse"
          name="warehouseCode"
          required
          defaultValue={lockedWarehouseCode ?? ""}
          disabled={Boolean(lockedWarehouseCode)}
        >
          <option value="" disabled>
            Select a warehouse
          </option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.code} value={warehouse.code}>
              {warehouse.name}
            </option>
          ))}
        </Select>
        {lockedWarehouseCode ? (
          <input type="hidden" name="warehouseCode" value={lockedWarehouseCode} />
        ) : null}
      </Field>
      <Field label="Product" htmlFor="count-product" required>
        <Select id="count-product" name="productCode" required defaultValue="">
          <option value="" disabled>
            Select a product
          </option>
          {products.map((product) => (
            <option key={product.code} value={product.code}>
              {product.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Physical quantity counted (MT)"
        htmlFor="count-physical"
        hint="The system quantity is read at submission; the difference is calculated automatically."
        required
      >
        <Input id="count-physical" name="physicalQty" inputMode="decimal" required />
      </Field>
      <Field label="Reason (optional)" htmlFor="count-reason">
        <Input id="count-reason" name="reason" />
      </Field>
      <Field label="Remarks (optional)" htmlFor="count-remarks" className="sm:col-span-2">
        <Textarea id="count-remarks" name="remarks" rows={2} />
      </Field>
      <div className="sm:col-span-2">
        <ActionFeedback state={state} />
      </div>
      <div className="sm:col-span-2 flex justify-end">
        <SubmitButton pending={pending} variant="primary">
          Submit count for approval
        </SubmitButton>
      </div>
    </form>
  );
}

export function CountActions({
  countId,
  countNo,
  difference,
}: {
  countId: string;
  countNo: string;
  difference: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmActionDialog
        action={decideStockCountAction as never}
        triggerLabel="Approve"
        triggerVariant="primary"
        title={`Approve ${countNo}`}
        description={`The stock will be adjusted by ${difference} MT and an ADJUSTMENT ledger entry written.`}
        confirmLabel="Approve adjustment"
        fields={{ countId, approve: "true" }}
        requireReason={Number(difference) !== 0}
        reasonLabel="Reason for the adjustment"
      />
      <ConfirmActionDialog
        action={decideStockCountAction as never}
        triggerLabel="Reject"
        triggerVariant="destructive"
        title={`Reject ${countNo}`}
        confirmLabel="Reject count"
        fields={{ countId }}
        requireReason
      />
    </div>
  );
}
