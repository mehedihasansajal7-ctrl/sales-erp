import { beforeAll, describe, expect, it } from "vitest";
import { userCreateSchema, userUpdateSchema } from "@/lib/validation";
import { createUser, updateUser, adminResetPassword, listUsers } from "@/server/services/user.service";
import { saveProduct, saveCustomer, saveWarehouse } from "@/server/services/master-data.service";
import { prisma, standardContext, type Ctx } from "@/tests/helpers/flows";

/**
 * Administrator flows. These cover a real bug found while adding an admin by
 * hand: an empty warehouse field reached PostgreSQL as `""` and violated
 * `users_warehouse_id_fkey`, so *any* non-warehouse user could not be created
 * from the UI.
 */
describe("Admin — users, roles and master data", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await standardContext();
  });

  it("treats an empty warehouse as 'no warehouse' in the schema", () => {
    const created = userCreateSchema.parse({
      name: "No Warehouse Admin",
      email: "nowh@test.local",
      password: "password123",
      role: "ADMIN",
      warehouseCode: "",
      isActive: true,
    });
    expect(created.warehouseCode).toBeUndefined();

    const updated = userUpdateSchema.parse({
      name: "No Warehouse Admin",
      role: "ADMIN",
      warehouseCode: "",
      isActive: true,
    });
    expect(updated.warehouseCode).toBeUndefined();
  });

  it("creates an administrator without a warehouse (regression: FK violation)", async () => {
    const user = await createUser(
      {
        name: "Mehedi Hasan Sajal",
        email: "mehedi06@akijresource.com",
        password: "Mehedi@2026",
        role: "ADMIN",
        warehouseCode: "",
        isActive: true,
      },
      { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
    );

    expect(user.role).toBe("ADMIN");
    expect(user.warehouseId).toBeNull();
    expect(user.isActive).toBe(true);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: "mehedi06@akijresource.com" } });
    expect(stored.warehouseId).toBeNull();

    // ...and the creation is audited.
    const audit = await prisma.auditLog.findFirst({
      where: { entity: "user", entityId: user.id, action: "CREATE" },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.newValue)).toContain("mehedi06@akijresource.com");
  });

  it("refuses a warehouse user without a warehouse, and a duplicate email", async () => {
    await expect(
      createUser(
        {
          name: "Warehouse Without Site",
          email: "nowh2@test.local",
          password: "password123",
          role: "WAREHOUSE",
          isActive: true,
        },
        { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
      ),
    ).rejects.toThrowError(/must be assigned to a warehouse/);

    await expect(
      createUser(
        {
          name: "Duplicate",
          email: "mehedi06@akijresource.com",
          password: "password123",
          role: "ADMIN",
          isActive: true,
        },
        { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
      ),
    ).rejects.toThrowError(/already exists/);
  });

  it("creates a warehouse user bound to its warehouse and can remove the binding again", async () => {
    const created = await createUser(
      {
        name: "Mongla Operator",
        email: "warehouse.mgl@test.local",
        password: "password123",
        role: "WAREHOUSE",
        warehouseCode: "WH-MGL",
        isActive: true,
      },
      { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
    );
    expect(created.warehouseId).toBe("WH-MGL");

    const updated = await updateUser(
      created.id,
      { name: "Mongla Operator", role: "ADMIN", warehouseCode: "", isActive: true },
      { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
    );
    expect(updated.warehouseId).toBeNull();
    expect(updated.role).toBe("ADMIN");
  });

  it("revokes sessions when a user is deactivated", async () => {
    const created = await createUser(
      {
        name: "Temporary Person",
        email: "temp@test.local",
        password: "password123",
        role: "SALES",
        isActive: true,
      },
      { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
    );
    await prisma.session.create({
      data: { userId: created.id, expiresAt: new Date(Date.now() + 3600_000) },
    });
    expect(await prisma.session.count({ where: { userId: created.id } })).toBe(1);

    await updateUser(
      created.id,
      { name: "Temporary Person", role: "SALES", isActive: false },
      { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
    );

    expect(await prisma.session.count({ where: { userId: created.id } })).toBe(0);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.isActive).toBe(false);
  });

  it("reset a password and forces a change at next sign-in", async () => {
    const target = await prisma.user.findUniqueOrThrow({ where: { email: "temp@test.local" } });
    await adminResetPassword(
      target.id,
      "brand-new-password",
      { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
      "127.0.0.1",
    );
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(stored.mustChangePassword).toBe(true);
    expect(stored.passwordHash).not.toBe(target.passwordHash);
  });

  it("protects the administrator from removing their own admin role or deactivating themselves", async () => {
    await expect(
      updateUser(
        ctx.admin.id,
        { name: ctx.admin.name, role: "SALES", isActive: true },
        { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
      ),
    ).rejects.toThrowError(/cannot remove your own administrator role/i);

    await expect(
      updateUser(
        ctx.admin.id,
        { name: ctx.admin.name, role: "ADMIN", isActive: false },
        { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
      ),
    ).rejects.toThrowError(/cannot deactivate your own account/i);
  });

  it("lists users with their warehouse and role, newest flags included", async () => {
    const users = await listUsers({ q: "mehedi06" });
    expect(users).toHaveLength(1);
    expect(users[0]?.role).toBe("ADMIN");
    expect(users[0]?.warehouseName).toBeNull();
  });

  it("saves master data and audits it (product / customer / warehouse)", async () => {
    await saveProduct(
      { code: "COAL-PC", name: "Petcoke", category: "Coal", unit: "MT", isActive: true },
      { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
    );
    const product = await prisma.product.findUnique({ where: { code: "COAL-PC" } });
    expect(product?.name).toBe("Petcoke");

    await saveCustomer(
      { code: "CUS-NEW", name: "New Trader", creditLimit: "250000.00", isActive: true },
      { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
    );
    const customer = await prisma.customer.findUnique({ where: { code: "CUS-NEW" } });
    expect(customer?.creditLimit?.toFixed(2)).toBe("250000.00");

    await saveWarehouse(
      { code: "WH-NEW", name: "New Warehouse", location: "Sylhet", isActive: true },
      { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
    );
    const warehouse = await prisma.warehouse.findUnique({ where: { code: "WH-NEW" } });
    expect(warehouse?.location).toBe("Sylhet");

    const audits = await prisma.auditLog.count({
      where: { entity: { in: ["product", "customer", "warehouse"] }, action: "CREATE" },
    });
    expect(audits).toBeGreaterThanOrEqual(3);
  });
});
