/**
 * server/metrics.ts — the single source of every number shown on the
 * Dashboard, Analytics and the Orders summary cards.
 *
 * Everything is a SQL aggregate (no "load all orders and count in JS").
 * Results are cached for 30s per (viewer, period) and dropped whenever an
 * order or payment changes (invalidateMetrics(), called from the write hook in
 * routes.ts).
 *
 * Money is in paisa (CRM tables). Convert to rupees only for display.
 *
 * Definitions (owner-approved, keep exactly):
 *  - Total orders (all time) = all orders placed − canceled. "Placed" means the
 *    advance was approved (advance_payment_status = 'approved'); payment
 *    requests that were never approved are not orders yet. This is the same
 *    logic as the old "Active orders" card, renamed.
 *  - In progress = confirmed (approved) and not delivered/canceled.
 *  - Sales       = value of orders booked in the period (net collected + still receivable).
 *  - Collected   = approved payments in the period (+ advances on admin-created
 *                  orders, which are approved without a payment record).
 *  - Outstanding = total due − collected on non-canceled orders.
 *  - Refunded    = refunds recorded in the period (cancel refunds + approved refund records).
 */
import { pool } from "./db";
import { getStartOfBusinessDay, getStartOfBusinessMonth, BUSINESS_TIME_ZONE } from "@shared/business-time";

export type Viewer = { role: string; id: number };

// ---- SQL building blocks (mirror shared/order-accounting.ts exactly) --------
const ADV = "greatest(coalesce(o.advance_amount, 0), 0)";
const REM = "greatest(coalesce(o.remaining_amount, 0), 0)";
const LEGACY_REFUND = `(case when o.status = 'canceled' and o.advance_refunded is true then greatest(coalesce(o.refund_amount, 0), 0) else 0 end)`;
/** Phase 2 refund records (approved or paid) on one order. */
const RECORD_REFUNDS = `coalesce((select sum(r.approved_amount) from refunds r where r.order_id = o.id and r.status in ('approved', 'paid')), 0)`;
const REFUND = `least(${ADV}, ${LEGACY_REFUND} + ${RECORD_REFUNDS})`;
/** Net collected on one order. */
export const SQL_NET_COLLECTED = `greatest(0, ${ADV} - ${REFUND})`;
/** Remaining receivable on one order (0 when canceled). */
export const SQL_REMAINING_RECEIVABLE = `(case when o.status = 'canceled' then 0 else ${REM} end)`;
/** Accounted total = net collected + remaining receivable. */
export const SQL_ACCOUNTED_TOTAL = `(${SQL_NET_COLLECTED} + ${SQL_REMAINING_RECEIVABLE})`;

/** Orders visible to a viewer; always only "placed" (approved) orders. Uses $1 for the viewer id when designer. */
function visibleOrders(viewer: Viewer, alias = "o") {
  const placed = `${alias}.advance_payment_status = 'approved'`;
  return viewer.role === "designer" ? `${placed} and ${alias}.assigned_to_id = $1` : placed;
}
function viewerParams(viewer: Viewer): unknown[] {
  return viewer.role === "designer" ? [viewer.id] : [];
}

/** UTC ISO strings: created_at etc. are `timestamp without time zone` stored in UTC. */
const iso = (d: Date) => d.toISOString();

export function businessMonthRange(year: number, month1to12: number) {
  // Middle of the month in Karachi time, then snap to the business-month start.
  const mid = new Date(Date.UTC(year, month1to12 - 1, 15, 12));
  const start = getStartOfBusinessMonth(mid);
  const nextMid = new Date(Date.UTC(month1to12 === 12 ? year + 1 : year, month1to12 === 12 ? 0 : month1to12, 15, 12));
  const end = getStartOfBusinessMonth(nextMid);
  return { start, end };
}

// ---- cache --------------------------------------------------------------------
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

export function invalidateMetrics() {
  cache.clear();
}

function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = compute();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  return value;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

// ---- dashboard ----------------------------------------------------------------
export type DashboardMetrics = Awaited<ReturnType<typeof computeDashboard>>;

export function getDashboardMetrics(viewer: Viewer) {
  return cached(`dash:${viewer.role}:${viewer.role === "designer" ? viewer.id : "all"}`, () => computeDashboard(viewer));
}

async function computeDashboard(viewer: Viewer) {
  const today = getStartOfBusinessDay();
  const month = getStartOfBusinessMonth();
  const vis = visibleOrders(viewer);
  const p = viewerParams(viewer);
  const t = p.length + 1; // index of the first date param
  const m = p.length + 2;

  const ordersQ = pool.query(
    `select
       count(*) filter (where o.status <> 'canceled')::int                                         as total_all_time,
       count(*)::int                                                                              as placed_all_time,
       count(*) filter (where o.created_at >= $${t})::int                                          as today,
       count(*) filter (where o.created_at >= $${m})::int                                          as this_month,
       count(*) filter (where o.status in ('new','working','ready'))::int                          as in_progress,
       count(*) filter (where o.status in ('new','working'))::int                                  as pending,
       count(*) filter (where o.status = 'new')::int                                               as s_new,
       count(*) filter (where o.status = 'working')::int                                           as s_working,
       count(*) filter (where o.status = 'ready')::int                                             as s_ready,
       count(*) filter (where o.status = 'delivered')::int                                         as s_delivered,
       count(*) filter (where o.status = 'canceled')::int                                          as s_canceled,
       count(*) filter (where o.created_at >= $${m} and o.status in ('ready','delivered'))::int    as completed_this_month,
       count(*) filter (where o.created_at >= $${m} and o.status = 'canceled')::int                as canceled_this_month,
       count(*) filter (where o.payment_status = 'paid')::int                                      as payment_paid,
       count(*) filter (where o.payment_status = 'pending')::int                                   as payment_pending
     from orders o where ${vis}`,
    [...p, iso(today), iso(month)],
  );

  const recentQ = pool.query(
    `select o.id, o.order_number as "orderNumber", o.client_name as "clientName", o.status, o.created_at as "createdAt"
     from orders o where ${vis} order by o.created_at desc nulls last, o.id desc limit 6`,
    p,
  );

  const designersQ = viewer.role === "admin"
    ? pool.query(
        `select u.id, u.name,
                count(o.id)::int as assigned,
                count(o.id) filter (where o.status in ('new','working'))::int as active,
                count(o.id) filter (where o.status in ('ready','delivered'))::int as completed
         from users u
         left join orders o on o.assigned_to_id = u.id and o.advance_payment_status = 'approved'
         where u.role = 'designer' and u.is_active
         group by u.id, u.name order by u.name`,
      )
    : Promise.resolve({ rows: [] as any[] });

  const financeQ = viewer.role === "admin" ? computeFinance(today, month) : Promise.resolve(undefined);

  const [ordersR, recentR, designersR, finance] = await Promise.all([ordersQ, recentQ, designersQ, financeQ]);
  const o = ordersR.rows[0] || {};
  return {
    generatedAt: new Date().toISOString(),
    timeZone: BUSINESS_TIME_ZONE,
    orders: {
      totalAllTime: n(o.total_all_time),
      placedAllTime: n(o.placed_all_time),
      today: n(o.today),
      thisMonth: n(o.this_month),
      inProgress: n(o.in_progress),
      pending: n(o.pending),
      byStatus: {
        new: n(o.s_new),
        working: n(o.s_working),
        ready: n(o.s_ready),
        delivered: n(o.s_delivered),
        canceled: n(o.s_canceled),
      },
      completedThisMonth: n(o.completed_this_month),
      canceledThisMonth: n(o.canceled_this_month),
      paymentPaid: n(o.payment_paid),
      paymentPending: n(o.payment_pending),
    },
    recentOrders: recentR.rows as Array<{ id: number; orderNumber: string | null; clientName: string; status: string; createdAt: string }>,
    designers: designersR.rows.map(r => ({ id: r.id as number, name: r.name as string, assigned: n(r.assigned), active: n(r.active), completed: n(r.completed) })),
    finance,
  };
}


const PLACED = "o.advance_payment_status = 'approved'";
const FAR_FUTURE = new Date(Date.UTC(9999, 0, 1));

/** Collected in [start, end): approved payments + advances on admin-created orders approved without a payment row. */
async function collectedBetween(start: Date, end: Date = FAR_FUTURE) {
  const [payments, direct] = await Promise.all([
    pool.query(
      `select coalesce(sum(pv.amount),0)::bigint as v
       from payment_verifications pv join orders o on o.id = pv.order_id
       where pv.status = 'approved' and pv.reviewed_at >= $1 and pv.reviewed_at < $2 and ${PLACED}`,
      [iso(start), iso(end)],
    ),
    pool.query(
      `select coalesce(sum(greatest(0, coalesce(o.advance_amount,0) - coalesce(pm.paid,0))),0)::bigint as v
       from orders o
       join users u on u.id = o.created_by_id and u.role = 'admin'
       left join lateral (
         select sum(pv.amount) as paid, bool_or(pv.payment_type in ('advance','full')) as has_initial
         from payment_verifications pv
         where pv.order_id = o.id and pv.status = 'approved' and pv.reviewed_at >= $1 and pv.reviewed_at < $2
       ) pm on true
       where ${PLACED} and o.created_at >= $1 and o.created_at < $2 and coalesce(pm.has_initial, false) = false`,
      [iso(start), iso(end)],
    ),
  ]);
  return n(payments.rows[0]?.v) + n(direct.rows[0]?.v);
}

/** Refunds recorded in [start, end). */
async function refundedBetween(start: Date, end: Date = FAR_FUTURE) {
  const [legacy, records] = await Promise.all([
    pool.query(
      `select coalesce(sum(o.refund_amount),0)::bigint as v from orders o
       where ${PLACED} and o.status = 'canceled' and coalesce(o.refund_amount,0) > 0 and o.refund_recorded_at >= $1 and o.refund_recorded_at < $2`,
      [iso(start), iso(end)],
    ),
    // Phase 2 refund records count on the day the admin approved them.
    pool.query(
      `select coalesce(sum(r.approved_amount),0)::bigint as v from refunds r join orders o on o.id = r.order_id
       where ${PLACED} and r.status in ('approved', 'paid') and r.decided_at >= $1 and r.decided_at < $2`,
      [iso(start), iso(end)],
    ),
  ]);
  return n(legacy.rows[0]?.v) + n(records.rows[0]?.v);
}

/** Admin finance block for "today" and "this month" (business time). */
async function computeFinance(today: Date, month: Date) {
  const placed = "o.advance_payment_status = 'approved'";
  const [totalsR, monthOrdersR, inflow, refunds, todayR] = await Promise.all([
    // all-time collected + outstanding
    pool.query(`select coalesce(sum(${SQL_NET_COLLECTED}),0)::bigint as collected, coalesce(sum(${SQL_REMAINING_RECEIVABLE}),0)::bigint as outstanding from orders o where ${placed}`),
    // orders booked this month: sales, collected-on-these-orders, remaining
    pool.query(
      `select coalesce(sum(${SQL_ACCOUNTED_TOTAL}),0)::bigint as sales,
              coalesce(sum(${SQL_NET_COLLECTED}),0)::bigint as collected_on_month_orders,
              coalesce(sum(${SQL_REMAINING_RECEIVABLE}),0)::bigint as remaining
       from orders o where ${placed} and o.created_at >= $1`,
      [iso(month)],
    ),
    collectedBetween(month),
    refundedBetween(month),
    // today's cash flow
    pool.query(
      `with collected_orders as (
         select o.id from orders o where ${placed} and ${SQL_NET_COLLECTED} > 0
       ),
       pay as (
         select pv.order_id, pv.payment_type, pv.amount
         from payment_verifications pv
         where pv.status = 'approved' and pv.reviewed_at >= $1 and pv.order_id in (select id from collected_orders)
       )
       select
         coalesce((select sum(amount) from pay where payment_type in ('advance','full')),0)::bigint as verified_advance,
         coalesce((select sum(amount) from pay where payment_type = 'remaining'),0)::bigint as remaining_received,
         coalesce((
           select sum(${SQL_NET_COLLECTED}) from orders o
           join users u on u.id = o.created_by_id and u.role = 'admin'
           where ${placed} and o.created_at >= $1 and ${SQL_NET_COLLECTED} > 0
             and o.id not in (select order_id from pay where payment_type in ('advance','full'))
         ),0)::bigint as direct_advance`,
      [iso(today)],
    ),
  ]);

  const advanceToday = n(todayR.rows[0]?.verified_advance) + n(todayR.rows[0]?.direct_advance);
  const remainingToday = n(todayR.rows[0]?.remaining_received);
  return {
    salesThisMonth: n(monthOrdersR.rows[0]?.sales),
    collectedThisMonth: inflow,
    collectedOnMonthOrders: n(monthOrdersR.rows[0]?.collected_on_month_orders),
    remainingOnMonthOrders: n(monthOrdersR.rows[0]?.remaining),
    refundedThisMonth: refunds,
    netCashThisMonth: inflow - refunds,
    collectedAllTime: n(totalsR.rows[0]?.collected),
    outstanding: n(totalsR.rows[0]?.outstanding),
    today: { advance: advanceToday, remaining: remainingToday, total: advanceToday + remainingToday },
  };
}

// ---- orders summary (Orders page cards) ----------------------------------------
export type OrdersSummaryFilters = { year: number; month: number; status?: string[]; designerId?: number; orderType?: string };

export function getOrdersSummary(viewer: Viewer, f: OrdersSummaryFilters) {
  return cached(`ordsum:${viewer.role}:${viewer.id}:${JSON.stringify(f)}`, async () => {
    const { start, end } = businessMonthRange(f.year, f.month);
    const today = getStartOfBusinessDay();
    const params: unknown[] = [...viewerParams(viewer)];
    const where = [visibleOrders(viewer)];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (f.status?.length) where.push(`o.status = any(${add(f.status)})`);
    if (f.designerId) where.push(`o.assigned_to_id = ${add(f.designerId)}`);
    if (f.orderType) where.push(`coalesce(o.order_type,'documentation') = ${add(f.orderType)}`);
    const s = add(iso(start)), e = add(iso(end)), t = add(iso(today));
    const r = await pool.query(
      `select
         count(*) filter (where o.created_at >= ${s} and o.created_at < ${e})::int as month_count,
         coalesce(sum(${SQL_ACCOUNTED_TOTAL}) filter (where o.created_at >= ${s} and o.created_at < ${e}),0)::bigint as month_sales,
         coalesce(sum(${SQL_NET_COLLECTED}) filter (where o.created_at >= ${s} and o.created_at < ${e}),0)::bigint as month_collected,
         coalesce(sum(${SQL_REMAINING_RECEIVABLE}) filter (where o.created_at >= ${s} and o.created_at < ${e}),0)::bigint as month_remaining,
         coalesce(sum(${SQL_ACCOUNTED_TOTAL}) filter (where o.created_at >= ${t}),0)::bigint as today_sales
       from orders o where ${where.join(" and ")}`,
      params,
    );
    const row = r.rows[0] || {};
    return {
      monthCount: n(row.month_count),
      monthSales: n(row.month_sales),
      monthCollected: n(row.month_collected),
      monthRemaining: n(row.month_remaining),
      todaySales: n(row.today_sales),
    };
  });
}

// ---- analytics ----------------------------------------------------------------
/** Monthly series for the last `months` business months (admin). */
export function getMonthlySeries(months = 12) {
  return cached(`series:${months}`, async () => {
    const now = getStartOfBusinessMonth();
    const out: Array<{ month: string; start: Date; end: Date }> = [];
    let cursor = now;
    for (let i = 0; i < months; i++) {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit" }).format(new Date(cursor.getTime() + 12 * 3600_000));
      const [y, mo] = parts.split("-").map(Number);
      const { start, end } = businessMonthRange(y, mo);
      out.unshift({ month: `${y}-${String(mo).padStart(2, "0")}`, start, end });
      cursor = new Date(start.getTime() - 24 * 3600_000);
      cursor = getStartOfBusinessMonth(cursor);
    }
    const rows = await Promise.all(out.map(async b => {
      const [o, collected, refunded] = await Promise.all([
        pool.query(
          `select count(*)::int as orders, count(*) filter (where o.status = 'canceled')::int as canceled,
                  coalesce(sum(${SQL_ACCOUNTED_TOTAL}),0)::bigint as sales
           from orders o where ${PLACED} and o.created_at >= $1 and o.created_at < $2`,
          [iso(b.start), iso(b.end)],
        ),
        collectedBetween(b.start, b.end),
        refundedBetween(b.start, b.end),
      ]);
      return {
        month: b.month,
        orders: n(o.rows[0]?.orders),
        canceled: n(o.rows[0]?.canceled),
        sales: n(o.rows[0]?.sales),
        collected,
        refunded,
      };
    }));
    return rows;
  });
}

// ---- analytics page (admin) -----------------------------------------------------
// The Analytics page historically counted every order except unpaid payment
// requests (status <> 'pending_payment'); keep that universe so numbers match.
const ANALYTICS = "o.status <> 'pending_payment'";

export function businessDayRange(year: number, month1to12: number, day: number) {
  const start = getStartOfBusinessDay(new Date(Date.UTC(year, month1to12 - 1, day, 12)));
  return { start, end: new Date(start.getTime() + 24 * 3600_000) };
}

type Range = { start: Date; end: Date } | null;

/** Designer workload for a business month (or all time when range is null). */
export function getDesignerAnalytics(range: Range) {
  const key = range ? `${iso(range.start)}` : "all";
  return cached(`an:designers:${key}`, async () => {
    const params: unknown[] = range ? [iso(range.start), iso(range.end)] : [];
    const inP = (col: string) => (range ? `(${col} >= $1 and ${col} < $2)` : "true");
    const completed = `o.status in ('ready','delivered') and o.advance_payment_status = 'approved' and ${inP("coalesce(o.ready_date, o.created_at)")}`;
    const select = `
      count(*) filter (where ${inP("o.created_at")})::int as assigned,
      count(*) filter (where ${inP("o.created_at")} and o.status not in ('ready','delivered','canceled'))::int as active,
      count(*) filter (where ${completed})::int as completed,
      count(*) filter (where o.status = 'canceled' and ${inP("coalesce(o.canceled_at, o.created_at)")})::int as canceled`;
    const [byDesigner, team] = await Promise.all([
      pool.query(`select o.assigned_to_id as id, ${select} from orders o where ${ANALYTICS} and o.assigned_to_id is not null group by o.assigned_to_id`, params),
      pool.query(`select ${select} from orders o where ${ANALYTICS}`, params),
    ]);
    const t = team.rows[0] || {};
    return {
      team: { active: n(t.active), completed: n(t.completed) },
      designers: byDesigner.rows.map(r => ({ id: n(r.id), assigned: n(r.assigned), active: n(r.active), completed: n(r.completed), canceled: n(r.canceled) })),
    };
  });
}

/** Orders assigned to one designer in the period (detail sheet; capped). */
export async function getDesignerOrders(designerId: number, range: Range) {
  const params: unknown[] = [designerId];
  let where = `${ANALYTICS} and o.assigned_to_id = $1`;
  if (range) { params.push(iso(range.start), iso(range.end)); where += " and o.created_at >= $2 and o.created_at < $3"; }
  const r = await pool.query(
    `select o.id, o.order_number as "orderNumber", o.client_name as "clientName", o.status, o.created_at as "createdAt", o.ready_date as "readyDate"
     from orders o where ${where} order by o.created_at desc, o.id desc limit 500`,
    params,
  );
  return r.rows;
}

/** Orders per platform / campaign / ad set / creative in a business month. */
export function getMarketingAnalytics(year: number, month: number) {
  return cached(`an:marketing:${year}-${month}`, async () => {
    const { start, end } = businessMonthRange(year, month);
    const r = await pool.query(
      `select coalesce(nullif(o.platform, ''), 'Unattributed') as platform,
              coalesce(nullif(o.campaign, ''), 'Uncategorized') as campaign,
              coalesce(nullif(o.ad_set, ''), 'No Ad Set') as "adSet",
              coalesce(nullif(o.creative, ''), 'No Creative') as creative,
              count(*)::int as orders
       from orders o where ${ANALYTICS} and o.created_at >= $1 and o.created_at < $2
       group by 1, 2, 3, 4 order by 1, 2, 3, 4`,
      [iso(start), iso(end)],
    );
    const rows = r.rows.map(x => ({ platform: x.platform as string, campaign: x.campaign as string, adSet: x.adSet as string, creative: x.creative as string, orders: n(x.orders) }));
    return { total: rows.reduce((s, x) => s + x.orders, 0), rows };
  });
}

/** Support agents: approved orders they created (all time / month / day) and money on the month's orders. */
export function getSupportAnalytics(year: number, month: number, day: number) {
  return cached(`an:support:${year}-${month}-${day}`, async () => {
    const m = businessMonthRange(year, month);
    const d = businessDayRange(year, month, day);
    const params = [iso(m.start), iso(m.end), iso(d.start), iso(d.end)];
    const inMonth = "o.created_at >= $1 and o.created_at < $2";
    const inDay = "o.created_at >= $3 and o.created_at < $4";
    const ok = "o.advance_payment_status = 'approved'";
    const [agents, totals, dayOrders] = await Promise.all([
      pool.query(
        `select o.created_by_id as id,
                count(*) filter (where ${ok})::int as total_orders,
                count(*) filter (where ${ok} and ${inMonth})::int as month_orders,
                count(*) filter (where ${ok} and ${inDay})::int as day_orders,
                coalesce(sum(${SQL_ACCOUNTED_TOTAL}) filter (where ${ok} and ${inMonth}), 0)::bigint as revenue,
                coalesce(sum(${SQL_NET_COLLECTED}) filter (where ${ok} and ${inMonth}), 0)::bigint as collected,
                coalesce(sum(${SQL_REMAINING_RECEIVABLE}) filter (where ${ok} and ${inMonth}), 0)::bigint as pending
         from orders o where ${ANALYTICS} and o.created_by_id is not null group by o.created_by_id`,
        params,
      ),
      pool.query(
        `select count(*) filter (where ${inMonth})::int as month_all,
                count(*) filter (where ${ok} and ${inMonth})::int as month_approved,
                coalesce(sum(${SQL_ACCOUNTED_TOTAL}) filter (where ${ok} and ${inMonth}), 0)::bigint as month_revenue,
                count(*) filter (where ${ok} and ${inDay})::int as day_approved
         from orders o where ${ANALYTICS}`,
        params,
      ),
      pool.query(
        `select o.id, o.order_number as "orderNumber", o.client_name as "clientName", o.status, o.created_at as "createdAt", o.created_by_id as "createdById"
         from orders o where ${ANALYTICS} and ${ok} and o.created_at >= $1 and o.created_at < $2 order by o.created_at desc, o.id desc limit 500`,
        [iso(d.start), iso(d.end)],
      ),
    ]);
    const t = totals.rows[0] || {};
    return {
      monthAll: n(t.month_all),
      monthApproved: n(t.month_approved),
      monthRevenue: n(t.month_revenue),
      dayApproved: n(t.day_approved),
      agents: agents.rows.map(r => ({ id: n(r.id), totalOrders: n(r.total_orders), monthOrders: n(r.month_orders), dayOrders: n(r.day_orders), revenue: n(r.revenue), collected: n(r.collected), pending: n(r.pending) })),
      dayOrders: dayOrders.rows,
    };
  });
}
