import { NextResponse } from "next/server";
import { getClientIp, requireUser } from "@/lib/auth";
import { toAppError } from "@/lib/errors";
import { isChatRoomKey } from "@/lib/chat";
import { chatPostSchema } from "@/lib/validation";
import { listChatMessages, postChatMessage } from "@/server/services/chat.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/chat/messages?room=OPERATION_SALES[&after=<ISO date>]
 *
 * Returns the newest page (oldest first) or only the messages that arrived after
 * the given cursor - that is what the open room polls every few seconds.
 * Reading a room marks it read for the caller.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const room = url.searchParams.get("room") ?? "";

    if (!isChatRoomKey(room)) {
      return NextResponse.json({ error: "Unknown chat room" }, { status: 400 });
    }

    const afterRaw = url.searchParams.get("after");
    const after = afterRaw ? new Date(afterRaw) : undefined;
    const cursor = after && !Number.isNaN(after.getTime()) ? after : undefined;

    const messages = await listChatMessages(
      room,
      { id: user.id, name: user.name, role: user.role },
      { after: cursor },
    );

    return NextResponse.json({ messages });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(
      { error: appError.message, code: appError.code },
      { status: appError.status },
    );
  }
}

/**
 * POST /api/chat/messages
 * Body: { room, body, orderId?, deliveryOrderId?, mentionedUserIds? }
 *
 * Chat rows are append-only: there is no PUT and no DELETE endpoint anywhere.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const json = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const input = chatPostSchema.parse({
      room: json.room,
      body: json.body,
      orderId: json.orderId || undefined,
      deliveryOrderId: json.deliveryOrderId || undefined,
      mentionedUserIds: Array.isArray(json.mentionedUserIds)
        ? json.mentionedUserIds.filter((v): v is string => typeof v === "string" && v.length > 0)
        : undefined,
    });

    const message = await postChatMessage(
      input,
      { id: user.id, name: user.name, role: user.role },
      await getClientIp(),
    );

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(
      { error: appError.message, code: appError.code },
      { status: appError.status },
    );
  }
}
