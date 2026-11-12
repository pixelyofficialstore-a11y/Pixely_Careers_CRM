/**
 * Phase 5 client profiles. Read-only: everything is computed from orders through
 * the client_profiles view (migration 0004). A client = one normalised phone key.
 */
import type { Express } from "express";
import { z } from "zod";
import { pool } from "../db";
import { pkPhoneKey } from "@shared/phone";
import { requireRole } from "./shared";

const KEY = `coalesce(o.client_key, public.pk_phone_key(o.client_phone))`;
const keyParam = z.string().regex(/^[0-9]{6,16}$/);

export function registerClientRoutes(app: Express) {
  const staff = requireRole(["admin", "support"]);

  app.get("/api/clients", staff, async (req, res) => {
    const q = z.object({
      search: z.string().trim().max(80).optional().default(""),
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
      sort: z.enum(["recent", "spent", "orders"]).default("recent"),
    }).parse(req.query);
    const params: unknown[] = [];
    let where = "true";
    if (q.search) {
      const digits = q.search.replace(/[^0-9]/g, "");
      params.push(`%${q.search}%`);
      where = `(name ilike $1 or email ilike $1`;
      if (digits.length >= 4) { params.push(`%${pkPhoneKey(digits)?.replace(/^92/, "") ?? digits}%`); where += ` or client_key like $2`; }
      where += ")";
    }
    const order = q.sort === "spent" ? "total_spent desc" : q.sort === "orders" ? "order_count desc" : "last_order_at desc nulls last";
    const [rows, total] = await Promise.all([
      pool.query(`select * from public.client_profiles where ${where} order by ${order}, client_key limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params),
      pool.query(`select count(*)::int c, count(*) filter (where placed_count > 1)::int repeat from public.client_profiles where ${where}`, params),
    ]);
    res.json({ rows: rows.rows.map(mapProfile), total: total.rows[0].c, repeat: total.rows[0].repeat, page: q.page, pageSize: q.pageSize });
  });

  /** Create Order: look a client up by WhatsApp number. */
  app.get("/api/clients/lookup", staff, async (req, res) => {
    const { phone } = z.object({ phone: z.string().max(40) }).parse(req.query);
    const key = pkPhoneKey(phone);
    if (!key || key.length < 10) return res.json({ found: false });
    const [p, last] = await Promise.all([
      pool.query(`select * from public.client_profiles where client_key = $1`, [key]),
      pool.query(
        `select o.id, o.order_number, o.status, o.package_type, o.order_type, o.client_type, o.client_email, o.created_at
           from orders o where ${KEY} = $1 order by o.created_at desc nulls last, o.id desc limit 5`, [key]),
    ]);
    if (!p.rows[0]) return res.json({ found: false, key });
    const latest = last.rows[0];
    res.json({
      found: true, key, profile: mapProfile(p.rows[0]),
      clientType: latest?.client_type ?? null,
      recentOrders: last.rows.map(r => ({ id: r.id, orderNumber: r.order_number, status: r.status, packageType: r.package_type, orderType: r.order_type, createdAt: r.created_at })),
    });
  });

  app.get("/api/clients/:key", staff, async (req, res) => {
    const parsed = keyParam.safeParse(req.params.key);
    if (!parsed.success) return res.status(400).json({ message: "Invalid client." });
    const key = parsed.data;
    const [p, ords] = await Promise.all([
      pool.query(`select * from public.client_profiles where client_key = $1`, [key]),
      pool.query(
        `select o.id, o.order_number, o.status, o.work_status, o.advance_payment_status, o.package_type, o.order_type,
                o.total_price, o.discount_amount, o.advance_amount, o.remaining_amount, o.platform, o.campaign,
                o.created_at, o.delivered_at, u.name as designer_name
           from orders o left join users u on u.id = o.assigned_to_id
          where ${KEY} = $1 order by o.created_at desc nulls last, o.id desc limit 200`, [key]),
    ]);
    if (!p.rows[0]) return res.status(404).json({ message: "Client not found." });
    const ids = ords.rows.map(r => r.id);
    const [payments, complaints, website] = await Promise.all([
      ids.length ? pool.query(
        `select pv.id, pv.order_id, pv.amount, pv.payment_type, pv.status, pv.created_at, o.order_number
           from payment_verifications pv join orders o on o.id = pv.order_id
          where pv.order_id = any($1) order by pv.created_at desc limit 200`, [ids]) : { rows: [] },
      ids.length ? pool.query(
        `select c.id, c.complaint_number, c.order_id, c.category, c.status, c.created_at, o.order_number
           from complaints c join orders o on o.id = c.order_id
          where c.order_id = any($1) order by c.created_at desc limit 100`, [ids]).catch(() => ({ rows: [] })) : { rows: [] },
      pool.query(
        `select id, created_at, status, package, total, currency, utm_source, utm_medium, utm_campaign, landing_page, crm_order_id
           from website.orders where public.pk_phone_key(whatsapp) = $1 order by created_at desc limit 50`, [key]).catch(() => ({ rows: [] })),
    ]);
    const firstUtm = [...website.rows].reverse().find((w: any) => w.utm_source || w.utm_campaign);
    res.json({
      profile: mapProfile(p.rows[0]),
      source: firstUtm ? { utmSource: firstUtm.utm_source, utmMedium: firstUtm.utm_medium, utmCampaign: firstUtm.utm_campaign, landingPage: firstUtm.landing_page } : null,
      orders: ords.rows.map(r => ({
        id: r.id, orderNumber: r.order_number, status: r.status, workStatus: r.work_status, advancePaymentStatus: r.advance_payment_status,
        packageType: r.package_type, orderType: r.order_type, totalPrice: Number(r.total_price || 0), discountAmount: Number(r.discount_amount || 0),
        remainingAmount: Number(r.remaining_amount || 0), platform: r.platform, campaign: r.campaign, createdAt: r.created_at, deliveredAt: r.delivered_at, designerName: r.designer_name,
      })),
      payments: payments.rows.map((r: any) => ({ id: r.id, orderId: r.order_id, orderNumber: r.order_number, amount: Number(r.amount || 0), paymentType: r.payment_type, status: r.status, createdAt: r.created_at })),
      complaints: complaints.rows.map((r: any) => ({ id: r.id, complaintNumber: r.complaint_number, orderId: r.order_id, orderNumber: r.order_number, category: r.category, status: r.status, createdAt: r.created_at })),
      websiteOrders: website.rows.map((r: any) => ({ id: r.id, createdAt: r.created_at, status: r.status, package: r.package, total: Number(r.total || 0) * 100, currency: r.currency, utmCampaign: r.utm_campaign, crmOrderId: r.crm_order_id })),
    });
  });

  /** Create Order: suggest the designer with the lowest active workload. */
  app.get("/api/designers/workload", staff, async (_req, res) => {
    const r = await pool.query(
      `select u.id, u.name,
              count(o.id) filter (where o.status in ('new','working','ready') and o.advance_payment_status = 'approved')::int as active
         from users u left join orders o on o.assigned_to_id = u.id
        where u.role = 'designer' and u.is_active = true
        group by u.id, u.name order by active asc, u.name asc`);
    res.json(r.rows);
  });
}

function mapProfile(r: any) {
  return {
    key: r.client_key as string, name: r.name as string, phone: r.phone as string | null, email: r.email as string | null,
    orderCount: Number(r.order_count || 0), placedCount: Number(r.placed_count || 0), totalSpent: Number(r.total_spent || 0),
    firstOrderAt: r.first_order_at, lastOrderAt: r.last_order_at, firstPlatform: r.first_platform, firstCampaign: r.first_campaign,
  };
}
