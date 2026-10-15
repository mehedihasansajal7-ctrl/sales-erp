import { beforeAll, afterAll } from "vitest";
import prisma from "@/lib/prisma";
import { resetDatabase } from "./helpers/db";

/**
 * Global per-file setup: every test file starts from an empty, migrated
 * database so tests can never depend on each other's leftovers.
 */
beforeAll(async () => {
  await resetDatabase();
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});
