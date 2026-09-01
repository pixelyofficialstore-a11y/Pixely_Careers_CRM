import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api, errorSchemas } from "@shared/routes";
import { z } from "zod";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { type User, userRoles, type InsertActivityLog, type ClientReview, type InsertClientSuggestion, orders, paymentVerifications, activityLogs } from "@shared/schema";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import multer from "multer";
import path from "path";
import fs from "fs";
import { ObjectStorageService, registerObjectStorageRoutes, objectStorageServiceInstance } from "./replit_integrations/object_storage";
import sharp from "sharp";
import { isCloudinaryConfigured, uploadToCloudinary } from "./cloudinary";
import webpush from "web-push";
import { addSseClient, removeSseClient, emitNotification, emitRealtime } from "./sse";
import { getPaymentApprovalConflict } from "@shared/order-accounting";

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@pixelcrm.app",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars are not set — background web push is disabled");
}
import { canAccessOrderCase, isSupportedComplaintTarget, projectCaseActivity, projectSuggestionForRole, type CaseRole } from "@shared/case-access";

const KNOWN_PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
  "web.push.apple.com",
];

function isValidPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    return KNOWN_PUSH_HOSTS.some(host => url.hostname === host || url.hostname.endsWith("." + host));
  } catch {
    return false;
  }
}

function isCloudinaryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "res.cloudinary.com" || url.hostname.endsWith(".cloudinary.com"));
  } catch {
    return false;
  }
}

async function sendWebPushToUser(userId: number, title: string, body: string, priority: string) {
  try {
    const subs = await storage.getPushSubscriptionsForUser(userId);
    const payload = JSON.stringify({ title, body, priority });
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await storage.deletePushSubscription(sub.endpoint);
        }
      }
    }
  } catch (_) {}
}

async function notifyUser(
  userId: number, type: string, title: string, message: string,
  priority: string, relatedId?: number, relatedType?: string,
  allowedRoles?: string[]
) {
  if (allowedRoles?.length) {
    const recipient = await storage.getUser(userId);
    if (!recipient || !allowedRoles.includes(recipient.role)) return null;
  }

  const result = await storage.createNotification(userId, type, title, message, priority, relatedId, relatedType);
  const scopes = type === "complaint"
    ? ["notifications", "complaints", "stats"]
    : ["notifications"];
  if (result.created) {
    sendWebPushToUser(userId, title, message, priority).catch(() => {});
    emitNotification(userId, { event: "notification", id: result.notification.id, count: 1, scopes });
  } else {
    emitRealtime(userId, scopes);
  }
  return result.notification;
}

// Notify several unique recipients at once (skips falsy/duplicate ids and any excluded ids).
async function notifyMany(
  userIds: (number | null | undefined)[], type: string, title: string, message: string,
  priority: string, relatedId?: number, relatedType?: string,
  exclude: (number | null | undefined)[] = [], allowedRoles: string[] = []
) {
  const excludeSet = new Set(exclude.filter((id): id is number => typeof id === "number"));
  const candidateRecipients = Array.from(
    new Set(userIds.filter((id): id is number => typeof id === "number" && !excludeSet.has(id)))
  );
  const allowedRecipientIds = allowedRoles.length
    ? new Set(
        (await storage.getUsers())
          .filter(user => allowedRoles.includes(user.role))
          .map(user => user.id)
      )
    : null;

  for (const id of candidateRecipients) {
    if (allowedRecipientIds && !allowedRecipientIds.has(id)) continue;
    await notifyUser(id, type, title, message, priority, relatedId, relatedType, allowedRoles);
  }
}

// Format PKR paisa (integer) into a readable rupee string, e.g. 300000 -> "₨3,000".
function fmtRs(paisa: number | null | undefined): string {
  const rs = Math.floor((paisa || 0) / 100);
  return `₨${rs.toLocaleString()}`;
}

// Human-readable order reference. Falls back gracefully when no order number exists yet.
function orderRef(order: { orderNumber?: string | null; id?: number }): string {
  if (order?.orderNumber) return `#${order.orderNumber}`;
  if (order?.id) return `Order #${order.id}`;
  return "this order";
}

// Turn an internal status key into a clean label, e.g. "pending_payment" -> "Pending Payment".
function statusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return status
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function safeUser(person: User | null | undefined) {
  if (!person) return null;
  const { password: _password, ...safe } = person;
  return safe;
}

function safeUserSummary(person: User | null | undefined) {
  return person ? {
    id: person.id,
    name: person.name,
    role: person.role,
    title: person.title,
    avatar: person.avatar,
  } : null;
}

const PgSession = connectPgSimple(session);

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }
  
  const sessionStore = new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true });

  app.use(
    session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET || "pixely_secret_key",
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: { 
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        httpOnly: true,
        maxAge: 365 * 24 * 60 * 60 * 1000,
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user || !(await comparePasswords(password, user.password))) {
          return done(null, false);
        }
        // Block disabled/inactive accounts even with a correct password.
        if (!user.isActive) {
          return done(null, false, { message: "account_disabled" });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user, done) => done(null, (user as User).id));
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await storage.getUser(id as number);
      // If the account was disabled after the session was created, treat it as
      // logged out so protected routes reject the request on the next call.
      if (!user || !user.isActive) {
        return done(null, false);
      }
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  app.post(api.auth.login.path, (req, res, next) => {
    passport.authenticate("local", (err: any, user: Express.User | false, info: { message?: string } | undefined) => {
      if (err) return next(err);
      if (!user) {
        if (info?.message === "account_disabled") {
          return res.status(403).json({ message: "Your account has been disabled. Please contact the admin." });
        }
        return res.status(401).json({ message: "Invalid username or password." });
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        return res.json(safeUser(user as User));
      });
    })(req, res, next);
  });

  app.post(api.auth.logout.path, (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.json({ message: "Logged out" });
    });
  });

  app.get(api.auth.me.path, (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(safeUser(req.user as User));
  });

  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    next();
  };

  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (!roles.includes((req.user as User).role)) return res.sendStatus(403);
    next();
  };

  // SSE stream: authenticated users connect here to receive real-time notification events
  app.get("/api/notifications/stream", requireAuth, (req: any, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const userId = (req.user as User).id;
    addSseClient(userId, res);

    // Send an initial heartbeat so the client knows the connection is live
    res.write(`: connected\n\n`);

    const keepAlive = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch (_) {
        clearInterval(keepAlive);
      }
    }, 25000);

    req.on("close", () => {
      clearInterval(keepAlive);
      removeSseClient(userId, res);
    });
  });

  app.get(api.users.list.path, requireAuth, async (req, res) => {
    const users = await storage.getUsers();
    res.json(users.map(safeUser));
  });

  app.post(api.users.create.path, requireRole(["admin"]), async (req, res) => {
    try {
      const input = api.users.create.input.parse(req.body);
      const hashedPassword = await hashPassword(input.password);
      const user = await storage.createUser({ ...input, password: hashedPassword });
      res.status(201).json(safeUser(user));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.patch(api.users.update.path, requireRole(["admin"]), async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const updates = { ...req.body };
      const actor = req.user as User;

      const existingUser = await storage.getUser(userId);

      if (updates.password) {
        updates.password = await hashPassword(updates.password);
      }
      
      const updatedUser = await storage.updateUser(userId, updates);

      // Notify other admins when a team member's access is enabled/disabled.
      if (
        existingUser &&
        typeof updates.isActive === "boolean" &&
        updates.isActive !== existingUser.isActive
      ) {
        const targetName = updatedUser.name || "A team member";
        const actorName = actor.name || "an admin";
        const admins = await storage.getAdmins();
        if (updates.isActive) {
          await notifyMany(
            admins.map(a => a.id), "user",
            "User Account Enabled",
            `${targetName}'s CRM access was enabled by ${actorName}.`,
            "update",
            userId, "user",
            [actor.id],
            ["admin"]
          );
        } else {
          await notifyMany(
            admins.map(a => a.id), "user",
            "User Account Disabled",
            `${targetName}'s CRM access was disabled by ${actorName}.`,
            "action_required",
            userId, "user",
            [actor.id],
            ["admin"]
          );
        }
      }

      res.json(safeUser(updatedUser));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post("/api/users/me/avatar", requireAuth, async (req, res, next) => {
    const avatarsDir = path.join(process.cwd(), 'uploads', 'avatars');
    if (!fs.existsSync(avatarsDir)) {
      fs.mkdirSync(avatarsDir, { recursive: true });
    }
    
    const avatarUpload = multer({
      storage: multer.diskStorage({
        destination: avatarsDir,
        filename: (req, file, cb) => {
          const user = req.user as User;
          const ext = path.extname(file.originalname);
          cb(null, `avatar-${user.id}-${Date.now()}${ext}`);
        }
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Invalid image type. Only JPEG, PNG, GIF, and WebP are allowed.'));
        }
      }
    }).single('avatar');
    
    avatarUpload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      
      const user = req.user as User;
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const avatarUrl = `/api/avatars/${file.filename}`;
      const updatedUser = await storage.updateUser(user.id, { avatar: avatarUrl });
      
      res.json(safeUser(updatedUser));
    });
  });

  app.get('/api/avatars/:filename', (req, res) => {
    const filename = req.params.filename;
    
    if (!filename || filename.includes('..') || filename.includes('/')) {
      return res.sendStatus(400);
    }
    
    const filePath = path.join(process.cwd(), 'uploads', 'avatars', filename);
    if (!fs.existsSync(filePath)) {
      return res.sendStatus(404);
    }
    
    res.sendFile(filePath);
  });

  app.get("/api/designer-assignments", requireAuth, async (req, res) => {
    const user = req.user as User;
    if (user.role === "admin") {
      const assignments = await storage.getAllDesignerAssignments();
      res.json(assignments);
    } else if (user.role === "support") {
      const assignments = await storage.getDesignerAssignments(user.id);
      res.json(assignments);
    } else {
      res.json([]);
    }
  });

  app.get("/api/designer-assignments/:supportUserId", requireRole(["admin"]), async (req, res) => {
    const supportUserId = Number(req.params.supportUserId);
    const assignments = await storage.getDesignerAssignments(supportUserId);
    res.json(assignments);
  });

  app.put("/api/designer-assignments/:supportUserId", requireRole(["admin"]), async (req, res) => {
    const supportUserId = Number(req.params.supportUserId);
    const { designerIds } = req.body;
    
    if (!Array.isArray(designerIds)) {
      return res.status(400).json({ message: "designerIds must be an array" });
    }
    
    await storage.setDesignerAssignments(supportUserId, designerIds);
    const assignments = await storage.getDesignerAssignments(supportUserId);
    res.json(assignments);
  });

  app.get(api.orders.list.path, requireAuth, async (req, res) => {
    const user = req.user as User;
    const orders = await storage.getOrders(user.role, user.id);
    
    const sanitizedOrders = orders.map(o => ({
      ...o,
      assignee: safeUser(o.assignee),
      totalPrice: (user.role === 'admin' || user.role === 'support') ? o.totalPrice : undefined,
      advanceAmount: (user.role === 'admin' || user.role === 'support' || user.role === 'designer') ? o.advanceAmount : undefined,
      remainingAmount: (user.role === 'admin' || user.role === 'support' || user.role === 'designer') ? o.remainingAmount : undefined,
    }));

    res.json(sanitizedOrders);
  });

  app.post(api.orders.create.path, requireRole(["admin", "support"]), async (req, res) => {
    try {
      const { services, ...orderData } = req.body;
      
      const isCustomOrder = !orderData.packageType || orderData.packageType === "custom";
      
      if (isCustomOrder && (!services || !Array.isArray(services) || services.length === 0)) {
        return res.status(400).json({ message: "At least one service is required for custom orders" });
      }

      const serviceSchema = z.object({
        serviceType: z.string().min(1, "Service type is required"),
        quantity: z.number().int().min(1, "Quantity must be at least 1"),
        instructions: z.string().nullable().optional(),
      });
      
      if (services && Array.isArray(services)) {
        for (const service of services) {
          serviceSchema.parse(service);
        }
      }

      const orderSchema = z.object({
        clientName: z.string().min(1, "Client name is required"),
        clientPhone: z.string().min(1, "Phone number is required"),
        clientEmail: z.string().email().optional().nullable(),
        clientType: z.enum(["national", "international"]),
        assignedToId: z.number().int().positive().optional().nullable(),
        paymentStatus: z.enum(["pending", "paid"]).optional(),
        totalPrice: z.number().int().optional(),
        advanceAmount: z.number().int().min(0).optional(),
        amountPaid: z.number().int().optional(),
        packageType: z.string().optional().nullable(),
        platform: z.string().optional().nullable(),
        campaign: z.string().optional().nullable(),
        adSet: z.string().optional().nullable(),
        creative: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      });
      
      orderSchema.parse(orderData);
      
      const user = req.user as User;
      
      const intendedDesignerId = orderData.assignedToId;
      const totalPrice = orderData.totalPrice || 0;
      
      if (user.role === 'admin') {
        // Admin orders are auto-approved — advance is collected immediately, no screenshot needed
        const orderNumber = await storage.generateOrderNumber();
        const advanceAmount = orderData.advanceAmount || 0;
        const remainingAmount = Math.max(0, totalPrice - advanceAmount);
        const order = await storage.createOrder({
          ...orderData,
          totalPrice,
          advanceAmount,
          remainingAmount,
          paymentStatus: remainingAmount === 0 ? "paid" : "pending",
          assignedToId: intendedDesignerId || null,
          intendedDesignerId: intendedDesignerId || null,
          advancePaymentStatus: "approved",
          orderNumber,
          createdById: user.id,
          status: "new",
        }, services || []);
        await storage.createActivityLog({ orderId: order.id, actorId: user.id, activityType: "order_created", newValue: "new" });
        if (intendedDesignerId) {
          const assignedDesigner = await storage.getUser(intendedDesignerId);
          await storage.createActivityLog({
            orderId: order.id, actorId: user.id, activityType: "assignment", newValue: String(intendedDesignerId),
            details: { previousDesigner: null, newDesigner: userSummary(assignedDesigner) },
          });
        }

        // Notify all OTHER admins (not the one who placed it)
        const admins = await storage.getAdmins();
        await notifyMany(
          admins.map(a => a.id), "order",
          "New Order Created",
          `New order of ${fmtRs(totalPrice)} placed by ${user.name} for ${orderData.clientName}. Order ${orderRef({ orderNumber })}.`,
          "update",
          order.id, "order",
           [user.id],
           ["admin"]
        );

        // Notify assigned designer (never notify the actor about their own assignment)
        if (intendedDesignerId && intendedDesignerId !== user.id) {
          await notifyUser(
            intendedDesignerId, "assignment",
            "Order Assigned",
            `${orderRef({ orderNumber })} for ${orderData.clientName} has been assigned to you. You can start working on it.`,
            "action_required",
            order.id, "order",
            ["designer"]
          );
        }

        return res.status(201).json(order);
      }

      // Non-admin: order goes through payment verification flow
      const order = await storage.createOrder({
        ...orderData,
        totalPrice: totalPrice,
        advanceAmount: 0,
        remainingAmount: totalPrice,
        paymentStatus: "pending",
        assignedToId: null,
        intendedDesignerId: intendedDesignerId || null,
        advancePaymentStatus: "pending",
        orderNumber: null,
        createdById: user.id,
        status: "pending_payment",
      }, services || []);
      await storage.createActivityLog({ orderId: order.id, actorId: user.id, activityType: "order_created", newValue: "pending_payment" });

      // Notify admins of a new payment request (not "order placed" — no order exists yet)
      const admins = await storage.getAdmins();
      await notifyMany(
        admins.map(a => a.id), "payment",
        "Payment Verification Required",
        `${fmtRs(totalPrice)} order placed by ${user.name} for ${orderData.clientName}. Verify the payment before approval.`,
        "action_required",
         order.id, "order",
         [],
         ["admin"]
      );

      res.status(201).json(order);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.get(api.orders.get.path, requireAuth, async (req, res) => {
    const order = await storage.getOrder(Number(req.params.id));
    if (!order) return res.sendStatus(404);
    
    const user = req.user as User;
    if (user.role === 'designer' && order.assignedToId !== user.id) {
      return res.sendStatus(403);
    }
    const sanitized = {
      ...order,
      assignee: safeUser(order.assignee),
      totalPrice: (user.role === 'admin' || user.role === 'support') ? order.totalPrice : undefined,
      advanceAmount: (user.role === 'admin' || user.role === 'support' || user.role === 'designer') ? order.advanceAmount : undefined,
      remainingAmount: (user.role === 'admin' || user.role === 'support' || user.role === 'designer') ? order.remainingAmount : undefined,
    };

    res.json(sanitized);
  });

  app.get(api.orderComplaints.list.path, requireAuth, async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const user = req.user as User;
    const order = await storage.getOrder(orderId);
    if (!order) return res.sendStatus(404);
    if (!canAccessOrderCase(user.role as CaseRole, user.id, order.assignedToId)) {
      return res.sendStatus(403);
    }
    const complaints = await storage.getComplaints(user.role, user.id, { orderId });
    res.json(complaints);
  });

  const canAccessOrder = async (user: User, orderId: number) => {
    const order = await storage.getOrder(orderId);
    if (!order) return undefined;
    if (!canAccessOrderCase(user.role as CaseRole, user.id, order.assignedToId)) return null;
    return order;
  };
  const userSummary = safeUserSummary;
  const feedbackProjection = async (items: any[], kind: "review" | "suggestion", role: string) => {
    const [allUsers, allOrders] = await Promise.all([storage.getUsers(), Promise.all(items.map(item => storage.getOrder(item.orderId)))]);
    const userById = new Map(allUsers.map(person => [person.id, person]));
    return Promise.all(items.map(async (item, index) => {
      const order = allOrders[index];
      const summary = (id: number | null | undefined) => id ? safeUserSummary(userById.get(id)) : null;
      if (kind === "review") {
        return { ...item, orderNumber: order?.orderNumber || null, clientName: order?.clientName || "", order: order ? { packageType: order.packageType, services: order.services, paymentStatus: order.paymentStatus, status: order.status } : undefined, reviewForDesigner: summary(item.reviewForDesignerId), createdBy: summary(item.createdById) };
      }
      const { category: _legacyCategory, ...suggestionFields } = item;
      const suggestion = projectSuggestionForRole(suggestionFields, role as CaseRole);
      return {
        ...suggestion,
        ...(role === "admin" ? { adminNotes: undefined } : {}),
        adminNotesLog: role === "admin" ? await storage.getSuggestionNotes(item.id) : undefined,
        orderNumber: order?.orderNumber || null,
        clientName: order?.clientName || "",
        order: order ? { packageType: order.packageType, services: order.services, status: order.status } : undefined,
        relatedDesigner: summary(item.relatedDesignerId),
        createdBy: summary(item.createdById),
        implementedBy: summary(item.implementedByUserId),
        rejectedBy: summary(item.rejectedByUserId),
      };
    }));
  };
  const feedbackFilters = (req: Request) => ({
    search: typeof req.query.search === "string" ? req.query.search.toLowerCase() : "",
    month: typeof req.query.month === "string" ? Number(req.query.month) : undefined,
    year: typeof req.query.year === "string" ? Number(req.query.year) : undefined,
    designerId: typeof req.query.designerId === "string" ? Number(req.query.designerId) : undefined,
    status: typeof req.query.status === "string" ? req.query.status : undefined,
  });
  const filterFeedback = (items: any[], filters: ReturnType<typeof feedbackFilters>, kind: "review" | "suggestion") => items.filter(item => {
    const created = item.createdAt ? new Date(item.createdAt) : null;
    if (filters.month && created?.getMonth() !== filters.month - 1) return false;
    if (filters.year && created?.getFullYear() !== filters.year) return false;
    if (filters.designerId && (kind === "review" ? item.reviewForDesignerId : item.relatedDesignerId) !== filters.designerId) return false;
    if (filters.status && kind === "suggestion" && item.status !== filters.status) return false;
    return true;
  });

  app.get("/api/orders/:id/activity", requireAuth, async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ message: "Invalid order id" });
    const user = req.user as User;
    const order = await canAccessOrder(user, orderId);
    if (!order) return res.sendStatus(order === null ? 403 : 404);
    const logs = await storage.getOrderActivity(orderId);
    // Complaint activity must never reveal a filer to the designer it concerns.
    res.json(projectCaseActivity(logs, user.role as CaseRole)
      .map(log => ({ ...log, actor: log.actor ? safeUserSummary(log.actor as User) : log.actor })));
  });

  app.get(api.orders.clientCaseReport.path, requireAuth, async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ message: "Invalid order id" });
    const user = req.user as User;
    const order = await canAccessOrder(user, orderId);
    if (!order) return res.sendStatus(order === null ? 403 : 404);
    const [payments, complaints, review, suggestions, activity, createdBy] = await Promise.all([
      storage.getPaymentVerificationsByOrder(orderId),
      storage.getComplaints(user.role, user.id, { orderId }),
      storage.getClientReviewByOrder(orderId),
      storage.getClientSuggestions(user.role, user.id, orderId),
      storage.getOrderActivity(orderId),
      order.createdById ? storage.getUser(order.createdById) : Promise.resolve(undefined),
    ]);
    const safeOrder = {
      ...order,
      assignee: userSummary(order.assignee),
      createdBy: userSummary(createdBy),
      totalPrice: user.role === "designer" ? undefined : order.totalPrice,
    };
    const projectedReview = review ? (await feedbackProjection([review], "review", user.role))[0] : null;
    const projectedSuggestions = await feedbackProjection(suggestions, "suggestion", user.role);
    const safeReview = projectedReview
      ? (({ reviewProgress: _reviewProgress, ...reviewRecord }) => reviewRecord)(projectedReview)
      : null;
    res.json({
      order: safeOrder,
      payments: payments.map(({ screenshotData: _screenshotData, submittedBy, reviewedBy, ...payment }) => ({
        ...payment, submittedBy: userSummary(submittedBy), reviewedBy: userSummary(reviewedBy),
      })),
      complaints,
      review: safeReview,
      suggestions: projectedSuggestions.map(({ adminNotes: _adminNotes, reviewedByUserId: _reviewedByUserId, reviewedAt: _reviewedAt, decisionNote: _decisionNote, ...suggestion }) => ({
        ...suggestion,
        adminNotesLog: user.role === "admin" ? suggestion.adminNotesLog : undefined,
      })),
      activity: projectCaseActivity(activity, user.role as CaseRole)
        .map(log => ({ ...log, actor: log.actor ? userSummary(log.actor as User) : log.actor })),
    });
  });

  const feedbackUpload = multer({
    storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)),
  }).single("screenshot");
  app.post("/api/feedback/upload", requireRole(["admin", "support", "designer"]), (req, res) => {
    feedbackUpload(req, res, async err => {
      if (err) return res.status(400).json({ message: "Invalid image upload." });
      if (!req.file) return res.status(400).json({ message: "An image is required." });
      if (!isCloudinaryConfigured()) return res.status(503).json({ message: "Feedback uploads require Cloudinary configuration." });
      try {
        const folder = req.body.folder === "suggestions" ? "pixelcrm/suggestions" : req.body.folder === "complaints" ? "pixelcrm/complaints" : "pixelcrm/reviews";
        const screenshotUrl = await uploadToCloudinary(req.file.buffer, folder);
        return res.json({ screenshotUrl });
      } catch { return res.status(502).json({ message: "Unable to upload feedback image." }); }
    });
  });

  app.get(api.feedback.reviews.list.path, requireAuth, async (req, res) => {
    const user = req.user as User;
    const orderId = typeof req.query.orderId === "string" && /^\d+$/.test(req.query.orderId) ? Number(req.query.orderId) : undefined;
    const rows = filterFeedback(await storage.getClientReviews(user.role, user.id, orderId), feedbackFilters(req), "review");
    const projected = await feedbackProjection(rows, "review", user.role);
    const search = feedbackFilters(req).search;
    res.json(search ? projected.filter((r: any) => [r.reviewNumber, r.clientName, r.feedbackText, r.orderNumber, r.reviewForDesigner?.name].some(v => String(v || "").toLowerCase().includes(search))) : projected);
  });
  app.get("/api/orders/:id/client-reviews", requireAuth, async (req, res) => {
    const orderId = Number(req.params.id); const user = req.user as User;
    const order = await canAccessOrder(user, orderId);
    if (!order) return res.sendStatus(order === null ? 403 : 404);
    res.json(await feedbackProjection(await storage.getClientReviews(user.role, user.id, orderId), "review", user.role));
  });
  app.post(api.feedback.reviews.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.feedback.reviews.create.input.parse(req.body);
      const user = req.user as User; const order = await canAccessOrder(user, input.orderId);
      if (!order) return res.sendStatus(order === null ? 403 : 404);
      if (input.screenshotUrl && !isCloudinaryUrl(input.screenshotUrl)) return res.status(400).json({ message: "Screenshot must be an HTTPS Cloudinary URL." });
      if (await storage.getClientReviewByOrder(input.orderId)) return res.status(409).json({ message: "This order already has a client review." });
       const review = await storage.createClientReview({ ...input, reviewForDesignerId: order.assignedToId ?? null, createdById: user.id });
       await storage.createActivityLog({ orderId: input.orderId, actorId: user.id, activityType: "review_created", newValue: review.reviewNumber, details: { reviewId: review.id, reviewNumber: review.reviewNumber } });
        const reviewAdmins = await storage.getAdmins();
        await notifyMany(
          [...reviewAdmins.map(admin => admin.id), order.assignedToId],
          "review",
          "New Client Review",
          `${review.reviewNumber} was recorded for ${orderRef(order)} (${order.clientName}).`,
          "update",
          review.id,
          "review",
          [user.id],
          ["admin", "designer"],
        );
      res.status(201).json((await feedbackProjection([review], "review", user.role))[0]);
    } catch (err) { if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message || "Invalid review." }); return res.status(500).json({ message: "Unable to create client review." }); }
  });
  app.patch(api.feedback.reviews.update.path, requireAuth, async (req, res) => {
    try {
      const input = api.feedback.reviews.update.input.parse(req.body); const id = Number(req.params.id);
      const existing = (await storage.getClientReviews("admin", 0)).find(row => row.id === id);
      if (!existing) return res.sendStatus(404);
      const user = req.user as User; const order = await canAccessOrder(user, existing.orderId);
      if (!order) return res.sendStatus(order === null ? 403 : 404);
      if (input.screenshotUrl && !isCloudinaryUrl(input.screenshotUrl)) return res.status(400).json({ message: "Screenshot must be an HTTPS Cloudinary URL." });
       const reviewChanges = input;
       const review = await storage.updateClientReview(id, reviewChanges);
      const changedFields = Object.keys(reviewChanges).filter(field => (reviewChanges as any)[field] !== (existing as any)[field]);
      if (changedFields.length) {
        await storage.createActivityLog({ orderId: existing.orderId, actorId: user.id, activityType: "review_updated", details: { reviewId: id, fields: changedFields } });
      }
      for (const [field, label] of [["whatsappFeedbackReceived", "whatsapp"], ["facebookReviewReceived", "facebook"], ["videoReviewReceived", "video"]] as const) {
        if (input[field] === true && existing[field] === false) {
          await storage.createActivityLog({ orderId: existing.orderId, actorId: user.id, activityType: "review_updated", newValue: label, details: { reviewId: id, channelReceived: label } });
        }
      }
      res.json((await feedbackProjection([review], "review", user.role))[0]);
    } catch (err) { if (err instanceof z.ZodError) return res.status(400).json({ message: "Invalid review." }); return res.status(500).json({ message: "Unable to update client review." }); }
  });
  app.get(api.feedback.suggestions.list.path, requireAuth, async (req, res) => {
    const user = req.user as User; const orderId = typeof req.query.orderId === "string" && /^\d+$/.test(req.query.orderId) ? Number(req.query.orderId) : undefined;
    const rows = filterFeedback(await storage.getClientSuggestions(user.role, user.id, orderId), feedbackFilters(req), "suggestion");
    const projected = await feedbackProjection(rows, "suggestion", user.role);
    const search = feedbackFilters(req).search;
    res.json(search ? projected.filter((r: any) => [r.suggestionNumber, r.clientName, r.suggestionText, r.orderNumber, r.relatedDesigner?.name].some(v => String(v || "").toLowerCase().includes(search))) : projected);
  });
  app.get("/api/orders/:id/client-suggestions", requireAuth, async (req, res) => {
    const orderId = Number(req.params.id); const user = req.user as User;
    const order = await canAccessOrder(user, orderId);
    if (!order) return res.sendStatus(order === null ? 403 : 404);
    res.json(await feedbackProjection(await storage.getClientSuggestions(user.role, user.id, orderId), "suggestion", user.role));
  });
  app.get("/api/feedback/stats", requireAuth, async (req, res) => {
    const user = req.user as User;
    const [reviewRows, suggestionRows] = await Promise.all([
      storage.getClientReviews(user.role, user.id),
      storage.getClientSuggestions(user.role, user.id),
    ]);
    const filters = feedbackFilters(req);
    const visibleReviews = user.role === "support" ? reviewRows.filter(review => review.createdById === user.id) : reviewRows;
    const visibleSuggestions = user.role === "support" ? suggestionRows.filter(suggestion => suggestion.createdById === user.id) : suggestionRows;
    const reviews = filterFeedback(visibleReviews, filters, "review");
    const suggestions = filterFeedback(visibleSuggestions, filters, "suggestion");
    const rated = reviews.filter(review => review.rating !== null);
    res.json({
      reviews: { all: reviews.length, averageRating: rated.length ? rated.reduce((sum, review) => sum + (review.rating || 0), 0) / rated.length : null, whatsapp: reviews.filter(r => r.whatsappFeedbackReceived).length, facebook: reviews.filter(r => r.facebookReviewReceived).length, video: reviews.filter(r => r.videoReviewReceived).length },
      suggestions: { all: suggestions.length, new: suggestions.filter(s => s.status === "new").length, implemented: suggestions.filter(s => s.status === "implemented").length, rejected: suggestions.filter(s => s.status === "rejected").length },
    });
  });
  app.post(api.feedback.suggestions.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.feedback.suggestions.create.input.parse(req.body); const user = req.user as User; const order = await canAccessOrder(user, input.orderId);
      if (!order) return res.sendStatus(order === null ? 403 : 404);
      if (input.screenshotUrl && !isCloudinaryUrl(input.screenshotUrl)) return res.status(400).json({ message: "Screenshot must be an HTTPS Cloudinary URL." });
      const suggestion = await storage.createClientSuggestion({ ...input, category: "other", relatedDesignerId: order.assignedToId ?? null, createdById: user.id, reviewedByUserId: null, reviewedAt: null, adminNotes: null });
      await storage.createActivityLog({ orderId: input.orderId, actorId: user.id, activityType: "suggestion_created", newValue: suggestion.suggestionNumber, details: { suggestionId: suggestion.id } });
       const suggestionAdmins = await storage.getAdmins();
       await notifyMany(
         [...suggestionAdmins.map(admin => admin.id), order.assignedToId],
         "suggestion",
         "New Client Suggestion",
         `${suggestion.suggestionNumber} was submitted for ${orderRef(order)} (${order.clientName}).`,
         "action_required",
         suggestion.id,
         "suggestion",
         [user.id],
         ["admin", "designer"],
       );
      res.status(201).json((await feedbackProjection([suggestion], "suggestion", user.role))[0]);
    } catch (err) { if (err instanceof z.ZodError) return res.status(400).json({ message: "Invalid suggestion." }); return res.status(500).json({ message: "Unable to create client suggestion." }); }
  });
  app.patch(api.feedback.suggestions.update.path, requireAuth, async (req, res) => {
    try {
      const input = api.feedback.suggestions.update.input.parse(req.body); const id = Number(req.params.id); const existing = await storage.getClientSuggestion(id);
      if (!existing) return res.sendStatus(404);
      const user = req.user as User; const order = await canAccessOrder(user, existing.orderId);
      if (!order) return res.sendStatus(order === null ? 403 : 404);
      if (user.role !== "admin") return res.status(403).json({ message: "Only admins can make suggestion decisions or add internal notes." });
      if (input.status !== undefined && input.status !== existing.status) {
        if (existing.status !== "new" || !["implemented", "rejected"].includes(input.status) || input.confirmDecision !== true) {
          return res.status(400).json({ message: "Suggestions can only move from New to Implemented or Rejected after confirmation." });
        }
        if (input.status === "implemented" && !input.implementationDetails?.trim()) return res.status(400).json({ message: "Implementation details are required." });
        if (input.status === "rejected" && !input.rejectionReason?.trim()) return res.status(400).json({ message: "A reason for rejection is required." });
      }
      if (input.implementationScreenshotUrl && !isCloudinaryUrl(input.implementationScreenshotUrl)) return res.status(400).json({ message: "Implementation evidence must be an HTTPS Cloudinary URL." });
      const { confirmDecision: _confirmDecision, adminNote, ...submittedChanges } = input;
      const now = new Date();
      const suggestionChanges: Partial<InsertClientSuggestion> = input.status === "implemented" ? {
        status: "implemented", implementationDetails: input.implementationDetails, implementationScreenshotUrl: input.implementationScreenshotUrl ?? null,
        implementedByUserId: user.id, implementedAt: now, reviewedByUserId: user.id, reviewedAt: now,
      } : input.status === "rejected" ? {
        status: "rejected", rejectionReason: input.rejectionReason, rejectedByUserId: user.id, rejectedAt: now,
        reviewedByUserId: user.id, reviewedAt: now,
      } : {};
      const suggestion = Object.keys(suggestionChanges).length ? await storage.updateClientSuggestion(id, suggestionChanges) : existing;
      if (input.status !== undefined && input.status !== existing.status) {
        await storage.createActivityLog({
          orderId: existing.orderId, actorId: user.id, activityType: "suggestion_status",
          previousValue: existing.status, newValue: input.status, details: {
            suggestionId: id, suggestionNumber: existing.suggestionNumber,
            ...(input.status === "implemented" ? { implementationDetails: input.implementationDetails } : { rejectionReason: input.rejectionReason }),
          },
        });
        const decisionLabel = input.status === "implemented" ? "implemented" : "rejected";
        const decisionMessage = input.status === "implemented"
          ? `${existing.suggestionNumber} for ${orderRef(order)} was implemented by ${user.name}.`
          : `${existing.suggestionNumber} for ${orderRef(order)} was rejected by ${user.name}.`;
        await notifyUser(
          existing.createdById,
          "suggestion",
          `Suggestion ${decisionLabel === "implemented" ? "Implemented" : "Rejected"}`,
          decisionMessage,
          input.status === "implemented" ? "confirmation" : "update",
          existing.id,
          "suggestion",
        );
      }
      if (adminNote) {
        await storage.addSuggestionNote(id, adminNote, user.id);
        await storage.createActivityLog({
          orderId: existing.orderId, actorId: user.id, activityType: "suggestion_updated",
          details: { suggestionId: id, suggestionNumber: existing.suggestionNumber, event: "admin_note_added" },
        });
      }
      res.json((await feedbackProjection([suggestion], "suggestion", user.role))[0]);
    } catch (err) { if (err instanceof z.ZodError) return res.status(400).json({ message: "Invalid suggestion." }); return res.status(500).json({ message: "Unable to update client suggestion." }); }
  });

  app.get(api.complaints.list.path, requireAuth, async (req, res) => {
    const user = req.user as User;
    const filters = {
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      category: typeof req.query.category === "string" ? req.query.category : undefined,
      designerId: typeof req.query.designerId === "string" && /^\d+$/.test(req.query.designerId) ? Number(req.query.designerId) : undefined,
      month: typeof req.query.month === "string" && /^(?:[1-9]|1[0-2])$/.test(req.query.month) ? Number(req.query.month) : undefined,
      year: typeof req.query.year === "string" && /^\d{4}$/.test(req.query.year) ? Number(req.query.year) : undefined,
    };
    const complaints = await storage.getComplaints(user.role, user.id, filters);
    res.json(complaints);
  });

  app.get(api.complaints.actionableCount.path, requireAuth, async (req, res) => {
    const user = req.user as User;
    const count = await storage.getActionableComplaintCount(user.role, user.id);
    res.json({ count });
  });

  app.get(api.complaints.get.path, requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const user = req.user as User;
    const complaint = await storage.getComplaintForUser(id, user.role, user.id);
    if (!complaint) return res.sendStatus(404);
    res.json(complaint);
  });

  const complaintUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Only PNG, JPEG, and WebP images are allowed."));
      }
    },
  }).single("screenshot");

  app.post("/api/complaints/upload", requireRole(["admin", "support"]), (req, res) => {
    complaintUpload(req, res, async (err) => {
      if (err) return res.status(400).json({ message: err.message });
      if (!req.file) return res.status(400).json({ message: "A screenshot is required." });
      if (!isCloudinaryConfigured()) {
        return res.status(503).json({ message: "Complaint uploads require Cloudinary configuration." });
      }
      try {
        const screenshotUrl = await uploadToCloudinary(req.file.buffer, "pixelcrm/complaints");
        return res.json({ screenshotUrl });
      } catch {
        return res.status(502).json({ message: "Unable to upload the complaint screenshot." });
      }
    });
  });

  app.post(api.complaints.create.path, requireRole(["admin", "support"]), async (req, res) => {
    try {
      const requestedTargetType = req.body?.complaintTargetType
        ?? req.body?.complaint_target_type
        ?? req.body?.target_type
        ?? req.body?.targetType;
      if (requestedTargetType === "client") {
        return res.status(400).json({ message: "Client-target complaints are no longer supported." });
      }
      const input = api.complaints.create.input.parse(req.body);
      const user = req.user as User;
      const order = await storage.getOrder(input.orderId);
      if (!order) return res.status(400).json({ message: "The selected order could not be found." });

      const targetId = order.assignedToId;
      if (!targetId) {
        return res.status(400).json({
          message: "This order has no assigned designer. Assign a designer before raising a complaint.",
        });
      }
      if (input.complaintAgainstUserId && input.complaintAgainstUserId !== targetId) {
        return res.status(400).json({
          message: "A complaint can only target the designer currently assigned to this order.",
        });
      }
      const targetDesigner = await storage.getUser(targetId);
      if (!targetDesigner || targetDesigner.role !== "designer") {
        return res.status(400).json({ message: "The complaint must target a valid assigned designer." });
      }

      const categoryConfigs = await storage.getComplaintCategoryConfigs();
      const selectedCategory = categoryConfigs.find(category => category.key === input.category);
      if (!selectedCategory || !selectedCategory.isActive) {
        return res.status(400).json({ message: "Select an active complaint category." });
      }

      if (input.screenshotUrl && !isCloudinaryUrl(input.screenshotUrl)) {
        return res.status(400).json({ message: "Screenshot must be an HTTPS Cloudinary URL." });
      }

      const complaint = await storage.createComplaint({
        orderId: input.orderId,
        complaintTargetType: "designer",
        complaintAgainstUserId: targetId,
        filedByUserId: user.id,
        category: input.category,
        description: input.description.trim(),
        status: "new",
        adminNotes: null,
        resolution: null,
        resolutionOutcome: null,
        screenshotUrl: input.screenshotUrl || null,
        resolvedByUserId: null,
        resolvedAt: null,
      }, user.id);

      const admins = await storage.getAdmins();
      await notifyMany(
        admins.map(admin => admin.id),
        "complaint",
        "New Complaint Filed",
        `${complaint.complaintNumber} related to ${orderRef(order)} requires review.`,
        "action_required",
        complaint.id,
        "complaint",
        [user.id],
        ["admin"],
      );
      if (targetId) {
        // Deliberately neutral: the target must not learn who filed the complaint.
        await notifyUser(
          targetId,
          "complaint",
          "Complaint Requires Review",
          `A complaint related to ${orderRef(order)} has been filed about an assigned order. Please review it in Complaints.`,
          "action_required",
          complaint.id,
          "complaint",
          ["designer"],
        );
      }
      emitRealtime(user.id, ["complaints", "stats"]);

      const response = await storage.getComplaintForUser(complaint.id, user.role, user.id);
      res.status(201).json(response);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid complaint details" });
      }
      throw err;
    }
  });

  app.patch(api.complaints.update.path, requireRole(["admin"]), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const input = api.complaints.update.input.parse(req.body);
      const existing = await storage.getComplaintRecord(id);
      if (!existing) return res.sendStatus(404);
      if (!isSupportedComplaintTarget(existing.complaintTargetType)) return res.sendStatus(404);
      const adminNote = input.adminNote?.trim() || input.adminNotes?.trim() || "";
      if (input.status === undefined && !adminNote && input.resolution === undefined && input.resolutionScreenshotUrl === undefined && input.dismissalReason === undefined) {
        return res.status(400).json({ message: "Provide a status, admin note, or decision details." });
      }
      const actor = req.user as User;
      if (
        adminNote &&
        input.status === undefined &&
        input.resolution === undefined &&
        input.resolutionOutcome === undefined &&
        input.resolutionScreenshotUrl === undefined &&
        input.dismissalReason === undefined
      ) {
        await storage.addComplaintNote(id, adminNote, actor.id);
        const response = await storage.getComplaintForUser(id, "admin", actor.id);
        return res.json(response);
      }

      const status = input.status;
      const transitionAllowed =
        status === undefined ||
        status === existing.status ||
        (existing.status === "new" && (status === "confirmed" || status === "dismissed")) ||
        (existing.status === "confirmed" && (status === "resolved" || status === "refunded"));
      if (!transitionAllowed) {
        return res.status(400).json({
          message: `Cannot move a complaint from ${statusLabel(existing.status)} to ${statusLabel(status)}.`,
        });
      }

      if (status !== undefined && status !== existing.status && input.confirmDecision !== true) {
        return res.status(400).json({ message: "Confirm the complaint decision before saving it." });
      }
      if (status === "dismissed" && (!input.dismissalReason?.trim())) {
        return res.status(400).json({ message: "A reason for dismissal is required." });
      }
      if ((status === "resolved" || status === "refunded") && existing.status !== "confirmed") {
        return res.status(400).json({ message: "Only confirmed complaints can be closed." });
      }
      if ((status === "resolved" || status === "refunded") && (!input.resolution?.trim() && !existing.resolution?.trim())) {
        return res.status(400).json({ message: "Please add the resolution details before closing this complaint." });
      }
      if (status === "refunded" && input.refundConfirmed !== true) {
        return res.status(400).json({ message: "Confirm that the client refund has been completed." });
      }
      if (input.resolutionScreenshotUrl && !isCloudinaryUrl(input.resolutionScreenshotUrl)) return res.status(400).json({ message: "Resolution evidence must be an HTTPS Cloudinary URL." });
      if (
        input.resolution !== undefined &&
        input.resolution !== existing.resolution &&
        existing.status !== "confirmed" &&
        status !== "resolved" && status !== "refunded"
      ) {
        return res.status(400).json({ message: "A resolution can only be recorded for a confirmed complaint." });
      }
      if (
        (existing.status === "resolved" || existing.status === "refunded" || existing.status === "dismissed") &&
        (
          (input.resolution !== undefined && input.resolution !== existing.resolution) ||
          (input.resolutionOutcome !== undefined && input.resolutionOutcome !== existing.resolutionOutcome)
        )
      ) {
        return res.status(400).json({ message: "The resolution and outcome are locked once a complaint is closed." });
      }

      const historyEvents: InsertActivityLog[] = [];
      if (status !== undefined && status !== existing.status) {
        historyEvents.push({
          orderId: existing.orderId,
          actorId: actor.id,
          activityType: status === "resolved" || status === "refunded" ? "complaint_resolved" : "complaint_status",
          previousValue: existing.status,
          newValue: status,
          details: {
            complaintId: existing.id,
            complaintNumber: existing.complaintNumber,
            ...(status === "resolved" || status === "refunded" ? { resolution: input.resolution?.trim() || existing.resolution, resolutionOutcome: status === "refunded" ? "refund" : input.resolutionOutcome } : {}),
          },
        });
      }
      if (input.resolution !== undefined && (input.resolution?.trim() || null) !== existing.resolution) {
        historyEvents.push({
          orderId: existing.orderId,
          actorId: actor.id,
          activityType: "complaint_resolution",
          previousValue: existing.resolution,
          newValue: input.resolution?.trim() || null,
          details: {
            complaintId: existing.id,
            complaintNumber: existing.complaintNumber,
          },
        });
      }
      if (input.resolutionOutcome !== undefined && input.resolutionOutcome !== existing.resolutionOutcome) {
        historyEvents.push({
          orderId: existing.orderId, actorId: actor.id, activityType: "complaint_resolution",
          previousValue: existing.resolutionOutcome, newValue: input.resolutionOutcome,
          details: { complaintId: existing.id, complaintNumber: existing.complaintNumber },
        });
      }
      if (historyEvents.length === 0) {
        return res.status(400).json({ message: "No complaint changes were provided." });
      }

      const updated = await storage.updateComplaint(id, existing.status, {
        ...(status !== undefined ? { status } : {}),
        ...(input.resolution !== undefined ? { resolution: input.resolution?.trim() || null } : {}),
        ...(input.resolutionOutcome !== undefined ? { resolutionOutcome: input.resolutionOutcome } : {}),
        ...(input.resolutionScreenshotUrl !== undefined ? { resolutionScreenshotUrl: input.resolutionScreenshotUrl } : {}),
        ...(status === "dismissed" && status !== existing.status ? { dismissalReason: input.dismissalReason!.trim(), dismissedByUserId: actor.id, dismissedAt: new Date() } : {}),
        ...((status === "resolved" || status === "refunded") && status !== existing.status
          ? { resolvedByUserId: actor.id, resolvedAt: new Date() }
          : {}),
        ...(status === "refunded" ? { resolutionOutcome: "refund" } : {}),
      }, historyEvents, status === "refunded" && status !== existing.status ? {
        reason: `Refunded after complaint ${existing.complaintNumber}: ${input.resolution?.trim() || existing.resolution || "Client refund"}`,
        advanceRefunded: true,
        actorId: actor.id,
        complaintId: existing.id,
        complaintNumber: existing.complaintNumber,
      } : undefined);
      if (!updated) {
        return res.status(409).json({
          message: "This complaint changed while you were reviewing it. Reload and try again.",
        });
      }
      if (adminNote) {
        await storage.addComplaintNote(id, adminNote, actor.id);
      }
      if (status !== undefined && status !== existing.status) {

        const targetOrder = await storage.getOrder(existing.orderId);
        if (existing.complaintTargetType === "designer" && existing.complaintAgainstUserId) {
          await notifyUser(
            existing.complaintAgainstUserId,
            "complaint",
            `Complaint ${statusLabel(status)}`,
            `Complaint ${existing.complaintNumber} related to ${targetOrder ? orderRef(targetOrder) : "an assigned order"} is now ${statusLabel(status)}.`,
            status === "resolved" ? "confirmation" : "update",
            existing.id,
            "complaint",
            ["designer"],
          );
        }
        emitRealtime(existing.filedByUserId, ["complaints", "stats"]);
        if (existing.complaintTargetType === "designer" && existing.complaintAgainstUserId) {
          emitRealtime(existing.complaintAgainstUserId, ["complaints", "stats"]);
        }
      }

      const response = await storage.getComplaintForUser(id, "admin", actor.id);
      res.json(response);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid complaint update" });
      }
      if (err instanceof Error && err.message === "Unable to cancel the related order") {
        return res.status(409).json({ message: "The related order was already canceled. Reload this complaint before continuing." });
      }
      throw err;
    }
  });

  app.get(api.complaints.history.path, requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const user = req.user as User;
    const complaint = await storage.getComplaintForUser(id, user.role, user.id);
    if (!complaint) return res.sendStatus(404);
    const history = await storage.getComplaintHistory(id);
    // Reporter and management identities are restricted to Admin. Other roles
    // receive the case events without actor metadata or internal note content.
    res.json(projectCaseActivity(
      history.map(entry => ({ ...entry, activityType: entry.action })),
      user.role as CaseRole,
    ).map(({ activityType: _activityType, ...entry }) => entry));
  });

  app.patch(api.orders.update.path, requireAuth, async (req, res) => {
    const orderId = Number(req.params.id);
    const updates = { ...req.body };
    const user = req.user as User;
    
    const existingOrder = await storage.getOrder(orderId);
    if (!existingOrder) return res.sendStatus(404);

    if ("clientType" in updates && !["national", "international"].includes(updates.clientType)) {
      return res.status(400).json({ message: "Client type must be national or international" });
    }

    // Services are stored in a separate table; preserve their presence for role checks.
    const hasIncomingServices = 'services' in updates;
    const incomingServices = Array.isArray(updates.services) ? updates.services : undefined;
    delete updates.services;

    const oldAssignedToId = existingOrder.assignedToId;

    if (user.role === 'support') {
      // Support can create and monitor orders, but cannot change client, package,
      // pricing, payment, or other order-detail fields after creation.
      const allowedUpdates = ['status', 'assignedToId'];
      const keys = Object.keys(updates);
      if (hasIncomingServices || keys.some(key => !allowedUpdates.includes(key))) {
        return res.status(403).json({ message: "Support can only update operational order status and designer assignment" });
      }

      if (updates.status === 'canceled') {
        return res.status(403).json({ message: "Only admins can cancel orders" });
      }

      if (updates.status && !['new', 'working', 'ready', 'delivered'].includes(updates.status)) {
        return res.status(400).json({ message: "Invalid operational order status" });
      }

      if (existingOrder.status === 'canceled' && updates.status) {
        return res.status(403).json({ message: "Support cannot change a canceled order" });
      }

      // Support may only reassign to one of their designated designers.
      if (updates.assignedToId && updates.assignedToId !== existingOrder.assignedToId) {
        const assignments = await storage.getDesignerAssignments(user.id);
        const assignedDesignerIds = assignments.map(a => a.designerUserId);
        if (!assignedDesignerIds.includes(updates.assignedToId)) {
          return res.status(403).json({ message: "You can only assign to your designated designers" });
        }
      }
    }

    // Block new assignments to disabled designers (existing assignees may stay).
    if (updates.assignedToId && updates.assignedToId !== existingOrder.assignedToId) {
      const targetDesigner = await storage.getUser(updates.assignedToId);
      if (!targetDesigner || targetDesigner.role !== 'designer' || !targetDesigner.isActive) {
        return res.status(400).json({ message: "Cannot assign to a disabled or invalid designer" });
      }
    }

    if (user.role === 'designer') {
      if (existingOrder.assignedToId !== user.id) return res.sendStatus(403);
      
      const allowedUpdates = ['status'];
      const keys = Object.keys(updates);
      if (hasIncomingServices || keys.some(k => !allowedUpdates.includes(k))) return res.sendStatus(403);
      
      if (updates.status && updates.status === 'canceled') {
        return res.status(403).json({ message: "Designers cannot cancel orders" });
      }

      if (updates.status && !['new', 'working', 'ready', 'delivered'].includes(updates.status)) {
        return res.status(400).json({ message: "Invalid production status" });
      }

      // Anti-gaming: once delivered, status is permanently locked
      if (updates.status && existingOrder.status === 'delivered') {
        return res.status(403).json({ message: "Order status is locked once delivered" });
      }

      // Once ready, designer can only move to delivered if there is no remaining balance
      if (updates.status && existingOrder.status === 'ready') {
        if (updates.status !== 'delivered') {
          return res.status(403).json({ message: "Order status is locked once completed" });
        }
        const remaining = existingOrder.remainingAmount || 0;
        if (remaining > 0) {
          return res.status(403).json({ message: "Cannot mark as delivered: remaining balance must be cleared by admin first" });
        }
      }

      // Designer can only mark as delivered from non-ready states if full payment received (no remaining)
      if (updates.status === 'delivered' && existingOrder.status !== 'ready') {
        const remaining = existingOrder.remainingAmount || 0;
        if (remaining > 0) {
          return res.status(403).json({ message: "Cannot mark as delivered: remaining balance must be cleared by admin first" });
        }
      }
    }
    
    if (updates.status === 'ready' && existingOrder.status !== 'ready') {
      updates.readyDate = new Date();
    }

    if (updates.status === 'delivered' && existingOrder.status !== 'delivered') {
      updates.deliveredAt = new Date();
    }

    // Marking a pending order as paid: collect the outstanding balance in full.
    const becomingPaid = updates.paymentStatus === 'paid' && existingOrder.paymentStatus === 'pending';
    if (becomingPaid) {
      const currentAdvance = existingOrder.advanceAmount || 0;
      const currentRemaining = existingOrder.remainingAmount || 0;
      updates.advanceAmount = currentAdvance + currentRemaining;
      updates.remainingAmount = 0;
      updates.paymentDate = new Date();
    }

    // When admin edits finance fields, recompute amounts consistently to avoid NaN/negative values.
    const financeKeys = ['totalPrice', 'discountAmount', 'advanceAmount'];
    const hasFinanceEdit = user.role === 'admin' && financeKeys.some(k => k in updates);
    if (hasFinanceEdit) {
      const total = Number(updates.totalPrice ?? existingOrder.totalPrice ?? 0) || 0;
      const discount = Number(updates.discountAmount ?? existingOrder.discountAmount ?? 0) || 0;
      const finalPayable = Math.max(0, total - discount);
      if (becomingPaid) {
        // Paid + finance edits in one request: collect the full (newly computed) payable.
        updates.advanceAmount = finalPayable;
        updates.remainingAmount = 0;
      } else {
        const advance = Number(updates.advanceAmount ?? existingOrder.advanceAmount ?? 0) || 0;
        updates.remainingAmount = Math.max(0, finalPayable - advance);
      }
    }

    const updatedOrder = await storage.updateOrder(orderId, updates);
    if ("assignedToId" in updates && updates.assignedToId !== oldAssignedToId) {
      const [previousDesigner, nextDesigner] = await Promise.all([
        oldAssignedToId ? storage.getUser(oldAssignedToId) : Promise.resolve(undefined),
        updates.assignedToId ? storage.getUser(updates.assignedToId) : Promise.resolve(undefined),
      ]);
      await storage.createActivityLog({
        orderId, actorId: user.id, activityType: "assignment",
        previousValue: oldAssignedToId?.toString() ?? null,
        newValue: updates.assignedToId?.toString() ?? null,
        details: {
          previousDesigner: userSummary(previousDesigner),
          newDesigner: userSummary(nextDesigner),
        },
      });
    }
    if (updates.status && updates.status !== existingOrder.status) {
      await storage.createActivityLog({ orderId, actorId: user.id, activityType: "status_change", previousValue: existingOrder.status, newValue: updates.status });
    }

    // Only admins can replace an order's services (add / remove / edit quantity & instructions).
    if (incomingServices && user.role === 'admin') {
      const cleanedServices = incomingServices
        .filter((s: any) => s && s.serviceType)
        .map((s: any) => ({
          serviceType: String(s.serviceType),
          quantity: Number(s.quantity) > 0 ? Number(s.quantity) : 1,
          instructions: s.instructions ? String(s.instructions) : null,
        }));
      await storage.replaceOrderServices(orderId, cleanedServices);
    }

    // Admin edit notifications: reassignment, package/services update, bill update.
    if (user.role === 'admin') {
      const editAdmins = await storage.getAdmins();
      const editUsers = await storage.getUsers();
      const nameOf = (id: number | null | undefined) => editUsers.find(u => u.id === id)?.name || "Unassigned";
      const clientName = existingOrder.clientName || "this client";

      if ('assignedToId' in updates && updates.assignedToId !== oldAssignedToId) {
        await notifyMany(
          [...editAdmins.map(a => a.id), updates.assignedToId], "assignment",
          "Order Reassigned",
          `${orderRef(existingOrder)} for ${clientName} was reassigned from ${nameOf(oldAssignedToId)} to ${nameOf(updates.assignedToId)} by ${user.name}.`,
          "update",
          orderId, "order",
          [user.id],
          ["admin", "designer"]
        );
      }

      const packageChanged = ('packageType' in updates && updates.packageType !== existingOrder.packageType);
      if (incomingServices || packageChanged) {
        await notifyMany(
          editAdmins.map(a => a.id), "order",
          "Order Package Updated",
          `${orderRef(existingOrder)} package/services for ${clientName} were updated by ${user.name}.`,
          "update",
          orderId, "order",
          [user.id],
          ["admin"]
        );
      }

      if (hasFinanceEdit) {
        const finalPayable = Math.max(0, (updatedOrder.totalPrice || 0) - (updatedOrder.discountAmount || 0));
        await notifyMany(
          editAdmins.map(a => a.id), "payment",
          "Order Bill Updated",
          `${orderRef(existingOrder)} bill for ${clientName} was updated by ${user.name}. New payable amount: ${fmtRs(finalPayable)}.`,
          "update",
          orderId, "order",
          [user.id],
          ["admin"]
        );
      }
    }

    // Notify relevant parties when the order status actually changes.
    if (updates.status && updates.status !== existingOrder.status) {
      const statusAdmins = await storage.getAdmins();
      const recipients = statusAdmins.map(a => a.id);
      const clientName = existingOrder.clientName || "this client";

      // Delivered is intentionally silent; the delivery state is visible in
      // Orders and does not require a separate notification.
      if (updates.status !== 'delivered') {
        await notifyMany(
          recipients, "order",
          "Order Status Updated",
          `${orderRef(existingOrder)} for ${clientName} changed from ${statusLabel(existingOrder.status)} to ${statusLabel(updates.status)} by ${user.name}.`,
          "update",
          orderId, "order",
          [user.id],
          ["admin"]
        );
      }
    }

    res.json(updatedOrder);
  });

  app.post("/api/orders/:id/cancel", requireRole(["admin"]), async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ message: "Invalid order id" });
    const input = z.object({
      reason: z.string().trim().min(3, "A reason for cancellation is required"),
      advanceRefunded: z.boolean(),
    }).parse(req.body);
    const actor = req.user as User;
    const existing = await storage.getOrder(orderId);
    if (!existing) return res.sendStatus(404);
    if (existing.status === "canceled") return res.status(409).json({ message: "This order is already canceled." });
    const refundAmount = input.advanceRefunded ? Number(existing.advanceAmount || 0) : 0;
    const updated = await storage.cancelOrder(orderId, {
      reason: input.reason,
      advanceRefunded: input.advanceRefunded,
      actorId: actor.id,
      expectedStatus: existing.status,
    });
    if (!updated) return res.status(409).json({ message: "This order was already canceled." });

    const admins = await storage.getAdmins();
    await notifyMany(
      [...admins.map(admin => admin.id), existing.assignedToId],
      "order",
      "Order Canceled",
      `${orderRef(existing)} for ${existing.clientName} was canceled by ${actor.name}. Advance ${input.advanceRefunded ? `refunded (${fmtRs(refundAmount)})` : `retained (${fmtRs(existing.advanceAmount || 0)})`}.`,
      "action_required",
      orderId,
      "order",
      [actor.id],
      ["admin", "designer"],
    );
    res.json(updated);
  });

  app.delete(api.orders.remove.path, requireRole(["admin"]), async (req, res) => {
    const orderId = Number(req.params.id);
    const user = req.user as User;

    const existingOrder = await storage.getOrder(orderId);
    if (!existingOrder) return res.sendStatus(404);

    const orderLabel = orderRef(existingOrder);
    const clientName = existingOrder.clientName || "this client";
    const relatedComplaints = await storage.getComplaints("admin", user.id, { orderId });
    if (relatedComplaints.length > 0) {
      return res.status(409).json({
        message: "This order has complaint history and cannot be deleted. Complaint records must remain auditable.",
      });
    }

    await storage.deleteOrder(orderId);

    // Notify other admins that an order was permanently removed (this notification is not tied to the deleted order).
    const deleteAdmins = await storage.getAdmins();
    await notifyMany(
      deleteAdmins.map(a => a.id), "order",
      "Order Deleted",
      `${orderLabel} for ${clientName} was permanently deleted by ${user.name}.`,
      "action_required",
      undefined, undefined,
      [user.id],
      ["admin"]
    );

    res.json({ success: true });
  });

  app.get(api.notifications.list.path, requireAuth, async (req, res) => {
    const notifs = await storage.getNotifications((req.user as User).id);
    res.json(notifs);
  });

  app.get("/api/notifications/unread-count", requireAuth, async (req, res) => {
    const count = await storage.getUnreadNotificationCount((req.user as User).id);
    res.json({ count });
  });

  app.patch("/api/notifications/mark-all-read", requireAuth, async (req, res) => {
    await storage.markAllNotificationsRead((req.user as User).id);
    res.json({ success: true });
  });

  app.patch(api.notifications.markRead.path, requireAuth, async (req, res) => {
    const notif = await storage.markNotificationRead(Number(req.params.id), (req.user as User).id);
    if (!notif) return res.sendStatus(404);
    res.json(notif);
  });

  app.get("/api/push/vapid-public-key", (_req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return res.status(503).json({ error: "Push not configured" });
    res.json({ publicKey: key });
  });

  app.post("/api/push/subscribe", requireAuth, async (req, res) => {
    const user = req.user as User;
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: "Invalid subscription" });
    }
    if (!isValidPushEndpoint(endpoint)) {
      return res.status(400).json({ error: "Endpoint must be an HTTPS push service URL" });
    }
    const sub = await storage.savePushSubscription(user.id, endpoint, keys.p256dh, keys.auth);
    res.status(201).json(sub);
  });

  app.delete("/api/push/unsubscribe", requireAuth, async (req, res) => {
    const { endpoint } = req.body;
    if (endpoint) await storage.deletePushSubscription(endpoint);
    res.json({ success: true });
  });

  app.get(api.stats.dashboard.path, requireAuth, async (req, res) => {
    const user = req.user as User;
    const month = typeof req.query.month === "string" && /^(?:[1-9]|1[0-2])$/.test(req.query.month)
      ? Number(req.query.month) : undefined;
    const year = typeof req.query.year === "string" && /^\d{4}$/.test(req.query.year)
      ? Number(req.query.year) : undefined;
    const designerId = typeof req.query.designerId === "string" && /^\d+$/.test(req.query.designerId)
      ? Number(req.query.designerId) : undefined;
    const stats = await storage.getStats(user.role, user.id, { month, year, designerId });

    if (user.role !== 'admin') {
      delete stats.finance;
    }
    
    res.json(stats);
  });

  // Configure multer for payment screenshot uploads — memory storage so sharp can process in-memory
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith("image/")) {
        return cb(new Error("Only image files are allowed"));
      }
      cb(null, true);
    },
  });

  app.get("/api/payment-verifications/pending-count", requireRole(["admin"]), async (req, res) => {
    res.json({ count: await storage.getPendingPaymentCount() });
  });
  
  app.get("/api/payment-verifications", requireAuth, async (req, res) => {
    const user = req.user as User;
    const verifications = await storage.getPaymentVerifications(user.role, user.id);
    
    // Use getOrder() per verification to include pending_payment orders (filtered out by getOrders)
    const result = await Promise.all(verifications.map(async v => {
      const order = await storage.getOrder(v.orderId);
      const sanitizedOrder = order ? {
        orderNumber: order.orderNumber,
        clientName: order.clientName,
        totalPrice: (user.role === 'admin' || user.role === 'support') ? order.totalPrice : undefined,
      } : null;
      return {
        ...v,
        submittedBy: safeUserSummary(v.submittedBy),
        reviewedBy: safeUserSummary(v.reviewedBy),
        order: sanitizedOrder,
      };
    }));
    
    res.json(result);
  });

  app.get("/api/orders/:id/payment-verifications", requireAuth, async (req, res) => {
    const orderId = Number(req.params.id);
    const user = req.user as User;
    
    const order = await storage.getOrder(orderId);
    if (!order) return res.sendStatus(404);
    
    if (user.role === 'designer' && order.assignedToId !== user.id) {
      return res.sendStatus(403);
    }
    
    const verifications = await storage.getPaymentVerificationsByOrder(orderId);
    res.json(verifications.map(v => ({
      ...v,
      submittedBy: safeUserSummary(v.submittedBy),
      reviewedBy: safeUserSummary(v.reviewedBy),
    })));
  });

  app.post("/api/payment-verifications", requireAuth, upload.single('screenshot'), async (req, res) => {
    try {
      const user = req.user as User;
      const { orderId, paymentType, amount } = req.body;
      
      if (!orderId) return res.status(400).json({ error: "Order ID is required" });
      
      const order = await storage.getOrder(Number(orderId));
      if (!order) return res.status(400).json({ error: "Order not found" });
      if (order.status === "canceled") {
        return res.status(409).json({ error: "Canceled orders cannot receive payment requests" });
      }
      
      // Admin orders are auto-approved — admin should never need to submit advance/full payment verifications
      if (user.role === 'admin' && (paymentType === 'advance' || paymentType === 'full')) {
        return res.status(403).json({ error: "Admin orders are auto-approved. No payment verification needed." });
      }

      if (user.role === 'designer' && order.assignedToId !== user.id) {
        return res.status(403).json({ error: "You can only submit payment requests for assigned orders" });
      }
      
      if (user.role === 'designer' && paymentType !== 'remaining') {
        return res.status(403).json({ error: "Designers can only submit remaining payment requests" });
      }
      
      const parsedAmount = Number(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: "Invalid payment amount" });
      }
      
      if (paymentType === 'remaining') {
        const orderRemaining = order.remainingAmount || 0;
        if (parsedAmount > orderRemaining) {
          return res.status(400).json({ error: `Amount exceeds remaining balance` });
        }
      }
      
      const validPaymentTypes = ['advance', 'full', 'remaining'];
      if (!validPaymentTypes.includes(paymentType)) {
        return res.status(400).json({ error: "Invalid payment type" });
      }
      
      const file = req.file;
      let screenshotUrl: string | null = null;
      let screenshotData: string | null = null;
      let screenshotMimeType: string | null = null;

      if (file) {
        // Compress with sharp: resize max 1000px wide, convert to JPEG at 70% quality
        const compressed = await sharp(file.buffer)
          .resize({ width: 1000, withoutEnlargement: true })
          .jpeg({ quality: 70 })
          .toBuffer();

        let cloudinarySuccess = false;

        if (isCloudinaryConfigured()) {
          try {
            screenshotUrl = await uploadToCloudinary(compressed);
            screenshotData = null;
            screenshotMimeType = null;
            cloudinarySuccess = true;
            console.log("[cloudinary] Upload OK:", screenshotUrl);
          } catch (cloudErr: any) {
            console.error("[cloudinary] Upload FAILED, falling back to DB base64:", cloudErr?.message || cloudErr);
          }
        }

        if (!cloudinarySuccess) {
          // Fallback: store compressed image as base64 in the database
          screenshotData = compressed.toString("base64");
          screenshotMimeType = "image/jpeg";
          screenshotUrl = `/api/payment-files/db/${Date.now()}-${file.originalname}`;
          console.warn("[screenshot] Stored as base64 in DB. Fix Cloudinary credentials to store as URL.");
        }
      }
      
      const verification = await storage.createPaymentVerification({
        orderId: Number(orderId),
        paymentType,
        amount: Number(amount),
        screenshotUrl,
        screenshotData,
        screenshotMimeType,
        submittedById: user.id,
        status: "pending_confirmation",
      });
      await storage.createActivityLog({
        orderId: order.id, actorId: user.id, activityType: "payment_change",
        newValue: "pending_confirmation",
        details: { paymentVerificationId: verification.id, paymentType, amount: Number(amount) },
      });

      // Only send screenshot notification for EXISTING approved orders (remaining payments).
      // For initial pending_payment orders, the order creation already notified all admins.
      // Never notify the submitter of their own action.
      if (order.status !== 'pending_payment') {
        const admins = await storage.getAdmins();
        const typeLabel = paymentType === 'remaining' ? 'remaining' : paymentType;
        await notifyMany(
          admins.map(a => a.id),
          "payment",
          "Payment Verification Required",
          `${fmtRs(parsedAmount)} ${typeLabel} payment received from ${order.clientName} for ${orderRef(order)}. Please verify and approve.`,
          "action_required",
          verification.id,
          "payment_verification",
          [user.id],
          ["admin"]
        );
      }
      emitRealtime(user.id, ["payments", "orders", "stats"]);
      
      res.status(201).json(verification);
    } catch (err: any) {
      console.error("Payment verification error:", err);
      res.status(500).json({ error: err.message || "Failed to create payment verification" });
    }
  });

  app.patch("/api/payment-verifications/:id/approve", requireAuth, async (req, res) => {
    const user = req.user as User;
    if (user.role !== 'admin') {
      return res.status(403).json({ error: "Only admin can approve payments" });
    }
    
    const verificationId = Number(req.params.id);
    const { notes } = req.body;
    
    const verifications = await storage.getPaymentVerifications("admin", 0);
    const verification = verifications.find(v => v.id === verificationId);
    if (!verification) return res.sendStatus(404);
    if (verification.status !== "pending_confirmation") {
      return res.status(409).json({ error: `This payment is already ${verification.status}` });
    }
    const order = await storage.getOrder(verification.orderId);
    if (!order) return res.sendStatus(404);
    if (order.status === "canceled") {
      return res.status(409).json({ error: "Canceled orders cannot receive approved payments" });
    }

    const orderNumber = verification.paymentType === "advance" || verification.paymentType === "full"
      ? await storage.generateOrderNumber()
      : order.orderNumber;

    const approval = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`);
      const [lockedOrder] = await tx.select().from(orders).where(eq(orders.id, order.id));
      if (!lockedOrder) {
        throw new Error("ORDER_CANCELED_DURING_APPROVAL");
      }
      const approvalConflict = getPaymentApprovalConflict(lockedOrder, {
        paymentType: verification.paymentType,
        amount: verification.amount,
      });
      if (approvalConflict) throw new Error(`PAYMENT_APPROVAL_CONFLICT:${approvalConflict}`);

      const [approvedVerification] = await tx.update(paymentVerifications).set({
        status: "approved",
        reviewedById: user.id,
        reviewedAt: new Date(),
        notes,
      }).where(and(
        eq(paymentVerifications.id, verificationId),
        eq(paymentVerifications.status, "pending_confirmation"),
      )).returning();
      if (!approvedVerification) return null;

      const currentAdvance = lockedOrder.advanceAmount || 0;
      const currentRemaining = lockedOrder.remainingAmount || 0;
      const newRemaining = verification.paymentType === "advance"
        ? Math.max(0, (lockedOrder.totalPrice || 0) - (currentAdvance + verification.amount))
        : verification.paymentType === "remaining"
          ? Math.max(0, currentRemaining - verification.amount)
          : 0;
      const isFullyPaid = newRemaining <= 0;
      const orderUpdates = verification.paymentType === "advance" ? {
        orderNumber,
        advanceAmount: currentAdvance + verification.amount,
        remainingAmount: newRemaining,
        paymentStatus: isFullyPaid ? "paid" : "pending",
        advancePaymentStatus: "approved" as const,
        assignedToId: order.intendedDesignerId,
        status: "new" as const,
        paymentDate: new Date(),
      } : verification.paymentType === "full" ? {
        orderNumber,
        advanceAmount: lockedOrder.totalPrice,
        remainingAmount: 0,
        paymentStatus: "paid",
        advancePaymentStatus: "approved" as const,
        assignedToId: order.intendedDesignerId,
        status: "new" as const,
        paymentDate: new Date(),
      } : {
        advanceAmount: currentAdvance + verification.amount,
        remainingAmount: newRemaining,
        paymentStatus: isFullyPaid ? "paid" : "pending",
        ...(isFullyPaid ? { status: "delivered" as const, deliveredAt: new Date(), paymentDate: new Date() } : {}),
      };
      const [updatedOrder] = await tx.update(orders).set(orderUpdates)
        .where(and(eq(orders.id, order.id), ne(orders.status, "canceled")))
        .returning();
      if (!updatedOrder) throw new Error("ORDER_CANCELED_DURING_APPROVAL");

      await tx.insert(activityLogs).values({
        orderId: verification.orderId,
        actorId: user.id,
        activityType: "payment_change",
        previousValue: "pending_confirmation",
        newValue: "approved",
        details: { paymentVerificationId: verificationId, paymentType: verification.paymentType, amount: verification.amount },
      });
      return { approvedVerification, updatedOrder, newRemaining, isFullyPaid };
    }).catch(error => {
      if (error instanceof Error && error.message === "ORDER_CANCELED_DURING_APPROVAL") return null;
      if (error instanceof Error && error.message.startsWith("PAYMENT_APPROVAL_CONFLICT:")) {
        return { conflict: error.message.slice("PAYMENT_APPROVAL_CONFLICT:".length) };
      }
      throw error;
    });
    if (!approval) {
      return res.status(409).json({ error: "This payment or order changed while you were reviewing it. Reload and try again." });
    }
    if ("conflict" in approval) {
      return res.status(409).json({ error: approval.conflict });
    }
    const { newRemaining, isFullyPaid } = approval;

    if (verification.paymentType === 'advance') {
      if (order.intendedDesignerId && order.intendedDesignerId !== user.id) {
        await notifyUser(
          order.intendedDesignerId, "assignment",
          "Order Assigned",
          `${orderRef({ orderNumber })} for ${order.clientName} is approved and assigned to you. You can start working on it.`,
          "action_required",
          order.id, "order",
          ["designer"]
        );
      }

      // Notify all other admins (not the one who approved)
      const approvalAdmins = await storage.getAdmins();
      const advBalanceNote = newRemaining > 0 ? ` ${fmtRs(newRemaining)} remaining.` : "";
      await notifyMany(
        approvalAdmins.map(a => a.id), "payment",
        "Payment Approved",
        `${fmtRs(verification.amount)} advance payment for ${orderRef({ orderNumber })} (${order.clientName}) was approved by ${user.name}.${advBalanceNote}`,
        "confirmation",
        order.id, "order",
        [user.id],
        ["admin"]
      );
      await notifyUser(
        verification.submittedById, "payment",
        "Payment Approved",
        `Your advance payment request for ${orderRef({ orderNumber })} (${order.clientName}) was approved.`,
        "confirmation",
        order.id, "order",
        ["support"]
      );
    } else if (verification.paymentType === 'full') {
      if (order.intendedDesignerId && order.intendedDesignerId !== user.id) {
        await notifyUser(
          order.intendedDesignerId, "assignment",
          "Order Assigned",
          `${orderRef({ orderNumber })} for ${order.clientName} is approved and assigned to you. You can start working on it.`,
          "action_required",
          order.id, "order",
          ["designer"]
        );
      }

      // Notify all other admins (not the one who approved)
      const fullApprovalAdmins = await storage.getAdmins();
      await notifyMany(
        fullApprovalAdmins.map(a => a.id), "payment",
        "Payment Approved",
        `${fmtRs(verification.amount)} full payment for ${orderRef({ orderNumber })} (${order.clientName}) was approved by ${user.name}. Order fully paid.`,
        "confirmation",
        order.id, "order",
        [user.id],
        ["admin"]
      );
      await notifyUser(
        verification.submittedById, "payment",
        "Payment Approved",
        `Your full payment request for ${orderRef({ orderNumber })} (${order.clientName}) was approved.`,
        "confirmation",
        order.id, "order",
        ["support"]
      );
    } else if (verification.paymentType === 'remaining') {
      // Notify admins plus the assigned designer and the payment requester.
      const remainingAdmins = await storage.getAdmins();
      const balanceNote = isFullyPaid
        ? "Order fully paid."
        : `${fmtRs(newRemaining)} still remaining.`;
      await notifyMany(
        [...remainingAdmins.map(a => a.id), order.assignedToId, verification.submittedById], "payment",
        "Payment Approved",
        `${fmtRs(verification.amount)} remaining payment for ${orderRef(order)} (${order.clientName}) was approved by ${user.name}. ${balanceNote}`,
        "confirmation",
        order.id, "order",
        [user.id],
        ["admin", "designer", "support"]
      );

    }
    emitRealtime(user.id, ["payments", "orders", "stats"]);
    
    const updatedVerification = await storage.getPaymentVerifications("admin", 0);
    res.json(updatedVerification.find(v => v.id === verificationId));
  });

  app.patch("/api/payment-verifications/:id/disapprove", requireAuth, async (req, res) => {
    const user = req.user as User;
    if (user.role !== 'admin') {
      return res.status(403).json({ error: "Only admin can disapprove payments" });
    }
    
    const verificationId = Number(req.params.id);
    const { notes } = req.body;
    
    const verifications = await storage.getPaymentVerifications("admin", 0);
    const verification = verifications.find(v => v.id === verificationId);
    if (!verification) return res.sendStatus(404);
    
    await storage.updatePaymentVerification(verificationId, {
      status: "disapproved",
      reviewedById: user.id,
      reviewedAt: new Date(),
      notes,
    });
    await storage.createActivityLog({
      orderId: verification.orderId, actorId: user.id, activityType: "payment_change",
      previousValue: verification.status, newValue: "disapproved",
      details: { paymentVerificationId: verificationId, paymentType: verification.paymentType, amount: verification.amount },
    });
    
    const rejectedOrder = await storage.getOrder(verification.orderId);

    if (verification.paymentType !== 'remaining') {
      if (rejectedOrder) {
        // Keep as pending_payment (not canceled) so it stays hidden from Orders page
        await storage.updateOrder(rejectedOrder.id, {
          advancePaymentStatus: "disapproved",
          status: "pending_payment",
        });
      }
    }

    // Notify only the payment requester and admins that it was rejected.
    if (rejectedOrder) {
      const typeLabel = verification.paymentType === 'remaining' ? 'remaining' : verification.paymentType;
      const rejectAdmins = await storage.getAdmins();
      await notifyMany(
        [...rejectAdmins.map(a => a.id), verification.submittedById], "payment",
        "Payment Rejected",
        `${fmtRs(verification.amount)} ${typeLabel} payment for ${orderRef(rejectedOrder)} (${rejectedOrder.clientName}) was rejected by ${user.name}. Please review the payment details.`,
        "action_required",
        rejectedOrder.id, "order",
        [user.id],
        ["admin", "designer", "support"]
      );
    }
    emitRealtime(user.id, ["payments", "orders", "stats"]);
    
    const updatedVerifications = await storage.getPaymentVerifications("admin", 0);
    res.json(updatedVerifications.find(v => v.id === verificationId));
  });

  const objectStorageService = new ObjectStorageService();
  
  app.get('/api/payment-files/db/:filename', requireAuth, async (req, res) => {
    try {
      const screenshotUrl = `/api/payment-files/db/${req.params.filename}`;
      const verification = await storage.getPaymentVerificationByScreenshotUrl(screenshotUrl);
      if (verification && verification.screenshotData) {
        const buffer = Buffer.from(verification.screenshotData, 'base64');
        res.set({
          'Content-Type': verification.screenshotMimeType || 'image/jpeg',
          'Content-Length': buffer.length.toString(),
          'Cache-Control': 'private, max-age=86400',
        });
        return res.send(buffer);
      }
      return res.sendStatus(404);
    } catch (error) {
      console.error("Error serving screenshot from DB:", error);
      return res.sendStatus(500);
    }
  });

  app.get('/api/payment-files/:filename', requireAuth, async (req, res) => {
    const filename = req.params.filename;
    const sanitized = path.basename(filename);
    
    const localFilePath = path.join(process.cwd(), 'uploads', sanitized);
    if (fs.existsSync(localFilePath)) {
      return res.sendFile(localFilePath);
    }
    
    if (process.env.PRIVATE_OBJECT_DIR) {
      try {
        const objectFile = await objectStorageService.getPrivateObject(`payments/${sanitized}`);
        if (objectFile) {
          await objectStorageService.downloadObject(objectFile, res);
          return;
        }
      } catch (error) {
        console.error("Error fetching from object storage:", error);
      }
    }
    
    return res.sendStatus(404);
  });

  registerObjectStorageRoutes(app);

  app.get("/api/platforms-catalog", requireAuth, async (req, res) => {
    const items = await storage.getPlatformsCatalog();
    res.json(items);
  });

  app.post("/api/platforms-catalog", requireRole(["admin"]), async (req, res) => {
    try {
      const { name, isActive, hasCampaignFields, sortOrder } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "Platform name is required" });
      }
      const item = await storage.createPlatformCatalogItem({
        name: name.trim(),
        isActive: isActive !== false,
        hasCampaignFields: !!hasCampaignFields,
        sortOrder: sortOrder || 0,
      });
      res.status(201).json(item);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(400).json({ message: "A platform with that name already exists" });
      }
      throw err;
    }
  });

  app.patch("/api/platforms-catalog/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    try {
      const updated = await storage.updatePlatformCatalogItem(id, req.body);
      res.json(updated);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(400).json({ message: "A platform with that name already exists" });
      }
      throw err;
    }
  });

  app.delete("/api/platforms-catalog/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    await storage.deletePlatformCatalogItem(id);
    res.json({ success: true });
  });

  app.get("/api/complaint-categories", requireAuth, async (_req, res) => {
    res.json(await storage.getComplaintCategoryConfigs());
  });

  app.post("/api/complaint-categories", requireRole(["admin"]), async (req, res) => {
    try {
      const label = typeof req.body.label === "string" ? req.body.label.trim() : "";
      const requestedKey = typeof req.body.key === "string" ? req.body.key.trim() : label;
      const key = requestedKey.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      if (!label || !key) return res.status(400).json({ message: "Category name is required" });
      const item = await storage.createComplaintCategoryConfig({
        key,
        label,
        isActive: req.body.isActive !== false,
        sortOrder: Number.isInteger(req.body.sortOrder) ? req.body.sortOrder : 0,
      });
      res.status(201).json(item);
    } catch (err: any) {
      if (err?.code === "23505") return res.status(400).json({ message: "That complaint category already exists" });
      throw err;
    }
  });

  app.patch("/api/complaint-categories/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    const updates: Record<string, unknown> = {};
    if (typeof req.body.label === "string" && req.body.label.trim()) updates.label = req.body.label.trim();
    if (typeof req.body.isActive === "boolean") updates.isActive = req.body.isActive;
    if (Number.isInteger(req.body.sortOrder)) updates.sortOrder = req.body.sortOrder;
    const updated = await storage.updateComplaintCategoryConfig(id, updates);
    if (!updated) return res.sendStatus(404);
    res.json(updated);
  });

  app.delete("/api/complaint-categories/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    const categories = await storage.getComplaintCategoryConfigs();
    const category = categories.find(item => item.id === id);
    if (!category) return res.sendStatus(404);
    const existingComplaints = await storage.getComplaints("admin", (req.user as User).id, { category: category.key });
    if (existingComplaints.length > 0) {
      return res.status(409).json({ message: "This category is used by complaint history. Disable it instead." });
    }
    await storage.deleteComplaintCategoryConfig(id);
    res.json({ success: true });
  });

  app.get("/api/services-catalog", requireAuth, async (req, res) => {
    const items = await storage.getServicesCatalog();
    res.json(items);
  });

  app.post("/api/services-catalog", requireRole(["admin"]), async (req, res) => {
    try {
      const { name, isActive, sortOrder } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "Service name is required" });
      }
      const item = await storage.createServiceCatalogItem({
        name: name.trim(),
        isActive: isActive !== false,
        sortOrder: sortOrder || 0,
      });
      res.status(201).json(item);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(400).json({ message: "A service with that name already exists" });
      }
      throw err;
    }
  });

  app.patch("/api/services-catalog/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    try {
      const updated = await storage.updateServiceCatalogItem(id, req.body);
      res.json(updated);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(400).json({ message: "A service with that name already exists" });
      }
      throw err;
    }
  });

  app.delete("/api/services-catalog/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    await storage.deleteServiceCatalogItem(id);
    res.json({ success: true });
  });

  app.get("/api/package-configs", requireAuth, async (req, res) => {
    const pkgs = await storage.getPackageConfigs();
    res.json(pkgs);
  });

  app.post("/api/package-configs", requireRole(["admin"]), async (req, res) => {
    try {
      const { key, label, isActive, sortOrder } = req.body;
      if (!key || typeof key !== "string" || !key.trim()) {
        return res.status(400).json({ message: "Package key is required" });
      }
      if (!label || typeof label !== "string" || !label.trim()) {
        return res.status(400).json({ message: "Package label is required" });
      }
      const slugKey = key.trim().toLowerCase().replace(/\s+/g, "_");
      const pkg = await storage.createPackageConfig({
        key: slugKey,
        label: label.trim(),
        isActive: isActive !== false,
        sortOrder: sortOrder || 0,
      });
      res.status(201).json(pkg);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(400).json({ message: "A package with that key already exists" });
      }
      throw err;
    }
  });

  app.patch("/api/package-configs/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    try {
      const updates = { ...req.body };
      if (updates.key) {
        updates.key = updates.key.trim().toLowerCase().replace(/\s+/g, "_");
      }
      const updated = await storage.updatePackageConfig(id, updates);
      res.json(updated);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(400).json({ message: "A package with that key already exists" });
      }
      throw err;
    }
  });

  app.delete("/api/package-configs/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    await storage.deletePackageConfig(id);
    res.json({ success: true });
  });

  await seedDatabase();

  return httpServer;
}

async function seedDatabase() {
  const existingServices = await storage.getServicesCatalog();
  if (existingServices.length === 0) {
    const defaultServices = [
      "ATS CV",
      "Additional CV",
      "Cover Letter",
      "LinkedIn Optimization",
      "Indeed Optimization",
      "Naukri Gulf Optimization",
      "Bio Statement",
      "Digital Contact Card",
    ];
    for (let i = 0; i < defaultServices.length; i++) {
      await storage.createServiceCatalogItem({ name: defaultServices[i], isActive: true, sortOrder: i });
    }
  }

  const existingPackages = await storage.getPackageConfigs();
  if (existingPackages.length === 0) {
    const defaultPackages = [
      { key: "ats_career", label: "ATS Career Package", sortOrder: 0 },
      { key: "international_career_pro", label: "International Career Pro", sortOrder: 1 },
      { key: "executive_career_branding", label: "Executive Career Branding", sortOrder: 2 },
    ];
    for (const pkg of defaultPackages) {
      await storage.createPackageConfig({ key: pkg.key, label: pkg.label, isActive: true, sortOrder: pkg.sortOrder });
    }
  }

  const existingUsers = await storage.getUsers();
  if (existingUsers.length > 0) return;

  console.log("Seeding database...");

  const adminPass = await hashPassword("admin123");
  const admin = await storage.createUser({
    username: "admin",
    password: adminPass,
    role: "admin",
    name: "Admin User",
    title: "Agency Owner",
    avatar: "https://github.com/shadcn.png"
  });

  const supportPass = await hashPassword("support123");
  const support = await storage.createUser({
    username: "support",
    password: supportPass,
    role: "support",
    name: "Support Agent",
    title: "Customer Success",
    avatar: "https://github.com/shadcn.png"
  });

  const designerPass = await hashPassword("designer123");
  const designer = await storage.createUser({
    username: "designer",
    password: designerPass,
    role: "designer",
    name: "Alex Designer",
    title: "Senior Graphic Designer",
    avatar: "https://github.com/shadcn.png"
  });

  await storage.createOrder({
    clientName: "Banee Pasth",
    clientPhone: "+92 300 1234567",
    status: "working",
    priority: "normal",
    assignedToId: designer.id,
    totalPrice: 1500000,
    advanceAmount: 1000000,
    remainingAmount: 500000,
    paymentStatus: "pending",
    orderNumber: await storage.generateOrderNumber(),
    createdById: admin.id,
  }, [{ serviceType: "ATS CV", quantity: 1, instructions: "Professional CV for Tech industry" }]);

  await storage.createOrder({
    clientName: "John Doe",
    clientPhone: "+92 333 9876543",
    status: "new",
    priority: "high",
    totalPrice: 2000000,
    advanceAmount: 0,
    remainingAmount: 2000000,
    paymentStatus: "pending",
    orderNumber: await storage.generateOrderNumber(),
    createdById: support.id,
  }, [{ serviceType: "LinkedIn Profile", quantity: 1, instructions: "Full profile revamp" }]);

  console.log("Database seeded!");
}
