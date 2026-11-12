/**
 * Meta customer list (Custom Audience) CSV. READ-ONLY: one SELECT, no writes.
 * One row per unique client (normalized phone), only clients who paid on at
 * least one non-canceled order. value = total received in PKR.
 */
import { pool } from "./db";
import { normalizeEmail, normalizePhone, splitName } from "./lib/metaCapi";

const COUNTRY_PREFIX: Array<[string, string]> = [["92", "pk"], ["971", "ae"], ["966", "sa"], ["44", "gb"], ["1", "us"]];
export const countryFromPhone = (e164: string) => COUNTRY_PREFIX.find(([p]) => e164.startsWith(p))?.[1] ?? "";

const csvCell = (v: string | number) => {
  const t = String(v ?? "");
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

type Row = { client_phone: string | null; client_email: string | null; client_name: string | null; paid: string; last_at: Date };

export function buildMetaCustomerRows(rows: Row[]) {
  const byPhone = new Map<string, { phone: string; email: string; fn: string; ln: string; country: string; value: number; lastAt: number }>();
  for (const r of rows) {
    const phone = normalizePhone(r.client_phone);
    if (!phone || !/^\d{8,15}$/.test(phone)) continue;
    const paid = Number(r.paid) / 100;
    const at = new Date(r.last_at).getTime();
    const cur = byPhone.get(phone);
    const { fn, ln } = splitName(r.client_name);
    const email = normalizeEmail(r.client_email) ?? "";
    if (!cur) {
      byPhone.set(phone, { phone, email, fn: fn ?? "", ln: ln ?? "", country: countryFromPhone(phone), value: paid, lastAt: at });
    } else {
      cur.value += paid;
      // Newest order wins for name/email; keep older values when the newer one is blank.
      if (at >= cur.lastAt) {
        cur.lastAt = at;
        if (email) cur.email = email;
        if (fn) { cur.fn = fn; cur.ln = ln ?? ""; }
      } else {
        if (!cur.email && email) cur.email = email;
        if (!cur.fn && fn) { cur.fn = fn; cur.ln = ln ?? ""; }
      }
    }
  }
  return Array.from(byPhone.values()).map(r => ({ ...r, value: Math.round(r.value * 100) / 100 }));
}

export async function metaCustomerListCsv(): Promise<{ csv: string; rows: number }> {
  const { rows } = await pool.query<Row>(`
    -- Amount received per order = advance_amount (it grows with every approved
    -- payment and also holds payments recorded before payment records existed).
    -- Approved payment records are used if they add up to more. Canceled orders skipped.
    SELECT o.client_phone, o.client_email, o.client_name,
           GREATEST(COALESCE(o.advance_amount, 0),
                    COALESCE((SELECT SUM(pv.amount) FROM payment_verifications pv WHERE pv.order_id = o.id AND pv.status = 'approved'), 0))::bigint AS paid,
           o.created_at AS last_at
    FROM orders o
    WHERE o.status <> 'canceled' AND COALESCE(o.work_status, '') <> 'canceled'
      AND GREATEST(COALESCE(o.advance_amount, 0),
                   COALESCE((SELECT SUM(pv.amount) FROM payment_verifications pv WHERE pv.order_id = o.id AND pv.status = 'approved'), 0)) > 0`);
  const list = buildMetaCustomerRows(rows);
  const header = "phone,email,fn,ln,country,value";
  const lines = list.map(r => [r.phone, r.email, r.fn, r.ln, r.country, r.value].map(csvCell).join(","));
  return { csv: [header, ...lines].join("\n") + "\n", rows: list.length };
}
