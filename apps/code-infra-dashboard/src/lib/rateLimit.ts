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

      // Sweep every key rather than just this one, so keys that are never seen
      // again cannot accumulate. The map stays small enough for this to be cheap.
      for (const [entryKey, timestamps] of hits) {
        const recent = timestamps.filter((timestamp) => timestamp > cutoff);
        if (recent.length === 0) {
          hits.delete(entryKey);
        } else {
          hits.set(entryKey, recent);
        }
      }

      const timestamps = hits.get(key) ?? [];

      if (timestamps.length >= limit) {
        const retryAfterMs = timestamps[0] + windowMs - current;
        return { allowed: false, retryAfterSeconds: Math.max(Math.ceil(retryAfterMs / 1000), 1) };
      }

      timestamps.push(current);
      hits.set(key, timestamps);

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
