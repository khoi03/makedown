/**
 * Session-cookie parsing and serialization (dependency-free). The cookie holds
 * the session bearer token; its attributes are security controls — HttpOnly
 * keeps it out of reach of JavaScript (XSS), SameSite=Lax blunts CSRF on
 * cross-site POSTs, and Secure is set whenever the server runs behind HTTPS.
 */

/** The session cookie name. */
export const SESSION_COOKIE = "md_session";

export interface CookieOptions {
  readonly maxAgeSeconds: number;
  /** Add the Secure attribute (HTTPS only). */
  readonly secure: boolean;
}

/** Extract a named cookie's (url-decoded) value from a Cookie header. */
export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

function serialize(value: string, opts: CookieOptions): string {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`,
  ];
  if (opts.secure) attrs.push("Secure");
  return attrs.join("; ");
}

/** Serialize a Set-Cookie value that stores the session token. */
export function serializeSessionCookie(token: string, opts: CookieOptions): string {
  return serialize(token, opts);
}

/** Serialize a Set-Cookie value that immediately expires the session cookie. */
export function clearSessionCookie(opts: { secure: boolean }): string {
  return serialize("", { maxAgeSeconds: 0, secure: opts.secure });
}
