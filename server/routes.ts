import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api, errorSchemas } from "@shared/routes";
import { z } from "zod";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { type User, userRoles } from "@shared/schema";
import { db, pool } from "./db";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import multer from "multer";
import path from "path";
import fs from "fs";
import { ObjectStorageService, registerObjectStorageRoutes, objectStorageServiceInstance } from "./replit_integrations/object_storage";
import sharp from "sharp";
import { isCloudinaryConfigured, uploadToCloudinary } from "./cloudinary";

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
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  app.post(api.auth.login.path, passport.authenticate("local"), (req, res) => {
    res.json(req.user);
  });

  app.post(api.auth.logout.path, (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.json({ message: "Logged out" });
    });
  });

  app.get(api.auth.me.path, (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(req.user);
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

  app.get(api.users.list.path, requireAuth, async (req, res) => {
    const users = await storage.getUsers();
    res.json(users);
  });

  app.post(api.users.create.path, requireRole(["admin"]), async (req, res) => {
    try {
      const input = api.users.create.input.parse(req.body);
      const hashedPassword = await hashPassword(input.password);
      const user = await storage.createUser({ ...input, password: hashedPassword });
      res.status(201).json(user);
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
      
      if (updates.password) {
        updates.password = await hashPassword(updates.password);
      }
      
      const updatedUser = await storage.updateUser(userId, updates);
      res.json(updatedUser);
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
      
      res.json(updatedUser);
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
      totalPrice: user.role === 'admin' ? o.totalPrice : undefined,
      advanceAmount: (user.role === 'admin' || (user.role === 'designer' && o.assignedToId === user.id)) ? o.advanceAmount : undefined,
      remainingAmount: (user.role === 'admin' || (user.role === 'designer' && o.assignedToId === user.id)) ? o.remainingAmount : undefined,
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
        assignedToId: z.number().int().positive().optional().nullable(),
        paymentStatus: z.enum(["pending", "paid"]).optional(),
        totalPrice: z.number().int().optional(),
        amountPaid: z.number().int().optional(),
        packageType: z.enum(["starter", "professional", "executive", "custom"]).optional().nullable(),
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
        // Admin orders are auto-approved — no screenshot upload required
        const orderNumber = await storage.generateOrderNumber();
        const order = await storage.createOrder({
          ...orderData,
          totalPrice: totalPrice,
          advanceAmount: 0,
          remainingAmount: totalPrice,
          paymentStatus: "pending",
          assignedToId: intendedDesignerId || null,
          intendedDesignerId: intendedDesignerId || null,
          advancePaymentStatus: "approved",
          orderNumber,
          createdById: user.id,
          status: "new",
        }, services || []);

        // Notify all OTHER admins (not the one who placed it)
        const admins = await storage.getAdmins();
        for (const admin of admins) {
          if (admin.id !== user.id) {
            await storage.createNotification(admin.id, "order", `New order: ${orderData.clientName} — #${orderNumber}`, order.id, "order");
          }
        }

        // Notify assigned designer
        if (intendedDesignerId) {
          await storage.createNotification(intendedDesignerId, "assignment", `New order assigned: ${orderNumber}`, order.id, "order");
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

      // Notify admins of a new payment request (not "order placed" — no order exists yet)
      const admins = await storage.getAdmins();
      for (const admin of admins) {
        await storage.createNotification(admin.id, "payment", `Payment request: ${orderData.clientName}`, order.id, "order");
      }

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
    if (user.role === 'support' && order.createdById !== user.id) {
      return res.sendStatus(403);
    }

    const sanitized = {
      ...order,
      totalPrice: user.role === 'admin' ? order.totalPrice : undefined,
      advanceAmount: (user.role === 'admin' || user.role === 'designer') ? order.advanceAmount : undefined,
      remainingAmount: (user.role === 'admin' || user.role === 'designer') ? order.remainingAmount : undefined,
    };

    res.json(sanitized);
  });

  app.patch(api.orders.update.path, requireAuth, async (req, res) => {
    const orderId = Number(req.params.id);
    const updates = { ...req.body };
    const user = req.user as User;
    
    const existingOrder = await storage.getOrder(orderId);
    if (!existingOrder) return res.sendStatus(404);

    if (user.role === 'support' && existingOrder.createdById !== user.id) {
      return res.sendStatus(403);
    }

    if (user.role === 'support' && updates.assignedToId) {
      const assignments = await storage.getDesignerAssignments(user.id);
      const assignedDesignerIds = assignments.map(a => a.designerUserId);
      if (!assignedDesignerIds.includes(updates.assignedToId)) {
        return res.status(403).json({ message: "You can only assign to your designated designers" });
      }
    }

    if (user.role === 'designer') {
      if (existingOrder.assignedToId !== user.id) return res.sendStatus(403);
      
      const allowedUpdates = ['status', 'paymentStatus'];
      const keys = Object.keys(updates);
      if (keys.some(k => !allowedUpdates.includes(k))) return res.sendStatus(403);
      
      if (updates.status && updates.status === 'canceled') {
        return res.status(403).json({ message: "Designers cannot cancel orders" });
      }

      // Anti-gaming: once an order is ready or delivered, designer cannot change its status
      if (updates.status && (existingOrder.status === 'ready' || existingOrder.status === 'delivered')) {
        return res.status(403).json({ message: "Order status is locked once completed" });
      }
    }
    
    if (updates.status === 'ready' && existingOrder.status !== 'ready') {
      updates.readyDate = new Date();
    }

    if (updates.paymentStatus === 'paid' && existingOrder.paymentStatus === 'pending') {
      const currentAdvance = existingOrder.advanceAmount || 0;
      const currentRemaining = existingOrder.remainingAmount || 0;
      updates.advanceAmount = currentAdvance + currentRemaining;
      updates.remainingAmount = 0;
    }

    const updatedOrder = await storage.updateOrder(orderId, updates);

    res.json(updatedOrder);
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
    const notif = await storage.markNotificationRead(Number(req.params.id));
    res.json(notif);
  });

  app.get(api.stats.dashboard.path, requireAuth, async (req, res) => {
    const stats = await storage.getStats();
    const user = req.user as User;

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
    const verifications = await storage.getPaymentVerifications("admin", 0);
    const pendingCount = verifications.filter(v => v.status === 'pending_confirmation').length;
    res.json({ count: pendingCount });
  });
  
  app.get("/api/payment-verifications", requireAuth, async (req, res) => {
    const user = req.user as User;
    const verifications = await storage.getPaymentVerifications(user.role, user.id);
    
    const orders = await storage.getOrders(user.role, user.id);
    const result = verifications.map(v => {
      const order = orders.find(o => o.id === v.orderId);
      const sanitizedOrder = order ? (user.role === 'admin' ? {
        orderNumber: order.orderNumber,
        clientName: order.clientName,
        totalPrice: order.totalPrice,
      } : {
        orderNumber: order.orderNumber,
        clientName: order.clientName,
      }) : null;
      return {
        ...v,
        order: sanitizedOrder,
      };
    });
    
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
    res.json(verifications);
  });

  app.post("/api/payment-verifications", requireAuth, upload.single('screenshot'), async (req, res) => {
    try {
      const user = req.user as User;
      const { orderId, paymentType, amount } = req.body;
      
      if (!orderId) return res.status(400).json({ error: "Order ID is required" });
      
      const order = await storage.getOrder(Number(orderId));
      if (!order) return res.status(400).json({ error: "Order not found" });
      
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

      const admins = await storage.getAdmins();
      const paymentLabel = paymentType === "advance" ? "advance" : paymentType === "remaining" ? "remaining" : "full";
      for (const admin of admins) {
        await storage.createNotification(
          admin.id,
          "payment",
          `Payment verification request: ${order.clientName} — ${paymentLabel} payment`,
          verification.id,
          "payment_verification"
        );
      }
      
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
    
    await storage.updatePaymentVerification(verificationId, {
      status: "approved",
      reviewedById: user.id,
      reviewedAt: new Date(),
      notes,
    });
    
    const order = await storage.getOrder(verification.orderId);
    if (!order) return res.sendStatus(404);
    
    const currentAdvance = order.advanceAmount || 0;
    const currentRemaining = order.remainingAmount || 0;
    
    if (verification.paymentType === 'advance') {
      const orderNumber = await storage.generateOrderNumber();
      
      const newAdvance = currentAdvance + verification.amount;
      const newRemaining = Math.max(0, (order.totalPrice || 0) - newAdvance);
      await storage.updateOrder(order.id, {
        orderNumber,
        advanceAmount: newAdvance,
        remainingAmount: newRemaining,
        paymentStatus: newRemaining === 0 ? "paid" : "pending",
        advancePaymentStatus: "approved",
        assignedToId: order.intendedDesignerId,
        status: "new",
      });
      
      if (order.intendedDesignerId) {
        await storage.createNotification(order.intendedDesignerId, "assignment", `New order assigned: ${orderNumber}`, order.id, "order");
      }

      // Notify all other admins (not the one who approved)
      const approvalAdmins = await storage.getAdmins();
      for (const admin of approvalAdmins) {
        if (admin.id !== user.id) {
          await storage.createNotification(admin.id, "order", `Order approved: ${order.clientName} — #${orderNumber}`, order.id, "order");
        }
      }
    } else if (verification.paymentType === 'full') {
      const orderNumber = await storage.generateOrderNumber();
      
      await storage.updateOrder(order.id, {
        orderNumber,
        advanceAmount: order.totalPrice,
        remainingAmount: 0,
        paymentStatus: "paid",
        advancePaymentStatus: "approved",
        assignedToId: order.intendedDesignerId,
        status: "new",
      });
      
      if (order.intendedDesignerId) {
        await storage.createNotification(order.intendedDesignerId, "assignment", `New order assigned: ${orderNumber}`, order.id, "order");
      }

      // Notify all other admins (not the one who approved)
      const approvalAdmins = await storage.getAdmins();
      for (const admin of approvalAdmins) {
        if (admin.id !== user.id) {
          await storage.createNotification(admin.id, "order", `Order approved: ${order.clientName} — #${orderNumber}`, order.id, "order");
        }
      }
    } else if (verification.paymentType === 'remaining') {
      const newRemaining = Math.max(0, currentRemaining - verification.amount);
      const isFullyPaid = newRemaining <= 0;

      await storage.updateOrder(order.id, {
        advanceAmount: currentAdvance + verification.amount,
        remainingAmount: newRemaining,
        paymentStatus: isFullyPaid ? "paid" : "pending",
        ...(isFullyPaid ? { status: "delivered" } : {}),
      });
    }
    
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
    
    if (verification.paymentType !== 'remaining') {
      const order = await storage.getOrder(verification.orderId);
      if (order) {
        await storage.updateOrder(order.id, {
          advancePaymentStatus: "disapproved",
          status: "canceled",
        });
      }
    }
    
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
      "Professional CV",
      "Europass CV",
      "LinkedIn Profile",
      "Cover Letter (Professional)",
      "Cover Letter (Europass)",
    ];
    for (let i = 0; i < defaultServices.length; i++) {
      await storage.createServiceCatalogItem({ name: defaultServices[i], isActive: true, sortOrder: i });
    }
  }

  const existingPackages = await storage.getPackageConfigs();
  if (existingPackages.length === 0) {
    const defaultPackages = [
      { key: "starter", label: "Starter", sortOrder: 0 },
      { key: "professional", label: "Professional", sortOrder: 1 },
      { key: "executive", label: "Executive", sortOrder: 2 },
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
