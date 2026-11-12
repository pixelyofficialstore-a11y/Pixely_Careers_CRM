/**
 * Background notifications (every 15 minutes). Read-only on orders; only
 * notification rows are created, each deduped so it fires once.
 *
 *  ⏰ Overdue    – orders with a STORED due date (new orders only, per the owner)
 *                  past due and still Confirmed / In progress → admins + designer,
 *                  once per due date. Old orders (no due_at) only show red in the UI.
 *  ⏰ Due today  – same orders, due later today (Pakistan time), from 9 AM →
 *                  admins + designer, once per order per day.
 *  📊 Summary    – 9 PM Pakistan time → admins, once per day.
 */
import { pool } from "./db";
import { storage } from "./storage";
import { dispatchNotifications } from "./routes/shared";
import { getDashboardMetrics, SQL_ACCOUNTED_TOTAL } from "./metrics";
import { getStartOfBusinessDay } from "@shared/business-time";
import { businessMinutesOfDay, rsFromPaisa, shortName } from "@shared/notification-events";

const INTERVAL_MS = 15 * 60 * 1000;
const DUE_TODAY_FROM = 9 * 60;   // 09:00 PKT
const SUMMARY_AT = 21 * 60;      // 21:00 PKT

const ACTIVE = `o.status in ('new', 'working') and o.advance_payment_status = 'approved'`;

/** Pakistan date key, e.g. 2026-11-12. */
function businessDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(now);
}

async function notifyOrders(rows: any[], adminIds: number[], build: (o: any) => { event: "order_overdue" | "order_due_today"; title: string; sourceEventId: string }) {
  for (const o of rows) {
    const recipients = [...new Set([...adminIds, ...(o.assigned_to_id ? [Number(o.assigned_to_id)] : [])])];
    const b = build(o);
    await dispatchNotifications(recipients, {
      event: b.event,
      type: "order",
      title: b.title,
      message: [o.order_number, shortName(o.client_name)].filter(Boolean).join(" · "),
      priority: "action_required",
      relatedId: Number(o.id),
      relatedType: "order",
      sourceEventId: b.sourceEventId,
    });
  }
}

export async function notifyOverdueOrders(now = new Date()) {
  const r = await pool.query(
    `select o.id, o.order_number, o.client_name, o.assigned_to_id,
            to_char(o.due_at, 'YYYY-MM-DD"T"HH24:MI') as due_key
       from orders o
      where o.due_at is not null and o.due_at < $1 and ${ACTIVE}
      order by o.due_at asc
      limit 200`,
    [now.toISOString()],
  );
  if (!r.rows.length) return 0;
  const adminIds = (await storage.getAdmins()).map(a => a.id);
  // One notification per due date (a changed due date can notify again).
  await notifyOrders(r.rows, adminIds, o => ({ event: "order_overdue", title: "⏰ Overdue", sourceEventId: `overdue:${o.id}:${o.due_key}` }));
  return r.rows.length;
}

export async function notifyDueToday(now = new Date()) {
  if (businessMinutesOfDay(now) < DUE_TODAY_FROM) return 0;
  const endOfDay = new Date(getStartOfBusinessDay(now).getTime() + 24 * 60 * 60 * 1000);
  const r = await pool.query(
    `select o.id, o.order_number, o.client_name, o.assigned_to_id
       from orders o
      where o.due_at is not null and o.due_at >= $1 and o.due_at < $2 and ${ACTIVE}
      order by o.due_at asc
      limit 200`,
    [now.toISOString(), endOfDay.toISOString()],
  );
  if (!r.rows.length) return 0;
  const adminIds = (await storage.getAdmins()).map(a => a.id);
  const day = businessDateKey(now);
  await notifyOrders(r.rows, adminIds, o => ({ event: "order_due_today", title: "⏰ Due today", sourceEventId: `due-today:${o.id}:${day}` }));
  return r.rows.length;
}

/** Numbers for the 9 PM summary (also used by tests / a manual preview). */
export async function buildDailySummary(now = new Date()) {
  const today = getStartOfBusinessDay(now);
  const [dash, placed, verify, overdue] = await Promise.all([
    getDashboardMetrics({ role: "admin", id: 0 }),
    pool.query(
      `select count(*)::int as n, coalesce(sum(${SQL_ACCOUNTED_TOTAL}),0)::bigint as sales
         from orders o where o.advance_payment_status = 'approved' and o.created_at >= $1`,
      [today.toISOString()],
    ),
    pool.query(`select count(*)::int as n from payment_verifications where status = 'pending_confirmation'`),
    pool.query(`select count(*)::int as n from orders o where o.due_at is not null and o.due_at < $1 and ${ACTIVE}`, [now.toISOString()]),
  ]);
  return {
    orders: Number(placed.rows[0]?.n || 0),
    sales: Number(placed.rows[0]?.sales || 0),
    collected: Number(dash.finance?.today?.total || 0),
    toVerify: Number(verify.rows[0]?.n || 0),
    overdue: Number(overdue.rows[0]?.n || 0),
  };
}

export async function notifyDailySummary(now = new Date()) {
  if (businessMinutesOfDay(now) < SUMMARY_AT) return false;
  const s = await buildDailySummary(now);
  const parts = [
    `${s.orders} order${s.orders === 1 ? "" : "s"}`,
    `${rsFromPaisa(s.sales)} sales`,
    `${rsFromPaisa(s.collected)} collected`,
    s.toVerify ? `${s.toVerify} to verify` : null,
    s.overdue ? `${s.overdue} overdue` : null,
  ].filter(Boolean);
  const adminIds = (await storage.getAdmins()).map(a => a.id);
  await dispatchNotifications(adminIds, {
    event: "daily_summary",
    type: "summary",
    title: "📊 Today's summary",
    message: parts.join(" · "),
    priority: "update",
    relatedType: "dashboard",
    sourceEventId: `summary:${businessDateKey(now)}`,
  });
  return true;
}

export function startOverdueNotifier() {
  if (process.env.CRM_DISABLE_BACKGROUND === "1") return; // tests
  // Local dev talks to the live database: never send scheduled alerts from a
  // dev machine unless explicitly asked (CRM_ENABLE_JOBS=1).
  if (process.env.NODE_ENV !== "production" && process.env.CRM_ENABLE_JOBS !== "1") return;
  const tick = async () => {
    for (const [name, job] of [["overdue", notifyOverdueOrders], ["due-today", notifyDueToday], ["summary", notifyDailySummary]] as const) {
      try { await job(); } catch (err: any) { console.error(`[notifications] ${name} scan failed:`, err?.message || err); }
    }
  };
  setInterval(tick, INTERVAL_MS).unref?.();
  setTimeout(tick, 30_000).unref?.();
}
