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


const NOTIFIABLE_EVENTS = [
  "complaint_created_by_support",
  "complaint_created_by_admin",
  "complaint_confirmed",
  "complaint_designer_explanation",
  "order_created_by_admin",
  "payment_verification_requested",
  "order_approved",
  "order_disapproved",
  "review_created",
  "suggestion_created",
  "website_request_new",
  "website_request_approval",
  "website_request_decision",
] as const;

type NotificationEvent = typeof NOTIFIABLE_EVENTS[number];

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
};

const SOUND_EVENTS = new Set<NotificationEvent>([
  "complaint_created_by_support",
  "complaint_created_by_admin",
  "payment_verification_requested",
  "review_created",
  "website_request_new",
  "website_request_approval",
]);

function notificationTag(event: NotificationEvent, relatedType: string | undefined, relatedId: number | undefined, sourceEventId: string | number): string {
  return ["pixelcrm", event, relatedType || "record", relatedId ?? "none", sourceEventId].join("-");
}

async function sendWebPushToUser(
  userId: number,
  payload: { title: string; body: string; priority: string; url: string; tag: string },
) {
  try {
    const subs = await storage.getPushSubscriptionsForUser(userId);
    await Promise.all(subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err: any) {
        // The only allowed automatic removal: expired subscriptions the app created.
        if (err.statusCode === 410 || err.statusCode === 404) {
          await storage.deletePushSubscription(sub.endpoint);
        }
      }
    }));
  } catch (_) {}
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
    const tag = notificationTag(input.event, input.relatedType, input.relatedId, input.sourceEventId);
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
      const url = input.relatedType === "complaint" && input.relatedId
      ? `/complaints/${input.relatedId}`
      : input.relatedType === "order" && input.relatedId
        ? `/orders?order=${input.relatedId}`
        : input.relatedType === "review" && input.relatedId
          ? `/feedback?review=${input.relatedId}`
          : input.relatedType === "suggestion" && input.relatedId
            ? `/feedback?suggestion=${input.relatedId}`
            : input.relatedType === "payment_verification" && input.relatedId
              ? `/payments?payment=${input.relatedId}`
              : input.relatedType === "website_request"
                ? "/website-requests"
                : "/orders";
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
        sound: SOUND_EVENTS.has(input.event),
      };
      // An active CRM session receives the event over SSE and owns its
      // foreground browser alert. Fall back to Web Push for non-connected
      // sessions so the same event is not shown twice.
      if (!hasSseClient(input.recipientId)) {
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
export const notifyAdminPlacedOrder = async (order: { id: number; assignedToId: number | null }, actorId: number, message = "New order created by Admin.") => {
  try {
    const admins = await storage.getAdmins();
    await dispatchNotifications(
      admins.map(a => a.id),
      {
        event: "order_created_by_admin",
        type: "order",
        title: "New Order",
        message,
        priority: "update",
        relatedId: order.id,
        relatedType: "order",
        sourceEventId: order.id,
      },
      [actorId],
    );
    if (order.assignedToId) {
      await dispatchNotification({
        event: "order_created_by_admin",
        recipientId: order.assignedToId,
        recipientRole: "designer",
        type: "order",
        title: "New Order Assigned",
        message: "New order assigned to you. Client details are available in CRM.",
        priority: "update",
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
