/**
 * Phase 2 overdue notifier. Every 15 minutes: orders with a STORED due date
 * (new orders only, per the owner) that are past due and still Confirmed or
 * In progress notify the admins and the assigned designer once per due date.
 * Old orders (no due_at) only show red in the UI and never notify.
 * Read-only on orders; only notification rows are created.
 */
import { pool } from "./db";
import { storage } from "./storage";
import { dispatchNotifications } from "./routes/shared";

const INTERVAL_MS = 15 * 60 * 1000;

export async function notifyOverdueOrders(now = new Date()) {
  const r = await pool.query(
    `select o.id, o.order_number, o.client_name, o.assigned_to_id,
            to_char(o.due_at, 'YYYY-MM-DD"T"HH24:MI') as due_key
       from orders o
      where o.due_at is not null and o.due_at < $1
        and o.status in ('new', 'working')
        and o.advance_payment_status = 'approved'
      order by o.due_at asc
      limit 200`,
    [now.toISOString()],
  );
  if (!r.rows.length) return 0;
  const adminIds = (await storage.getAdmins()).map(a => a.id);
  for (const o of r.rows) {
    const recipients = [...new Set([...adminIds, ...(o.assigned_to_id ? [Number(o.assigned_to_id)] : [])])];
    await dispatchNotifications(recipients, {
      event: "order_overdue",
      type: "order",
      title: "Order overdue",
      message: `${o.order_number || "An order"} for ${o.client_name} is past its due date.`,
      priority: "action_required",
      relatedId: Number(o.id),
      relatedType: "order",
      // One notification per due date (a changed due date can notify again).
      sourceEventId: `overdue:${o.id}:${o.due_key}`,
    });
  }
  return r.rows.length;
}

export function startOverdueNotifier() {
  if (process.env.CRM_DISABLE_BACKGROUND === "1") return; // tests
  const tick = () => notifyOverdueOrders().catch(err => console.error("[overdue] scan failed:", err?.message || err));
  setInterval(tick, INTERVAL_MS).unref?.();
  setTimeout(tick, 30_000).unref?.();
}
