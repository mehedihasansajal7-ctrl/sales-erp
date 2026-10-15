import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe used by docker-compose and any uptime monitor. */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      database: "up",
      latencyMs: Date.now() - startedAt,
      time: new Date().toISOString(),
      timezone: process.env.APP_TIMEZONE ?? "Asia/Dhaka",
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "degraded",
        database: "down",
        error: error instanceof Error ? error.message : "unknown error",
        time: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
