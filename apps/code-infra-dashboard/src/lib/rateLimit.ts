export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may try again. Only meaningful when `allowed` is false. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
}

export interface RateLimiterOptions {
  /** Number of attempts allowed per key within the window. */
  limit: number;
  windowMs: number;
  now?: () => number;
}

/**
 * A sliding-window rate limiter held in process memory.
 *
 * State is per instance and resets on deploy, so this is a guard against casual
 * brute-forcing rather than a hard guarantee. Anything stronger would need a shared
 * store, which is not worth it for the traffic these endpoints see.
 */
/**
 * Ceiling on tracked keys. A key is normally pruned when its own client comes back,
 * so this bounds the damage from a flood of addresses that are each seen once.
 */
const MAX_TRACKED_KEYS = 10_000;

export function createRateLimiter({
  limit,
  windowMs,
  now = () => Date.now(),
}: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    check(key: string): RateLimitResult {
      const current = now();
      const cutoff = current - windowMs;

      if (hits.size > MAX_TRACKED_KEYS) {
        for (const [entryKey, timestamps] of hits) {
          if (timestamps[timestamps.length - 1] <= cutoff) {
            hits.delete(entryKey);
          }
        }
        // Still over the ceiling, so the window is saturated with live keys. Drop
        // everything rather than grow: some clients get extra attempts, which beats
        // an unbounded map.
        if (hits.size > MAX_TRACKED_KEYS) {
          hits.clear();
        }
      }

      const recent = (hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

      if (recent.length >= limit) {
        const retryAfterMs = recent[0] + windowMs - current;
        return { allowed: false, retryAfterSeconds: Math.max(Math.ceil(retryAfterMs / 1000), 1) };
      }

      recent.push(current);
      hits.set(key, recent);

      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

/**
 * Best-effort client identity for rate limiting. Render terminates TLS upstream, so the
 * originating address is the first hop of `x-forwarded-for`. Requests without the header
 * share a single bucket, which errs towards limiting too much rather than too little.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const firstHop = forwardedFor?.split(',')[0].trim();
  return firstHop || 'unknown';
}
