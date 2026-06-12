/**
 * A minimal in-process fixed-window rate limiter for the auth endpoints — the
 * first line of brute-force defense (a public deployment should also sit behind
 * a proxy/WAF limiter). Counts attempts per key (client IP) within a rolling
 * window; entries are lazily replaced when their window expires, so memory is
 * bounded by the number of active keys.
 */
export interface LimiterOptions {
  /** Max attempts allowed per window. */
  readonly max: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Clock source (injectable for tests). Defaults to Date.now. */
  readonly now?: () => number;
}

interface Window {
  count: number;
  resetAt: number;
}

export class FixedWindowLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly now: () => number;

  constructor(private readonly opts: LimiterOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** Record an attempt for `key`; returns true if it is within the limit. */
  allow(key: string): boolean {
    const t = this.now();
    const existing = this.windows.get(key);
    if (!existing || t >= existing.resetAt) {
      this.windows.set(key, { count: 1, resetAt: t + this.opts.windowMs });
      return true;
    }
    if (existing.count >= this.opts.max) return false;
    existing.count += 1;
    return true;
  }

  /** Clear a key's window (e.g. after a successful authentication). */
  reset(key: string): void {
    this.windows.delete(key);
  }
}
