/** Payment verifications (paginated list, submit, approve, disapprove) and payment files. */
import type { Express } from "express";
import { storage } from "../storage";
import { dueAtForNewOrder } from "../orderProcess";
import { type User, orders, paymentVerifications, activityLogs } from "@shared/schema";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { isCloudinaryConfigured } from "../cloudinary";
import { claimCrmPurchaseTx, queuePurchase, txQueryOf } from "../lib/metaCapi";
import { emitRealtime } from "../sse";
import { getPaymentApprovalConflict } from "@shared/order-accounting";
import { logAudit } from "../security/audit";
import { uploadPrivateImage } from "../files";
import { listPayments, getPaymentForUser, paymentListQuerySchema } from "../paymentList";
import { dispatchNotification, dispatchNotifications, safeUserSummary, requireAuth, requireRole, canAccessOrder } from "./shared";

export function registerPaymentRoutes(app: Express) {
  // Configure multer for payment screenshot uploads — memory storage so sharp can process in-memory
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"].includes(file.mimetype)) {
        return cb(new Error("Only image files are allowed"));
      }
      cb(null, true);
    },
  });

  app.get("/api/payment-verifications/pending-count", requireRole(["admin"]), async (req, res) => {
    res.json({ count: await storage.getPendingPaymentCount() });
  });

  // Paginated + filtered in SQL (50/page).
  const projectPayment = (user: User, usersById: Map<number, User>, row: { pv: any; order: { orderNumber: string | null; clientName: string | null; totalPrice: number | null; orderId: number | null } | null }) => ({
    ...row.pv,
    screenshotData: null,
    submittedBy: safeUserSummary(usersById.get(row.pv.submittedById)),
    reviewedBy: safeUserSummary(row.pv.reviewedById ? usersById.get(row.pv.reviewedById) : null),
    order: row.order?.orderId ? {
      orderNumber: row.order.orderNumber,
      clientName: row.order.clientName,
      totalPrice: (user.role === "admin" || user.role === "support") ? row.order.totalPrice : undefined,
    } : null,
  });
  app.get("/api/payment-verifications", requireAuth, async (req, res) => {
    const user = req.user as User;
    const q = paymentListQuerySchema.parse(req.query);
    const [result, allUsers] = await Promise.all([listPayments(user, q), storage.getUsers()]);
    const usersById = new Map(allUsers.map(u => [u.id, u]));
    res.json({ ...result, rows: result.rows.map(r => projectPayment(user, usersById, r)) });
  });

  app.get("/api/payment-verifications/:id", requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.sendStatus(404);
    const user = req.user as User;
    const [row, allUsers] = await Promise.all([getPaymentForUser(user, id), storage.getUsers()]);
    if (!row) return res.sendStatus(404);
    res.json(projectPayment(user, new Map(allUsers.map(u => [u.id, u])), row));
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
        let compressed: Buffer;
        try {
          compressed = await sharp(file.buffer, { limitInputPixels: 60_000_000 })
            .rotate()
            .resize({ width: 1000, withoutEnlargement: true })
            .jpeg({ quality: 70 })
            .toBuffer();
        } catch {
          return res.status(400).json({ error: "That file is not a valid image." });
        }

        let cloudinarySuccess = false;

        if (isCloudinaryConfigured()) {
          try {
            screenshotUrl = await uploadPrivateImage(compressed, { kind: "payment", folder: "pixelcrm/payments", uploadedById: user.id, orderId: Number(orderId) });
            screenshotData = null;
            screenshotMimeType = null;
            cloudinarySuccess = true;
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

      if (order.status !== 'pending_payment') {
        try {
          const admins = await storage.getAdmins();
          await dispatchNotifications(
            admins.map(a => a.id),
             {
               event: "payment_verification_requested",
               type: "payment",
               title: "Payment Verification Required",
               message: "New payment verification request received. Review payment details.",
               priority: "action_required",
               relatedId: verification.id,
               relatedType: "payment_verification",
               sourceEventId: verification.id,
             },
          );
        } catch (notificationError) {
          console.error("[payment] request notification failed after commit:", notificationError);
        }
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
    if (!Number.isInteger(verificationId) || verificationId <= 0) {
      return res.status(400).json({ error: "Invalid payment id" });
    }
    const notes = typeof req.body?.notes === "string" ? req.body.notes : undefined;
    try {
    const verification = await storage.getPaymentVerification(verificationId);
    if (!verification) return res.status(404).json({ error: "Payment not found. It may have been removed - reload the page." });
    if (verification.status !== "pending_confirmation") {
      return res.status(409).json({ error: `This payment is already ${verification.status}` });
    }
    const order = await storage.getOrder(verification.orderId);
    if (!order) return res.status(404).json({ error: "The order for this payment no longer exists." });
    if (order.status === "canceled") {
      return res.status(409).json({ error: "Canceled orders cannot receive approved payments" });
    }

    const approval = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`);
      const [lockedOrder] = await tx.select().from(orders).where(eq(orders.id, order.id));
      if (!lockedOrder) {
        throw new Error("ORDER_CANCELED_DURING_APPROVAL");
      }
      // Allocated inside the transaction (advisory-locked) so two approvals
      // running at the same time can never get the same order number.
      const orderNumber = verification.paymentType === "advance" || verification.paymentType === "full"
        ? (lockedOrder.orderNumber || await storage.generateOrderNumber(tx))
        : lockedOrder.orderNumber;
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
      // Phase 2: a verified first payment confirms the order; the due date starts now.
      const confirm = {
        workStatus: "confirmed" as const,
        dueAt: lockedOrder.dueAt ?? await dueAtForNewOrder(lockedOrder.packageType, lockedOrder.orderType),
      };
      const orderUpdates = verification.paymentType === "advance" ? {
        ...confirm,
        orderNumber,
        advanceAmount: currentAdvance + verification.amount,
        remainingAmount: newRemaining,
        paymentStatus: isFullyPaid ? "paid" : "pending",
        advancePaymentStatus: "approved" as const,
        assignedToId: lockedOrder.intendedDesignerId,
        status: "new" as const,
        paymentDate: new Date(),
      } : verification.paymentType === "full" ? {
        ...confirm,
        orderNumber,
        advanceAmount: lockedOrder.totalPrice,
        remainingAmount: 0,
        paymentStatus: "paid",
        advancePaymentStatus: "approved" as const,
        assignedToId: lockedOrder.intendedDesignerId,
        status: "new" as const,
        paymentDate: new Date(),
      } : {
        advanceAmount: currentAdvance + verification.amount,
        remainingAmount: newRemaining,
        paymentStatus: isFullyPaid ? "paid" : "pending",
        ...(isFullyPaid ? { status: "delivered" as const, workStatus: "delivered" as const, deliveredAt: new Date(), paymentDate: new Date() } : {}),
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
      // First payment on this order → Meta Purchase (claimed once; sent after commit).
      const metaPayload = (lockedOrder.advanceAmount || 0) === 0
        ? await claimCrmPurchaseTx(txQueryOf(tx), order.id, verification.amount, new Date())
        : null;
      return { approvedVerification, updatedOrder, newRemaining, isFullyPaid, metaPayload };
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
    if (approval.metaPayload) queuePurchase({ crmOrderId: order.id }, approval.metaPayload);

    if (verification.paymentType === "advance" || verification.paymentType === "full") {
      try {
        const approvalAdmins = await storage.getAdmins();
        await dispatchNotifications(
          approvalAdmins.map(admin => admin.id),
          {
            event: "order_approved",
            type: "order",
            title: "Order Approved",
            message: "Order request approved. Review the order details.",
            priority: "confirmation",
            relatedId: order.id,
            relatedType: "order",
            sourceEventId: verification.id,
          },
          [user.id],
        );
        if (order.createdById) {
          await dispatchNotification({
            event: "order_approved",
            recipientId: order.createdById,
            recipientRole: "support",
            type: "order",
            title: "Order Approved",
            message: "Your order request has been approved.",
            priority: "confirmation",
            relatedId: order.id,
            relatedType: "order",
            sourceEventId: verification.id,
          });
        }
        const assignedDesignerId = order.assignedToId || order.intendedDesignerId;
        if (assignedDesignerId) {
          await dispatchNotification({
            event: "order_approved",
            recipientId: assignedDesignerId,
            recipientRole: "designer",
            type: "order",
            title: "Order Approved",
            message: "Your assigned order has been approved and production can start.",
            priority: "confirmation",
            relatedId: order.id,
            relatedType: "order",
            sourceEventId: verification.id,
          });
        }
      } catch (notificationError) {
        console.error("[payment] approval notification failed after commit:", notificationError);
      }
    }
    emitRealtime(user.id, ["payments", "orders", "stats"]);

    void logAudit({ action: "payment_approved", actor: user, targetType: "payment_verification", targetId: verificationId, details: { orderId: verification.orderId, amount: verification.amount, paymentType: verification.paymentType }, req });
    res.json({ ...verification, ...approval.approvedVerification });
    } catch (error: any) {
      // The transaction rolled back - nothing was half-saved.
      console.error(`[payment-approve] id=${verificationId} admin=${user.id} failed: ${error?.code ? `[${error.code}] ` : ""}${error?.message || error}`);
      const message = error?.code === "23505"
        ? "Another approval happened at the same moment. Nothing was saved - please try again."
        : "Approval failed on the server. Nothing was saved - please try again.";
      if (!res.headersSent) res.status(error?.code === "23505" ? 409 : 500).json({ error: message });
    }
  });

  app.patch("/api/payment-verifications/:id/disapprove", requireAuth, async (req, res) => {
    const user = req.user as User;
    if (user.role !== 'admin') {
      return res.status(403).json({ error: "Only admin can disapprove payments" });
    }

    const verificationId = Number(req.params.id);
    if (!Number.isInteger(verificationId) || verificationId <= 0) {
      return res.status(400).json({ error: "Invalid payment id" });
    }
    const notes = typeof req.body?.notes === "string" ? req.body.notes : undefined;

    let verification: Awaited<ReturnType<typeof storage.getPaymentVerification>>;
    let rejectedOrder: Awaited<ReturnType<typeof storage.getOrder>>;
    try {
      verification = await storage.getPaymentVerification(verificationId);
      if (!verification) return res.status(404).json({ error: "Payment not found. It may have been removed - reload the page." });
      if (verification.status !== "pending_confirmation") {
        return res.status(409).json({ error: `This payment is already ${verification.status}` });
      }
      const pv = verification;
      const outcome = await db.transaction(async tx => {
        await tx.execute(sql`SELECT id FROM orders WHERE id = ${pv.orderId} FOR UPDATE`);
        const [updated] = await tx.update(paymentVerifications).set({
          status: "disapproved",
          reviewedById: user.id,
          reviewedAt: new Date(),
          notes,
        }).where(and(
          eq(paymentVerifications.id, verificationId),
          eq(paymentVerifications.status, "pending_confirmation"),
        )).returning({ id: paymentVerifications.id });
        if (!updated) return "changed" as const;
        await tx.insert(activityLogs).values({
          orderId: pv.orderId, actorId: user.id, activityType: "payment_change",
          previousValue: "pending_confirmation", newValue: "disapproved",
          details: { paymentVerificationId: verificationId, paymentType: pv.paymentType, amount: pv.amount },
        });
        if (pv.paymentType !== "remaining") {
          // Keep as pending_payment (not canceled) so it stays hidden from Orders page.
          // Only orders still waiting for this first payment are touched.
          await tx.update(orders).set({
            advancePaymentStatus: "disapproved",
            status: "pending_payment",
          }).where(and(eq(orders.id, pv.orderId), eq(orders.status, "pending_payment")));
        }
        return "ok" as const;
      });
      if (outcome === "changed") {
        return res.status(409).json({ error: "This payment was already reviewed by someone else. Reload the page." });
      }
      rejectedOrder = await storage.getOrder(verification.orderId);
    } catch (error: any) {
      console.error(`[payment-disapprove] id=${verificationId} admin=${user.id} failed: ${error?.message || error}`);
      return res.status(500).json({ error: "Disapproval failed on the server. Nothing was saved - please try again." });
    }

    if (rejectedOrder && rejectedOrder.createdById) {
      try {
        await dispatchNotification({
          event: "order_disapproved",
          recipientId: rejectedOrder.createdById,
          recipientRole: "support",
          type: "order",
          title: "Order Disapproved",
          message: "Your order request was not approved. Please review the details.",
          priority: "action_required",
          relatedId: rejectedOrder.id,
          relatedType: "order",
          sourceEventId: verification.id,
        });
      } catch (notificationError) {
        console.error("[payment] disapproval notification failed after commit:", notificationError);
      }
    }
    emitRealtime(user.id, ["payments", "orders", "stats"]);

    void logAudit({ action: "payment_disapproved", actor: user, targetType: "payment_verification", targetId: verificationId, details: { orderId: verification.orderId, amount: verification.amount, paymentType: verification.paymentType }, req });
    res.json({ ...verification, status: "disapproved", reviewedById: user.id, reviewedAt: new Date(), notes });
  });


  app.get('/api/payment-files/db/:filename', requireAuth, async (req, res) => {
    try {
      const screenshotUrl = `/api/payment-files/db/${req.params.filename}`;
      const verification = await storage.getPaymentVerificationByScreenshotUrl(screenshotUrl);
      if (verification && !(await canAccessOrder(req.user as User, verification.orderId))) return res.sendStatus(403);
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

  // Legacy local payment files: only admins (no DB row links these files to an order).
  app.get('/api/payment-files/:filename', requireRole(["admin"]), async (req, res) => {
    const filename = String(req.params.filename || "");
    const sanitized = path.basename(filename);
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(sanitized)) return res.sendStatus(400);

    const localFilePath = path.join(process.cwd(), 'uploads', sanitized);
    if (fs.existsSync(localFilePath)) {
      return res.sendFile(localFilePath);
    }

    return res.sendStatus(404);
  });
}
