/**
 * Server-side order listing: filtering, search and pagination happen in SQL.
 * No endpoint returns every order.
 */
import { z } from "zod";
import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { orders, orderServices, users, type OrderService, type OrderWithServices, type User } from "@shared/schema";
import { getStartOfBusinessDay } from "@shared/business-time";
import { DEFAULT_PACKAGE_DELIVERY_DAYS, DEFAULT_ORDER_TYPE_DELIVERY_DAYS, FALLBACK_DELIVERY_DAYS } from "@shared/order-process";
import { businessMonthRange } from "./metrics";

/** Status filter keys used by the Orders page (old status values; Phase 2 maps them). */
export const ORDER_STATUS_FILTERS: Record<string, string[]> = {
  pending: ["pending_payment", "new"],
  working: ["working"],
  ready: ["ready"],
  delivered: ["delivered"],
  canceled: ["canceled"],
};

const int = z.coerce.number().int();
export const orderListQuerySchema = z.object({
  page: int.min(1).max(100_000).default(1),
  pageSize: int.min(1).max(100).default(50),
  search: z.string().trim().max(100).optional(),
  status: z.enum(["pending", "working", "ready", "delivered", "canceled", "overdue"]).optional(),
  /** Phase 2: "requests" = orders still waiting for a verified payment or pay-later approval (admin, support). */
  view: z.enum(["requests"]).optional(),
  designerId: int.positive().optional(),
  orderType: z.enum(["documentation", "resume_distribution", "portfolio_website"]).optional(),
  period: z.enum(["today", "month", "all"]).default("all"),
  year: int.min(2020).max(2100).optional(),
  month: int.min(1).max(12).optional(),
}).strict();
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const orderLookupQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  limit: int.min(1).max(50).default(10),
  /** Only orders with a designer assigned (complaints). */
  assigned: z.enum(["1"]).optional(),
  /** Only open orders that still have a balance to collect (remaining-payment form). */
  withBalance: z.enum(["1"]).optional(),
}).strict();
export type OrderLookupQuery = z.infer<typeof orderLookupQuerySchema>;

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, ch => `\\${ch}`);
}

/** Order ID / client name / phone (digits only) search. */
function searchCondition(raw: string): SQL | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const like = `%${escapeLike(text.toLowerCase())}%`;
  const digits = text.replace(/\D/g, "");
  const parts: SQL[] = [
    sql`lower(coalesce(${orders.orderNumber}, '')) like ${like}`,
    sql`lower(${orders.clientName}) like ${like}`,
  ];
  if (digits.length >= 3) {
    parts.push(sql`regexp_replace(coalesce(${orders.clientPhone}, ''), '\\D', '', 'g') like ${`%${digits}%`}`);
  }
  return or(...parts);
}

/** Who can see what: everyone sees placed (approved) orders only; designers only their own. */
function visibility(user: Pick<User, "id" | "role">): SQL {
  const placed = eq(orders.advancePaymentStatus, "approved");
  return user.role === "designer" ? and(placed, eq(orders.assignedToId, user.id))! : placed;
}

/** SQL delivery days for an order (package setting → package default → order type default → 3). Mirrors deliveryDaysFor(). */
function sqlDeliveryDays(): SQL {
  const pkg = Object.entries(DEFAULT_PACKAGE_DELIVERY_DAYS).map(([k, d]) => sql`when ${k} then ${d}::int`);
  const type = Object.entries(DEFAULT_ORDER_TYPE_DELIVERY_DAYS).map(([k, d]) => sql`when ${k} then ${d}::int`);
  return sql`coalesce(
    (select pc.delivery_days from package_configs pc where lower(pc.key) = lower(trim(${orders.packageType})) and pc.delivery_days > 0 limit 1),
    case lower(trim(coalesce(${orders.packageType}, ''))) ${sql.join(pkg, sql` `)} else null end,
    case ${orders.orderType} ${sql.join(type, sql` `)} else null end,
    ${FALLBACK_DELIVERY_DAYS}::int)`;
}
/** Overdue (Confirmed / In progress past the stored or computed due date). Mirrors isOverdue(). */
export function sqlOverdue(): SQL {
  return sql`(${orders.status} in ('new', 'working')
    and coalesce(${orders.dueAt}, ${orders.createdAt} + make_interval(days => ${sqlDeliveryDays()})) < (now() at time zone 'utc'))`;
}

export function buildOrderListWhere(user: Pick<User, "id" | "role">, q: OrderListQuery): SQL {
  if (q.view === "requests" && user.role !== "designer") {
    // Requests are not orders yet: only these rows, no other visibility rule.
    const where: Array<SQL | undefined> = [sql`${orders.status} = 'pending_payment' and coalesce(${orders.advancePaymentStatus}, 'pending') <> 'approved'`];
    if (q.search) where.push(searchCondition(q.search));
    return and(...where.filter(Boolean) as SQL[])!;
  }
  const where: Array<SQL | undefined> = [visibility(user)];
  if (q.status === "overdue") where.push(sqlOverdue());
  else if (q.status) where.push(inArray(orders.status, ORDER_STATUS_FILTERS[q.status] as any));
  if (q.designerId && user.role !== "designer") where.push(eq(orders.assignedToId, q.designerId));
  if (q.orderType) where.push(sql`coalesce(${orders.orderType}, 'documentation') = ${q.orderType}`);
  if (q.search) {
    // Search ignores the period so it finds orders from any month.
    where.push(searchCondition(q.search));
  } else if (q.period === "today") {
    where.push(gte(orders.createdAt, getStartOfBusinessDay()));
  } else if (q.period === "month" && q.year && q.month) {
    const { start, end } = businessMonthRange(q.year, q.month);
    where.push(gte(orders.createdAt, start), lt(orders.createdAt, end));
  }
  return and(...where.filter(Boolean) as SQL[])!;
}

export async function listOrders(user: Pick<User, "id" | "role">, q: OrderListQuery, usersById: Map<number, User>) {
  const where = buildOrderListWhere(user, q);
  const offset = (q.page - 1) * q.pageSize;
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(orders).where(where).orderBy(desc(orders.createdAt), desc(orders.id)).limit(q.pageSize).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(orders).where(where),
  ]);
  const ids = rows.map(r => r.id);
  const services = ids.length ? await db.select().from(orderServices).where(inArray(orderServices.orderId, ids)) : [];
  const byOrder = new Map<number, OrderService[]>();
  for (const s of services) {
    const list = byOrder.get(s.orderId);
    if (list) list.push(s); else byOrder.set(s.orderId, [s]);
  }
  const withServices: OrderWithServices[] = rows.map(o => ({
    ...o,
    services: byOrder.get(o.id) || [],
    assignee: o.assignedToId ? usersById.get(o.assignedToId) ?? null : null,
  }));
  return { rows: withServices, total: Number(total) || 0, page: q.page, pageSize: q.pageSize };
}

/** Small picker search (complaints, feedback, payments forms). */
export async function lookupOrders(user: Pick<User, "id" | "role">, q: OrderLookupQuery) {
  const where: Array<SQL | undefined> = [visibility(user)];
  if (q.q) where.push(searchCondition(q.q));
  if (q.assigned) where.push(sql`${orders.assignedToId} is not null`);
  if (q.withBalance) {
    where.push(sql`${orders.status} <> 'canceled' and coalesce(${orders.remainingAmount}, 0) > 0 and coalesce(${orders.paymentStatus}, '') <> 'paid'`);
  }
  return db.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    clientName: orders.clientName,
    status: orders.status,
    assignedToId: orders.assignedToId,
    assigneeName: users.name,
    remainingAmount: orders.remainingAmount,
    createdAt: orders.createdAt,
  }).from(orders)
    .leftJoin(users, eq(users.id, orders.assignedToId))
    .where(and(...where.filter(Boolean) as SQL[]))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(q.limit);
}

/** Resolve an order by its number (or numeric id) for deep links. */
export async function findOrderRef(user: Pick<User, "id" | "role">, ref: string) {
  const byNumber = eq(orders.orderNumber, ref);
  const cond = /^\d{1,10}$/.test(ref) ? or(byNumber, eq(orders.id, Number(ref))) : byNumber;
  const [row] = await db.select({ id: orders.id }).from(orders).where(and(visibility(user), cond)).limit(1);
  return row?.id ?? null;
}
