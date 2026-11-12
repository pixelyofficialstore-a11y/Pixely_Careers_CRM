/**
 * Phase 2 refunds: support (or admin) requests a refund on an order → an admin
 * approves it with an amount (or rejects it) → the admin marks it paid.
 * Records are never deleted. Money is in paisa.
 */
import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { refunds, orders, complaints, activityLogs, type User } from "@shared/schema";
import { getOrderAccounting } from "@shared/order-accounting";
import { logAudit } from "../security/audit";
import { dispatchNotification, dispatchNotifications, requireRole, safeUserSummary } from "./shared";
import { shortName } from "@shared/notification-events";

const fmt = (paisa: number) => `Rs ${Math.round(paisa / 100).toLocaleString("en-PK")}`;

/** What can still be refunded on an order: net collected minus open (requested) refunds. */
async function refundableTx(tx: any, orderId: number, excludeRefundId?: number) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
  const rows = await tx.select({ id: refunds.id, status: refunds.status, requested: refunds.requestedAmount, approved: refunds.approvedAmount })
    .from(refunds).where(eq(refunds.orderId, orderId));
  let counted = 0, open = 0;
  for (const r of rows) {
    if (r.id === excludeRefundId) continue;
    if (r.status === "approved" || r.status === "paid") counted += r.approved || 0;
    else if (r.status === "requested") open += r.requested || 0;
  }
  const net = getOrderAccounting(order, counted).netCollected;
  return { order, net, open, available: Math.max(0, net - open) };
}

const requestSchema = z.object({
  amount: z.number().int().positive("Enter the refund amount").max(1_000_000_000),
  reason: z.string().trim().min(3, "Give a reason for the refund").max(1000),
  method: z.string().trim().max(100).optional().nullable(),
  complaintId: z.number().int().positive().optional().nullable(),
}).strict();

const decideSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    amount: z.number().int().positive("Enter the approved amount").max(1_000_000_000),
    method: z.string().trim().max(100).optional().nullable(),
    note: z.string().trim().max(1000).optional().nullable(),
  }).strict(),
  z.object({
    decision: z.literal("reject"),
    note: z.string().trim().min(3, "Give a reason for rejecting").max(1000),
  }).strict(),
]);

const listSchema = z.object({
  status: z.enum(["requested", "approved", "rejected", "paid"]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

export function registerRefundRoutes(app: Express) {
  const withNames = async <T extends { requestedById: number; decidedById: number | null }>(rows: T[]) => {
    const byId = new Map((await storage.getUsers()).map(u => [u.id, u]));
    return rows.map(r => ({
      ...r,
      requestedBy: safeUserSummary(byId.get(r.requestedById)),
      decidedBy: r.decidedById ? safeUserSummary(byId.get(r.decidedById)) : null,
    }));
  };

  // Refunds on one order (admin, support).
  app.get("/api/orders/:id/refunds", requireRole(["admin", "support"]), async (req, res) => {
    const orderId = Number(req.params.id);
    const rows = await db.select().from(refunds).where(eq(refunds.orderId, orderId)).orderBy(desc(refunds.requestedAt), desc(refunds.id));
    const info = await refundableTx(db, orderId);
    if (!info) return res.sendStatus(404);
    res.json({ rows: await withNames(rows), netCollected: info.net, openRequested: info.open, available: info.available });
  });

  // Request a refund (support or admin).
  app.post("/api/orders/:id/refunds", requireRole(["admin", "support"]), async (req, res) => {
    const orderId = Number(req.params.id);
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    const input = parsed.data;
    const actor = req.user as User;
    try {
      const refund = await db.transaction(async tx => {
        await tx.execute(sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
        const info = await refundableTx(tx, orderId);
        if (!info) throw new HttpError(404, "Order not found");
        if (info.order.advancePaymentStatus !== "approved") throw new HttpError(409, "Only confirmed orders with a payment can be refunded.");
        if (input.amount > info.available) {
          throw new HttpError(409, info.available > 0
            ? `The most that can be requested is ${fmt(info.available)} (collected ${fmt(info.net)}, already requested ${fmt(info.open)}).`
            : "Nothing left to refund on this order.");
        }
        if (input.complaintId) {
          const [c] = await tx.select({ orderId: complaints.orderId }).from(complaints).where(eq(complaints.id, input.complaintId));
          if (!c || c.orderId !== orderId) throw new HttpError(400, "That complaint is not on this order.");
        }
        const [created] = await tx.insert(refunds).values({
          orderId,
          complaintId: input.complaintId ?? null,
          requestedAmount: input.amount,
          reason: input.reason,
          method: input.method || null,
          requestedById: actor.id,
        }).returning();
        await tx.insert(activityLogs).values({
          orderId, actorId: actor.id, activityType: "payment_change",
          previousValue: null, newValue: "refund_requested",
          details: { refundId: created.id, amount: input.amount, reason: input.reason },
        });
        return { created, order: info.order };
      });
      const admins = (await storage.getAdmins()).filter(a => a.id !== actor.id);
      await dispatchNotifications(admins.map(a => a.id), {
        event: "refund_requested",
        type: "payment",
        title: "💸 Refund requested",
        message: [fmt(input.amount), refund.order.orderNumber, shortName(refund.order.clientName), `by ${actor.name}`].filter(Boolean).join(" · "),
        priority: "action_required",
        relatedId: orderId,
        relatedType: "order",
        sourceEventId: `refund:${refund.created.id}`,
      });
      res.status(201).json(refund.created);
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
      throw err;
    }
  });

  // All refunds (admin: decisions; support: track their requests). Paginated.
  app.get("/api/refunds", requireRole(["admin", "support"]), async (req, res) => {
    const q = listSchema.parse(req.query);
    const where = q.status ? eq(refunds.status, q.status) : undefined;
    const [rows, [{ total }], counts] = await Promise.all([
      db.select({
        refund: refunds,
        orderNumber: orders.orderNumber,
        clientName: orders.clientName,
      }).from(refunds).innerJoin(orders, eq(orders.id, refunds.orderId))
        .where(where)
        .orderBy(desc(refunds.requestedAt), desc(refunds.id))
        .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ total: sql<number>`count(*)::int` }).from(refunds).where(where),
      db.select({ status: refunds.status, n: sql<number>`count(*)::int` }).from(refunds).groupBy(refunds.status),
    ]);
    const named = await withNames(rows.map(r => ({ ...r.refund, orderNumber: r.orderNumber, clientName: r.clientName })));
    res.json({
      rows: named,
      total: Number(total) || 0,
      page: q.page,
      pageSize: q.pageSize,
      counts: Object.fromEntries(counts.map(c => [c.status, Number(c.n)])),
    });
  });

  // Count of refunds waiting for an admin decision (badge).
  app.get("/api/refunds/pending-count", requireRole(["admin"]), async (_req, res) => {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(refunds).where(eq(refunds.status, "requested"));
    res.json({ count: Number(n) || 0 });
  });

  // Admin decision: approve with an amount, or reject.
  app.post("/api/refunds/:id/decide", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    const parsed = decideSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    const input = parsed.data;
    const actor = req.user as User;
    try {
      const result = await db.transaction(async tx => {
        const [existing] = await tx.select().from(refunds).where(eq(refunds.id, id));
        if (!existing) throw new HttpError(404, "Refund not found");
        await tx.execute(sql`SELECT id FROM orders WHERE id = ${existing.orderId} FOR UPDATE`);
        const lockedRes: any = await tx.execute(sql`SELECT status FROM refunds WHERE id = ${id} FOR UPDATE`);
        const locked = (lockedRes.rows ?? lockedRes)[0];
        if (locked?.status !== "requested") throw new HttpError(409, "This refund was already decided.");
        const now = new Date();
        let updated;
        if (input.decision === "approve") {
          const info = await refundableTx(tx, existing.orderId, id);
          if (!info) throw new HttpError(404, "Order not found");
          if (input.amount > info.net) {
            throw new HttpError(409, `The most that can be refunded is ${fmt(info.net)} (net collected on this order).`);
          }
          [updated] = await tx.update(refunds).set({
            status: "approved", approvedAmount: input.amount,
            method: input.method || existing.method, adminNote: input.note || null,
            decidedById: actor.id, decidedAt: now,
          }).where(and(eq(refunds.id, id), eq(refunds.status, "requested"))).returning();
        } else {
          [updated] = await tx.update(refunds).set({
            status: "rejected", adminNote: input.note, decidedById: actor.id, decidedAt: now,
          }).where(and(eq(refunds.id, id), eq(refunds.status, "requested"))).returning();
        }
        if (!updated) throw new HttpError(409, "This refund was already decided.");
        await tx.insert(activityLogs).values({
          orderId: existing.orderId, actorId: actor.id, activityType: "payment_change",
          previousValue: "refund_requested", newValue: input.decision === "approve" ? "refund_approved" : "refund_rejected",
          details: { refundId: id, amount: input.decision === "approve" ? input.amount : null, note: input.note || null },
        });
        const [order] = await tx.select({ orderNumber: orders.orderNumber, clientName: orders.clientName }).from(orders).where(eq(orders.id, existing.orderId));
        return { updated, order };
      });
      const r = result.updated;
      void logAudit({
        action: input.decision === "approve" ? "refund_approved" : "refund_rejected",
        actor, targetType: "order", targetId: r.orderId,
        details: { refundId: r.id, orderNumber: result.order?.orderNumber, requested: r.requestedAmount, approved: r.approvedAmount }, req,
      });
      if (r.requestedById !== actor.id) {
        await dispatchNotification({
          recipientId: r.requestedById,
          event: "refund_decided",
          type: "payment",
          title: input.decision === "approve" ? "💸 Refund approved" : "💸 Refund rejected",
          message: input.decision === "approve"
            ? `${fmt(r.approvedAmount || 0)} refund approved on ${result.order?.orderNumber || "the order"} (${result.order?.clientName}).`
            : `Refund on ${result.order?.orderNumber || "the order"} (${result.order?.clientName}) was rejected: ${input.note}`,
          priority: "update",
          relatedId: r.orderId,
          relatedType: "order",
          sourceEventId: `refund-decided:${r.id}`,
        });
      }
      res.json(r);
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
      throw err;
    }
  });

  // Admin: the approved refund was sent to the client.
  app.post("/api/refunds/:id/paid", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    const input = z.object({ method: z.string().trim().max(100).optional().nullable() }).strict().parse(req.body ?? {});
    const actor = req.user as User;
    const [existing] = await db.select().from(refunds).where(eq(refunds.id, id));
    if (!existing) return res.sendStatus(404);
    const [updated] = await db.update(refunds).set({ status: "paid", paidAt: new Date(), method: input.method || existing.method })
      .where(and(eq(refunds.id, id), eq(refunds.status, "approved"))).returning();
    if (!updated) return res.status(409).json({ message: "Only an approved refund can be marked as paid." });
    await storage.createActivityLog({
      orderId: updated.orderId, actorId: actor.id, activityType: "payment_change",
      previousValue: "refund_approved", newValue: "refund_paid",
      details: { refundId: id, amount: updated.approvedAmount, method: updated.method },
    });
    void logAudit({ action: "refund_paid", actor, targetType: "order", targetId: updated.orderId, details: { refundId: id, amount: updated.approvedAmount }, req });
    res.json(updated);
  });
}
