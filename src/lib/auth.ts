import { cookies, headers } from "next/headers";
import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { ROLE_HOME, roleHasPermission, type Permission } from "@/lib/rbac";

export const SESSION_COOKIE = "erp_session";

const SESSION_MAX_AGE_SECONDS = Number(process.env.SESSION_MAX_AGE_SECONDS ?? 60 * 60 * 12);

function authSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET must be set to a long random string in production.");
    }
    return new TextEncoder().encode("insecure-development-secret-please-change");
  }
  return new TextEncoder().encode(secret);
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  warehouseId: string | null;
  warehouseName: string | null;
  mustChangePassword: boolean;
};

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export async function getClientIp(): Promise<string | undefined> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();
  return h.get("x-real-ip") ?? undefined;
}

export async function getUserAgent(): Promise<string | undefined> {
  const h = await headers();
  return h.get("user-agent") ?? undefined;
}

/**
 * Creates a server-side session row and sets a signed, httpOnly cookie that
 * carries only the opaque session id (never the role or any user data).
 */
export async function createSession(userId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt,
      ip: await getClientIp(),
      userAgent: await getUserAgent(),
    },
  });

  const token = await new SignJWT({ sid: session.id, uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(authSecret());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return session.id;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  if (!token) return;
  try {
    const { payload } = await jwtVerify(token, authSecret());
    const sid = payload.sid as string | undefined;
    if (sid) await prisma.session.deleteMany({ where: { id: sid } });
  } catch {
    // Token already invalid — nothing to revoke.
  }
}

/** Revokes every session of a user (used when a user is deactivated). */
export async function revokeUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

/**
 * Resolves the signed-in user for the current request, or null.
 * Cached per request so a page + its actions do not hit the DB repeatedly.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  let token: string | undefined;
  try {
    const store = await cookies();
    token = store.get(SESSION_COOKIE)?.value;
  } catch {
    return null;
  }
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, authSecret());
    const sid = payload.sid as string | undefined;
    if (!sid) return null;

    const session = await prisma.session.findUnique({
      where: { id: sid },
      include: { user: { include: { warehouse: true } } },
    });
    if (!session) return null;
    if (session.expiresAt.getTime() < Date.now()) {
      await prisma.session.deleteMany({ where: { id: sid } });
      return null;
    }
    if (!session.user.isActive) return null;

    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
      warehouseId: session.user.warehouseId,
      warehouseName: session.user.warehouse?.name ?? null,
      mustChangePassword: session.user.mustChangePassword,
    };
  } catch {
    return null;
  }
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw errors.unauthenticated();
  return user;
}

/** Server-side permission gate — used by every action and route handler. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!roleHasPermission(user.role, permission)) {
    throw errors.forbidden(permission.replace(/\./g, " "));
  }
  return user;
}

/**
 * Warehouse scoping: a WAREHOUSE user may only touch their own warehouse.
 * ADMIN bypasses the scope; every other role is rejected unless `allowAll`.
 */
export async function requireWarehouseScope(
  user: SessionUser,
  warehouseId: string,
): Promise<void> {
  if (user.role === "ADMIN") return;
  if (user.role !== "WAREHOUSE") throw errors.forbidden("warehouse operations");
  if (!user.warehouseId) throw errors.forbidden("warehouse operations (no warehouse assigned)");
  if (user.warehouseId !== warehouseId) {
    throw errors.forbidden("operations on another warehouse");
  }
}

export function homeFor(role: Role): string {
  return ROLE_HOME[role];
}

export { SESSION_MAX_AGE_SECONDS };
