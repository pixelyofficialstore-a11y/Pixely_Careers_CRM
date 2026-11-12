/** Wires Website Requests (server/websiteRequests.ts) to CRM notifications. */
import type { Express } from "express";
import { storage } from "../storage";
import { registerWebsiteRequestRoutes } from "../websiteRequests";
import { emitRealtime } from "../sse";
import { dispatchNotification, dispatchNotifications, requireRole, notifyAdminPlacedOrder } from "./shared";

export function registerWebsiteRequestNotifications(app: Express) {
  registerWebsiteRequestRoutes(app, {
    requireRole,
    notifyNewRequest: async (recipientIds, request) => {
      const kind = request.kind ?? "order";
      const amount = `Rs ${Number(request.total || 0).toLocaleString("en-PK")}`;
      await dispatchNotifications(recipientIds, {
        event: "website_request_new",
        type: "website_request",
        title: kind === "review" ? "New Free CV Review" : kind === "partner" ? "New Agency Partner" : request.status === "payment_submitted" ? "Website Payment Submitted" : "New Website Request",
        message: kind === "order"
          ? `${request.name || "A customer"} · ${request.currency && request.currency !== "PKR" ? `${request.currency} ${Number(request.total || 0).toLocaleString("en-PK")}` : amount}${request.status === "payment_submitted" ? " — needs verification" : ""}`
          : `${request.name || (kind === "partner" ? "An agency" : "A customer")} submitted the ${kind === "review" ? "free CV review" : "For Agencies"} form.`,
        priority: "action_required",
        relatedType: "website_request",
        sourceEventId: `${request.id}:${request.status}`,
      });
    },
    notifyApprovalRequested: async (request, submitter, note) => {
      const admins = await storage.getAdmins();
      const amount = `${request.currency} ${Number(request.total || 0).toLocaleString()}`;
      await dispatchNotifications(admins.map(a => a.id), {
        event: "website_request_approval",
        type: "website_request",
        title: "Website order needs approval",
        message: `${submitter.name} sent ${request.name || "a customer"} · ${amount} for approval${note ? ` — "${note.slice(0, 80)}"` : ""}`,
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
        title: decision === "approved" ? "Website order approved" : "Website order declined",
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
      await notifyAdminPlacedOrder(order, actor.id, "New order placed by Admin from a website request.");
      emitRealtime(actor.id, ["payments", "orders", "stats", "website_requests"]);
    },
  });
}
