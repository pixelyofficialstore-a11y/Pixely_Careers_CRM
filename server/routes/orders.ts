/** Orders: paginated list, lookup, create, update, cancel and the case report. */
import type { Express } from "express";
import { storage } from "../storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { type User } from "@shared/schema";
import { db } from "../db";
import { placeApprovedOrderTx } from "../orderCreation";
import { claimCrmPurchaseTx, queuePurchase, retryPurchase, txQueryOf } from "../lib/metaCapi";
import { logAudit } from "../security/audit";
import { getOrdersSummary } from "../metrics";
import { listOrders, lookupOrders, findOrderRef, orderListQuerySchema, orderLookupQuerySchema, ORDER_STATUS_FILTERS } from "../orderList";
import { canAccessOrderCase, projectCaseActivity, type CaseRole } from "@shared/case-access";
import { dispatchNotifications, safeUser, safeUserSummary, requireAuth, requireRole, notifyAdminPlacedOrder, canAccessOrder } from "./shared";
import { feedbackProjection } from "./feedback";
import { withProcess, dueAtForNewOrder } from "../orderProcess";
import { refunds, orders as ordersTable, activityLogs as activityLogsTable } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { WORK_TO_LEGACY, LEGACY_TO_WORK, SETTABLE_WORK_STATUSES, WORK_STATUS_LABELS, storedOrMappedWorkStatus, type WorkStatus } from "@shared/order-process";
import { rsFromPaisa, shortName } from "@shared/notification-events";
import { packageLabel } from "../lib/metaCapi";
import { notifyDelivered, notifyOrderAssigned, notifyRevisionRequested } from "../orderNotifications";

export function registerOrderRoutes(app: Express) {
  const sanitizeOrderForRole = <T extends { totalPrice?: number | null; advanceAmount?: number | null; remainingAmount?: number | null; assignee?: any }>(o: T, role: string) => ({
    ...o,
    assignee: safeUser(o.assignee),
    totalPrice: (role === 'admin' || role === 'support') ? o.totalPrice : undefined,
    advanceAmount: (role === 'admin' || role === 'support' || role === 'designer') ? o.advanceAmount : undefined,
    remainingAmount: (role === 'admin' || role === 'support' || role === 'designer') ? o.remainingAmount : undefined,
  });

  // Paginated, filtered in SQL (50 per page). Never returns every order.
  app.get(api.orders.list.path, requireAuth, async (req, res) => {
    const user = req.user as User;
    const q = orderListQuerySchema.parse(req.query);
    const usersById = new Map((await storage.getUsers()).map(u => [u.id, u]));
    const result = await listOrders(user, q, usersById);
    const rows = await withProcess(result.rows, user.role);
    res.json({ ...result, rows: rows.map(o => sanitizeOrderForRole(o, user.role)) });
  });

  // Small search for order pickers (complaints, feedback, payments).
  app.get("/api/orders/lookup", requireAuth, async (req, res) => {
    const user = req.user as User;
    res.json(await lookupOrders(user, orderLookupQuerySchema.parse(req.query)));
  });

  // Deep links: /orders?order=PX-2611-001 -> the full order.
  app.get("/api/orders/ref/:ref", requireAuth, async (req, res) => {
    const user = req.user as User;
    const ref = String(req.params.ref || "").slice(0, 40);
    const id = await findOrderRef(user, ref);
    if (!id) return res.status(404).json({ message: "Order not found." });
    const order = await storage.getOrder(id);
    if (!order) return res.status(404).json({ message: "Order not found." });
    const [withP] = await withProcess([order], user.role);
    res.json(sanitizeOrderForRole(withP, user.role));
  });

  // Orders page summary cards (admin): month + today, same filters as the list.
  app.get("/api/orders/summary", requireRole(["admin"]), async (req, res) => {
    const user = req.user as User;
    const q = z.object({
      year: z.coerce.number().int().min(2020).max(2100),
      month: z.coerce.number().int().min(1).max(12),
      status: z.enum(["pending", "working", "ready", "delivered", "canceled"]).optional(),
      designerId: z.coerce.number().int().positive().optional(),
      orderType: z.enum(["documentation", "resume_distribution", "portfolio_website"]).optional(),
    }).strict().parse(req.query);
    res.json(await getOrdersSummary(user, { year: q.year, month: q.month, status: q.status ? ORDER_STATUS_FILTERS[q.status] : undefined, designerId: q.designerId, orderType: q.orderType }));
  });

  app.post(api.orders.create.path, requireRole(["admin", "support"]), async (req, res) => {
    try {
      const { services: rawServices, ...orderData } = req.body;

      const orderType = orderData.orderType || "documentation";

      if (orderType === "documentation" && (!rawServices || !Array.isArray(rawServices) || rawServices.length === 0)) {
        return res.status(400).json({ message: "At least one service is required" });
      }

      const serviceSchema = z.object({
        serviceType: z.string().min(1, "Service type is required"),
        quantity: z.number().int().min(1, "Quantity must be at least 1"),
        instructions: z.string().nullable().optional(),
      });

      if (rawServices && Array.isArray(rawServices)) {
        for (const service of rawServices) {
          serviceSchema.parse(service);
        }
      }

      // Portfolio Website / Resume Distribution orders don't ask the user to pick
      // services — they get one fixed synthetic service so the Order still uses
      // the normal services/deliverables architecture.
      const services = orderType === "portfolio_website"
        ? [{ serviceType: "Website", quantity: 1, instructions: null }]
        : orderType === "resume_distribution"
        ? [{ serviceType: "Distribution Service", quantity: 1, instructions: null }]
        : rawServices;

      const orderSchema = z.object({
        clientName: z.string().min(1, "Client name is required"),
        clientPhone: z.string().min(1, "Phone number is required"),
        clientEmail: z.string().email().optional().nullable(),
        clientType: z.enum(["national", "international"]),
        orderType: z.enum(["documentation", "resume_distribution", "portfolio_website"]).optional(),
        assignedToId: z.number().int().positive().optional().nullable(),
        paymentStatus: z.enum(["pending", "paid"]).optional(),
        totalPrice: z.number().int().optional(),
        advanceAmount: z.number().int().min(0).optional(),
        amountPaid: z.number().int().optional(),
        packageType: z.string().optional().nullable(),
        numberOfRevisions: z.number().int().min(1).max(5).optional().nullable(),
        supportPeriod: z.enum(["15_days", "1_month", "2_months", "3_months", "4_months", "5_months", "6_months"]).optional().nullable(),
        platform: z.string().optional().nullable(),
        campaign: z.string().optional().nullable(),
        adSet: z.string().optional().nullable(),
        creative: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      });

      const parsedOrder: Record<string, any> = orderSchema.parse(orderData);

      const user = req.user as User;

      const intendedDesignerId = parsedOrder.assignedToId;
      const totalPrice = parsedOrder.totalPrice || 0;
      // Only validated fields reach the database (process/meta/refund columns are server-owned).
      const { amountPaid: _amountPaid, ...validFields } = parsedOrder;
      // Remaining revisions starts equal to the purchased allowance.
      validFields.remainingRevisions = parsedOrder.numberOfRevisions ?? null;

      if (user.role === 'admin') {
        // Admin orders are auto-approved — advance is collected immediately, no screenshot needed.
        // Same function as Website Requests "Verify & place order"; one transaction.
        const { assignedToId: _ignored, ...orderFields } = validFields;
        const { order, metaPayload } = await db.transaction(async tx => {
          const order = await placeApprovedOrderTx(tx, {
            order: { ...(orderFields as any), totalPrice, advanceAmount: parsedOrder.advanceAmount || 0 },
            services: services || [],
            designerId: intendedDesignerId || null,
            actorId: user.id,
          });
          // First payment recorded on a manual (WhatsApp) order → Meta Purchase, claimed once.
          const metaPayload = await claimCrmPurchaseTx(txQueryOf(tx), order.id, order.advanceAmount || 0, new Date());
          return { order, metaPayload };
        });
        if (metaPayload) queuePurchase({ crmOrderId: order.id }, metaPayload);
        await notifyAdminPlacedOrder(order, user.id);
        return res.status(201).json(order);
      }

      // Non-admin: order goes through payment verification flow
      const order = await storage.createOrder({
        ...(validFields as any),
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
        // Phase 2: a Request until a payment is verified or an admin approves pay later.
        workStatus: "request",
      }, services || []);
      await storage.createActivityLog({ orderId: order.id, actorId: user.id, activityType: "order_created", newValue: "pending_payment" });

      const admins = await storage.getAdmins();
      await dispatchNotifications(
        admins.map(a => a.id),
        {
          event: "payment_verification_requested",
          type: "payment",
          title: "💳 Verify payment",
          message: [rsFromPaisa(order.advanceAmount), packageLabel(order.packageType), shortName(order.clientName)].filter(Boolean).join(" · "),
          priority: "action_required",
          relatedId: order.id,
          relatedType: "order",
          sourceEventId: order.id,
        },
      );

      res.status(201).json(order);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.issues[0].message });
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
    const [withP] = await withProcess([order], user.role);
    const sanitized = {
      ...withP,
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
  const userSummary = safeUserSummary;
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
  app.patch(api.orders.update.path, requireAuth, async (req, res) => {
    const orderId = Number(req.params.id);
    const updates = { ...req.body };
    // Meta Purchase tracking and pay-later approval are server-owned.
    delete updates.metaEventId; delete updates.metaStatus; delete updates.metaPurchaseSentAt;
    delete updates.payLaterApprovedById; delete updates.payLaterApprovedAt;
    delete updates.process;
    const user = req.user as User;

    const existingOrder = await storage.getOrder(orderId);
    if (!existingOrder) return res.sendStatus(404);

    // Phase 2: the work status drives the old status (kept in sync for every existing rule).
    let requestedWork: WorkStatus | undefined;
    if ("workStatus" in updates) {
      const ws = updates.workStatus;
      if (!SETTABLE_WORK_STATUSES.includes(ws)) {
        return res.status(400).json({ message: "Invalid work status" });
      }
      requestedWork = ws as WorkStatus;
      const legacy = WORK_TO_LEGACY[requestedWork];
      if (updates.status && updates.status !== legacy) {
        return res.status(400).json({ message: "Status and work status don't match" });
      }
      delete updates.workStatus;
      updates.status = legacy;
    }
    // Only admins may change the due date.
    if ("dueAt" in updates) {
      if (user.role !== "admin") return res.status(403).json({ message: "Only admins can change the due date" });
      const due = updates.dueAt === null ? null : new Date(updates.dueAt);
      if (due && Number.isNaN(due.getTime())) return res.status(400).json({ message: "Invalid due date" });
      updates.dueAt = due;
    }
    // A Request is confirmed only by a verified payment or an admin approving pay later.
    if (updates.status && existingOrder.status === "pending_payment" && updates.status !== "pending_payment" && updates.status !== "canceled") {
      return res.status(409).json({ message: "This order is still a Request. Verify a payment or use Approve pay later to confirm it." });
    }
    if (updates.status === "pending_payment" && existingOrder.status !== "pending_payment") {
      return res.status(400).json({ message: "A confirmed order can't go back to Request" });
    }
    if (updates.status === "canceled" && existingOrder.status !== "canceled") {
      return res.status(400).json({ message: "Use Cancel order to cancel (it records the reason and any refund)" });
    }

    if ("clientType" in updates && !["national", "international"].includes(updates.clientType)) {
      return res.status(400).json({ message: "Client type must be national or international" });
    }

    // Services are stored in a separate table; preserve their presence for role checks.
    const hasIncomingServices = 'services' in updates;
    const incomingServices = Array.isArray(updates.services) ? updates.services : undefined;
    delete updates.services;

    const oldAssignedToId = existingOrder.assignedToId;

    if ("remainingRevisions" in updates && updates.remainingRevisions !== null) {
      const remaining = Number(updates.remainingRevisions);
      const originalLimit = existingOrder.numberOfRevisions;
      const maxAllowed = originalLimit != null ? originalLimit : 5;
      if (!Number.isInteger(remaining) || remaining < 0 || remaining > maxAllowed) {
        return res.status(400).json({ message: `Remaining revisions must be between 0 and ${maxAllowed}` });
      }
    }

    if (user.role === 'support') {
      // Support can create and monitor orders, but cannot change client, package,
      // pricing, payment, or other order-detail fields after creation.
      const allowedUpdates = ['status', 'assignedToId', 'remainingRevisions'];
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

      const allowedUpdates = ['status', 'remainingRevisions'];
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
        // Draft sent <-> Revisions stays within the old "ready" status.
        if (updates.status !== 'delivered' && updates.status !== 'ready') {
          return res.status(403).json({ message: "Order status is locked once completed" });
        }
        const remaining = existingOrder.remainingAmount || 0;
        if (updates.status === 'delivered' && remaining > 0) {
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

    // Phase 2 rule: Delivered only when fully paid (every role; an admin can mark it paid in the same save).
    if (updates.status === 'delivered' && existingOrder.status !== 'delivered') {
      const remainingAfter = Number(updates.remainingAmount ?? existingOrder.remainingAmount ?? 0) || 0;
      if (remainingAfter > 0) {
        return res.status(409).json({ message: "Cannot mark as Delivered: the order isn't fully paid yet. Collect the remaining balance first." });
      }
    }

    // Store the work status whenever the status is set (new data only; old rows map in code).
    const previousWork = storedOrMappedWorkStatus(existingOrder);
    if (updates.status) {
      updates.workStatus = requestedWork ?? (updates.status === existingOrder.status ? previousWork : LEGACY_TO_WORK[updates.status]);
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
      await storage.createActivityLog({ orderId, actorId: user.id, activityType: "status_change", previousValue: existingOrder.status, newValue: updates.status, details: { workStatus: updates.workStatus, previousWorkStatus: previousWork } });
    } else if (updates.workStatus && updates.workStatus !== previousWork) {
      // Draft sent <-> Revisions (same old status): log the work stage change.
      await storage.createActivityLog({ orderId, actorId: user.id, activityType: "status_change", previousValue: WORK_STATUS_LABELS[previousWork], newValue: WORK_STATUS_LABELS[updates.workStatus as WorkStatus], details: { workStatus: updates.workStatus, previousWorkStatus: previousWork } });
    }

    // Phase 3 notifications (after the save; failures never undo it).
    if (updatedOrder.advancePaymentStatus === "approved") {
      if ("assignedToId" in updates && updates.assignedToId && updates.assignedToId !== oldAssignedToId) {
        void notifyOrderAssigned(updatedOrder, user.id);
      }
      if (updates.workStatus === "revisions" && previousWork !== "revisions") void notifyRevisionRequested(updatedOrder, user.id);
      if (updates.workStatus === "delivered" && previousWork !== "delivered") void notifyDelivered(updatedOrder, user.id);
    }

    // Only admins can replace an order's services (add / remove / edit quantity & instructions).
    if (incomingServices && user.role === 'admin') {
      // Replacing services deletes and reinserts rows — carry over each existing
      // service's deliverable link when its serviceType is kept, so re-saving the
      // services editor doesn't wipe out already-added deliverable links.
      const existingServices = await storage.getOrderServices(orderId);
      const linkByServiceType = new Map(existingServices.map(s => [s.serviceType, s.deliverableLink]));
      const cleanedServices = incomingServices
        .filter((s: any) => s && s.serviceType)
        .map((s: any) => ({
          serviceType: String(s.serviceType),
          quantity: Number(s.quantity) > 0 ? Number(s.quantity) : 1,
          instructions: s.instructions ? String(s.instructions) : null,
          deliverableLink: linkByServiceType.get(String(s.serviceType)) || null,
        }));
      await storage.replaceOrderServices(orderId, cleanedServices);
    }

    // Merged into cached rows on the client: send only real fields (no assignee
    // placeholder), and never the total to a designer.
    const [withP] = await withProcess([updatedOrder], user.role);
    const out: Record<string, unknown> = { ...withP };
    if (user.role === "designer") delete out.totalPrice;
    res.json(out);
  });

  // Phase 2: admin approves "pay later" for a Request → Confirmed (no payment yet).
  app.post("/api/orders/:id/approve-pay-later", requireRole(["admin"]), async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ message: "Invalid order id" });
    const input = z.object({ note: z.string().trim().max(500).optional() }).strict().parse(req.body ?? {});
    const actor = req.user as User;
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
      const [locked] = await tx.select().from(ordersTable).where(eq(ordersTable.id, orderId));
      if (!locked) return { status: 404 as const };
      if (locked.status !== "pending_payment" || locked.advancePaymentStatus === "approved") {
        return { status: 409 as const, message: "Only a Request (not yet confirmed) can be approved for pay later." };
      }
      const pending = await tx.execute(sql`SELECT 1 FROM payment_verifications WHERE order_id = ${orderId} AND status = 'pending_confirmation' LIMIT 1`);
      if (((pending as any).rows ?? pending).length) {
        return { status: 409 as const, message: "This order has a payment waiting for verification. Review that payment instead." };
      }
      const now = new Date();
      const orderNumber = locked.orderNumber || await storage.generateOrderNumber(tx);
      const [order] = await tx.update(ordersTable).set({
        orderNumber,
        status: "new",
        workStatus: "confirmed",
        advancePaymentStatus: "approved",
        assignedToId: locked.intendedDesignerId,
        payLaterApprovedById: actor.id,
        payLaterApprovedAt: now,
        dueAt: locked.dueAt ?? await dueAtForNewOrder(locked.packageType, locked.orderType, now),
      }).where(eq(ordersTable.id, orderId)).returning();
      await tx.insert(activityLogsTable).values({
        orderId, actorId: actor.id, activityType: "status_change",
        previousValue: "pending_payment", newValue: "new",
        details: { workStatus: "confirmed", previousWorkStatus: "request", payLater: true, note: input.note || null },
      });
      return { status: 200 as const, order };
    });
    if (result.status === 404) return res.sendStatus(404);
    if (result.status === 409) return res.status(409).json({ message: result.message });
    const order = result.order;
    void logAudit({ action: "order_pay_later_approved", actor, targetType: "order", targetId: orderId, details: { orderNumber: order.orderNumber, note: input.note || null }, req });
    await notifyAdminPlacedOrder(order, actor.id);
    if (order.createdById && order.createdById !== actor.id) {
      await dispatchNotifications([order.createdById], {
        event: "order_pay_later_approved",
        type: "order",
        title: "✅ Order confirmed (pay later)",
        message: [order.orderNumber, shortName(order.clientName), "approved to pay later"].filter(Boolean).join(" · "),
        priority: "update",
        relatedId: order.id,
        relatedType: "order",
        sourceEventId: `pay-later:${order.id}`,
      });
    }
    const [withP] = await withProcess([order], actor.role);
    res.json(withP);
  });

  app.patch("/api/order-services/:id", requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid service id" });

    const orderService = await storage.getOrderService(id);
    if (!orderService) return res.sendStatus(404);

    const user = req.user as User;
    if (user.role === 'designer') {
      const order = await storage.getOrder(orderService.orderId);
      if (!order || order.assignedToId !== user.id) return res.sendStatus(403);
    }

    const input = z.object({ deliverableLink: z.string().trim().url().max(2000).nullable() });
    let deliverableLink: string | null;
    try {
      ({ deliverableLink } = input.parse({ deliverableLink: req.body.deliverableLink || null }));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Enter a valid URL" });
      throw err;
    }

    const updated = await storage.updateOrderService(id, { deliverableLink });
    res.json(updated);
  });

  // Meta Purchase retry (admin) — only when the last send failed.
  app.post("/api/orders/:id/meta-retry", requireRole(["admin"]), async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ message: "Invalid order id" });
    try {
      const started = await retryPurchase({ kind: "crm", id: orderId });
      if (!started) return res.status(409).json({ message: "Nothing to retry - the Purchase was already sent or is still sending." });
      res.json({ ok: true, metaStatus: "pending" });
    } catch (error: any) {
      console.error(`[meta-capi] retry for order ${orderId} failed:`, error);
      res.status(500).json({ message: "Retry failed to start. Please try again." });
    }
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
    void logAudit({ action: "order_canceled", actor, targetType: "order", targetId: orderId, details: { orderNumber: existing.orderNumber, reason: input.reason, advanceRefunded: input.advanceRefunded, refundAmount }, req });

    res.json(updated);
  });

  app.delete(api.orders.remove.path, requireRole(["admin"]), async (req, res) => {
    const orderId = Number(req.params.id);
    const user = req.user as User;

    const existingOrder = await storage.getOrder(orderId);
    if (!existingOrder) return res.sendStatus(404);

    const [hasRefund] = await db.select({ id: refunds.id }).from(refunds).where(eq(refunds.orderId, orderId)).limit(1);
    if (hasRefund) {
      return res.status(409).json({ message: "This order has refund records and cannot be deleted. Refunds must remain auditable." });
    }

    const relatedComplaints = await storage.getComplaints("admin", user.id, { orderId });
    if (relatedComplaints.length > 0) {
      return res.status(409).json({
        message: "This order has complaint history and cannot be deleted. Complaint records must remain auditable.",
      });
    }

    await storage.deleteOrder(orderId);
    void logAudit({ action: "order_deleted", actor: user, targetType: "order", targetId: orderId, details: { orderNumber: existingOrder.orderNumber, clientName: existingOrder.clientName, totalPrice: existingOrder.totalPrice }, req });

    res.json({ success: true });
  });
}
