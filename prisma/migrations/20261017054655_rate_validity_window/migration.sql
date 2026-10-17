-- DropIndex
DROP INDEX "stock_ledger_created_at_desc_idx";

-- AlterTable
ALTER TABLE "rates" ADD COLUMN     "effective_to" TIMESTAMP(3);
