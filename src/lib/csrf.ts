import { headers } from "next/headers";
import { errors } from "@/lib/errors";

/**
 * CSRF defence for route handlers:
 *   1. the session cookie is SameSite=Lax (never sent on cross-site POST),
 *   2. every mutating request must carry an Origin/Referer that matches the Host.
 *
 * Server Actions are additionally protected by Next.js' built-in action-origin
 * check. Both layers are server-side; nothing relies on the UI.
 */
function hostOf(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

export async function assertSameOrigin(): Promise<void> {
  const h = await headers();
  // Behind a reverse proxy (docker/nginx/openship edge) the forwarded host wins.
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const origin = h.get("origin") ?? (h.get("referer") ? hostOf(h.get("referer") as string) : null);

  if (!host) return; // Non-browser client with no Host header: nothing to compare.
  if (!origin) return; // curl/CLI callers have no Origin; cookie already scoped.

  const originHost = hostOf(origin) ?? origin;
  if (originHost !== host) {
    throw errors.forbidden("cross-site requests");
  }
}
