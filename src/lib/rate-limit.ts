/**
 * Small in-process fixed-window rate limiter.
 *
 * Scope: protects the login endpoint (and any other expensive/auth endpoint)
 * from brute force. It is intentionally dependency free; when the app runs on
 * more than one instance this should be swapped for Redis — documented in
 * docs/ASSUMPTIONS.md.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { ok: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Housekeeping so the map cannot grow without bound. */
export function pruneRateLimits(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

if (typeof setInterval === "function") {
  const timer = setInterval(pruneRateLimits, 60_000);
  // Do not keep the process alive because of this timer.
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}
