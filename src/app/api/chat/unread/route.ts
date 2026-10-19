import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { toAppError } from "@/lib/errors";
import { chatUnread } from "@/server/services/chat.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/chat/unread -> { total, mentions, rooms: { ROOM: n } }
 * Polled by the top-bar badge every 10 seconds. Cheap: three counts.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const summary = await chatUnread({ id: user.id, name: user.name, role: user.role });
    return NextResponse.json(summary);
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(
      { error: appError.message, code: appError.code },
      { status: appError.status },
    );
  }
}
