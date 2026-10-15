-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'FINANCE', 'SALES', 'SALES_OPS', 'WAREHOUSE', 'MANAGEMENT');

-- CreateEnum
CREATE TYPE "RateStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_DELIVERED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'SHORT_CLOSED');

-- CreateEnum
CREATE TYPE "DeliveryOrderStatus" AS ENUM ('CREATED', 'PARTIALLY_DISPATCHED', 'DISPATCHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('OPENING', 'INWARD', 'OUTWARD', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'RESERVE', 'UNRESERVE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "warehouse_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "products_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "customers" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "credit_limit" DECIMAL(18,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "rates" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "rate_per_mt" DECIMAL(18,2) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "status" "RateStatus" NOT NULL DEFAULT 'ACTIVE',
    "published_by" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "order_seq" INTEGER NOT NULL,
    "order_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "total_value" DECIMAL(18,2) NOT NULL,
    "remarks" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "short_closed_by" TEXT,
    "short_closed_at" TIMESTAMP(3),
    "short_close_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "qty_mt" DECIMAL(18,3) NOT NULL,
    "locked_rate_per_mt" DECIMAL(18,2) NOT NULL,
    "rate_id" TEXT NOT NULL,
    "line_value" DECIMAL(18,2) NOT NULL,
    "delivered_mt" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "do_allocated_mt" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "rate_overridden" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_orders" (
    "id" TEXT NOT NULL,
    "do_no" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "status" "DeliveryOrderStatus" NOT NULL DEFAULT 'CREATED',
    "priority_override" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "note" TEXT,
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "delivery_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_order_items" (
    "id" TEXT NOT NULL,
    "do_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "qty_mt" DECIMAL(18,3) NOT NULL,
    "dispatched_mt" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "delivery_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatches" (
    "id" TEXT NOT NULL,
    "do_id" TEXT NOT NULL,
    "truck_no" TEXT NOT NULL,
    "driver_name" TEXT NOT NULL,
    "driver_phone" TEXT NOT NULL,
    "challan_no" TEXT NOT NULL,
    "loading_date" TIMESTAMP(3) NOT NULL,
    "dispatch_date" TIMESTAMP(3) NOT NULL,
    "remarks" TEXT,
    "recorded_by" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_items" (
    "id" TEXT NOT NULL,
    "dispatch_id" TEXT NOT NULL,
    "do_item_id" TEXT NOT NULL,
    "qty_mt" DECIMAL(18,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "dispatch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "on_hand_mt" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "reserved_mt" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_ledger" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "movement_type" "MovementType" NOT NULL,
    "qty_mt" DECIMAL(18,3) NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "balance_after" DECIMAL(18,3) NOT NULL,
    "reserved_after" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" TEXT NOT NULL,
    "transfer_no" TEXT NOT NULL,
    "from_warehouse_id" TEXT NOT NULL,
    "to_warehouse_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "qty_mt" DECIMAL(18,3) NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "in_transit_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "received_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "count_no" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "system_qty" DECIMAL(18,3) NOT NULL,
    "physical_qty" DECIMAL(18,3) NOT NULL,
    "difference" DECIMAL(18,3) NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "count_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "remarks" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "user_name" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "sequences" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_is_active_idx" ON "users"("role", "is_active");

-- CreateIndex
CREATE INDEX "users_warehouse_id_idx" ON "users"("warehouse_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "products_is_active_idx" ON "products"("is_active");

-- CreateIndex
CREATE INDEX "customers_is_active_idx" ON "customers"("is_active");

-- CreateIndex
CREATE INDEX "warehouses_is_active_idx" ON "warehouses"("is_active");

-- CreateIndex
CREATE INDEX "rates_product_id_effective_from_idx" ON "rates"("product_id", "effective_from" DESC);

-- CreateIndex
CREATE INDEX "rates_status_idx" ON "rates"("status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_no_key" ON "orders"("order_no");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_customer_id_status_order_seq_idx" ON "orders"("customer_id", "status", "order_seq");

-- CreateIndex
CREATE INDEX "orders_order_date_idx" ON "orders"("order_date");

-- CreateIndex
CREATE UNIQUE INDEX "orders_customer_id_order_seq_key" ON "orders"("customer_id", "order_seq");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_orders_do_no_key" ON "delivery_orders"("do_no");

-- CreateIndex
CREATE INDEX "delivery_orders_order_id_idx" ON "delivery_orders"("order_id");

-- CreateIndex
CREATE INDEX "delivery_orders_warehouse_id_status_idx" ON "delivery_orders"("warehouse_id", "status");

-- CreateIndex
CREATE INDEX "delivery_orders_status_idx" ON "delivery_orders"("status");

-- CreateIndex
CREATE INDEX "delivery_order_items_do_id_idx" ON "delivery_order_items"("do_id");

-- CreateIndex
CREATE INDEX "delivery_order_items_order_item_id_idx" ON "delivery_order_items"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispatches_challan_no_key" ON "dispatches"("challan_no");

-- CreateIndex
CREATE INDEX "dispatches_do_id_idx" ON "dispatches"("do_id");

-- CreateIndex
CREATE INDEX "dispatches_dispatch_date_idx" ON "dispatches"("dispatch_date");

-- CreateIndex
CREATE INDEX "dispatch_items_dispatch_id_idx" ON "dispatch_items"("dispatch_id");

-- CreateIndex
CREATE INDEX "dispatch_items_do_item_id_idx" ON "dispatch_items"("do_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_warehouse_id_product_id_key" ON "stock_balances"("warehouse_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_ledger_warehouse_id_product_id_created_at_idx" ON "stock_ledger"("warehouse_id", "product_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "stock_ledger_movement_type_idx" ON "stock_ledger"("movement_type");

-- CreateIndex
CREATE INDEX "stock_ledger_ref_type_ref_id_idx" ON "stock_ledger"("ref_type", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_transfer_no_key" ON "stock_transfers"("transfer_no");

-- CreateIndex
CREATE INDEX "stock_transfers_from_warehouse_id_status_idx" ON "stock_transfers"("from_warehouse_id", "status");

-- CreateIndex
CREATE INDEX "stock_transfers_to_warehouse_id_status_idx" ON "stock_transfers"("to_warehouse_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_count_no_key" ON "stock_counts"("count_no");

-- CreateIndex
CREATE INDEX "stock_counts_warehouse_id_status_idx" ON "stock_counts"("warehouse_id", "status");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rates" ADD CONSTRAINT "rates_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rates" ADD CONSTRAINT "rates_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_rate_id_fkey" FOREIGN KEY ("rate_id") REFERENCES "rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_order_items" ADD CONSTRAINT "delivery_order_items_do_id_fkey" FOREIGN KEY ("do_id") REFERENCES "delivery_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_order_items" ADD CONSTRAINT "delivery_order_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_order_items" ADD CONSTRAINT "delivery_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_do_id_fkey" FOREIGN KEY ("do_id") REFERENCES "delivery_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_do_item_id_fkey" FOREIGN KEY ("do_item_id") REFERENCES "delivery_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written safety nets (spec Section 4: "Add DB-level CHECK constraints
-- for the quantity limits wherever possible, as a second safety net behind the
-- service layer").
--
-- These constraints make over-allocation, over-dispatch, negative stock and
-- over-reservation impossible *at the storage layer*, so even a bug in the
-- service layer (or a direct SQL session) cannot corrupt a running business.
-- ===========================================================================

-- Rule 7 — stock can never go negative and reservations can never exceed stock.
ALTER TABLE "stock_balances"
  ADD CONSTRAINT "stock_balances_on_hand_non_negative" CHECK ("on_hand_mt" >= 0),
  ADD CONSTRAINT "stock_balances_reserved_non_negative" CHECK ("reserved_mt" >= 0),
  ADD CONSTRAINT "stock_balances_reserved_within_on_hand" CHECK ("reserved_mt" <= "on_hand_mt");

-- Rule 1/4 — an order line is always positive and can never be over-allocated
-- or over-delivered.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_qty_positive" CHECK ("qty_mt" > 0),
  ADD CONSTRAINT "order_items_delivered_non_negative" CHECK ("delivered_mt" >= 0),
  ADD CONSTRAINT "order_items_allocated_non_negative" CHECK ("do_allocated_mt" >= 0),
  ADD CONSTRAINT "order_items_allocated_within_qty" CHECK ("do_allocated_mt" <= "qty_mt"),
  ADD CONSTRAINT "order_items_delivered_within_qty" CHECK ("delivered_mt" <= "qty_mt"),
  ADD CONSTRAINT "order_items_values_non_negative" CHECK ("line_value" >= 0 AND "locked_rate_per_mt" > 0);

-- Rule 4 — a dispatch can never exceed its delivery order line.
ALTER TABLE "delivery_order_items"
  ADD CONSTRAINT "do_items_qty_positive" CHECK ("qty_mt" > 0),
  ADD CONSTRAINT "do_items_dispatched_non_negative" CHECK ("dispatched_mt" >= 0),
  ADD CONSTRAINT "do_items_dispatched_within_qty" CHECK ("dispatched_mt" <= "qty_mt");

ALTER TABLE "dispatch_items"
  ADD CONSTRAINT "dispatch_items_qty_positive" CHECK ("qty_mt" > 0);

-- Rule 1 — a published rate is always a positive amount.
ALTER TABLE "rates"
  ADD CONSTRAINT "rates_rate_positive" CHECK ("rate_per_mt" > 0);

-- Rules 2/3 — money and quantities on the order header.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_total_value_non_negative" CHECK ("total_value" >= 0),
  ADD CONSTRAINT "orders_seq_positive" CHECK ("order_seq" >= 1);

-- Rule 7 — transfers move a positive quantity between two different warehouses.
ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_qty_positive" CHECK ("qty_mt" > 0),
  ADD CONSTRAINT "stock_transfers_warehouses_differ" CHECK ("from_warehouse_id" <> "to_warehouse_id");

-- Rule 7 — physical vs system counts.
ALTER TABLE "stock_counts"
  ADD CONSTRAINT "stock_counts_quantities_non_negative" CHECK ("system_qty" >= 0 AND "physical_qty" >= 0);

-- Rule 8 — the audit trail is append-only at the database level too. No UPDATE,
-- DELETE or TRUNCATE can ever remove or rewrite an audit entry.
CREATE OR REPLACE FUNCTION sfuwt_prevent_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION sfuwt_prevent_audit_mutation();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION sfuwt_prevent_audit_mutation();

-- Indexes for the hot queue queries (Rule 3) and the dispatch register.
CREATE INDEX IF NOT EXISTS "orders_queue_idx"
  ON "orders" ("customer_id", "order_seq")
  WHERE "status" IN ('APPROVED', 'PARTIALLY_DELIVERED');

CREATE INDEX IF NOT EXISTS "delivery_orders_open_idx"
  ON "delivery_orders" ("warehouse_id", "created_at")
  WHERE "status" IN ('CREATED', 'PARTIALLY_DISPATCHED');

CREATE INDEX IF NOT EXISTS "stock_ledger_created_at_desc_idx"
  ON "stock_ledger" ("created_at" DESC);

