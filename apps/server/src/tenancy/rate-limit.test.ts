import { describe, it, expect } from "vitest";
import { FixedWindowLimiter } from "./rate-limit.js";

/**
 * Brute-force protection for the auth endpoints. A fixed-window counter per key
 * (client IP): the first N attempts in a window are allowed, the rest rejected
 * until the window rolls over. A controllable clock keeps the test deterministic.
 */
describe("FixedWindowLimiter", () => {
  it("allows up to the limit, then rejects within the window", () => {
    let t = 1000;
    const limiter = new FixedWindowLimiter({ max: 3, windowMs: 1000, now: () => t });
    expect(limiter.allow("ip")).toBe(true);
    expect(limiter.allow("ip")).toBe(true);
    expect(limiter.allow("ip")).toBe(true);
    expect(limiter.allow("ip")).toBe(false); // 4th in the window
  });

  it("rolls over when the window elapses", () => {
    let t = 0;
    const limiter = new FixedWindowLimiter({ max: 1, windowMs: 1000, now: () => t });
    expect(limiter.allow("ip")).toBe(true);
    expect(limiter.allow("ip")).toBe(false);
    t += 1001; // window elapsed
    expect(limiter.allow("ip")).toBe(true);
  });

  it("tracks keys independently", () => {
    let t = 0;
    const limiter = new FixedWindowLimiter({ max: 1, windowMs: 1000, now: () => t });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
  });

  it("can reset a key after a successful auth", () => {
    let t = 0;
    const limiter = new FixedWindowLimiter({ max: 1, windowMs: 1000, now: () => t });
    expect(limiter.allow("ip")).toBe(true);
    limiter.reset("ip");
    expect(limiter.allow("ip")).toBe(true);
  });
});
