import { beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { canPostRoom, canReadRoom, roomsForRole } from "@/lib/chat";
import { chatUnread, listChatMessages, listChatRooms, postChatMessage } from "@/server/services/chat.service";
import { standardContext, type Ctx } from "@/tests/helpers/flows";

/**
 * Chat: three fixed rooms, no direct messages, append only.
 *
 * The point of these tests is the **separation**: a salesperson can never read or
 * post in the warehouse room (and the other way round), so Sales and Warehouse can
 * only talk through Operations.
 */
describe("Chat rooms", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await standardContext();
    await prisma.chatMessage.deleteMany({});
    await prisma.chatReadState.deleteMany({});
  });

  const actorOf = (who: { id: string; name: string; role: Role }) => ({
    id: who.id,
    name: who.name,
    role: who.role,
  });

  it("gives each role only its own rooms", () => {
    const sales = roomsForRole("SALES").map((room) => room.key);
    const warehouse = roomsForRole("WAREHOUSE").map((room) => room.key);
    const ops = roomsForRole("SALES_OPS").map((room) => room.key);
    const finance = roomsForRole("FINANCE").map((room) => room.key);

    expect(sales).toEqual(["OPERATION_SALES", "ANNOUNCEMENT"]);
    expect(warehouse).toEqual(["OPERATION_WAREHOUSE", "ANNOUNCEMENT"]);
    expect(ops).toEqual(["OPERATION_SALES", "OPERATION_WAREHOUSE", "ANNOUNCEMENT"]);
    // Finance and management only see announcements, never the operational chatter.
    expect(finance).toEqual(["ANNOUNCEMENT"]);

    expect(canReadRoom("SALES", "OPERATION_WAREHOUSE")).toBe(false);
    expect(canReadRoom("WAREHOUSE", "OPERATION_SALES")).toBe(false);
    expect(canPostRoom("FINANCE", "ANNOUNCEMENT")).toBe(false);
    expect(canPostRoom("SALES_OPS", "ANNOUNCEMENT")).toBe(true);
  });

  it("keeps the warehouse room invisible to salespeople", async () => {
    await postChatMessage(
      { room: "OPERATION_WAREHOUSE", body: "Truck 12 is loading at Dhaka." },
      actorOf(ctx.warehouse),
    );

    await expect(
      listChatMessages("OPERATION_WAREHOUSE", actorOf(ctx.sales)),
    ).rejects.toThrowError(/not allowed/i);

    await expect(
      postChatMessage(
        { room: "OPERATION_WAREHOUSE", body: "Sales trying to jump the queue" },
        actorOf(ctx.sales),
      ),
    ).rejects.toThrowError(/not allowed/i);
  });

  it("keeps the sales room invisible to the warehouse", async () => {
    await postChatMessage(
      { room: "OPERATION_SALES", body: "Customer wants delivery tomorrow morning." },
      actorOf(ctx.sales),
    );

    await expect(
      listChatMessages("OPERATION_SALES", actorOf(ctx.warehouse)),
    ).rejects.toThrowError(/not allowed/i);
  });

  it("lets Operations read both rooms and post in them", async () => {
    const salesRoom = await listChatMessages("OPERATION_SALES", actorOf(ctx.ops));
    const warehouseRoom = await listChatMessages("OPERATION_WAREHOUSE", actorOf(ctx.ops));

    expect(salesRoom.length).toBeGreaterThan(0);
    expect(warehouseRoom.length).toBeGreaterThan(0);

    const posted = await postChatMessage(
      { room: "OPERATION_WAREHOUSE", body: "Confirmed with sales - load after 10am." },
      actorOf(ctx.ops),
    );
    expect(posted.author.role).toBe("SALES_OPS");
  });

  it("makes the announcement room read-only for non-Operations roles", async () => {
    const announcement = await postChatMessage(
      { room: "ANNOUNCEMENT", body: "Price list changes from Sunday." },
      actorOf(ctx.ops),
    );
    expect(announcement.room).toBe("ANNOUNCEMENT");

    const seen = await listChatMessages("ANNOUNCEMENT", actorOf(ctx.sales));
    expect(seen.some((message) => message.body === "Price list changes from Sunday.")).toBe(true);

    await expect(
      postChatMessage({ room: "ANNOUNCEMENT", body: "Sales posting an announcement" }, actorOf(ctx.sales)),
    ).rejects.toThrowError(/not allowed/i);
  });

  it("keeps the author name and time, and supports an order tag", async () => {
    const { createOrder } = await import("@/tests/helpers/flows");
    const order = await createOrder(ctx, "CUS-ABC", [
      { productCode: "GRAIN-WHEAT", qtyMt: "2.000" },
    ]);

    const message = await postChatMessage(
      {
        room: "OPERATION_SALES",
        body: "Please expedite this one.",
        orderId: order!.id,
      },
      actorOf(ctx.sales),
    );

    expect(message.order?.orderNo).toBe(order.orderNo);
    expect(message.author.name).toBe(ctx.sales.name);
    expect(message.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // The audit trail records the post (append-only).
    const audit = await prisma.auditLog.findFirst({
      where: { entity: "chat_message", entityId: message.id },
    });
    expect(audit?.action).toBe("CHAT_POST");
  });

  it("refuses an order tag that belongs to another salesperson", async () => {
    const other = await prisma.order.findFirst({ where: { createdBy: { not: ctx.sales.id } } });
    if (!other) return; // fixture may have only this salesperson's orders

    await expect(
      postChatMessage(
        { room: "OPERATION_SALES", body: "Tagging someone else's order", orderId: other.id },
        actorOf(ctx.sales),
      ),
    ).rejects.toThrowError(/another salesperson/i);
  });

  it("counts unread messages per room and marks a room read when opened", async () => {
    await prisma.chatReadState.deleteMany({ where: { userId: ctx.warehouse.id } });

    await postChatMessage(
      { room: "OPERATION_WAREHOUSE", body: "Unread check 1" },
      actorOf(ctx.ops),
      null,
    );
    await postChatMessage(
      { room: "ANNOUNCEMENT", body: "Unread check 2" },
      actorOf(ctx.ops),
      null,
    );

    const before = await chatUnread(actorOf(ctx.warehouse));
    expect(before.rooms.OPERATION_WAREHOUSE).toBeGreaterThanOrEqual(1);
    expect(before.rooms.ANNOUNCEMENT).toBeGreaterThanOrEqual(1);
    expect(before.rooms.OPERATION_SALES).toBeUndefined();

    await listChatMessages("OPERATION_WAREHOUSE", actorOf(ctx.warehouse));

    const after = await chatUnread(actorOf(ctx.warehouse));
    expect(after.rooms.OPERATION_WAREHOUSE).toBe(0);
    expect(after.total).toBe(before.total - before.rooms.OPERATION_WAREHOUSE!);
  });

  it("counts @mentions separately and only mentions people who can see the room", async () => {
    await prisma.chatReadState.deleteMany({ where: { userId: ctx.sales.id } });

    const message = await postChatMessage(
      {
        room: "OPERATION_SALES",
        body: `@${ctx.sales.name} please confirm the quantity.`,
        mentionedUserIds: [ctx.warehouse.id], // warehouse is not in this room
      },
      actorOf(ctx.ops),
      null,
    );

    expect(message.mentionedUserIds).toContain(ctx.sales.id);
    // The warehouse user cannot be mentioned in a room they cannot read.
    expect(message.mentionedUserIds).not.toContain(ctx.warehouse.id);

    const unread = await chatUnread(actorOf(ctx.sales));
    expect(unread.mentions).toBeGreaterThanOrEqual(1);
  });

  it("shows a room summary with unread counts and the last message", async () => {
    const rooms = await listChatRooms(actorOf(ctx.ops));
    expect(rooms.map((room) => room.key)).toEqual([
      "OPERATION_SALES",
      "OPERATION_WAREHOUSE",
      "ANNOUNCEMENT",
    ]);
    expect(rooms.every((room) => room.lastMessage !== null)).toBe(true);
  });

  it("rejects an empty message", async () => {
    await expect(
      postChatMessage({ room: "OPERATION_SALES", body: "   " }, actorOf(ctx.sales)),
    ).rejects.toThrowError(/write a message/i);
  });
});
