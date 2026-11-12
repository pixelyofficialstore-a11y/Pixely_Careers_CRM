/**
 * Phase 3 order events (matrix): assigned to you, revision requested, delivered.
 * Called after the change is saved; a notification failure never undoes it.
 */
import { storage } from "./storage";
import { dispatchNotification, dispatchNotifications } from "./routes/shared";
import { packageLabel } from "./lib/metaCapi";
import { shortName } from "@shared/notification-events";
import { BUSINESS_TIME_ZONE } from "@shared/business-time";

type OrderLike = {
  id: number;
  orderNumber?: string | null;
  clientName?: string | null;
  packageType?: string | null;
  assignedToId?: number | null;
  createdById?: number | null;
  dueAt?: Date | string | null;
};

export function formatDueShort(due: Date | string | null | undefined): string | null {
  if (!due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, month: "short", day: "numeric" }).format(d);
}

const ref = (o: OrderLike) => o.orderNumber || shortName(o.clientName);

/** 👤 Order assigned to you (designer only, sound). */
export async function notifyOrderAssigned(order: OrderLike, actorId: number) {
  if (!order.assignedToId || order.assignedToId === actorId) return;
  try {
    const due = formatDueShort(order.dueAt);
    await dispatchNotification({
      event: "order_assigned",
      recipientId: order.assignedToId,
      recipientRole: "designer",
      type: "order",
      title: "👤 New order assigned",
      message: [ref(order), packageLabel(order.packageType), due ? `due ${due}` : null].filter(Boolean).join(" · "),
      priority: "action_required",
      relatedId: order.id,
      relatedType: "order",
      sourceEventId: `assigned:${order.assignedToId}:${Date.now()}`,
    });
  } catch (err) {
    console.error(`[orders] assignment notification failed for order ${order.id}:`, err);
  }
}

/** 🔁 Revision requested (assigned designer). */
export async function notifyRevisionRequested(order: OrderLike, actorId: number) {
  if (!order.assignedToId || order.assignedToId === actorId) return;
  try {
    await dispatchNotification({
      event: "order_revision_requested",
      recipientId: order.assignedToId,
      recipientRole: "designer",
      type: "order",
      title: "🔁 Revision requested",
      message: [ref(order), shortName(order.clientName)].filter((v, i, a) => v && a.indexOf(v) === i).join(" · "),
      priority: "action_required",
      relatedId: order.id,
      relatedType: "order",
      sourceEventId: `revision:${Date.now()}`,
    });
  } catch (err) {
    console.error(`[orders] revision notification failed for order ${order.id}:`, err);
  }
}

/** 📦 Delivered (admins + the support member who created it). */
export async function notifyDelivered(order: OrderLike, actorId: number) {
  try {
    const [admins, actor] = await Promise.all([storage.getAdmins(), storage.getUser(actorId)]);
    const message = [ref(order), shortName(order.clientName), actor ? `by ${actor.name}` : null]
      .filter((v, i, a) => v && a.indexOf(v) === i).join(" · ");
    const base = {
      event: "order_delivered" as const,
      type: "order",
      title: "📦 Delivered",
      message,
      priority: "confirmation",
      relatedId: order.id,
      relatedType: "order",
      sourceEventId: `delivered:${order.id}`,
    };
    await dispatchNotifications(admins.map(a => a.id), base, [actorId]);
    if (order.createdById && order.createdById !== actorId) {
      await dispatchNotification({ ...base, recipientId: order.createdById, recipientRole: "support" });
    }
  } catch (err) {
    console.error(`[orders] delivered notification failed for order ${order.id}:`, err);
  }
}
