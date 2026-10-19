"use client";

import * as React from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Top-bar unread badge. Polls a very cheap endpoint every 10 seconds and shows the
 * number of messages the signed-in user has not read yet (red dot when one of them
 * @mentions them).
 */
export function ChatBadge({ initialTotal = 0 }: { initialTotal?: number }) {
  const [total, setTotal] = React.useState(initialTotal);
  const [mentions, setMentions] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const response = await fetch("/api/chat/unread", { cache: "no-store" });
        if (response.ok) {
          const json = (await response.json()) as { total?: number; mentions?: number };
          if (alive) {
            setTotal(json.total ?? 0);
            setMentions(json.mentions ?? 0);
          }
        }
      } catch {
        // Offline: keep the last known number, the page still works.
      } finally {
        if (alive) timer = setTimeout(load, 10000);
      }
    };

    timer = setTimeout(load, 10000);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <Link
      href="/chat"
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100",
      )}
      aria-label={total > 0 ? `Chat, ${total} unread` : "Chat"}
    >
      <MessageSquare className="size-4" />
      <span className="hidden sm:inline">Chat</span>
      {total > 0 ? (
        <span
          className={cn(
            "ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold leading-5 text-white",
            mentions > 0 ? "bg-red-600" : "bg-emerald-600",
          )}
        >
          {total > 99 ? "99+" : total}
        </span>
      ) : null}
    </Link>
  );
}
