/** Users, passwords, 2FA, the security log and avatars. */
import type { Express } from "express";
import { storage } from "../storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { type User, userRoles } from "@shared/schema";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { isCloudinaryConfigured, uploadToCloudinary } from "../cloudinary";
import { hashPassword, comparePasswords, newPasswordSchema, generateTemporaryPassword } from "../security/passwords";
import { logAudit, listAuditEvents, AUDIT_ACTIONS } from "../security/audit";
import { generateTotpSecret, verifyTotp, otpauthUri } from "../security/totp";
import { safeUser, safeUserSummary, markSessionLogin, requireAuth, requireRole } from "./shared";

export function registerUserRoutes(app: Express) {
  // ---- Users -------------------------------------------------------------
  // Designers only see their support lead(s) and admins, with minimal fields.
  app.get(api.users.list.path, requireAuth, async (req, res) => {
    const me = req.user as User;
    const all = await storage.getUsers();
    if (me.role !== "designer") return res.json(all.map(safeUser));
    const assignments = await storage.getAllDesignerAssignments();
    const supportIds = new Set(assignments.filter(a => a.designerUserId === me.id).map(a => a.supportUserId));
    const visible = all.filter(u => u.id === me.id || u.role === "admin" || supportIds.has(u.id));
    res.json(visible.map(u => ({ ...safeUserSummary(u), isActive: u.isActive })));
  });

  const usernameSchema = z.string().trim().min(3).max(50).regex(/^[A-Za-z0-9._-]+$/, "Username can use letters, numbers, dot, dash and underscore.");
  const createUserBody = z.object({
    username: usernameSchema,
    password: newPasswordSchema,
    name: z.string().trim().min(1).max(100),
    role: z.enum(userRoles),
    title: z.string().trim().max(100).nullish(),
  });
  const updateUserBody = z.object({
    username: usernameSchema.optional(),
    password: newPasswordSchema.optional(),
    name: z.string().trim().min(1).max(100).optional(),
    role: z.enum(userRoles).optional(),
    title: z.string().trim().max(100).nullish(),
    isActive: z.boolean().optional(),
  }).strict();

  app.post(api.users.create.path, requireRole(["admin"]), async (req, res) => {
    const parsed = createUserBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    const actor = req.user as User;
    const input = parsed.data;
    if (await storage.getUserByUsername(input.username)) return res.status(409).json({ message: "That username is already taken." });
    const user = await storage.createUser({ ...input, title: input.title ?? null, password: await hashPassword(input.password) });
    // New accounts choose their own password on first login.
    const withFlag = await storage.updateUser(user.id, { mustChangePassword: true } as any);
    void logAudit({ action: "user_created", actor, targetType: "user", targetId: user.id, details: { username: user.username, role: user.role }, req });
    res.status(201).json(safeUser(withFlag));
  });

  app.patch(api.users.update.path, requireRole(["admin"]), async (req, res) => {
    const parsed = updateUserBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    const userId = Number(req.params.id);
    const actor = req.user as User;
    const existing = await storage.getUser(userId);
    if (!existing) return res.status(404).json({ message: "User not found." });
    const input = parsed.data;
    if (userId === actor.id && (input.isActive === false || (input.role && input.role !== "admin"))) {
      return res.status(400).json({ message: "You can't deactivate or demote your own account." });
    }
    if (input.username && input.username !== existing.username && await storage.getUserByUsername(input.username)) {
      return res.status(409).json({ message: "That username is already taken." });
    }
    const updates: Record<string, unknown> = { ...input };
    const now = new Date();
    if (input.password) {
      // Admin-set password: the user must choose their own on next login; old sessions end.
      updates.password = await hashPassword(input.password);
      updates.mustChangePassword = true;
      updates.passwordChangedAt = now;
      updates.sessionsValidAfter = now;
    }
    if (input.isActive === false && existing.isActive) updates.sessionsValidAfter = now;
    if (input.role && input.role !== existing.role) updates.sessionsValidAfter = now;
    const updated = await storage.updateUser(userId, updates as any);

    const base = { actor, targetType: "user", targetId: userId, req };
    if (input.password) void logAudit({ ...base, action: "password_reset_by_admin" });
    if (input.role && input.role !== existing.role) void logAudit({ ...base, action: "user_role_changed", details: { from: existing.role, to: input.role } });
    if (input.isActive === false && existing.isActive) void logAudit({ ...base, action: "user_deactivated" });
    if (input.isActive === true && !existing.isActive) void logAudit({ ...base, action: "user_reactivated" });
    const changed = Object.keys(input).filter(k => !["password", "role", "isActive"].includes(k));
    if (changed.length) void logAudit({ ...base, action: "user_updated", details: { fields: changed } });
    res.json(safeUser(updated));
  });

  // Admin reset: generates a one-time temporary password, shown once to the admin.
  app.post("/api/users/:id/reset-password", requireRole(["admin"]), async (req, res) => {
    const userId = Number(req.params.id);
    const target = await storage.getUser(userId);
    if (!target) return res.status(404).json({ message: "User not found." });
    const temporaryPassword = generateTemporaryPassword();
    const now = new Date();
    await storage.updateUser(userId, {
      password: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      passwordChangedAt: now,
      sessionsValidAfter: now,
    } as any);
    void logAudit({ action: "password_reset_by_admin", actor: req.user as User, targetType: "user", targetId: userId, req });
    res.setHeader("Cache-Control", "no-store");
    res.json({ temporaryPassword });
  });

  // Signed-in user changes their own password (also clears a forced change).
  const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: newPasswordSchema });
  app.post("/api/user/password", requireAuth, async (req, res, next) => {
    const parsed = changePasswordBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    const me = await storage.getUser((req.user as User).id);
    if (!me) return res.sendStatus(401);
    if (!(await comparePasswords(parsed.data.currentPassword, me.password))) {
      return res.status(400).json({ code: "WRONG_PASSWORD", message: "Your current password is not correct." });
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return res.status(400).json({ message: "Choose a password different from the current one." });
    }
    const now = new Date();
    const updated = await storage.updateUser(me.id, {
      password: await hashPassword(parsed.data.newPassword),
      mustChangePassword: false,
      passwordChangedAt: now,
      sessionsValidAfter: now,
    } as any);
    void logAudit({ action: "password_changed", actor: me, targetType: "user", targetId: me.id, req });
    // Every other session ends; this one continues on a fresh session id.
    req.logIn(updated, (err) => {
      if (err) return next(err);
      markSessionLogin(req);
      res.json(safeUser(updated));
    });
  });

  // ---- Optional TOTP 2FA (admins) -------------------------------------------
  app.post("/api/user/2fa/setup", requireRole(["admin"]), async (req, res) => {
    const me = req.user as User;
    if (me.totpEnabled) return res.status(409).json({ message: "Two-step verification is already on." });
    const secret = generateTotpSecret();
    (req.session as any).pendingTotpSecret = secret;
    res.setHeader("Cache-Control", "no-store");
    res.json({ secret, otpauthUri: otpauthUri(secret, me.username) });
  });

  app.post("/api/user/2fa/enable", requireRole(["admin"]), async (req, res) => {
    const parsed = z.object({ code: z.string().trim().min(6).max(10) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Enter the 6-digit code." });
    const secret = (req.session as any).pendingTotpSecret as string | undefined;
    if (!secret) return res.status(400).json({ message: "Start setup again." });
    if (!verifyTotp(secret, parsed.data.code)) return res.status(400).json({ code: "TOTP_INVALID", message: "That code is not valid. Try the latest code." });
    const me = req.user as User;
    const updated = await storage.updateUser(me.id, { totpSecret: secret, totpEnabled: true } as any);
    delete (req.session as any).pendingTotpSecret;
    void logAudit({ action: "totp_enabled", actor: me, targetType: "user", targetId: me.id, req });
    res.json(safeUser(updated));
  });

  app.post("/api/user/2fa/disable", requireRole(["admin"]), async (req, res) => {
    const parsed = z.object({ password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Enter your password." });
    const me = await storage.getUser((req.user as User).id);
    if (!me || !(await comparePasswords(parsed.data.password, me.password))) {
      return res.status(400).json({ code: "WRONG_PASSWORD", message: "Your password is not correct." });
    }
    const updated = await storage.updateUser(me.id, { totpSecret: null, totpEnabled: false } as any);
    void logAudit({ action: "totp_disabled", actor: me, targetType: "user", targetId: me.id, req });
    res.json(safeUser(updated));
  });

  // ---- Security log (admin) -----------------------------------------------
  app.get("/api/audit-events", requireRole(["admin"]), async (req, res) => {
    const q = z.object({
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
      action: z.enum(AUDIT_ACTIONS).optional(),
      actorId: z.coerce.number().int().positive().optional(),
    }).safeParse(req.query);
    if (!q.success) return res.status(400).json({ message: q.error.issues[0].message });
    res.json(await listAuditEvents(q.data));
  });

  // Exports are generated in the browser; the client records each one here.
  app.post("/api/audit-events/export", requireAuth, async (req, res) => {
    const parsed = z.object({
      what: z.string().trim().min(1).max(80),
      format: z.enum(["csv", "xlsx", "pdf", "json"]),
      rows: z.number().int().min(0).max(1_000_000).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    await logAudit({ action: "export", actor: req.user as User, targetType: "export", targetId: parsed.data.what, details: parsed.data, req });
    res.status(204).end();
  });

  // ---- Avatars -------------------------------------------------------------
  // Images only, max 2 MB, re-encoded by sharp (strips metadata and any payload).
  const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype)) cb(null, true);
      else cb(new Error("Use a JPEG, PNG, WebP or GIF image."));
    },
  }).single("avatar");

  app.post("/api/users/me/avatar", requireAuth, (req, res) => {
    avatarUpload(req, res, async (err: any) => {
      if (err) {
        const message = err?.code === "LIMIT_FILE_SIZE" ? "Image must be 2 MB or smaller." : (err?.message || "Upload failed.");
        return res.status(400).json({ message });
      }
      if (!req.file) return res.status(400).json({ message: "No file uploaded." });
      const user = req.user as User;
      let webp: Buffer;
      try {
        webp = await sharp(req.file.buffer, { limitInputPixels: 40_000_000 })
          .rotate()
          .resize(256, 256, { fit: "cover" })
          .webp({ quality: 85 })
          .toBuffer();
      } catch {
        return res.status(400).json({ message: "That file is not a valid image." });
      }
      let avatarUrl: string;
      try {
        if (isCloudinaryConfigured()) {
          avatarUrl = await uploadToCloudinary(webp, "pixelcrm/avatars");
        } else {
          const avatarsDir = path.join(process.cwd(), "uploads", "avatars");
          fs.mkdirSync(avatarsDir, { recursive: true });
          const filename = `avatar-${user.id}-${Date.now()}.webp`;
          fs.writeFileSync(path.join(avatarsDir, filename), webp);
          avatarUrl = `/api/avatars/${filename}`;
        }
      } catch (uploadErr) {
        console.error("[avatar] upload failed:", (uploadErr as Error)?.message);
        return res.status(502).json({ message: "Couldn't store the image. Please try again." });
      }
      const updatedUser = await storage.updateUser(user.id, { avatar: avatarUrl });
      res.json(safeUser(updatedUser));
    });
  });

  // Legacy local avatars (existing rows keep their /api/avatars/... values).
  app.get("/api/avatars/:filename", requireAuth, (req, res) => {
    const filename = String(req.params.filename || "");
    if (!/^[A-Za-z0-9._-]{1,120}\.(png|jpe?g|gif|webp)$/i.test(filename) || filename.includes("..")) {
      return res.sendStatus(400);
    }
    const filePath = path.join(process.cwd(), "uploads", "avatars", filename);
    if (!fs.existsSync(filePath)) return res.sendStatus(404);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(filePath);
  });
}
