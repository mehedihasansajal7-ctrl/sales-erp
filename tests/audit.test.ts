import { beforeAll, describe, expect, it } from "vitest";
import {
  auditCount,
  createApprovedOrder,
  createDo,
  dispatch,
  doItemsOf,
  orderItemsOf,
  prisma,
  standardContext,
  type Ctx,
} from "@/tests/helpers/flows";

/**
 * Scenario 11 (must pass): the audit trail.
 * Every action writes a row, the rows carry who/what/before/after, and the
 * database refuses UPDATE, DELETE and TRUNCATE on audit_logs.
 */
describe("Rule 8 — audit trail is complete and append-only", () => {
  let ctx: Ctx;
  let orderId: string;
  let doId: string;

  beforeAll(async () => {
    ctx = await standardContext();
    await prisma.customer.create({ data: { code: "CUS-AUD", name: "Audit Trader" } });

    const order = await createApprovedOrder(ctx, "CUS-AUD", [
      { productCode: "FERT-UREA", qtyMt: "20.000" },
    ]);
    orderId = order.id;
    const items = await orderItemsOf(order.id);
    const doResult = await createDo(ctx, order.id, "WH-DHK", [
      { orderItemId: items[0]!.id, qtyMt: "20.000" },
    ]);
    doId = doResult.deliveryOrder.id;
    const doItems = await doItemsOf(doId);
    await dispatch(ctx, doId, [{ doItemId: doItems[0]!.id, qtyMt: "20.000" }], "CH-AUDIT-1");
  });

  it("records create, approve, DO creation and dispatch with before/after values", async () => {
    expect(await auditCount("order", orderId, "CREATE")).toBe(1);
    expect(await auditCount("order", orderId, "APPROVE")).toBe(1);
    expect(await auditCount("delivery_order", doId, "CREATE")).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { entity: "dispatch", action: "DISPATCH" } }),
    ).toBeGreaterThanOrEqual(1);

    const approve = await prisma.auditLog.findFirstOrThrow({
      where: { entity: "order", entityId: orderId, action: "APPROVE" },
    });
    expect(approve.userName).toBe(ctx.ops.name);
    expect(JSON.stringify(approve.oldValue)).toContain("PENDING_APPROVAL");
    expect(JSON.stringify(approve.newValue)).toContain("APPROVED");
    expect(approve.createdAt).toBeInstanceOf(Date);
  });

  it("records stock movements as stock ledger entries plus audit rows", async () => {
    const ledger = await prisma.stockLedger.findMany({ where: { refId: doId } });
    expect(ledger.length).toBeGreaterThanOrEqual(1);
    const stockAudit = await prisma.auditLog.count({ where: { entity: "stock" } });
    expect(stockAudit).toBeGreaterThanOrEqual(1);
  });

  it("rejects UPDATE on audit_logs at the database level", async () => {
    const row = await prisma.auditLog.findFirstOrThrow({ where: { entity: "order", entityId: orderId } });
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "audit_logs" SET "action" = 'TAMPERED' WHERE "id" = $1`, row.id),
    ).rejects.toThrowError(/append-only/);

    const unchanged = await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(unchanged.action).not.toBe("TAMPERED");
  });

  it("rejects DELETE and TRUNCATE on audit_logs", async () => {
    const row = await prisma.auditLog.findFirstOrThrow({ where: { entity: "order", entityId: orderId } });
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "audit_logs" WHERE "id" = $1`, row.id),
    ).rejects.toThrowError(/append-only/);

    await expect(prisma.$executeRawUnsafe(`TRUNCATE TABLE "audit_logs"`)).rejects.toThrowError(
      /append-only/,
    );

    const stillThere = await prisma.auditLog.findUnique({ where: { id: row.id } });
    expect(stillThere).not.toBeNull();
  });

  it("records failed sign-ins without a user id", async () => {
    const { writeAudit } = await import("@/lib/audit");
    await writeAudit({
      action: "LOGIN_FAILED",
      entity: "auth",
      entityId: "someone@test.local",
      newValue: { email: "someone@test.local" },
      ip: "203.0.113.9",
    });
    const failed = await prisma.auditLog.findFirstOrThrow({
      where: { action: "LOGIN_FAILED", entityId: "someone@test.local" },
    });
    expect(failed.userId).toBeNull();
    expect(failed.ip).toBe("203.0.113.9");
  });

  it("exposes the audit log through the read-only viewer query", async () => {
    const { listAuditLogs } = await import("@/server/services/audit.service");
    const page = await listAuditLogs({ entity: "order", pageSize: 10 });
    expect(page.total).toBeGreaterThanOrEqual(2);
    expect(page.rows[0]?.createdAtLabel).toMatch(/\d{2}:\d{2}/);
    expect(page.rows.every((row) => typeof row.userName === "string")).toBe(true);
  });
});
