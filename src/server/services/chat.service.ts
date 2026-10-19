import type { ChatRoom, Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { actor, writeAudit } from "@/lib/audit";
import {
  CHAT_BODY_MAX,
  CHAT_PAGE_SIZE,
  canPostRoom,
  canReadRoom,
  chatRoomDef,
  extractMentions,
  rolesForRoom,
  roomsForRole,
  type ChatMessageDto,
  type ChatMemberDto,
  type ChatRoomKey,
  type ChatRoomSummary,
  type ChatTagOptions,
} from "@/lib/chat";

/**
 * Chat service. Fixed rooms, no direct messages, append only.
 *
 * Every entry point re-checks the room membership on the server, so a role that
 * cannot see a room cannot read it or post into it even by calling the API with a
 * guessed room key.
 */

export type ChatActor = { id: string; name: string; role: Role };

const messageInclude = {
  author: { select: { id: true, name: true, role: true } },
  order: { select: { id: true, orderNo: true } },
  deliveryOrder: { select: { id: true, doNo: true } },
} as const;

type MessageRow = {
  id: string;
  room: ChatRoom;
  body: string;
  createdAt: Date;
  authorId: string;
  mentionedUserIds: string[];
  author: { id: string; name: string; role: Role };
  order: { id: string; orderNo: string } | null;
  deliveryOrder: { id: string; doNo: string } | null;
};

function toMessageDto(row: MessageRow, viewerId: string): ChatMessageDto {
  return {
    id: row.id,
    room: row.room,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    mine: row.authorId === viewerId,
    author: row.author,
    order: row.order,
    deliveryOrder: row.deliveryOrder,
    mentionedUserIds: row.mentionedUserIds,
  };
}

function assertReadable(room: ChatRoomKey, role: Role) {
  if (!canReadRoom(role, room)) {
    throw errors.forbidden(`the ${chatRoomDef(room).name} room`);
  }
}

/** Active people who can see this room - the only valid @mention targets. */
export async function roomMembers(room: ChatRoomKey): Promise<(ChatMemberDto & { createdAt?: Date })[]> {
  return prisma.user.findMany({
    where: { isActive: true, role: { in: rolesForRoom(room) } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
}

/** Rooms for the sidebar plus the unread counts that drive the badges. */
export async function listChatRooms(user: ChatActor): Promise<ChatRoomSummary[]> {
  const rooms = roomsForRole(user.role);
  const states = await prisma.chatReadState.findMany({ where: { userId: user.id } });
  const lastRead = new Map(states.map((s) => [s.room, s.lastReadAt]));

  return Promise.all(
    rooms.map(async (room) => {
      const since = lastRead.get(room.key);
      const unreadWhere = {
        room: room.key,
        authorId: { not: user.id },
        ...(since ? { createdAt: { gt: since } } : {}),
      };

      const [unread, mentions, last] = await Promise.all([
        prisma.chatMessage.count({ where: unreadWhere }),
        prisma.chatMessage.count({
          where: { ...unreadWhere, mentionedUserIds: { has: user.id } },
        }),
        prisma.chatMessage.findFirst({
          where: { room: room.key },
          orderBy: { createdAt: "desc" },
          include: messageInclude,
        }),
      ]);

      return {
        key: room.key,
        name: room.name,
        shortName: room.shortName,
        description: room.description,
        canPost: canPostRoom(user.role, room.key),
        unread,
        mentions,
        lastMessage: last
          ? {
              body: last.body,
              authorName: last.author.name,
              createdAt: last.createdAt.toISOString(),
            }
          : null,
      };
    }),
  );
}

/**
 * Reads a room. Without `after` it returns the newest page (oldest first); with
 * `after` it returns only what arrived since, which is what the client polls for.
 */
export async function listChatMessages(
  room: ChatRoomKey,
  user: ChatActor,
  options: { after?: Date; take?: number } = {},
): Promise<ChatMessageDto[]> {
  assertReadable(room, user.role);
  const take = Math.min(200, Math.max(1, options.take ?? CHAT_PAGE_SIZE));

  const rows = options.after
    ? await prisma.chatMessage.findMany({
        where: { room, createdAt: { gt: options.after } },
        orderBy: { createdAt: "asc" },
        take,
        include: messageInclude,
      })
    : (
        await prisma.chatMessage.findMany({
          where: { room },
          orderBy: { createdAt: "desc" },
          take,
          include: messageInclude,
        })
      ).reverse();

  // Opening / polling a room is what marks it read.
  await markRoomRead(room, user.id);

  return rows.map((row) => toMessageDto(row, user.id));
}

export type PostChatInput = {
  room: ChatRoomKey;
  body: string;
  orderId?: string | null;
  deliveryOrderId?: string | null;
  mentionedUserIds?: string[];
};

export async function postChatMessage(
  input: PostChatInput,
  user: ChatActor,
  ip?: string | null,
): Promise<ChatMessageDto> {
  assertReadable(input.room, user.role);
  if (!canPostRoom(user.role, input.room)) {
    throw errors.forbidden(`posting in the ${chatRoomDef(input.room).name} room`);
  }

  const body = (input.body ?? "").trim();
  if (!body) throw errors.validation("Write a message before sending.");
  if (body.length > CHAT_BODY_MAX) {
    throw errors.validation(`A message cannot be longer than ${CHAT_BODY_MAX} characters.`);
  }

  if (input.orderId) {
    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, createdBy: true },
    });
    if (!order) throw errors.notFound("Order");
    // A salesperson may only talk about their own orders.
    if (user.role === "SALES" && order.createdBy !== user.id) {
      throw errors.forbidden("messages about another salesperson's order");
    }
  }

  if (input.deliveryOrderId) {
    const deliveryOrder = await prisma.deliveryOrder.findUnique({
      where: { id: input.deliveryOrderId },
      select: { id: true, order: { select: { createdBy: true } } },
    });
    if (!deliveryOrder) throw errors.notFound("Delivery order");
    if (user.role === "SALES" && deliveryOrder.order.createdBy !== user.id) {
      throw errors.forbidden("messages about another salesperson's delivery order");
    }
  }

  const members = await roomMembers(input.room);
  const memberIds = new Set(members.map((m) => m.id));
  const mentioned = new Set<string>();
  for (const id of input.mentionedUserIds ?? []) {
    if (memberIds.has(id)) mentioned.add(id);
  }
  for (const id of extractMentions(body, members)) mentioned.add(id);
  mentioned.delete(user.id);

  const row = await prisma.chatMessage.create({
    data: {
      room: input.room,
      body,
      orderId: input.orderId ?? null,
      deliveryOrderId: input.deliveryOrderId ?? null,
      mentionedUserIds: [...mentioned],
      authorId: user.id,
    },
    include: messageInclude,
  });

  // The author has obviously read their own message.
  await prisma.chatReadState.upsert({
    where: { userId_room: { userId: user.id, room: input.room } },
    create: { userId: user.id, room: input.room, lastReadAt: row.createdAt },
    update: { lastReadAt: row.createdAt },
  });

  await writeAudit({
    ...actor(user, ip),
    action: "CHAT_POST",
    entity: "chat_message",
    entityId: row.id,
    newValue: {
      room: input.room,
      body,
      order: row.order?.orderNo ?? null,
      deliveryOrder: row.deliveryOrder?.doNo ?? null,
      mentions: [...mentioned],
    },
  });

  return toMessageDto(row, user.id);
}

export async function markRoomRead(room: ChatRoomKey, userId: string): Promise<void> {
  const now = new Date();
  await prisma.chatReadState.upsert({
    where: { userId_room: { userId, room } },
    create: { userId, room, lastReadAt: now },
    update: { lastReadAt: now },
  });
}

export type ChatUnread = {
  total: number;
  mentions: number;
  rooms: Record<string, number>;
};

/** Cheap polling endpoint for the top-bar badge. */
export async function chatUnread(user: ChatActor): Promise<ChatUnread> {
  const rooms = roomsForRole(user.role);
  const states = await prisma.chatReadState.findMany({ where: { userId: user.id } });
  const lastRead = new Map(states.map((s) => [s.room, s.lastReadAt]));

  const entries = await Promise.all(
    rooms.map(async (room) => {
      const since = lastRead.get(room.key);
      const where = {
        room: room.key,
        authorId: { not: user.id },
        ...(since ? { createdAt: { gt: since } } : {}),
      };
      const [unread, mentions] = await Promise.all([
        prisma.chatMessage.count({ where }),
        prisma.chatMessage.count({ where: { ...where, mentionedUserIds: { has: user.id } } }),
      ]);
      return { key: room.key as string, unread, mentions };
    }),
  );

  return {
    total: entries.reduce((sum, e) => sum + e.unread, 0),
    mentions: entries.reduce((sum, e) => sum + e.mentions, 0),
    rooms: Object.fromEntries(entries.map((e) => [e.key, e.unread])),
  };
}

/**
 * Orders / delivery orders that can be tagged on a message. The list is small on
 * purpose: the 25 most recent documents the caller is allowed to see.
 */
export async function chatTagOptions(user: ChatActor): Promise<ChatTagOptions> {
  const [orders, deliveryOrders] = await Promise.all([
    prisma.order.findMany({
      where: user.role === "SALES" ? { createdBy: user.id } : {},
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, orderNo: true, customer: { select: { name: true } } },
    }),
    prisma.deliveryOrder.findMany({
      where: user.role === "SALES" ? { order: { createdBy: user.id } } : {},
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, doNo: true, warehouse: { select: { code: true } } },
    }),
  ]);

  return {
    orders: orders.map((o) => ({ id: o.id, label: `${o.orderNo} - ${o.customer.name}` })),
    deliveryOrders: deliveryOrders.map((d) => ({
      id: d.id,
      label: `${d.doNo} - ${d.warehouse.code}`,
    })),
  };
}
