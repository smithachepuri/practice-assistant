export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limiter held in memory. It protects the demo from runaway model
 * costs; a deployment with several server instances needs a shared store instead.
 */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const windows = new Map<string, { startedAt: number; count: number }>();

  return function check(key: string): RateLimitResult {
    const time = now();
    if (windows.size > 5000) {
      for (const [storedKey, window] of windows) {
        if (time - window.startedAt >= windowMs) windows.delete(storedKey);
      }
    }
    const current = windows.get(key);
    if (!current || time - current.startedAt >= windowMs) {
      windows.set(key, { startedAt: time, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + windowMs - time) / 1000)),
      };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}
