import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton. Next.js dev mode re-evaluates modules on every edit,
 * so we keep the instance on `globalThis` to avoid exhausting DB connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** Prisma transaction client type, used by the service layer. */
export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export default prisma;
