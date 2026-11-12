/**
 * Phase 5: WhatsApp templates, ad spend + Marketing ROI, and the shared catalog.
 * Tables from migration 0004. Money in paisa (website.orders totals are rupees ×100).
 * The app never deletes these rows: templates/catalog items are switched off with
 * is_active; ad spend is corrected by editing the amount.
 */
import type { Express } from "express";
import { z } from "zod";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { adSpend, catalogItems, whatsappTemplates, type User } from "@shared/schema";
import { DEFAULT_WHATSAPP_TEMPLATES } from "@shared/whatsapp-templates";
import { logAudit } from "../security/audit";
import { metaCustomerListCsv } from "../metaCustomerList";
import { requireAuth, requireRole } from "./shared";
import { getConfiguredDeliveryDays } from "../orderProcess";
import { effectiveDueAt } from "@shared/order-process";

const admin = requireRole(["admin"]);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PUBLIC_CATALOG_ORIGINS = new Set(["https://pixelycareers.com", "https://www.pixelycareers.com"]);

export function registerGrowthRoutes(app: Express) {
  /** Settings → Data: Meta customer list CSV (admin, read-only, audited). */
  app.get("/api/exports/meta-customer-list.csv", requireRole(["admin"]), async (req, res) => {
    try {
      const { csv, rows } = await metaCustomerListCsv();
      void logAudit({ action: "export", actor: req.user as User, targetType: "export", targetId: "meta_customer_list", details: { rows }, req });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="meta-customer-list-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(csv);
    } catch (err) {
      console.error("[export] meta customer list failed:", err);
      res.status(500).json({ message: "Couldn't build the customer list." });
    }
  });

  // ---- WhatsApp templates -------------------------------------------------------
  app.get("/api/whatsapp-templates", requireAuth, async (req, res) => {
    const user = req.user as User;
    const rows = await db.select().from(whatsappTemplates).orderBy(asc(whatsappTemplates.sortOrder), asc(whatsappTemplates.id));
    if (!rows.length) {
      return res.json({ source: "default", templates: DEFAULT_WHATSAPP_TEMPLATES.map((t, i) => ({ id: null, ...t, isActive: true, sortOrder: i })) });
    }
    res.json({ source: "saved", templates: user.role === "admin" ? rows : rows.filter(r => r.isActive) });
  });

  const templateBody = z.object({
    kind: z.string().trim().min(1).max(40).default("custom"),
    label: z.string().trim().min(1).max(60),
    body: z.string().trim().min(1).max(1000),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(999).default(0),
  });

  app.post("/api/whatsapp-templates", admin, async (req, res) => {
    const user = req.user as User;
    const data = templateBody.parse(req.body);
    const [row] = await db.insert(whatsappTemplates).values({ ...data, updatedById: user.id }).returning();
    void logAudit({ action: "settings_changed", actor: user, targetType: "whatsapp_template", targetId: row.id, details: { created: data.label }, req });
    res.status(201).json(row);
  });

  /** First save: copies the built-in defaults into the table so they become editable. */
  app.post("/api/whatsapp-templates/adopt-defaults", admin, async (req, res) => {
    const user = req.user as User;
    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(whatsappTemplates);
    if (Number(c) > 0) return res.status(409).json({ message: "Templates are already saved." });
    const rows = await db.insert(whatsappTemplates).values(DEFAULT_WHATSAPP_TEMPLATES.map((t, i) => ({ ...t, sortOrder: i, updatedById: user.id }))).returning();
    void logAudit({ action: "settings_changed", actor: user, targetType: "whatsapp_template", details: { adoptedDefaults: rows.length }, req });
    res.status(201).json(rows);
  });

  app.patch("/api/whatsapp-templates/:id", admin, async (req, res) => {
    const user = req.user as User;
    const data = templateBody.partial().parse(req.body);
    const [row] = await db.update(whatsappTemplates).set({ ...data, updatedById: user.id, updatedAt: new Date() }).where(eq(whatsappTemplates.id, Number(req.params.id))).returning();
    if (!row) return res.status(404).json({ message: "Template not found." });
    void logAudit({ action: "settings_changed", actor: user, targetType: "whatsapp_template", targetId: row.id, details: { fields: Object.keys(data) }, req });
    res.json(row);
  });

  // ---- Ad spend -------------------------------------------------------------------
  app.get("/api/ad-spend", admin, async (req, res) => {
    const q = z.object({ from: ymd, to: ymd }).parse(req.query);
    const rows = await db.select().from(adSpend).where(and(gte(adSpend.spendDate, q.from), lte(adSpend.spendDate, q.to))).orderBy(asc(adSpend.spendDate), asc(adSpend.campaign));
    res.json(rows);
  });

  /** Upsert by (date, platform, campaign): entering the same day again replaces the amount. */
  app.post("/api/ad-spend", admin, async (req, res) => {
    const user = req.user as User;
    const data = z.object({
      spendDate: ymd,
      platform: z.string().trim().toLowerCase().min(1).max(40).default("meta"),
      campaign: z.string().trim().max(120).default(""),
      amount: z.number().int().min(0).max(10_000_000_000),
      notes: z.string().trim().max(500).optional().nullable(),
    }).parse(req.body);
    const [row] = await db.insert(adSpend).values({ ...data, createdById: user.id })
      .onConflictDoUpdate({ target: [adSpend.spendDate, adSpend.platform, adSpend.campaign], set: { amount: data.amount, notes: data.notes ?? null, updatedAt: new Date() } })
      .returning();
    void logAudit({ action: "settings_changed", actor: user, targetType: "ad_spend", targetId: row.id, details: { date: data.spendDate, campaign: data.campaign, amount: data.amount }, req });
    res.status(201).json(row);
  });

  // ---- Marketing ROI ----------------------------------------------------------------
  /**
   * ROAS per campaign = website checkout revenue (utm_campaign, converted orders) ÷ ad spend.
   * CRM revenue per order campaign is shown alongside for reference.
   */
  app.get("/api/analytics/roi", admin, async (req, res) => {
    const q = z.object({ from: ymd, to: ymd }).parse(req.query);
    const fromTs = `${q.from} 00:00:00+05`, toTs = `${q.to} 23:59:59.999+05`;
    const [web, crm, spend] = await Promise.all([
      pool.query(
        `select coalesce(nullif(trim(utm_campaign), ''), '(no campaign)') as campaign,
                count(*)::int as orders, coalesce(sum(total), 0)::bigint * 100 as revenue
           from website.orders
          where (crm_order_id is not null or status in ('converted', 'paid'))
            and upper(coalesce(nullif(trim(currency), ''), 'PKR')) = 'PKR'
            and coalesce(paid_at, created_at) between $1::timestamptz and $2::timestamptz
          group by 1`, [fromTs, toTs]).catch(() => ({ rows: [] as any[] })),
      pool.query(
        `select coalesce(nullif(trim(campaign), ''), '(no campaign)') as campaign,
                count(*)::int as orders, coalesce(sum(total_price - coalesce(discount_amount, 0)), 0)::bigint as revenue
           from orders
          where advance_payment_status = 'approved' and status <> 'canceled'
            and created_at >= ($1::timestamptz at time zone 'UTC') and created_at <= ($2::timestamptz at time zone 'UTC')
          group by 1`, [fromTs, toTs]),
      pool.query(
        `select coalesce(nullif(trim(campaign), ''), '(no campaign)') as campaign, coalesce(sum(amount), 0)::bigint as spend
           from ad_spend where spend_date between $1::date and $2::date group by 1`, [q.from, q.to]),
    ]);
    const byName = new Map<string, { campaign: string; spend: number; webOrders: number; webRevenue: number; crmOrders: number; crmRevenue: number }>();
    const row = (c: string) => byName.get(c) ?? byName.set(c, { campaign: c, spend: 0, webOrders: 0, webRevenue: 0, crmOrders: 0, crmRevenue: 0 }).get(c)!;
    for (const r of web.rows) Object.assign(row(r.campaign), { webOrders: r.orders, webRevenue: Number(r.revenue) });
    for (const r of crm.rows) Object.assign(row(r.campaign), { crmOrders: r.orders, crmRevenue: Number(r.revenue) });
    for (const r of spend.rows) row(r.campaign).spend = Number(r.spend);
    const rows = Array.from(byName.values()).map(r => ({ ...r, roas: r.spend > 0 ? r.webRevenue / r.spend : null, profit: r.webRevenue - r.spend }))
      .sort((a, b) => b.spend - a.spend || b.webRevenue - a.webRevenue);
    const totals = rows.reduce((t, r) => ({ spend: t.spend + r.spend, webRevenue: t.webRevenue + r.webRevenue, crmRevenue: t.crmRevenue + r.crmRevenue, webOrders: t.webOrders + r.webOrders }), { spend: 0, webRevenue: 0, crmRevenue: 0, webOrders: 0 });
    res.json({ from: q.from, to: q.to, rows, totals: { ...totals, roas: totals.spend > 0 ? totals.webRevenue / totals.spend : null, profit: totals.webRevenue - totals.spend } });
  });

  // ---- SLA: on-time delivery ------------------------------------------------------------
  /**
   * Delivered orders in the last N months: on time = delivered_at <= due date
   * (stored due_at, or created_at + package days for old orders). Read-only.
   */
  app.get("/api/analytics/sla", admin, async (req, res) => {
    const { months } = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) }).parse(req.query);
    const [rows, days] = await Promise.all([
      pool.query(
        `select o.id, o.created_at, o.due_at, o.delivered_at, o.package_type, o.order_type, o.assigned_to_id, u.name as designer
           from orders o left join users u on u.id = o.assigned_to_id
          where o.delivered_at is not null and o.status <> 'canceled'
            and o.delivered_at >= (date_trunc('month', now() at time zone 'Asia/Karachi') - make_interval(months => $1::int - 1)) at time zone 'Asia/Karachi' at time zone 'UTC'`, [months]),
      getConfiguredDeliveryDays(),
    ]);
    const monthKey = (d: Date) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 7);
    const byMonth = new Map<string, { month: string; delivered: number; onTime: number; lateHoursTotal: number }>();
    const byDesigner = new Map<string, { designer: string; delivered: number; onTime: number }>();
    for (const r of rows.rows) {
      const due = effectiveDueAt({ dueAt: r.due_at, createdAt: r.created_at, packageType: r.package_type, orderType: r.order_type }, days);
      const delivered = new Date(r.delivered_at);
      const onTime = !due || delivered.getTime() <= due.getTime();
      const m = monthKey(delivered);
      const mm = byMonth.get(m) ?? byMonth.set(m, { month: m, delivered: 0, onTime: 0, lateHoursTotal: 0 }).get(m)!;
      mm.delivered++; if (onTime) mm.onTime++; else mm.lateHoursTotal += (delivered.getTime() - due!.getTime()) / 3600_000;
      const name = r.designer || "Unassigned";
      const dd = byDesigner.get(name) ?? byDesigner.set(name, { designer: name, delivered: 0, onTime: 0 }).get(name)!;
      dd.delivered++; if (onTime) dd.onTime++;
    }
    const total = rows.rows.length, onTime = [...byMonth.values()].reduce((s, m) => s + m.onTime, 0);
    res.json({
      months,
      total, onTime, rate: total ? onTime / total : null,
      byMonth: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map(m => ({ month: m.month, delivered: m.delivered, onTime: m.onTime, rate: m.onTime / m.delivered, avgLateHours: m.delivered - m.onTime ? m.lateHoursTotal / (m.delivered - m.onTime) : 0 })),
      byDesigner: [...byDesigner.values()].sort((a, b) => b.delivered - a.delivered).map(d => ({ ...d, rate: d.onTime / d.delivered })),
    });
  });

  // ---- Catalog -----------------------------------------------------------------------
  app.get("/api/catalog", requireAuth, async (req, res) => {
    const user = req.user as User;
    const rows = await db.select().from(catalogItems).orderBy(asc(catalogItems.kind), asc(catalogItems.sortOrder), asc(catalogItems.label));
    res.json(user.role === "admin" ? rows : rows.filter(r => r.isActive));
  });

  const catalogBody = z.object({
    kind: z.enum(["package", "addon"]),
    key: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,59}$/, "Use lowercase letters, numbers, - or _"),
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional().nullable(),
    price: z.number().int().min(0).max(100_000_000_00),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("PKR"),
    market: z.string().trim().toLowerCase().max(10).default("pk"),
    services: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    websiteKey: z.string().trim().max(60).optional().nullable(),
    crmPackageKey: z.string().trim().max(60).optional().nullable(),
    deliveryDays: z.number().int().min(1).max(365).optional().nullable(),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(999).default(0),
  });

  app.post("/api/catalog", admin, async (req, res) => {
    const user = req.user as User;
    const data = catalogBody.parse(req.body);
    try {
      const [row] = await db.insert(catalogItems).values({ ...data, updatedById: user.id }).returning();
      void logAudit({ action: "settings_changed", actor: user, targetType: "catalog_item", targetId: row.id, details: { created: data.key }, req });
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.code === "23505") return res.status(400).json({ message: "An item with that key already exists." });
      throw err;
    }
  });

  app.patch("/api/catalog/:id", admin, async (req, res) => {
    const user = req.user as User;
    const data = catalogBody.partial().omit({ key: true }).parse(req.body);
    const [row] = await db.update(catalogItems).set({ ...data, updatedById: user.id, updatedAt: new Date() }).where(eq(catalogItems.id, Number(req.params.id))).returning();
    if (!row) return res.status(404).json({ message: "Item not found." });
    void logAudit({ action: "settings_changed", actor: user, targetType: "catalog_item", targetId: row.id, details: { fields: Object.keys(data) }, req });
    res.json(row);
  });

  /**
   * Public, read-only catalog for pixelycareers.com (no login). Active items only,
   * prices in paisa AND rupees. Documented in docs/catalog-api.md.
   */
  app.get("/api/public/catalog", async (req, res) => {
    const origin = req.get("origin");
    if (origin && PUBLIC_CATALOG_ORIGINS.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    const market = typeof req.query.market === "string" ? req.query.market.toLowerCase().slice(0, 10) : null;
    const rows = await db.select().from(catalogItems).where(eq(catalogItems.isActive, true)).orderBy(asc(catalogItems.kind), asc(catalogItems.sortOrder), asc(catalogItems.label));
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      version: 1,
      updatedAt: rows.reduce<string | null>((m, r) => (!m || r.updatedAt.toISOString() > m ? r.updatedAt.toISOString() : m), null),
      items: rows.filter(r => !market || r.market === market).map(r => ({
        kind: r.kind, key: r.key, websiteKey: r.websiteKey, label: r.label, description: r.description,
        price: r.price, priceMajor: r.price / 100, currency: r.currency, market: r.market, services: r.services, deliveryDays: r.deliveryDays,
      })),
    });
  });
}
