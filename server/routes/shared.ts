/**
 * Helpers shared by the route modules: auth guards, notification dispatch,
 * user projections and order access checks.
 */
import { storage } from "../storage";
import { type User } from "@shared/schema";
import sharp from "sharp";
import webpush from "web-push";
import { emitNotification, emitRealtime, hasSseClient } from "../sse";
import { isAllowedFileRef } from "../files";
import { canAccessOrderCase, type CaseRole } from "@shared/case-access";
import { EVENT_CATEGORY, NOTIFIABLE_EVENTS, SOUND_EVENTS, type NotificationEvent } from "@shared/notification-events";
import { getNotificationPrefs, shouldAlert } from "../notificationPrefs";
import { rsFromPaisa, shortName } from "@shared/notification-events";
import { packageLabel as packageLabelOf } from "../lib/metaCapi";

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@pixelcrm.app",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars are not set — background web push is disabled");
}

const KNOWN_PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
  "web.push.apple.com",
];

export function isValidPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    return KNOWN_PUSH_HOSTS.some(host => url.hostname === host || url.hostname.endsWith("." + host));
  } catch {
    return false;
  }
}


const EVENT_SCOPES: Record<NotificationEvent, string[]> = {
  complaint_created_by_support: ["notifications", "complaints", "stats"],
  complaint_created_by_admin: ["notifications", "complaints", "stats"],
  complaint_confirmed: ["notifications", "complaints", "stats"],
  complaint_designer_explanation: ["notifications", "complaints"],
  order_created_by_admin: ["notifications", "orders", "stats"],
  payment_verification_requested: ["notifications", "payments", "orders", "stats"],
  order_approved: ["notifications", "payments", "orders", "stats"],
  order_disapproved: ["notifications", "payments", "orders", "stats"],
  review_created: ["notifications", "feedback"],
  suggestion_created: ["notifications", "feedback"],
  website_request_new: ["notifications", "website_requests"],
  website_request_approval: ["notifications", "website_requests"],
  website_request_decision: ["notifications", "website_requests", "orders", "stats"],
  order_pay_later_approved: ["notifications", "orders", "stats"],
  order_overdue: ["notifications", "orders"],
  refund_requested: ["notifications", "refunds", "orders"],
  refund_decided: ["notifications", "refunds", "orders", "stats"],
  // Phase 3
  order_assigned: ["notifications", "orders"],
  order_due_today: ["notifications", "orders"],
  order_revision_requested: ["notifications", "orders"],
  order_delivered: ["notifications", "orders", "stats"],
  daily_summary: ["notifications"],
};

/** Where a notification opens (bell click + push click-through). */
export function notificationUrl(relatedType: string | null | undefined, relatedId: number | null | undefined): string {
  if (relatedType === "complaint" && relatedId) return `/complaints/${relatedId}`;
  if (relatedType === "order" && relatedId) return `/orders?order=${relatedId}`;
  if (relatedType === "review" && relatedId) return `/feedback?review=${relatedId}`;
  if (relatedType === "suggestion" && relatedId) return `/feedback?suggestion=${relatedId}`;
  if (relatedType === "payment_verification" && relatedId) return `/payments?payment=${relatedId}`;
  if (relatedType === "website_request") return "/website-requests";
  if (relatedType === "dashboard") return "/";
  return "/orders";
}

/** Related notifications (same order / complaint / …) replace each other on the phone. */
function notificationGroupTag(event: NotificationEvent, relatedType: string | undefined, relatedId: number | undefined): string {
  if (relatedType && relatedId) return `px-${relatedType}-${relatedId}`;
  return `px-${event}`;
}

export type PushPayload = {
  title: string;
  body: string;
  priority: string;
  url: string;
  tag: string;
  icon?: string;
  badge?: string;
};

const PUSH_ICON = "/icons/icon-192.png";
const PUSH_BADGE = "/icons/badge-96.png";

/** Sends to every device of the user. Returns how many devices accepted it. */
export async function sendWebPushToUser(userId: number, payload: PushPayload): Promise<number> {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return 0;
  let delivered = 0;
  try {
    const subs = await storage.getPushSubscriptionsForUser(userId);
    const body = JSON.stringify({ icon: PUSH_ICON, badge: PUSH_BADGE, ...payload });
    await Promise.all(subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 24 * 60 * 60, urgency: payload.priority === "action_required" ? "high" : "normal", topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined },
        );
        delivered++;
      } catch (err: any) {
        // The only allowed automatic removal: expired subscriptions the app created.
        if (err.statusCode === 410 || err.statusCode === 404) {
          await storage.deletePushSubscription(sub.endpoint);
        }
      }
    }));
  } catch (_) {}
  return delivered;
}

type DispatchNotificationInput = {
  event: NotificationEvent;
  recipientId: number;
  recipientRole?: string;
  type: string;
  title: string;
  message: string;
  priority: string;
  relatedId?: number;
  relatedType?: string;
  sourceEventId: string | number;
};

export async function dispatchNotification(input: DispatchNotificationInput) {
  if (!NOTIFIABLE_EVENTS.includes(input.event)) return null;
  const recipient = await storage.getUser(input.recipientId);
  if (!recipient || !recipient.isActive || (input.recipientRole && recipient.role !== input.recipientRole)) return null;

  try {
    const scopes = EVENT_SCOPES[input.event];
    const dedupeKey = [input.event, input.relatedType || "", input.relatedId ?? "", input.sourceEventId].join("::");
    const result = await storage.createNotification(
      input.recipientId,
      input.type,
      input.title,
      input.message,
      input.priority,
      input.relatedId,
      input.relatedType,
      dedupeKey,
    );
    if (result.created) {
      const url = notificationUrl(input.relatedType, input.relatedId);
      const tag = notificationGroupTag(input.event, input.relatedType, input.relatedId);
      // Muted category or quiet hours: the bell still gets it, but no push and no sound.
      const prefs = await getNotificationPrefs(input.recipientId);
      const alert = shouldAlert(prefs, EVENT_CATEGORY[input.event]);
      const eventPayload = {
        event: "notification",
        id: result.notification.id,
        count: 1,
        eventType: input.event,
        type: input.type,
        title: input.title,
        message: input.message,
        priority: input.priority,
        relatedId: input.relatedId ?? null,
        relatedType: input.relatedType ?? null,
        url,
        tag,
        scopes,
        alert,
        sound: alert && SOUND_EVENTS.has(input.event),
      };
      // Push goes to every device (phone included). An open, focused CRM tab
      // gets the SSE event instead; the service worker skips the duplicate OS
      // alert there, and the shared tag collapses any remaining duplicate.
      if (alert) {
        sendWebPushToUser(input.recipientId, {
          title: input.title,
          body: input.message,
          priority: input.priority,
          url,
          tag,
        }).catch(() => {});
      }
      emitNotification(input.recipientId, eventPayload);
    } else {
      emitRealtime(input.recipientId, scopes);
    }
    return result.notification;
  } catch (error) {
    // Notifications are secondary side effects. Never report a successful
    // payment/order mutation as failed because notification delivery failed.
    console.error("[notifications] dispatch failed:", error);
    return null;
  }
}

export async function dispatchNotifications(
  userIds: (number | null | undefined)[],
  input: Omit<DispatchNotificationInput, "recipientId">,
  exclude: (number | null | undefined)[] = [],
) {
  const excludeSet = new Set(exclude.filter((id): id is number => typeof id === "number"));
  const candidateRecipients = Array.from(
    new Set(userIds.filter((id): id is number => typeof id === "number" && !excludeSet.has(id)))
  );
  // Send to every recipient in parallel (each dispatch is independent).
  await Promise.all(candidateRecipients.map(id => dispatchNotification({ ...input, recipientId: id })));
}

// Turn an internal status key into a clean label, e.g. "pending_payment" -> "Pending Payment".
export function statusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return status
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function safeUser(person: User | null | undefined) {
  if (!person) return null;
  const { password: _password, totpSecret: _totpSecret, sessionsValidAfter: _sva, ...safe } = person;
  return { ...safe, mustChangePassword: Boolean(person.mustChangePassword), totpEnabled: Boolean(person.totpEnabled) };
}

export function safeUserSummary(person: User | null | undefined) {
  return person ? {
    id: person.id,
    name: person.name,
    role: person.role,
    title: person.title,
    avatar: person.avatar,
  } : null;
}

export const markSessionLogin = (req: any) => { req.session.loginAt = Date.now(); };

export const requireAuth = (req: any, res: any, next: any) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  next();
};

export const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  if (!roles.includes((req.user as User).role)) return res.sendStatus(403);
  next();
};

export const fileRefOk = (value: string, req: any) => isAllowedFileRef(value, req.user as User);
export const allFileRefsOk = async (values: string[], req: any) =>
  (await Promise.all(values.map(v => fileRefOk(v, req)))).every(Boolean);

// Re-encode any uploaded image (validates it really is an image and strips metadata).
export const normalizeImage = (buffer: Buffer, maxWidth = 1600) =>
  sharp(buffer, { limitInputPixels: 60_000_000 })
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

export const optionalOrderId = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Notifications for an order placed (auto-approved) by an admin. Shared by
// the Orders page and Website Requests. Runs after the transaction commits;
// a notification failure never undoes the order.
export const notifyAdminPlacedOrder = async (
  order: { id: number; assignedToId: number | null; orderNumber?: string | null; clientName?: string | null; packageType?: string | null; totalPrice?: number | null; dueAt?: Date | string | null },
  actorId: number,
  message?: string,
) => {
  try {
    const admins = await storage.getAdmins();
    await dispatchNotifications(
      admins.map(a => a.id),
      {
        event: "order_created_by_admin",
        type: "order",
        title: "🛒 New order",
        message: message ?? [order.totalPrice ? rsFromPaisa(order.totalPrice) : null, packageLabelOf(order.packageType), shortName(order.clientName), "placed by Admin"].filter(Boolean).join(" · "),
        priority: "update",
        relatedId: order.id,
        relatedType: "order",
        sourceEventId: order.id,
      },
      [actorId],
    );
    if (order.assignedToId) {
      const due = order.dueAt ? new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", month: "short", day: "numeric" }).format(new Date(order.dueAt)) : null;
      await dispatchNotification({
        event: "order_assigned",
        recipientId: order.assignedToId,
        recipientRole: "designer",
        type: "order",
        title: "👤 New order assigned",
        message: [order.orderNumber || shortName(order.clientName), packageLabelOf(order.packageType), due ? `due ${due}` : null].filter(Boolean).join(" · "),
        priority: "action_required",
        relatedId: order.id,
        relatedType: "order",
        sourceEventId: order.id,
      });
    }
  } catch (error) {
    console.error(`[orders] notifications failed for order ${order.id} (order was saved):`, error);
  }
  emitRealtime(actorId, ["orders", "stats"]);
};

export const canAccessOrder = async (user: User, orderId: number) => {
  const order = await storage.getOrder(orderId);
  if (!order) return undefined;
  if (!canAccessOrderCase(user.role as CaseRole, user.id, order.assignedToId)) return null;
  return order;
};
