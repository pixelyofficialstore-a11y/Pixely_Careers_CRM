/** Wires Website Requests (server/websiteRequests.ts) to CRM notifications. */
import type { Express } from "express";
import { storage } from "../storage";
import { registerWebsiteRequestRoutes } from "../websiteRequests";
import { emitRealtime } from "../sse";
import { dispatchNotification, dispatchNotifications, requireRole, notifyAdminPlacedOrder } from "./shared";
import { packageLabel } from "../lib/metaCapi";
import { notifyOrderAssigned } from "../orderNotifications";
import { rs, shortName } from "@shared/notification-events";

export function registerWebsiteRequestNotifications(app: Express) {
  registerWebsiteRequestRoutes(app, {
    requireRole,
    notifyNewRequest: async (recipientIds, request) => {
      const kind = request.kind ?? "order";
      // Website totals are rupees. "🛒 New order · Rs 19,000 · 11.11 Bundle · Ahmed R."
      const amount = request.currency && request.currency !== "PKR"
        ? `${request.currency} ${Number(request.total || 0).toLocaleString("en-PK")}`
        : rs(request.total);
      const paymentSubmitted = request.status === "payment_submitted";
      await dispatchNotifications(recipientIds, {
        event: "website_request_new",
        type: "website_request",
        title: kind === "review" ? "📝 New free CV review" : kind === "partner" ? "🤝 New agency partner" : paymentSubmitted ? "💳 Verify payment" : "🛒 New order",
        message: kind === "order"
          ? [amount, request.package ? packageLabel(request.package) : null, shortName(request.name)].filter(Boolean).join(" · ")
          : `${request.name || (kind === "partner" ? "An agency" : "A customer")} submitted the ${kind === "review" ? "free CV review" : "For Agencies"} form.`,
        priority: "action_required",
        relatedType: "website_request",
        sourceEventId: `${request.id}:${request.status}`,
      });
    },
    notifyApprovalRequested: async (request, submitter, note) => {
      const admins = await storage.getAdmins();
      const amount = request.currency && request.currency !== "PKR" ? `${request.currency} ${Number(request.total || 0).toLocaleString("en-PK")}` : rs(request.total);
      await dispatchNotifications(admins.map(a => a.id), {
        event: "website_request_approval",
        type: "website_request",
        title: "📝 Approval needed",
        message: `${amount} · ${shortName(request.name)} · from ${submitter.name}${note ? ` — "${note.slice(0, 80)}"` : ""}`,
        priority: "action_required",
        relatedType: "website_request",
        sourceEventId: `${request.id}:approval:${request.submittedAt}`,
      }, [submitter.id]);
      emitRealtime(submitter.id, ["website_requests"]);
    },
    notifySubmitterDecision: async (submitterId, request, decision, actorId, orderId) => {
      await dispatchNotification({
        event: "website_request_decision",
        recipientId: submitterId,
        recipientRole: "support",
        type: "website_request",
        title: decision === "approved" ? "✅ Order confirmed" : "Website order declined",
        message: decision === "approved"
          ? `${request.name || "The customer"}'s order was approved and placed.`
          : `${request.name || "The customer"}'s request was declined.`,
        priority: decision === "approved" ? "confirmation" : "action_required",
        relatedId: orderId ?? undefined,
        relatedType: decision === "approved" && orderId ? "order" : "website_request",
        sourceEventId: `${request.id}:${decision}`,
      }).catch(err => console.error("[website-requests] decision notify failed:", err));
      emitRealtime(actorId, ["website_requests"]);
    },
    afterPlacement: async (actor, order) => {
      await notifyAdminPlacedOrder(order, actor.id);
      await notifyOrderAssigned(order, actor.id);
      emitRealtime(actor.id, ["payments", "orders", "stats", "website_requests"]);
    },
  });
}
