import type { ChatRoom, Role } from "@prisma/client";
import { roleHasPermission, type Permission } from "@/lib/rbac";

/**
 * The chat is **three fixed rooms and no direct messages**.
 *
 *   Operation - Sales      Sales + Sales Operations (+ Admin)
 *   Operation - Warehouse  Warehouse + Sales Operations (+ Admin)
 *   Announcement           everyone reads, only Sales Operations / Admin post
 *
 * A salesperson therefore cannot reach the warehouse directly (and vice versa):
 * the room is simply not in their list, and the service refuses them even if they
 * guess the room key. Operations sits in both rooms and relays what has to be relayed.
 *
 * Messages are append-only: this module exposes no edit and no delete, and the UI has
 * no such button, so the conversation is as auditable as the workflow.
 */

export type ChatRoomKey = ChatRoom;

export type ChatRoomDef = {
  key: ChatRoomKey;
  name: string;
  shortName: string;
  description: string;
  /** Permission that grants membership of the room (read + post unless `readOnly`). */
  permission: Permission | null;
  /** Room readable by every signed-in user (announcements). */
  readByAll: boolean;
  /** Who may post. */
  postPermission: Permission;
};

export const CHAT_ROOMS: readonly ChatRoomDef[] = [
  {
    key: "OPERATION_SALES",
    name: "Operation - Sales",
    shortName: "Op - Sales",
    description: "Sales and Sales Operations. The warehouse cannot see this room.",
    permission: "chat.sales",
    readByAll: false,
    postPermission: "chat.sales",
  },
  {
    key: "OPERATION_WAREHOUSE",
    name: "Operation - Warehouse",
    shortName: "Op - Warehouse",
    description: "Warehouse and Sales Operations. Sales cannot see this room.",
    permission: "chat.warehouse",
    readByAll: false,
    postPermission: "chat.warehouse",
  },
  {
    key: "ANNOUNCEMENT",
    name: "Announcement",
    shortName: "Announcement",
    description: "Read-only for everyone. Sales Operations and Admin post here.",
    permission: null,
    readByAll: true,
    postPermission: "chat.announce",
  },
] as const;

export const CHAT_BODY_MAX = 2000;
export const CHAT_PAGE_SIZE = 80;

export type ChatMemberDto = { id: string; name: string; role: Role };

export type ChatMessageDto = {
  id: string;
  room: ChatRoomKey;
  body: string;
  createdAt: string;
  mine: boolean;
  author: ChatMemberDto;
  order: { id: string; orderNo: string } | null;
  deliveryOrder: { id: string; doNo: string } | null;
  mentionedUserIds: string[];
};

export type ChatRoomSummary = {
  key: ChatRoomKey;
  name: string;
  shortName: string;
  description: string;
  canPost: boolean;
  unread: number;
  mentions: number;
  lastMessage: { body: string; authorName: string; createdAt: string } | null;
};

export type ChatTagOptions = {
  orders: { id: string; label: string }[];
  deliveryOrders: { id: string; label: string }[];
};

export function chatRoomDef(key: ChatRoomKey): ChatRoomDef {
  const room = CHAT_ROOMS.find((r) => r.key === key);
  if (!room) throw new Error(`Unknown chat room ${key}`);
  return room;
}

/** Every role that may read a room - used to decide who can be @mentioned there. */
export function rolesForRoom(key: ChatRoomKey): Role[] {
  const all: Role[] = ["ADMIN", "FINANCE", "SALES", "SALES_OPS", "WAREHOUSE", "MANAGEMENT"];
  return all.filter((role) => canReadRoom(role, key));
}

export function isChatRoomKey(value: string): value is ChatRoomKey {
  return CHAT_ROOMS.some((r) => r.key === value);
}

/** Rooms this role may read, in display order. */
export function roomsForRole(role: Role): ChatRoomDef[] {
  return CHAT_ROOMS.filter((room) => canReadRoom(role, room.key));
}

export function canReadRoom(role: Role, key: ChatRoomKey): boolean {
  const room = chatRoomDef(key);
  if (!roleHasPermission(role, "chat.view")) return false;
  if (room.readByAll) return true;
  return room.permission ? roleHasPermission(role, room.permission) : false;
}

export function canPostRoom(role: Role, key: ChatRoomKey): boolean {
  if (!canReadRoom(role, key)) return false;
  const room = chatRoomDef(key);
  return roleHasPermission(role, room.postPermission);
}

/** The room a role lands on when it opens /chat. */
export function defaultRoomFor(role: Role): ChatRoomKey {
  return roomsForRole(role)[0]?.key ?? "ANNOUNCEMENT";
}

/**
 * Finds "@Name" mentions in the body, limited to people who can actually see the
 * room, so nobody can be pinged about a room they are not allowed to read.
 */
export function extractMentions(
  body: string,
  members: { id: string; name: string }[],
): string[] {
  const found = new Set<string>();
  const lower = body.toLowerCase();
  for (const member of members) {
    const firstName = member.name.split(" ")[0]?.toLowerCase();
    if (!firstName) continue;
    if (lower.includes(`@${member.name.toLowerCase()}`) || lower.includes(`@${firstName}`)) {
      found.add(member.id);
    }
  }
  return [...found];
}
