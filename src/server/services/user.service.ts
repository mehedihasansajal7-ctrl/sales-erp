import { type Prisma, type Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { actor, writeAudit } from "@/lib/audit";
import { hashPassword, revokeUserSessions } from "@/lib/auth";
import type { ServiceActor } from "@/server/services/order.service";

/** Admin — user & role management (spec Section 7.8). */

export type CreateUserInput = {
  name: string;
  email: string;
  password: string;
  role: Role;
  warehouseCode?: string;
  isActive?: boolean;
};

export async function listUsers(filter: { q?: string; role?: Role | "ALL" } = {}) {
  const where: Prisma.UserWhereInput = {
    ...(filter.role && filter.role !== "ALL" ? { role: filter.role } : {}),
    ...(filter.q
      ? {
          OR: [
            { name: { contains: filter.q, mode: "insensitive" } },
            { email: { contains: filter.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const users = await prisma.user.findMany({
    where,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { warehouse: true },
  });

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    warehouseCode: user.warehouseId,
    warehouseName: user.warehouse?.name ?? null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  }));
}

export type UserRow = Awaited<ReturnType<typeof listUsers>>[number];

export async function createUser(input: CreateUserInput, admin: ServiceActor, ip?: string) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw errors.conflict(`A user with email ${input.email} already exists.`);

  if (input.role === "WAREHOUSE" && !input.warehouseCode) {
    throw errors.validation("A warehouse user must be assigned to a warehouse.");
  }
  if (input.warehouseCode) {
    const warehouse = await prisma.warehouse.findUnique({ where: { code: input.warehouseCode } });
    if (!warehouse) throw errors.notFound("Warehouse");
  }

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      warehouseId: input.warehouseCode ?? null,
      isActive: input.isActive ?? true,
      createdBy: admin.id,
    },
    include: { warehouse: true },
  });

  await writeAudit({
    ...actor(admin, ip),
    action: "CREATE",
    entity: "user",
    entityId: user.id,
    newValue: { name: user.name, email: user.email, role: user.role, warehouse: user.warehouseId },
  });

  return user;
}

export type UpdateUserInput = {
  name: string;
  role: Role;
  warehouseCode?: string;
  isActive: boolean;
};

export async function updateUser(
  userId: string,
  input: UpdateUserInput,
  admin: ServiceActor,
  ip?: string,
) {
  const before = await prisma.user.findUnique({ where: { id: userId } });
  if (!before) throw errors.notFound("User");

  if (input.role === "WAREHOUSE" && !input.warehouseCode) {
    throw errors.validation("A warehouse user must be assigned to a warehouse.");
  }
  if (userId === admin.id && input.role !== "ADMIN") {
    throw errors.conflict("You cannot remove your own administrator role.");
  }
  if (userId === admin.id && !input.isActive) {
    throw errors.conflict("You cannot deactivate your own account.");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      name: input.name,
      role: input.role,
      warehouseId: input.warehouseCode ?? null,
      isActive: input.isActive,
    },
    include: { warehouse: true },
  });

  if (before.isActive && !updated.isActive) {
    await revokeUserSessions(userId);
  }

  await writeAudit({
    ...actor(admin, ip),
    action: updated.isActive ? "UPDATE" : "DEACTIVATE",
    entity: "user",
    entityId: userId,
    oldValue: {
      name: before.name,
      role: before.role,
      warehouse: before.warehouseId,
      isActive: before.isActive,
    },
    newValue: {
      name: updated.name,
      role: updated.role,
      warehouse: updated.warehouseId,
      isActive: updated.isActive,
    },
  });

  return updated;
}

export async function adminResetPassword(
  userId: string,
  password: string,
  admin: ServiceActor,
  ip?: string,
) {
  const before = await prisma.user.findUnique({ where: { id: userId } });
  if (!before) throw errors.notFound("User");

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password), mustChangePassword: true },
  });
  await revokeUserSessions(userId);

  await writeAudit({
    ...actor(admin, ip),
    action: "PASSWORD_CHANGE",
    entity: "user",
    entityId: userId,
    newValue: { resetByAdmin: true, email: before.email },
  });
}
