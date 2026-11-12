import type { Request, Response, NextFunction } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Rate limits. In-memory stores: Railway runs a single instance. If the app is
 * ever scaled horizontally, move these to a shared store (Postgres/Redis).
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

type Bucket = { failures: number[]; lockedUntil: number };
const loginBuckets = new Map<string, Bucket>();

function bucket(key: string): Bucket {
  let b = loginBuckets.get(key);
  if (!b) {
    b = { failures: [], lockedUntil: 0 };
    loginBuckets.set(key, b);
  }
  return b;
}

function keysFor(ip: string, username: string) {
  return [`ip:${ip}`, `user:${username.trim().toLowerCase()}`];
}

/** Returns the lock expiry (ms epoch) if this IP or username is locked. */
export function loginLockedUntil(ip: string, username: string, now = Date.now()): number | null {
  let until = 0;
  for (const key of keysFor(ip, username)) {
    const b = loginBuckets.get(key);
    if (b && b.lockedUntil > now) until = Math.max(until, b.lockedUntil);
  }
  return until > now ? until : null;
}

/** Records a failed login. Returns true if this failure triggered a lock. */
export function recordLoginFailure(ip: string, username: string, now = Date.now()): boolean {
  let locked = false;
  for (const key of keysFor(ip, username)) {
    const b = bucket(key);
    b.failures = b.failures.filter(t => now - t < WINDOW_MS);
    b.failures.push(now);
    if (b.failures.length >= MAX_FAILURES) {
      b.lockedUntil = now + LOCK_MS;
      b.failures = [];
      locked = true;
    }
  }
  if (loginBuckets.size > 10_000) {
    for (const [key, b] of loginBuckets) if (b.lockedUntil < now && b.failures.length === 0) loginBuckets.delete(key);
  }
  return locked;
}

/** A successful login clears the username bucket (the IP bucket keeps counting). */
export function recordLoginSuccess(username: string) {
  loginBuckets.delete(`user:${username.trim().toLowerCase()}`);
}

export function resetLoginLimiter() {
  loginBuckets.clear();
}

const userOrIpKey = (req: Request) => {
  const user = (req as any).user as { id?: number } | undefined;
  return user?.id ? `u:${user.id}` : `ip:${ipKeyGenerator(req.ip || "")}`;
};

const limitedResponse = (_req: Request, res: Response) =>
  res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests. Please wait a minute and try again." } });

/** 300 requests per minute per signed-in user (or IP when signed out). */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  // The SSE stream is one long-lived request; don't count reconnects against the user.
  skip: (req) => req.path === "/notifications/stream",
  handler: limitedResponse,
});

/** 20 uploads per minute per user. */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  handler: limitedResponse,
});

export const isUploadRequest = (req: Request) =>
  req.method === "POST" && (/\/upload$/.test(req.path) || req.path === "/api/users/me/avatar" || req.path === "/api/payment-verifications");

export function uploadLimiterMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isUploadRequest(req)) return next();
  return uploadLimiter(req, res, next);
}
