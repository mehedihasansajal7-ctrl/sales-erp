import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  canPostRoom,
  chatRoomDef,
  defaultRoomFor,
  isChatRoomKey,
  type ChatRoomKey,
} from "@/lib/chat";
import { chatTagOptions, listChatMessages, listChatRooms, roomMembers } from "@/server/services/chat.service";
import { ChatRoomView } from "@/components/chat/chat-room";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * Chat page. Only the rooms the role is a member of are listed, and the selected
 * room is re-checked server-side: `/chat?room=OPERATION_WAREHOUSE` typed by a
 * salesperson simply lands them back in their own room.
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const user = await requirePermission("chat.view");
  const actor = { id: user.id, name: user.name, role: user.role };

  const rooms = await listChatRooms(actor);
  const allowed = new Set(rooms.map((room) => room.key));

  const requested = (await searchParams).room;
  const room: ChatRoomKey =
    requested && isChatRoomKey(requested) && allowed.has(requested)
      ? requested
      : defaultRoomFor(user.role);

  const [messages, members, tags] = await Promise.all([
    listChatMessages(room, actor),
    roomMembers(room),
    chatTagOptions(actor),
  ]);

  const definition = chatRoomDef(room);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Chat</h1>
          <p className="text-sm text-slate-500">
            Fixed rooms only - no direct messages. Sales talks to Operations, Operations talks to the
            warehouse; every message is kept and audited.
          </p>
        </div>
        <Badge tone="outline">Append only · no edit, no delete</Badge>
      </header>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-2">
          {rooms.map((entry) => (
            <Link
              key={entry.key}
              href={`/chat?room=${entry.key}`}
              className={cn(
                "flex flex-col gap-1 rounded-lg border px-3 py-2 transition-colors",
                entry.key === room
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-slate-200 bg-white hover:bg-slate-50",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">{entry.shortName}</span>
                {entry.unread > 0 ? (
                  <span
                    className={cn(
                      "inline-flex min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold leading-5 text-white",
                      entry.mentions > 0 ? "bg-red-600" : "bg-emerald-600",
                    )}
                  >
                    {entry.unread}
                  </span>
                ) : null}
              </div>
              <p className="line-clamp-2 text-[11px] text-slate-500">
                {entry.lastMessage
                  ? `${entry.lastMessage.authorName}: ${entry.lastMessage.body}`
                  : entry.description}
              </p>
              {!entry.canPost ? <span className="text-[10px] text-slate-400">read only</span> : null}
            </Link>
          ))}

          <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            A salesperson never sees the warehouse room and a warehouse user never sees the sales room.
            Operations sits in both, so nothing has to be decided on a personal phone.
          </p>
        </aside>

        <ChatRoomView
          key={room}
          roomKey={room}
          roomName={definition.name}
          roomDescription={definition.description}
          canPost={canPostRoom(user.role, room)}
          me={{ id: user.id, name: user.name, role: user.role }}
          initialMessages={messages}
          members={members.map((member) => ({
            id: member.id,
            name: member.name,
            role: member.role,
          }))}
          tags={tags}
        />
      </div>
    </div>
  );
}
