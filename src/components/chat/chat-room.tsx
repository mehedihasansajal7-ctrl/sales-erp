"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import type { ChatMessageDto, ChatMemberDto, ChatTagOptions } from "@/lib/chat";

const POLL_MS = 7000;

function timeLabel(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) return "Today";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * One room. Messages are append only - there is no edit and no delete, on purpose:
 * the conversation stays as auditable as the workflow next to it.
 *
 * Polling (not websockets) keeps the deployment simple: the browser asks for
 * "everything after the last message I have" every 7 seconds.
 */
export function ChatRoomView({
  roomKey,
  roomName,
  roomDescription,
  canPost,
  me,
  initialMessages,
  members,
  tags,
}: {
  roomKey: string;
  roomName: string;
  roomDescription: string;
  canPost: boolean;
  me: ChatMemberDto;
  initialMessages: ChatMessageDto[];
  members: ChatMemberDto[];
  tags: ChatTagOptions;
}) {
  const [messages, setMessages] = React.useState<ChatMessageDto[]>(initialMessages);
  const [body, setBody] = React.useState("");
  const [orderId, setOrderId] = React.useState("");
  const [deliveryOrderId, setDeliveryOrderId] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [live, setLive] = React.useState(true);

  const listRef = React.useRef<HTMLDivElement>(null);
  const cursorRef = React.useRef<string | null>(
    initialMessages.length > 0 ? initialMessages[initialMessages.length - 1]!.createdAt : null,
  );

  const scrollToBottom = React.useCallback((smooth = false) => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  React.useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  const appendMessages = React.useCallback((incoming: ChatMessageDto[]) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const seen = new Set(current.map((m) => m.id));
      const merged = [...current, ...incoming.filter((m) => !seen.has(m.id))];
      cursorRef.current = merged[merged.length - 1]?.createdAt ?? cursorRef.current;
      return merged;
    });
  }, []);

  React.useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const params = new URLSearchParams({ room: roomKey });
        if (cursorRef.current) params.set("after", cursorRef.current);
        const response = await fetch(`/api/chat/messages?${params.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("offline");
        const json = (await response.json()) as { messages?: ChatMessageDto[] };
        if (alive) {
          appendMessages(json.messages ?? []);
          setLive(true);
        }
      } catch {
        if (alive) setLive(false);
      } finally {
        if (alive) timer = setTimeout(tick, POLL_MS);
      }
    };

    timer = setTimeout(tick, POLL_MS);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [roomKey, appendMessages]);

  const mentionFirst = (member: ChatMemberDto) => {
    const firstName = member.name.split(" ")[0] ?? member.name;
    setBody((current) => {
      const spacer = current.length === 0 || current.endsWith(" ") ? "" : " ";
      return `${current}${spacer}@${firstName} `;
    });
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canPost || sending) return;
    const text = body.trim();
    if (!text) return;

    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          room: roomKey,
          body: text,
          orderId: orderId || undefined,
          deliveryOrderId: deliveryOrderId || undefined,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        message?: ChatMessageDto;
        error?: string;
      };
      if (!response.ok || !json.message) {
        setError(json.error ?? "The message could not be sent.");
        return;
      }
      appendMessages([json.message]);
      setBody("");
      setOrderId("");
      setDeliveryOrderId("");
      scrollToBottom(true);
    } catch {
      setError("The message could not be sent - check the connection.");
    } finally {
      setSending(false);
    }
  };

  // Day separators are derived from the list (never mutated during render).
  const rendered = messages.map((message, index) => ({
    message,
    day: dayLabel(message.createdAt),
    showDay: index === 0 || dayLabel(messages[index - 1]!.createdAt) !== dayLabel(message.createdAt),
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight">{roomName}</h2>
          <p className="text-xs text-slate-500">{roomDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={live ? "success" : "warning"}>{live ? "Live" : "Reconnecting"}</Badge>
          <Badge tone="outline">Append only</Badge>
        </div>
      </div>

      <div
        ref={listRef}
        className="flex min-h-[45vh] flex-1 flex-col gap-3 overflow-y-auto bg-slate-50/60 px-3 py-4 lg:max-h-[calc(100dvh-22rem)]"
      >
        {messages.length === 0 ? (
          <p className="m-auto max-w-sm text-center text-sm text-slate-500">
            No messages yet. Say what needs saying here instead of on a personal phone - everyone who
            needs to see it is in this room.
          </p>
        ) : null}

        {rendered.map(({ message, day, showDay }) => {
          const mentionsMe = message.mentionedUserIds.includes(me.id);

          return (
            <React.Fragment key={message.id}>
              {showDay ? (
                <div className="self-center rounded-full bg-white px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm">
                  {day}
                </div>
              ) : null}
              <div className={cn("flex flex-col gap-1", message.mine ? "items-end" : "items-start")}>
                <div className="flex items-center gap-2 px-1 text-[11px] text-slate-500">
                  <span className="font-medium text-slate-700">
                    {message.mine ? "You" : message.author.name}
                  </span>
                  <span>{timeLabel(message.createdAt)}</span>
                  {mentionsMe ? <Badge tone="warning">mentioned you</Badge> : null}
                </div>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm shadow-sm",
                    message.mine
                      ? "bg-emerald-600 text-white"
                      : "border border-slate-200 bg-white text-slate-800",
                  )}
                >
                  {message.body}
                </div>
                {message.order || message.deliveryOrder ? (
                  <div className="flex flex-wrap gap-1 px-1">
                    {message.order ? (
                      <a
                        href={`/sales/orders/${message.order.id}`}
                        className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800 hover:underline"
                      >
                        {message.order.orderNo}
                      </a>
                    ) : null}
                    {message.deliveryOrder ? (
                      <a
                        href={`/sales-ops/delivery-orders/${message.deliveryOrder.id}`}
                        className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:underline"
                      >
                        {message.deliveryOrder.doNo}
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {canPost ? (
        <form onSubmit={send} className="flex flex-col gap-2 border-t border-slate-100 p-3">
          {error ? (
            <p role="alert" className="text-xs font-medium text-red-600">
              {error}
            </p>
          ) : null}
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write a message... (received orders, truck timing, a DO that looks wrong)"
            maxLength={2000}
            rows={3}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                void send(event as unknown as React.FormEvent);
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Tag an order"
              className="h-8 max-w-56 text-xs"
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
            >
              <option value="">Tag an order (optional)</option>
              {tags.orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Tag a delivery order"
              className="h-8 max-w-56 text-xs"
              value={deliveryOrderId}
              onChange={(event) => setDeliveryOrderId(event.target.value)}
            >
              <option value="">Tag a DO (optional)</option>
              {tags.deliveryOrders.map((deliveryOrder) => (
                <option key={deliveryOrder.id} value={deliveryOrder.id}>
                  {deliveryOrder.label}
                </option>
              ))}
            </Select>
            {members.length > 0 ? (
              <Select
                aria-label="Mention someone"
                className="h-8 max-w-44 text-xs"
                value=""
                onChange={(event) => {
                  const member = members.find((m) => m.id === event.target.value);
                  if (member) mentionFirst(member);
                }}
              >
                <option value="">@ Mention</option>
                {members
                  .filter((member) => member.id !== me.id)
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
              </Select>
            ) : null}
            <span className="text-[11px] text-slate-400">Ctrl + Enter sends</span>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="ml-auto"
              disabled={sending || body.trim().length === 0}
            >
              {sending ? "Sending..." : "Send"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          This room is read-only for you. Sales Operations posts announcements here.
        </div>
      )}
    </div>
  );
}
