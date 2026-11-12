import type { Request, Response, NextFunction } from "express";
import { randomBytes, timingSafeEqual } from "crypto";

/**
 * Double-submit CSRF protection.
 *
 * Every response makes sure the browser holds a random token in a readable
 * cookie. State-changing /api requests must echo it in the X-CSRF-Token header.
 * A cross-site page can make the browser send the cookie but cannot read it,
 * so it can't produce the matching header.
 */

export const CSRF_COOKIE = "pixely_csrf";
export const CSRF_HEADER = "x-csrf-token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

function sameToken(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  let token = readCookie(req, CSRF_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = randomBytes(32).toString("hex");
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // the SPA must read it to echo it back
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    // A request that arrives without a cookie can't carry a valid header yet.
    (req as any).csrfFresh = true;
  }

  if (SAFE_METHODS.has(req.method) || !req.path.startsWith("/api")) return next();

  const sent = req.get(CSRF_HEADER);
  if ((req as any).csrfFresh || !sent || !sameToken(sent, token)) {
    return res.status(403).json({ error: { code: "CSRF_INVALID", message: "Your session expired. Refresh the page and try again." } });
  }
  next();
}
