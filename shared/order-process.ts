/**
 * Phase 2 – one order process (pure functions, used by server and client).
 *
 * Two tracks per order:
 *  - Work status:    Request → Confirmed → In progress → Draft sent → Revisions → Delivered → Closed (+ Canceled)
 *  - Payment status: Unpaid · Advance paid · Fully paid · Refunded · Partially refunded
 *
 * Rule 0: old rows are never rewritten. Orders without a stored `work_status`
 * use the mapped legacy `status`; old orders without `due_at` get a due date
 * computed from created_at + package days. "Closed" and the payment status are
 * always computed, never stored.
 */

// ---- work status --------------------------------------------------------------
export const workStatuses = ["request", "confirmed", "in_progress", "draft_sent", "revisions", "delivered", "canceled"] as const;
export type WorkStatus = typeof workStatuses[number];
/** Effective status shown in the UI ("closed" is computed only). */
export type DisplayWorkStatus = WorkStatus | "closed";

export const WORK_STATUS_LABELS: Record<DisplayWorkStatus, string> = {
  request: "Request",
  confirmed: "Confirmed",
  in_progress: "In progress",
  draft_sent: "Draft sent",
  revisions: "Revisions",
  delivered: "Delivered",
  closed: "Closed",
  canceled: "Canceled",
};

/** Old `status` value → work status (owner-approved mapping, code only). */
export const LEGACY_TO_WORK: Record<string, WorkStatus> = {
  pending_payment: "request",
  new: "confirmed",
  working: "in_progress",
  ready: "draft_sent",
  delivered: "delivered",
  canceled: "canceled",
};

/**
 * Work status → the old `status` value kept in sync, so every existing rule,
 * filter and metric keeps working. "Revisions" is a sub-state of the old
 * "ready" (a draft exists and is being revised), so designer locks and the
 * ready date are unaffected.
 */
export const WORK_TO_LEGACY: Record<WorkStatus, string> = {
  request: "pending_payment",
  confirmed: "new",
  in_progress: "working",
  draft_sent: "ready",
  revisions: "ready",
  delivered: "delivered",
  canceled: "canceled",
};

/** Statuses staff can pick by hand (Request comes from creation, Canceled from the cancel flow). */
export const SETTABLE_WORK_STATUSES: WorkStatus[] = ["confirmed", "in_progress", "draft_sent", "revisions", "delivered"];

export function mapLegacyStatus(status: string | null | undefined): WorkStatus {
  return LEGACY_TO_WORK[status || ""] ?? "confirmed";
}

/**
 * The stored work_status when it still agrees with the old status; otherwise the
 * mapped old status (older code paths, e.g. payment approval, only set `status`).
 */
export function storedOrMappedWorkStatus(order: { status?: string | null; workStatus?: string | null }): WorkStatus {
  const stored = order.workStatus as WorkStatus | null | undefined;
  if (stored && (workStatuses as readonly string[]).includes(stored) && WORK_TO_LEGACY[stored] === order.status) return stored;
  return mapLegacyStatus(order.status);
}

// ---- support period / closed ----------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;
/** Support period length: days, or calendar months (same as the Orders page support validity). */
const SUPPORT_PERIODS: Record<string, { days?: number; months?: number }> = {
  "15_days": { days: 15 }, "1_month": { months: 1 }, "2_months": { months: 2 }, "3_months": { months: 3 },
  "4_months": { months: 4 }, "5_months": { months: 5 }, "6_months": { months: 6 },
};

const toDate = (v: Date | string | null | undefined) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * When the support period ends: order date + period (the same rule the Orders
 * page already uses for "Support validity"). Null when there is no period.
 */
export function supportEndsAt(order: { createdAt?: Date | string | null; supportPeriod?: string | null }): Date | null {
  const start = toDate(order.createdAt);
  const period = SUPPORT_PERIODS[order.supportPeriod || ""];
  if (!start || !period) return null;
  if (period.days) return new Date(start.getTime() + period.days * DAY_MS);
  const end = new Date(start.getTime());
  end.setMonth(end.getMonth() + (period.months || 0));
  return end;
}

/** Closed = delivered and the support period has ended (computed, never stored). */
export function effectiveWorkStatus(
  order: { status?: string | null; workStatus?: string | null; createdAt?: Date | string | null; supportPeriod?: string | null },
  now = new Date(),
): DisplayWorkStatus {
  const ws = storedOrMappedWorkStatus(order);
  if (ws === "delivered") {
    const ends = supportEndsAt(order);
    if (ends && ends.getTime() <= now.getTime()) return "closed";
  }
  return ws;
}

// ---- payment status ------------------------------------------------------------
export const paymentStates = ["unpaid", "advance_paid", "fully_paid", "refunded", "partially_refunded"] as const;
export type PaymentState = typeof paymentStates[number];
export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  unpaid: "Unpaid",
  advance_paid: "Advance paid",
  fully_paid: "Fully paid",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
};

const money = (v: number | null | undefined) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

/**
 * Computed from approved payments vs the total (never stored over old data).
 * `advanceAmount` is the running total of approved payments; `remainingAmount`
 * is still due. Refunds = the legacy cancel refund + approved/paid refund records.
 */
export function paymentStateOf(order: {
  status?: string | null;
  totalPrice?: number | null;
  advanceAmount?: number | null;
  remainingAmount?: number | null;
  advanceRefunded?: boolean | null;
  refundAmount?: number | null;
}, refundsTotal = 0): PaymentState {
  const paid = money(order.advanceAmount);
  const legacyRefund = order.status === "canceled" && order.advanceRefunded === true ? Math.min(paid, money(order.refundAmount)) : 0;
  const refunded = Math.min(paid, legacyRefund + money(refundsTotal));
  if (paid > 0 && refunded >= paid) return "refunded";
  if (refunded > 0) return "partially_refunded";
  if (paid > 0 && money(order.remainingAmount) === 0) return "fully_paid";
  if (paid > 0) return "advance_paid";
  return "unpaid";
}

// ---- delivery days / due date -------------------------------------------------------
/**
 * Owner-set defaults (days), used when package_configs.delivery_days is empty.
 * Keys are CRM package keys, legacy keys and website package keys.
 */
export const DEFAULT_PACKAGE_DELIVERY_DAYS: Record<string, number> = {
  ats_career: 2, ats: 2, starter: 2,
  international_career_pro: 2, international_pro: 2, "international-pro": 2, international: 2, pro: 2, professional: 2,
  executive_career_branding: 3, executive_career: 3, executive: 3,
  executive_bundle: 5, // 11.11 Bundle (website)
  portfolio_website: 5, portfolio: 5,
  resume_distribution_service: 30, resume_distribution: 30, distribution: 30,
};
export const DEFAULT_ORDER_TYPE_DELIVERY_DAYS: Record<string, number> = {
  portfolio_website: 5,
  resume_distribution: 30,
};
export const FALLBACK_DELIVERY_DAYS = 3;

/** Days for an order: package setting → package default → order type default → 3. */
export function deliveryDaysFor(
  packageKey: string | null | undefined,
  orderType: string | null | undefined,
  configured: Map<string, number | null> | Record<string, number | null | undefined> = {},
): number {
  const key = (packageKey || "").trim().toLowerCase();
  const fromConfig = configured instanceof Map ? configured.get(key) : configured[key];
  if (key && fromConfig && fromConfig > 0) return fromConfig;
  if (key && DEFAULT_PACKAGE_DELIVERY_DAYS[key]) return DEFAULT_PACKAGE_DELIVERY_DAYS[key];
  return DEFAULT_ORDER_TYPE_DELIVERY_DAYS[orderType || ""] ?? FALLBACK_DELIVERY_DAYS;
}

export function addDays(from: Date, days: number) {
  return new Date(from.getTime() + days * DAY_MS);
}

/** Stored due date, or created_at + package days for old orders (no writes). */
export function effectiveDueAt(
  order: { dueAt?: Date | string | null; createdAt?: Date | string | null; packageType?: string | null; orderType?: string | null },
  configured?: Map<string, number | null> | Record<string, number | null | undefined>,
): Date | null {
  const stored = toDate(order.dueAt);
  if (stored) return stored;
  const created = toDate(order.createdAt);
  return created ? addDays(created, deliveryDaysFor(order.packageType, order.orderType, configured)) : null;
}

/** Overdue = past the due date while still Confirmed or In progress (once a draft is sent it is no longer late). */
export function isOverdue(status: DisplayWorkStatus, dueAt: Date | null, now = new Date()) {
  if (!dueAt) return false;
  if (status !== "confirmed" && status !== "in_progress") return false;
  return dueAt.getTime() < now.getTime();
}

// ---- API shape ------------------------------------------------------------------
/** Computed block the server adds to every order response as `process`. */
export type OrderProcess = {
  workStatus: DisplayWorkStatus;
  paymentState: PaymentState;
  dueAt: string | null;
  /** True when due_at is stored (new orders); false = computed for an old order. */
  dueStored: boolean;
  overdue: boolean;
  supportEndsAt: string | null;
  /** Approved/paid refund records (not sent to designers). */
  refundedAmount?: number;
};

/** The server's `process` block, or the same values computed locally (code defaults) as a fallback. */
export function processOf(order: {
  process?: OrderProcess | null;
  status?: string | null; workStatus?: string | null; createdAt?: Date | string | null; supportPeriod?: string | null;
  dueAt?: Date | string | null; packageType?: string | null; orderType?: string | null;
  advanceAmount?: number | null; remainingAmount?: number | null; advanceRefunded?: boolean | null; refundAmount?: number | null;
}, now = new Date()): OrderProcess {
  if (order.process) return order.process;
  const workStatus = effectiveWorkStatus(order, now);
  const due = effectiveDueAt(order);
  const ends = supportEndsAt(order);
  return {
    workStatus,
    paymentState: paymentStateOf(order),
    dueAt: due ? due.toISOString() : null,
    dueStored: Boolean(order.dueAt),
    overdue: isOverdue(workStatus, due, now),
    supportEndsAt: ends ? ends.toISOString() : null,
  };
}

// ---- refunds -------------------------------------------------------------------
export const refundStatuses = ["requested", "approved", "rejected", "paid"] as const;
export type RefundStatus = typeof refundStatuses[number];
/** Refund records that reduce what was collected. */
export const COUNTED_REFUND_STATUSES: RefundStatus[] = ["approved", "paid"];
