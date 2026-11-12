/**
 * Per-role home dashboard (Phase 4). Read-only: every number is a query.
 *
 *  Admin    : Today's orders · To verify · Overdue · Collected this month
 *             + "Needs your action" list + total orders (all time)
 *  Support  : Payments to submit · Follow-ups due · My orders this month
 *             (+ "New requests" comes from /api/website-requests/counts on the client)
 *             + action list
 *  Designer : My queue · Due today · Overdue · Delivered this month + queue by due date
 *
 * Definitions
 *  - Overdue / due: stored due_at, or the computed due date for old orders (same as the Orders page).
 *  - Payments to submit (support): requests I created that are still waiting for payment and have
 *    no payment screenshot pending review.
 *  - Follow-ups due (support): my placed orders with a draft sent / revisions (status 'ready'),
 *    i.e. waiting on the client.
 */
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { orders, type User } from "@shared/schema";
import { getStartOfBusinessDay, getStartOfBusinessMonth } from "@shared/business-time";
import { sqlEffectiveDue, sqlOverdue, visibility } from "./orderList";
import { getDashboardMetrics } from "./metrics";

const n = (v: unknown) => Number(v || 0);
const ACTIVE = ["new", "working", "ready"] as const;

export type ActionItem = { kind: string; title: string; detail?: string; href: string; count?: number; tone?: "danger" | "warning" | "info" };
export type QueueItem = { id: number; orderNumber: string | null; clientName: string; status: string; workStatus: string | null; dueAt: string | null; overdue: boolean };

async function countOrders(where: ReturnType<typeof and>) {
  const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(orders).where(where);
  return n(r?.c);
}

async function queue(where: ReturnType<typeof and>, limit = 20): Promise<QueueItem[]> {
  const due = sqlEffectiveDue();
  const rows = await db.select({
    id: orders.id, orderNumber: orders.orderNumber, clientName: orders.clientName, status: orders.status,
    workStatus: orders.workStatus, dueAt: sql<string>`to_char(${due}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
    overdue: sql<boolean>`${sqlOverdue()}`,
  }).from(orders).where(where).orderBy(asc(due), asc(orders.id)).limit(limit);
  return rows.map(r => ({ ...r, overdue: Boolean(r.overdue) }));
}

export async function adminHome(user: Pick<User, "id" | "role">) {
  const now = new Date();
  const placed = visibility(user);
  const [dash, verify, overdue, overdueTop, requests, refunds, complaints, website] = await Promise.all([
    getDashboardMetrics({ role: "admin", id: user.id }),
    pool.query(
      `select pv.id, pv.amount, pv.payment_type, o.order_number, o.client_name
         from payment_verifications pv join orders o on o.id = pv.order_id
        where pv.status = 'pending_confirmation' order by pv.created_at asc limit 5`,
    ),
    countOrders(and(placed, sqlOverdue())),
    queue(and(placed, sqlOverdue()), 5),
    pool.query(`select count(*)::int as c from orders where status = 'pending_payment' and coalesce(advance_payment_status,'pending') <> 'approved'`),
    pool.query(`select count(*)::int as c from refunds where status = 'requested'`).catch(() => ({ rows: [{ c: 0 }] })),
    pool.query(`select count(*)::int as c from complaints where status = 'new'`).catch(() => ({ rows: [{ c: 0 }] })),
    pool.query(`select count(*)::int as c from website.orders where status = 'pending_approval' and crm_order_id is null`).catch(() => ({ rows: [{ c: 0 }] })),
  ]);
  const verifyCount = await pool.query(`select count(*)::int as c from payment_verifications where status = 'pending_confirmation'`);

  const actions: ActionItem[] = [];
  for (const p of verify.rows) {
    actions.push({ kind: "verify", tone: "warning", title: `Verify payment · ${p.order_number || "Request"}`, detail: `${p.client_name} · Rs ${Math.round(n(p.amount) / 100).toLocaleString("en-PK")}`, href: "/payments" });
  }
  for (const o of overdueTop) {
    actions.push({ kind: "overdue", tone: "danger", title: `Overdue · ${o.orderNumber}`, detail: o.clientName, href: `/orders?order=${encodeURIComponent(o.orderNumber || String(o.id))}` });
  }
  const approvals = n(website.rows[0]?.c);
  if (approvals) actions.push({ kind: "approval", tone: "info", title: "Website orders to approve", count: approvals, href: "/website-requests" });
  const req = n(requests.rows[0]?.c);
  if (req) actions.push({ kind: "requests", tone: "info", title: "Requests waiting for payment", count: req, href: "/orders" });
  const rf = n(refunds.rows[0]?.c);
  if (rf) actions.push({ kind: "refunds", tone: "warning", title: "Refunds to review", count: rf, href: "/orders" });
  const cp = n(complaints.rows[0]?.c);
  if (cp) actions.push({ kind: "complaints", tone: "danger", title: "New complaints", count: cp, href: "/complaints" });

  return {
    role: "admin" as const,
    generatedAt: now.toISOString(),
    stats: {
      todayOrders: dash.orders.today,
      toVerify: n(verifyCount.rows[0]?.c),
      overdue,
      collectedThisMonth: n(dash.finance?.collectedThisMonth),
    },
    totalAllTime: dash.orders.totalAllTime,
    actions,
  };
}

export async function supportHome(user: Pick<User, "id" | "role">) {
  const month = getStartOfBusinessMonth();
  const mine = eq(orders.createdById, user.id);
  const waiting = sql`${orders.status} = 'pending_payment' and coalesce(${orders.advancePaymentStatus}, 'pending') <> 'approved'
    and not exists (select 1 from payment_verifications pv where pv.order_id = ${orders.id} and pv.status = 'pending_confirmation')`;
  const followUp = and(visibility(user), mine, eq(orders.status, "ready"));
  const [toSubmit, toSubmitList, followUps, followUpList, myMonth, rejected] = await Promise.all([
    countOrders(and(mine, waiting)),
    queue(and(mine, waiting), 5),
    countOrders(followUp),
    queue(followUp, 5),
    countOrders(and(visibility(user), mine, gte(orders.createdAt, month))),
    pool.query(
      `select o.id, o.order_number, o.client_name from payment_verifications pv join orders o on o.id = pv.order_id
        where pv.status = 'disapproved' and pv.submitted_by_id = $1 and pv.reviewed_at >= now() - interval '7 days'
        order by pv.reviewed_at desc limit 5`,
      [user.id],
    ),
  ]);
  const actions: ActionItem[] = [
    ...rejected.rows.map((r: any) => ({ kind: "rejected", tone: "danger" as const, title: `Payment not approved · ${r.order_number || "Request"}`, detail: r.client_name, href: "/payments" })),
    ...toSubmitList.map(o => ({ kind: "submit", tone: "warning" as const, title: `Submit payment · ${o.clientName}`, detail: "Waiting for payment screenshot", href: "/payments" })),
    ...followUpList.map(o => ({ kind: "follow", tone: "info" as const, title: `Follow up · ${o.orderNumber}`, detail: o.clientName, href: `/orders?order=${encodeURIComponent(o.orderNumber || String(o.id))}` })),
  ];
  return { role: "support" as const, generatedAt: new Date().toISOString(), stats: { paymentsToSubmit: toSubmit, followUpsDue: followUps, myOrdersThisMonth: myMonth }, actions };
}

export async function designerHome(user: Pick<User, "id" | "role">) {
  const today = getStartOfBusinessDay();
  const tomorrow = new Date(today.getTime() + 24 * 3600_000);
  const month = getStartOfBusinessMonth();
  const vis = visibility(user);
  const active = and(vis, inArray(orders.status, ACTIVE));
  const due = sqlEffectiveDue();
  const [myQueue, dueToday, overdue, delivered, list] = await Promise.all([
    countOrders(active),
    countOrders(and(vis, inArray(orders.status, ["new", "working"] as const), sql`${due} >= ${today.toISOString()}::timestamp`, sql`${due} < ${tomorrow.toISOString()}::timestamp`)),
    countOrders(and(vis, sqlOverdue())),
    countOrders(and(vis, eq(orders.status, "delivered"), sql`coalesce(${orders.deliveredAt}, ${orders.createdAt}) >= ${month.toISOString()}::timestamp`)),
    queue(active, 30),
  ]);
  return { role: "designer" as const, generatedAt: new Date().toISOString(), stats: { myQueue, dueToday, overdue, deliveredThisMonth: delivered }, queue: list };
}
