import { describe, it, expect } from "vitest";
import { parseCookie, serializeSessionCookie, clearSessionCookie, SESSION_COOKIE } from "./cookies.js";

/**
 * The session cookie carries the bearer token, so its attributes are a security
 * control, not cosmetics: HttpOnly (no JS access — blunts XSS theft), SameSite
 * (CSRF), Path, and Secure in production. These tests pin those attributes.
 */
describe("parseCookie", () => {
  it("extracts a named cookie value from a Cookie header", () => {
    expect(parseCookie("md_session=abc123; other=x", "md_session")).toBe("abc123");
    expect(parseCookie("other=x; md_session=tok", "md_session")).toBe("tok");
  });

  it("returns undefined when absent, empty, or malformed", () => {
    expect(parseCookie(undefined, "md_session")).toBeUndefined();
    expect(parseCookie("", "md_session")).toBeUndefined();
    expect(parseCookie("other=x", "md_session")).toBeUndefined();
  });

  it("url-decodes the value", () => {
    expect(parseCookie("md_session=a%20b", "md_session")).toBe("a b");
  });
});

describe("serializeSessionCookie", () => {
  it("sets HttpOnly, SameSite=Lax, Path=/ and a Max-Age", () => {
    const cookie = serializeSessionCookie("tok", { maxAgeSeconds: 3600, secure: false });
    expect(cookie).toContain(`${SESSION_COOKIE}=tok`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=3600");
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure in production/https mode", () => {
    expect(serializeSessionCookie("tok", { maxAgeSeconds: 1, secure: true })).toContain("Secure");
  });

  it("url-encodes the token value", () => {
    expect(serializeSessionCookie("a b", { maxAgeSeconds: 1, secure: false })).toContain(
      `${SESSION_COOKIE}=a%20b`,
    );
  });
});

describe("clearSessionCookie", () => {
  it("expires the cookie with Max-Age=0", () => {
    const cookie = clearSessionCookie({ secure: false });
    expect(cookie).toContain(`${SESSION_COOKIE}=;`);
    expect(cookie).toContain("Max-Age=0");
  });
});
