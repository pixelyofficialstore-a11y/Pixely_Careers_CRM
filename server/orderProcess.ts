/**
 * Phase 2 server helpers: computed process fields for API responses, delivery
 * days lookup, and refund totals. Read-only (never rewrites old rows).
 */
import { and, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { packageConfigs, refunds, type Order } from "@shared/schema";
import {
  deliveryDaysFor, effectiveDueAt, effectiveWorkStatus, isOverdue, paymentStateOf, supportEndsAt, addDays,
  type OrderProcess,
} from "@shared/order-process";
export type { OrderProcess };

// ---- delivery days (package_configs.delivery_days), cached 60 s ----------------
let daysCache: { at: number; map: Map<string, number | null> } | null = null;
export async function getConfiguredDeliveryDays(): Promise<Map<string, number | null>> {
  if (daysCache && Date.now() - daysCache.at < 60_000) return daysCache.map;
  const rows = await db.select({ key: packageConfigs.key, days: packageConfigs.deliveryDays }).from(packageConfigs);
  const map = new Map(rows.map(r => [r.key.trim().toLowerCase(), r.days ?? null]));
  daysCache = { at: Date.now(), map };
  return map;
}
export function clearDeliveryDaysCache() { daysCache = null; }

/** Due date for a NEW order (stored in due_at). */
export async function dueAtForNewOrder(packageKey: string | null | undefined, orderType: string | null | undefined, from = new Date()) {
  return addDays(from, deliveryDaysFor(packageKey, orderType, await getConfiguredDeliveryDays()));
}

// ---- refunds ---------------------------------------------------------------------
/** Approved/paid refund records per order id. */
export async function getRefundTotals(orderIds: number[]): Promise<Map<number, number>> {
  const ids = [...new Set(orderIds.filter(id => Number.isInteger(id) && id > 0))];
  if (!ids.length) return new Map();
  const rows = await db.select({
    orderId: refunds.orderId,
    total: sql<number>`coalesce(sum(${refunds.approvedAmount}), 0)::int`,
  }).from(refunds)
    .where(and(inArray(refunds.orderId, ids), inArray(refunds.status, ["approved", "paid"])))
    .groupBy(refunds.orderId);
  return new Map(rows.map(r => [r.orderId, Number(r.total) || 0]));
}

// ---- computed process block --------------------------------------------------------
type ProcessInput = Pick<Order, "status" | "createdAt" | "packageType" | "orderType" | "deliveredAt" | "supportPeriod"> & Partial<Pick<Order,
  "workStatus" | "dueAt" | "advanceAmount" | "remainingAmount" | "totalPrice" | "advanceRefunded" | "refundAmount">>;

export function computeProcess(order: ProcessInput, refundsTotal: number, days: Map<string, number | null>, role: string, now = new Date()): OrderProcess {
  const workStatus = effectiveWorkStatus(order, now);
  const due = effectiveDueAt(order, days);
  const ends = supportEndsAt(order);
  return {
    workStatus,
    paymentState: paymentStateOf(order, refundsTotal),
    dueAt: due ? due.toISOString() : null,
    dueStored: Boolean(order.dueAt),
    overdue: isOverdue(workStatus, due, now),
    supportEndsAt: ends ? ends.toISOString() : null,
    ...(role === "designer" ? {} : { refundedAmount: refundsTotal }),
  };
}

/** Adds `process` to each order (one refunds query + cached package days). */
export async function withProcess<T extends ProcessInput & { id: number }>(rows: T[], role: string): Promise<Array<T & { process: OrderProcess }>> {
  const [days, totals] = await Promise.all([getConfiguredDeliveryDays(), getRefundTotals(rows.map(r => r.id))]);
  const now = new Date();
  return rows.map(r => ({ ...r, process: computeProcess(r, totals.get(r.id) || 0, days, role, now) }));
}
