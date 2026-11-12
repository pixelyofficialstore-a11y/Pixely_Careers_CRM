/**
 * Phase 3 notification matrix. Every server event belongs to one category;
 * categories are what a user can mute (push + sound) in Settings → Notifications.
 * The bell always keeps the record, so nothing is lost when a category is muted.
 */
import { BUSINESS_TIME_ZONE } from "./business-time";

export const notificationCategories = [
  "new_order",
  "payment_submitted",
  "payment_approved",
  "sent_for_approval",
  "order_assigned",
  "due_overdue",
  "revision_requested",
  "delivered",
  "complaint",
  "refund",
  "feedback",
  "daily_summary",
] as const;
export type NotificationCategory = typeof notificationCategories[number];

type Role = "admin" | "support" | "designer";

export const NOTIFICATION_CATEGORY_INFO: Record<NotificationCategory, { emoji: string; label: string; roles: Role[] }> = {
  new_order:          { emoji: "🛒", label: "New website order / request", roles: ["admin", "support"] },
  payment_submitted:  { emoji: "💳", label: "Payment submitted (verify)", roles: ["admin"] },
  payment_approved:   { emoji: "✅", label: "Payment approved / order confirmed", roles: ["admin", "support", "designer"] },
  sent_for_approval:  { emoji: "📝", label: "Sent for approval", roles: ["admin"] },
  order_assigned:     { emoji: "👤", label: "Order assigned to you", roles: ["designer"] },
  due_overdue:        { emoji: "⏰", label: "Due today / overdue", roles: ["admin", "designer"] },
  revision_requested: { emoji: "🔁", label: "Revision requested", roles: ["designer"] },
  delivered:          { emoji: "📦", label: "Delivered", roles: ["admin", "support"] },
  complaint:          { emoji: "⚠️", label: "Complaint filed", roles: ["admin", "designer"] },
  refund:             { emoji: "💸", label: "Refunds", roles: ["admin", "support"] },
  feedback:           { emoji: "⭐", label: "Reviews & suggestions", roles: ["admin", "support", "designer"] },
  daily_summary:      { emoji: "📊", label: "Daily summary (9 PM)", roles: ["admin"] },
};

/** Server event → category. */
export const EVENT_CATEGORY = {
  website_request_new: "new_order",
  order_created_by_admin: "new_order",
  payment_verification_requested: "payment_submitted",
  order_approved: "payment_approved",
  order_disapproved: "payment_approved",
  order_pay_later_approved: "payment_approved",
  website_request_decision: "payment_approved",
  website_request_approval: "sent_for_approval",
  order_assigned: "order_assigned",
  order_due_today: "due_overdue",
  order_overdue: "due_overdue",
  order_revision_requested: "revision_requested",
  order_delivered: "delivered",
  complaint_created_by_support: "complaint",
  complaint_created_by_admin: "complaint",
  complaint_confirmed: "complaint",
  complaint_designer_explanation: "complaint",
  refund_requested: "refund",
  refund_decided: "refund",
  review_created: "feedback",
  suggestion_created: "feedback",
  daily_summary: "daily_summary",
} as const satisfies Record<string, NotificationCategory>;
export type NotificationEvent = keyof typeof EVENT_CATEGORY;
export const NOTIFIABLE_EVENTS = Object.keys(EVENT_CATEGORY) as NotificationEvent[];

/** Events that play a sound (matrix): new order, payment to verify, assigned to you. */
export const SOUND_EVENTS = new Set<NotificationEvent>([
  "website_request_new",
  "order_created_by_admin",
  "payment_verification_requested",
  "order_assigned",
]);

export function categoriesForRole(role: string): NotificationCategory[] {
  return notificationCategories.filter(c => NOTIFICATION_CATEGORY_INFO[c].roles.includes(role as Role));
}

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return typeof value === "string" && (notificationCategories as readonly string[]).includes(value);
}

/** Minutes after midnight in Pakistan time. */
export function businessMinutesOfDay(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const h = Number(parts.find(p => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find(p => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** Quiet hours may wrap midnight (e.g. 22:00 → 08:00). start === end = off. */
export function isWithinQuietHours(start: number | null | undefined, end: number | null | undefined, now = new Date()): boolean {
  if (start == null || end == null || start === end) return false;
  const t = businessMinutesOfDay(now);
  return start < end ? t >= start && t < end : t >= start || t < end;
}

/** "Ahmed Raza Khan" → "Ahmed R." (lock-screen friendly). */
export function shortName(name: string | null | undefined): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Client";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
}

/** Rupees (number) → "Rs 19,000". */
export function rs(rupees: number | null | undefined): string {
  return `Rs ${Math.round(Number(rupees) || 0).toLocaleString("en-PK")}`;
}

/** Paisa → "Rs 19,000" (CRM tables store paisa). */
export function rsFromPaisa(paisa: number | null | undefined): string {
  return rs((Number(paisa) || 0) / 100);
}

/** Bell list window: older items are hidden (never deleted). */
export const NOTIFICATION_LIST_DAYS = 30;
