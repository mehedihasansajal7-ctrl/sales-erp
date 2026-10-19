import { beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS, roleHasPermission } from "@/lib/rbac";
import { errors } from "@/lib/errors";
import {
  actor,
  createApprovedOrder,
  createDo,
  orderItemsOf,
  prisma,
  standardContext,
  type Ctx,
} from "@/tests/helpers/flows";

/**
 * Scenario 10 (must pass): permissions.
 * Salesperson cannot publish rates or approve; Warehouse cannot create DOs;
 * Warehouse A cannot see Warehouse B's DOs; Management cannot write.
 *
 * The permission map and the service-level scoping are both exercised; every
 * server action additionally calls `requirePermission` (see src/actions/*).
 */
describe("Permissions and data scoping", () => {
  let ctx: Ctx;
  let dhakaDoId: string;
  let ctgDoId: string;
  let orderId: string;

  beforeAll(async () => {
    ctx = await standardContext();
    await prisma.customer.createMany({
      data: [
        { code: "CUS-P1", name: "Permission Trader 1" },
        { code: "CUS-P2", name: "Permission Trader 2" },
      ],
    });

    const orderA = await createApprovedOrder(ctx, "CUS-P1", [
      { productCode: "FERT-UREA", qtyMt: "40.000" },
    ]);
    const itemsA = await orderItemsOf(orderA.id);
    dhakaDoId = (
      await createDo(ctx, orderA.id, "WH-DHK", [{ orderItemId: itemsA[0]!.id, qtyMt: "20.000" }])
    ).deliveryOrder.id;
    orderId = orderA.id;

    const orderB = await createApprovedOrder(ctx, "CUS-P2", [
      { productCode: "FERT-UREA", qtyMt: "40.000" },
    ]);
    const itemsB = await orderItemsOf(orderB.id);
    ctgDoId = (
      await createDo(ctx, orderB.id, "WH-CTG", [{ orderItemId: itemsB[0]!.id, qtyMt: "20.000" }])
    ).deliveryOrder.id;
  });

  it("the permission map denies the documented role/action pairs", () => {
    expect(roleHasPermission("SALES", "rate.publish")).toBe(false);
    expect(roleHasPermission("SALES", "order.approve")).toBe(false);
    expect(roleHasPermission("SALES", "do.create")).toBe(false);
    expect(roleHasPermission("WAREHOUSE", "do.create")).toBe(false);
    expect(roleHasPermission("WAREHOUSE", "order.approve")).toBe(false);
    expect(roleHasPermission("WAREHOUSE", "rate.publish")).toBe(false);
    expect(roleHasPermission("MANAGEMENT", "order.create")).toBe(false);
    expect(roleHasPermission("FINANCE", "dispatch.create")).toBe(false);
  });

  it("every permission is granted to at least one role (no dead actions)", () => {
    for (const [permission, roles] of Object.entries(PERMISSIONS)) {
      expect(roles.length, `permission ${permission} has no role`).toBeGreaterThan(0);
    }
  });

  it("Warehouse A only sees and acts on its own warehouse", async () => {
    const { listDeliveryOrders, getDeliveryOrder } = await import(
      "@/server/services/delivery-order.service"
    );

    const dhakaView = await listDeliveryOrders(
      { status: "ALL" },
      actor(ctx.warehouse, "WH-DHK"),
    );
    const dhakaIds = dhakaView.rows.map((row) => row.id);
    expect(dhakaIds).toContain(dhakaDoId);
    expect(dhakaIds).not.toContain(ctgDoId);

    const ctgView = await listDeliveryOrders(
      { status: "ALL" },
      actor(ctx.warehouseCtg, "WH-CTG"),
    );
    const ctgIds = ctgView.rows.map((row) => row.id);
    expect(ctgIds).toContain(ctgDoId);
    expect(ctgIds).not.toContain(dhakaDoId);

    // Explicit access to the other warehouse's DO is refused.
    await expect(getDeliveryOrder(ctgDoId, actor(ctx.warehouse, "WH-DHK"))).rejects.toThrowError(
      /not allowed to perform/,
    );
  });

  it("a warehouse cannot dispatch another warehouse's DO even if it knows the id", async () => {
    const { recordDispatch } = await import("@/server/services/dispatch.service");
    const { doItemsOf } = await import("@/tests/helpers/flows");
    const doItems = await doItemsOf(ctgDoId);

    await expect(
      recordDispatch(
        {
          doId: ctgDoId,
          truckNo: "X-1",
          driverName: "Nope",
          driverPhone: "01711-000000",
          challanNo: "CH-WRONG-WH",
          loadingDate: new Date().toISOString(),
          dispatchDate: new Date().toISOString(),
          items: [{ doItemId: doItems[0]!.id, qtyMt: "1.000" }],
        },
        actor(ctx.warehouse, "WH-DHK"),
      ),
    ).rejects.toThrowError(/not allowed to perform/);
  });

  it("Management is read-only", async () => {
    const writeLike =
      /(create|publish|approve|reject|cancel|inward|opening|adjust|override|shortClose|request|receive)/i;
    const writePermissions = Object.keys(PERMISSIONS).filter((permission) =>
      writeLike.test(permission),
    );
    expect(writePermissions.length).toBeGreaterThan(5);
    for (const permission of writePermissions) {
      expect(roleHasPermission("MANAGEMENT", permission as never)).toBe(false);
    }
    // ...but Management can read every dashboard and report.
    expect(roleHasPermission("MANAGEMENT", "report.view")).toBe(true);
    expect(roleHasPermission("MANAGEMENT", "dashboard.view")).toBe(true);
    expect(roleHasPermission("MANAGEMENT", "audit.view")).toBe(true);
  });

  it("a Salesperson cannot read another salesperson's order detail", async () => {
    const otherSales = await prisma.user.create({
      data: {
        name: "Other Salesperson",
        email: "otrosales@test.local",
        passwordHash: "x",
        role: "SALES",
      },
    });

    const { getOrderDetail } = await import("@/server/services/order.service");
    await expect(
      getOrderDetail(orderId, { id: otherSales.id, name: otherSales.name, role: "SALES" }),
    ).rejects.toThrowError(/not allowed to perform/);

    // The owner can read it.
    const own = await getOrderDetail(orderId, {
      id: ctx.sales.id,
      name: ctx.sales.name,
      role: "SALES",
    });
    expect(own.orderNo).toMatch(/^SO\d{11}$/);
  });

  it("exposes a stable error shape for forbidden actions", () => {
    expect(errors.forbidden("this action").code).toBe("FORBIDDEN");
    expect(errors.forbidden("this action").status).toBe(403);
    expect(errors.unauthenticated().status).toBe(401);
  });
});
