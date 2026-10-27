-- DropIndex
DROP INDEX "stock_ledger_warehouse_id_product_id_created_at_idx";

-- AlterTable
ALTER TABLE "stock_ledger" ADD COLUMN     "movement_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "stock_ledger_warehouse_id_product_id_movement_date_idx" ON "stock_ledger"("warehouse_id", "product_id", "movement_date" DESC);
