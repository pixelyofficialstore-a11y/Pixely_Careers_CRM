/** Login, logout and the current user. */
import type { Express } from "express";
import { api } from "@shared/routes";
import { z } from "zod";
import passport from "passport";
import { type User } from "@shared/schema";
import { logAudit } from "../security/audit";
import { loginLockedUntil, recordLoginFailure, recordLoginSuccess } from "../security/rateLimit";
import { verifyTotp } from "../security/totp";
import { safeUser, markSessionLogin } from "./shared";

export function registerAuthRoutes(app: Express) {
  const loginBody = z.object({
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(200),
    totpCode: z.string().trim().max(10).optional(),
  });

  app.post(api.auth.login.path, (req, res, next) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Enter your username and password." });
    const { username, totpCode } = parsed.data;
    const ip = req.ip || "unknown";

    const lockedUntil = loginLockedUntil(ip, username);
    if (lockedUntil) {
      const minutes = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000));
      void logAudit({ action: "login_locked", success: false, targetType: "username", targetId: username, req });
      res.setHeader("Retry-After", String(Math.ceil((lockedUntil - Date.now()) / 1000)));
      return res.status(429).json({ code: "LOGIN_LOCKED", message: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` });
    }

    const fail = (status: number, message: string, code: string, actor?: User) => {
      const nowLocked = recordLoginFailure(ip, username);
      void logAudit({ action: "login_failed", success: false, actor: actor ? { id: actor.id, role: actor.role } : null, targetType: "username", targetId: username, details: { reason: code, locked: nowLocked }, req });
      return res.status(status).json({ code, message });
    };

    passport.authenticate("local", (err: any, user: Express.User | false, info: { message?: string } | undefined) => {
      if (err) return next(err);
      if (!user) {
        if (info?.message === "account_disabled") {
          return fail(403, "Your account has been disabled. Please contact the admin.", "ACCOUNT_DISABLED");
        }
        return fail(401, "Invalid username or password.", "INVALID_CREDENTIALS");
      }
      const account = user as User;
      if (account.totpEnabled && account.totpSecret) {
        if (!totpCode) return res.status(401).json({ code: "TOTP_REQUIRED", message: "Enter the 6-digit code from your authenticator app." });
        if (!verifyTotp(account.totpSecret, totpCode)) return fail(401, "That code is not valid. Try the latest code.", "TOTP_INVALID", account);
      }
      // passport >= 0.6 regenerates the session id on logIn (prevents fixation).
      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        markSessionLogin(req);
        recordLoginSuccess(username);
        void logAudit({ action: "login_success", actor: { id: account.id, role: account.role }, targetType: "user", targetId: account.id, req });
        return res.json(safeUser(account));
      });
    })(req, res, next);
  });

  app.post(api.auth.logout.path, (req, res, next) => {
    const user = req.user as User | undefined;
    req.logout((err) => {
      if (err) return next(err);
      if (user) void logAudit({ action: "logout", actor: { id: user.id, role: user.role }, targetType: "user", targetId: user.id, req });
      res.json({ message: "Logged out" });
    });
  });

  app.get(api.auth.me.path, (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(safeUser(req.user as User));
  });
}
