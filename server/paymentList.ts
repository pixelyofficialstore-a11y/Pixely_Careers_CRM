/**
 * Payment verification list: filters and pagination happen in SQL (50/page).
 */
import { z } from "zod";
import { and, desc, eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { orders, paymentVerifications, users, type User } from "@shared/schema";

const int = z.coerce.number().int();
export const paymentListQuerySchema = z.object({
  page: int.min(1).max(100_000).default(1),
  pageSize: int.min(1).max(100).default(50),
  status: z.enum(["pending_confirmation", "approved", "disapproved"]).optional(),
  type: z.enum(["advance", "full", "remaining"]).optional(),
  role: z.enum(["admin", "support", "designer"]).optional(),
  year: int.min(2020).max(2100).optional(),
  month: int.min(1).max(12).optional(),
  day: int.min(1).max(31).optional(),
}).strict();
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

// created_at is stored as UTC without a zone; filter on the Karachi calendar date.
const localCreated = sql`((${paymentVerifications.createdAt} at time zone 'UTC') at time zone 'Asia/Karachi')`;

function visibility(user: Pick<User, "id" | "role">): SQL | undefined {
  return user.role === "admin" ? undefined : eq(paymentVerifications.submittedById, user.id);
}

const { screenshotData: _omit, ...pvColumns } = getTableColumns(paymentVerifications);
const orderSummary = {
  orderNumber: orders.orderNumber,
  clientName: orders.clientName,
  totalPrice: orders.totalPrice,
  orderId: orders.id,
};

export async function listPayments(user: Pick<User, "id" | "role">, q: PaymentListQuery) {
  const where: Array<SQL | undefined> = [
    visibility(user),
    // Admin-submitted advance/full requests are not real (admin orders auto-approve); never listed.
    sql`not (coalesce(${users.role}, '') = 'admin' and ${paymentVerifications.paymentType} in ('advance', 'full'))`,
  ];
  if (q.status) where.push(eq(paymentVerifications.status, q.status));
  if (q.type) where.push(eq(paymentVerifications.paymentType, q.type));
  if (q.role) where.push(eq(users.role, q.role));
  if (q.year) where.push(sql`extract(year from ${localCreated}) = ${q.year}`);
  if (q.month) where.push(sql`extract(month from ${localCreated}) = ${q.month}`);
  if (q.day) where.push(sql`extract(day from ${localCreated}) = ${q.day}`);
  const cond = and(...where.filter(Boolean) as SQL[]);
  const offset = (q.page - 1) * q.pageSize;
  const [rows, [{ total }]] = await Promise.all([
    db.select({ pv: pvColumns, order: orderSummary }).from(paymentVerifications)
      .leftJoin(users, eq(users.id, paymentVerifications.submittedById))
      .leftJoin(orders, eq(orders.id, paymentVerifications.orderId))
      .where(cond)
      .orderBy(desc(paymentVerifications.createdAt), desc(paymentVerifications.id))
      .limit(q.pageSize).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(paymentVerifications)
      .leftJoin(users, eq(users.id, paymentVerifications.submittedById))
      .where(cond),
  ]);
  return { rows, total: Number(total) || 0, page: q.page, pageSize: q.pageSize };
}

/** One payment (deep link), with the same visibility rules. */
export async function getPaymentForUser(user: Pick<User, "id" | "role">, id: number) {
  const [row] = await db.select({ pv: pvColumns, order: orderSummary }).from(paymentVerifications)
    .leftJoin(orders, eq(orders.id, paymentVerifications.orderId))
    .where(and(eq(paymentVerifications.id, id), visibility(user)))
    .limit(1);
  return row ?? null;
}
