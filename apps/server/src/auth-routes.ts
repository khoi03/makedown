/**
 * Authentication routes: signup, login, logout, and the current-user probe.
 * The session token is delivered as an HttpOnly cookie (see cookies.ts) so the
 * browser never exposes it to JavaScript. All routes are no-ops returning 404
 * when tenancy is disabled, so a single-tenant server has no login surface.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { TenancyProvider, AuthResult } from "./tenancy/index.js";
import {
  SESSION_COOKIE,
  parseCookie,
  serializeSessionCookie,
  clearSessionCookie,
} from "./tenancy/cookies.js";
import { FixedWindowLimiter } from "./tenancy/rate-limit.js";

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
// Brute-force guard: at most N credential attempts per client IP per window.
const AUTH_MAX_ATTEMPTS = 10;
const AUTH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export interface AuthRoutesOptions {
  readonly tenancy: TenancyProvider;
  /** Add the Secure cookie attribute (set when serving over HTTPS). */
  readonly secureCookies: boolean;
}

interface Credentials {
  email?: unknown;
  password?: unknown;
}

/** Validate a credentials body, returning a typed pair or an error message. */
function validate(body: Credentials | undefined): { email: string; password: string } | string {
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!EMAIL_RE.test(email)) return "A valid email is required";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return { email, password };
}

function setSession(reply: FastifyReply, result: AuthResult, secure: boolean): void {
  reply.header(
    "set-cookie",
    serializeSessionCookie(result.token, { maxAgeSeconds: SESSION_MAX_AGE_SECONDS, secure }),
  );
}

const publicResult = (r: AuthResult) => ({ user: r.user, org: r.org });

export function registerAuthRoutes(app: FastifyInstance, opts: AuthRoutesOptions): void {
  const { tenancy, secureCookies } = opts;
  const limiter = new FixedWindowLimiter({ max: AUTH_MAX_ATTEMPTS, windowMs: AUTH_WINDOW_MS });

  app.get("/api/tenancy", async () => ({ enabled: tenancy.enabled }));

  app.post<{ Body: Credentials }>("/api/auth/signup", async (req, reply) => {
    if (!tenancy.enabled) return reply.code(404).send({ error: "Authentication is disabled" });
    if (!limiter.allow(req.ip)) return reply.code(429).send({ error: "Too many attempts — try again later" });
    const valid = validate(req.body);
    if (typeof valid === "string") return reply.code(400).send({ error: valid });
    try {
      const result = await tenancy.signup(valid.email, valid.password);
      limiter.reset(req.ip);
      setSession(reply, result, secureCookies);
      return reply.code(201).send(publicResult(result));
    } catch {
      // Do not distinguish "email taken" from other failures (no enumeration).
      return reply.code(409).send({ error: "Could not create account" });
    }
  });

  app.post<{ Body: Credentials }>("/api/auth/login", async (req, reply) => {
    if (!tenancy.enabled) return reply.code(404).send({ error: "Authentication is disabled" });
    if (!limiter.allow(req.ip)) return reply.code(429).send({ error: "Too many attempts — try again later" });
    const valid = validate(req.body);
    if (typeof valid === "string") return reply.code(400).send({ error: valid });
    const result = await tenancy.login(valid.email, valid.password);
    if (!result) return reply.code(401).send({ error: "Invalid email or password" });
    limiter.reset(req.ip); // successful auth clears the counter
    setSession(reply, result, secureCookies);
    return publicResult(result);
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) await tenancy.logout(token);
    reply.header("set-cookie", clearSessionCookie({ secure: secureCookies }));
    return { ok: true };
  });

  app.get("/api/auth/me", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Not authenticated" });
    return { user: { id: req.user.userId, email: req.user.email } };
  });
}
