/**
 * Website Requests — everything submitted on pixelycareers.com:
 *   - Orders            (website.orders)
 *   - Free CV Reviews   (website.cv_reviews)
 *   - Agency Partners   (website.partners)
 *
 * Admin + Support only. The tables are owned by the website project, so they
 * are read with raw SQL and the CRM only writes its own tracking columns and
 * the status column. Every action = one transaction + one activity log entry.
 *
 * Orders roles:
 *  - Admin places orders (same function as the Orders page), approves/declines
 *    requests support sent for approval, rejects, retries Meta.
 *  - Support sends requests for approval and rejects. Support can never place
 *    an order directly — enforced here, not just in the UI.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, pool } from "./db";
import { storage } from "./storage";
import { placeApprovedOrderTx } from "./orderCreation";
import { claimWebsitePurchaseTx, queuePurchase, retryPurchase, txQueryOf } from "./lib/metaCapi";
import { paymentVerifications, activityLogs, type Order, type User } from "@shared/schema";
import { getStartOfBusinessDay, getStartOfBusinessMonth } from "@shared/business-time";

const ALLOWED_ROLES = ["admin", "support"];
const REJECT_REASONS = ["fake_screenshot", "duplicate", "test", "not_interested", "no_response", "other"] as const;
const POLL_INTERVAL_MS = 10_000;
const PAGE_SIZE = 50;

export type RequestKind = "order" | "review" | "partner";
type RequestSummary = { id: string; name: string | null; status: string; total?: number | null; currency?: string | null; kind?: RequestKind };

type Deps = {
  requireRole: (roles: string[]) => any;
  notifyNewRequest: (recipientIds: number[], request: RequestSummary) => Promise<void>;
  notifyApprovalRequested: (request: RequestSummary & { submittedAt: string }, submitter: User, note: string | null) => Promise<void>;
  notifySubmitterDecision: (submitterId: number, request: RequestSummary, decision: "approved" | "declined", actorId: number, orderId?: number) => Promise<void>;
  afterPlacement: (actor: User, order: Order) => Promise<void>;
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const uuidSchema = z.string().uuid();
const parseId = (raw: unknown) => {
  const parsed = uuidSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};
const normalizePhone = (value: string | null | undefined) => (value || "").replace(/[^0-9]/g, "");
const rowsOf = (result: any) => (result?.rows ?? result ?? []) as any[];

async function logActivity(requestId: string, actorId: number | null, action: string, details?: Record<string, unknown>, tx?: any) {
  if (tx) {
    await tx.execute(sql`INSERT INTO website_request_activity (request_id, actor_id, action, details)
      VALUES (${requestId}, ${actorId}, ${action}, ${details ? JSON.stringify(details) : null}::jsonb)`);
    return;
  }
  await pool.query(
    `INSERT INTO website_request_activity (request_id, actor_id, action, details) VALUES ($1, $2, $3, $4)`,
    [requestId, actorId, action, details ? JSON.stringify(details) : null],
  );
}

async function getActivity(requestId: string) {
  const { rows } = await pool.query(
    `SELECT a.id, a.action, a.details, a.created_at, u.name AS actor_name, u.role AS actor_role
     FROM website_request_activity a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.request_id = $1 ORDER BY a.created_at DESC LIMIT 100`,
    [requestId],
  );
  return rows;
}

/** Sends a handled error as JSON; logs anything unexpected with route + user. */
function fail(res: Response, req: Request, err: any, action: string) {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
  if (err?.code === "23505") return res.status(409).json({ message: "Someone else changed this at the same moment. Reload the page." });
  const user = req.user as User | undefined;
  console.error(`[website-requests] ${action} ${req.originalUrl} user=${user ? `${user.id}:${user.username}` : "-"} failed:`, err);
  return res.status(500).json({ message: `${action} failed on the server. Nothing was saved - please try again.` });
}

// ── Shared list builder ───────────────────────────────────────────────────────

type ListConfig = {
  table: string;
  columns: string;
  statuses: Record<string, string>;
  defaultStatus: string;
  /** Text columns searched with ILIKE; WhatsApp is also matched by digits. */
  searchColumns: string[];
  extraFilters?: Record<string, string>; // query param → column (equality)
  csv: Array<[string, string]>; // [header, column]
};

const listQuerySchema = z.object({
  status: z.string().max(40).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(PAGE_SIZE),
}).passthrough();

function buildWhere(cfg: ListConfig, query: Record<string, any>) {
  const status = cfg.statuses[query.status] ? query.status : cfg.defaultStatus;
  const where: string[] = [cfg.statuses[status]];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => { params.push(value); where.push(clause.replace("?", `$${params.length}`)); };
  if (query.from) add("created_at >= ?", query.from);
  if (query.to) add("created_at <= ?", query.to);
  for (const [param, column] of Object.entries(cfg.extraFilters ?? {})) {
    const value = typeof query[param] === "string" ? query[param].trim() : "";
    if (value && value !== "all" && value.length <= 80) add(`${column} = ?`, value);
  }
  const term = typeof query.q === "string" ? query.q.trim() : "";
  if (term) {
    params.push(`%${term}%`);
    const idx = params.length;
    const parts = cfg.searchColumns.map(c => `${c} ILIKE $${idx}`);
    // Drop leading zeros so local "0300…" matches stored "+92 300…".
    const digits = normalizePhone(term).replace(/^0+/, "");
    if (digits.length >= 4) {
      params.push(`%${digits}%`);
      parts.push(`regexp_replace(COALESCE(whatsapp,''), '[^0-9]', '', 'g') LIKE $${params.length}`);
    }
    where.push(`(${parts.join(" OR ")})`);
  }
  return { status, where: where.join(" AND "), params };
}

async function runList(cfg: ListConfig, query: Record<string, any>) {
  const parsed = listQuerySchema.safeParse(query);
  if (!parsed.success) throw new HttpError(400, "Invalid filters");
  const { page, pageSize } = parsed.data;
  const { status, where, params } = buildWhere(cfg, parsed.data);
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await pool.query(
    `SELECT ${cfg.columns}, COUNT(*) OVER() AS __total FROM ${cfg.table} WHERE ${where}
     ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const total = rows[0] ? Number(rows[0].__total) : 0;
  return { rows: rows.map(({ __total, ...r }: any) => r), total, page, pageSize, status };
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join("; ") : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Prevent spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

async function runCsv(cfg: ListConfig, query: Record<string, any>) {
  const parsed = listQuerySchema.safeParse(query);
  if (!parsed.success) throw new HttpError(400, "Invalid filters");
  const { where, params } = buildWhere(cfg, parsed.data);
  const { rows } = await pool.query(
    `SELECT ${cfg.csv.map(([, c]) => c).join(", ")} FROM ${cfg.table} WHERE ${where} ORDER BY created_at DESC LIMIT 5000`,
    params,
  );
  const header = cfg.csv.map(([h]) => csvCell(h)).join(",");
  return [header, ...rows.map((r: any) => cfg.csv.map(([, c]) => csvCell(r[c.split(" AS ").pop()!.trim()])).join(","))].join("\n");
}

// ── Orders (website.orders) ───────────────────────────────────────────────────

const ORDER_COLUMNS = `
  id, created_at, updated_at, market, country, utm_source, utm_medium, utm_campaign,
  status, package, package_price, addons, same_day, offer, is_bundle, pay_choice,
  discount, subtotal, total, currency, name, whatsapp, email, target_country, target_role,
  notes, cv_url, payment_method, payment_screenshot_url, transaction_id, step_reached,
  last_activity_at, paid_at, crm_order_id, paid_amount, verified_by, verified_at,
  contacted_at, reject_reason, crm_notes, submitted_by, submitted_at, approval_note,
  meta_status, meta_event_id, meta_purchase_sent_at
`;
const CONVERTED_SQL = `(crm_order_id IS NOT NULL OR status IN ('converted','paid'))`;
const ORDER_STATUSES: Record<string, string> = {
  verification: `status = 'payment_submitted' AND crm_order_id IS NULL`,
  awaiting_approval: `status = 'pending_approval' AND crm_order_id IS NULL`,
  pay_later: `pay_choice = 'later' AND NOT ${CONVERTED_SQL} AND status NOT IN ('rejected','cart','abandoned','pending_approval')`,
  abandoned: `status IN ('cart','abandoned') AND crm_order_id IS NULL`,
  converted: CONVERTED_SQL,
  rejected: `status = 'rejected'`,
  all: `TRUE`,
};
// "New" = needs staff attention: submitted on the site and not yet handled.
const ORDER_NEW_SQL = `status IN ('new','payment_submitted') AND crm_order_id IS NULL`;

const ORDERS_CFG: ListConfig = {
  table: "website.orders",
  columns: ORDER_COLUMNS,
  statuses: ORDER_STATUSES,
  defaultStatus: "verification",
  searchColumns: ["name", "whatsapp", "transaction_id", "email"],
  extraFilters: { market: "market", package: "package" },
  csv: [
    ["Created", "created_at"], ["Status", "status"], ["Name", "name"], ["WhatsApp", "whatsapp"], ["Email", "email"],
    ["Package", "package"], ["11.11 bundle", "is_bundle"], ["Total", "total"], ["Currency", "currency"], ["Pay choice", "pay_choice"],
    ["Payment method", "payment_method"], ["Transaction ID", "transaction_id"], ["Paid amount", "paid_amount"],
    ["Market", "market"], ["UTM source", "utm_source"], ["UTM campaign", "utm_campaign"], ["CRM order id", "crm_order_id"],
    ["Meta", "meta_status"], ["Reject reason", "reject_reason"],
  ],
};

async function getOrderRequest(id: string) {
  const { rows } = await pool.query(`SELECT ${ORDER_COLUMNS} FROM website.orders WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

const placeSchema = z.object({
  clientName: z.string().trim().min(1, "Client name is required"),
  clientPhone: z.string().trim().min(1, "Phone number is required"),
  clientEmail: z.string().email().optional().nullable(),
  clientType: z.enum(["national", "international"]),
  orderType: z.enum(["documentation", "resume_distribution", "portfolio_website"]),
  assignedToId: z.number().int().positive().optional().nullable(),
  totalPrice: z.number().int().positive("Total bill is required"),
  amountReceived: z.number().int().min(0),
  paymentMethod: z.string().max(80).optional().nullable(),
  transactionId: z.string().max(200).optional().nullable(),
  screenshotUrl: z.string().url().refine(u => /^https?:\/\//i.test(u), "Screenshot must be an http(s) URL").optional().nullable(),
  numberOfRevisions: z.number().int().min(1).max(5).optional().nullable(),
  supportPeriod: z.enum(["15_days", "1_month", "2_months", "3_months", "4_months", "5_months", "6_months"]).optional().nullable(),
  platform: z.string().optional().nullable(),
  campaign: z.string().optional().nullable(),
  adSet: z.string().optional().nullable(),
  creative: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  services: z.array(z.object({
    serviceType: z.string().min(1),
    quantity: z.number().int().min(1),
    instructions: z.string().nullable().optional(),
  })).default([]),
});

// ── CV reviews (website.cv_reviews) ───────────────────────────────────────────

const REVIEW_COLUMNS = `
  id, created_at, updated_at, market, country, utm_source, utm_medium, utm_campaign,
  status, name, whatsapp, email, target_role, target_country, target_countries,
  cv_url, cv_filename, notes, internal_notes, crm_order_id, review_started_by, review_started_at,
  sent_by, sent_at, converted_at, reject_reason
`;
const REVIEWS_CFG: ListConfig = {
  table: "website.cv_reviews",
  columns: REVIEW_COLUMNS,
  statuses: {
    new: `status = 'new'`,
    in_review: `status = 'in_review'`,
    sent: `status = 'sent'`,
    converted: `status = 'converted'`,
    rejected: `status::text = 'rejected'`,
    all: `TRUE`,
  },
  defaultStatus: "new",
  searchColumns: ["name", "whatsapp", "email", "target_role"],
  csv: [
    ["Created", "created_at"], ["Status", "status"], ["Name", "name"], ["WhatsApp", "whatsapp"], ["Email", "email"],
    ["Target role", "target_role"], ["Target countries", "COALESCE(array_to_string(target_countries, '; '), target_country) AS target_countries"],
    ["CV", "cv_url"], ["Market", "market"], ["UTM source", "utm_source"], ["UTM campaign", "utm_campaign"], ["CRM order id", "crm_order_id"],
  ],
};
const REVIEW_TRANSITIONS: Record<string, { from: string[]; action: string }> = {
  in_review: { from: ["new"], action: "review_started" },
  sent: { from: ["new", "in_review"], action: "review_sent" },
  rejected: { from: ["new", "in_review", "sent"], action: "rejected" },
  new: { from: ["in_review", "sent", "rejected"], action: "reopened" },
};

// ── Partners (website.partners) ───────────────────────────────────────────────

const PARTNER_COLUMNS = `
  id, created_at, updated_at, market, country, utm_source, utm_medium, utm_campaign,
  status, org_name, org_type, contact_name, designation, whatsapp, email, country_hq,
  destinations, monthly_volume, model, notes, internal_notes, contacted_at
`;
const PARTNER_STATUS_VALUES = ["new", "contacted", "trial", "active", "lost"] as const;
const PARTNERS_CFG: ListConfig = {
  table: "website.partners",
  columns: PARTNER_COLUMNS,
  statuses: { ...Object.fromEntries(PARTNER_STATUS_VALUES.map(s => [s, `status = '${s}'`])), all: `TRUE` },
  defaultStatus: "new",
  searchColumns: ["org_name", "contact_name", "whatsapp", "email", "country_hq"],
  extraFilters: { country: "country_hq" },
  csv: [
    ["Created", "created_at"], ["Status", "status"], ["Organization", "org_name"], ["Type", "org_type"], ["Contact", "contact_name"],
    ["Designation", "designation"], ["WhatsApp", "whatsapp"], ["Email", "email"], ["Country HQ", "country_hq"],
    ["Destinations", "destinations"], ["Monthly volume", "monthly_volume"], ["Model", "model"], ["Notes", "notes"],
  ],
};

// ─────────────────────────────────────────────────────────────────────────────

export function registerWebsiteRequestRoutes(app: Express, deps: Deps) {
  const guard = deps.requireRole(ALLOWED_ROLES);
  const base = "/api/website-requests";

  /**
   * Lightweight change detector polled every 10s by the page and the sidebar.
   * Lists only refetch when `version` changes.
   */
  app.get(`${base}/counts`, guard, async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM website.orders WHERE ${ORDER_NEW_SQL})::int AS orders_new,
          (SELECT COUNT(*) FROM website.orders WHERE ${ORDER_STATUSES.awaiting_approval})::int AS awaiting_approval,
          (SELECT COUNT(*) FROM website.cv_reviews WHERE status = 'new')::int AS reviews_new,
          (SELECT COUNT(*) FROM website.partners WHERE status = 'new')::int AS partners_new,
          (SELECT COUNT(*) || ':' || COALESCE(EXTRACT(EPOCH FROM MAX(updated_at))::text, '0') FROM website.orders) AS v_orders,
          (SELECT COUNT(*) || ':' || COALESCE(EXTRACT(EPOCH FROM MAX(updated_at))::text, '0') FROM website.cv_reviews) AS v_reviews,
          (SELECT COUNT(*) || ':' || COALESCE(EXTRACT(EPOCH FROM MAX(updated_at))::text, '0') FROM website.partners) AS v_partners,
          (SELECT MAX(created_at) FROM website.orders WHERE status NOT IN ('cart','abandoned')) AS latest_order,
          (SELECT MAX(created_at) FROM website.cv_reviews) AS latest_review,
          (SELECT MAX(created_at) FROM website.partners) AS latest_partner
      `);
      const r = rows[0];
      const ms = (d: any) => (d ? new Date(d).getTime() : 0);
      res.json({
        orders_new: r.orders_new,
        reviews_new: r.reviews_new,
        partners_new: r.partners_new,
        awaiting_approval: r.awaiting_approval,
        latest: { orders: ms(r.latest_order), reviews: ms(r.latest_review), partners: ms(r.latest_partner) },
        version: { orders: r.v_orders, reviews: r.v_reviews, partners: r.v_partners },
      });
    } catch (err) { fail(res, req, err, "Loading counts"); }
  });

  // ── Orders ─────────────────────────────────────────────────────────────────

  app.get(`${base}/orders/stats`, guard, async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= $1 AND status NOT IN ('cart','abandoned'))::int AS new_today,
          COUNT(*) FILTER (WHERE ${ORDER_STATUSES.verification})::int AS awaiting_verification,
          COUNT(*) FILTER (WHERE ${ORDER_STATUSES.awaiting_approval})::int AS awaiting_approval,
          COUNT(*) FILTER (WHERE crm_order_id IS NOT NULL AND verified_at >= $2)::int AS converted_this_month,
          COALESCE(array_agg(DISTINCT market) FILTER (WHERE market IS NOT NULL), '{}') AS markets,
          COALESCE(array_agg(DISTINCT package) FILTER (WHERE package IS NOT NULL), '{}') AS packages,
          ${Object.entries(ORDER_STATUSES).map(([k, f]) => `COUNT(*) FILTER (WHERE ${f})::int AS s_${k}`).join(",\n          ")}
        FROM website.orders
      `, [getStartOfBusinessDay(), getStartOfBusinessMonth()]);
      const r = rows[0];
      res.json({
        newToday: r.new_today,
        awaitingVerification: r.awaiting_verification,
        awaitingApproval: r.awaiting_approval,
        convertedThisMonth: r.converted_this_month,
        markets: r.markets,
        packages: r.packages,
        statusCounts: Object.fromEntries(Object.keys(ORDER_STATUSES).map(k => [k, r[`s_${k}`]])),
      });
    } catch (err) { fail(res, req, err, "Loading stats"); }
  });

  app.get(`${base}/orders`, guard, async (req, res) => {
    try { res.json(await runList(ORDERS_CFG, req.query as any)); } catch (err) { fail(res, req, err, "Loading orders"); }
  });

  app.get(`${base}/orders/export`, guard, async (req, res) => {
    try {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="website-orders-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send("﻿" + await runCsv(ORDERS_CFG, req.query as any));
    } catch (err) { fail(res, req, err, "Export"); }
  });

  app.get(`${base}/orders/:id`, guard, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid request id" });
    try {
      const request = await getOrderRequest(id);
      if (!request) return res.status(404).json({ message: "Request not found" });
      const user = req.user as User;
      const phoneDigits = normalizePhone(request.whatsapp);
      const [repeat, duplicateTxn, activity, crmOrder, users, meta] = await Promise.all([
        phoneDigits.length >= 7
          ? pool.query(
            `SELECT id FROM website.orders
             WHERE id <> $1 AND status NOT IN ('cart','abandoned')
               AND regexp_replace(COALESCE(whatsapp,''), '[^0-9]', '', 'g') = $2
               AND created_at >= $3::timestamptz - interval '30 days'`,
            [id, phoneDigits, request.created_at],
          )
          : Promise.resolve({ rows: [] as any[] }),
        request.transaction_id?.trim()
          ? pool.query(`SELECT id FROM website.orders WHERE id <> $1 AND lower(trim(transaction_id)) = lower(trim($2))`, [id, request.transaction_id])
          : Promise.resolve({ rows: [] as any[] }),
        getActivity(id),
        request.crm_order_id
          ? pool.query(`SELECT id, order_number FROM orders WHERE id = $1`, [request.crm_order_id])
          : Promise.resolve({ rows: [] as any[] }),
        storage.getUsers(),
        user.role === "admin"
          ? pool.query(`SELECT meta_response, (fbp IS NOT NULL) AS has_fbp, (fbc IS NOT NULL) AS has_fbc, (client_ip IS NOT NULL) AS has_ip FROM website.orders WHERE id = $1`, [id])
          : Promise.resolve({ rows: [] as any[] }),
      ]);
      const flags: { code: string; message: string }[] = [];
      if (repeat.rows.length > 0) flags.push({ code: "repeat_whatsapp", message: `Same WhatsApp already ordered ${repeat.rows.length} time${repeat.rows.length === 1 ? "" : "s"} in the last 30 days.` });
      if (duplicateTxn.rows.length > 0) flags.push({ code: "duplicate_transaction", message: `Transaction ID already used on ${duplicateTxn.rows.length} other request${duplicateTxn.rows.length === 1 ? "" : "s"}.` });
      if (request.pay_choice === "now" && !request.payment_screenshot_url && !["cart", "abandoned"].includes(request.status)) {
        flags.push({ code: "missing_screenshot", message: "Pay-now request has no payment screenshot." });
      }
      const nameOf = (userId: number | null) => (userId ? users.find((u: User) => u.id === userId)?.name ?? null : null);
      const order = crmOrder.rows[0];
      const m = meta.rows[0];
      res.json({
        ...request,
        flags,
        activity,
        crmOrder: order ? { id: order.id, orderNumber: order.order_number } : null,
        verifiedByName: nameOf(request.verified_by),
        submittedByName: nameOf(request.submitted_by),
        meta: m ? { response: m.meta_response, hasFbp: m.has_fbp, hasFbc: m.has_fbc, hasIp: m.has_ip } : null,
      });
    } catch (err) { fail(res, req, err, "Loading request"); }
  });

  app.patch(`${base}/orders/:id/notes`, guard, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid request id" });
    const body = z.object({ crmNotes: z.string().max(5000) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Invalid notes" });
    const user = req.user as User;
    try {
      await db.transaction(async tx => {
        const updated = rowsOf(await tx.execute(sql`UPDATE website.orders SET crm_notes = ${body.data.crmNotes.trim() || null} WHERE id = ${id} RETURNING id`));
        if (!updated[0]) throw new HttpError(404, "Request not found");
        await logActivity(id, user.id, "notes_updated", undefined, tx);
      });
      res.json(await getOrderRequest(id));
    } catch (err) { fail(res, req, err, "Saving notes"); }
  });

  /** Reject (support or admin) / Decline (admin, for requests awaiting approval). */
  app.post(`${base}/orders/:id/reject`, guard, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid request id" });
    const body = z.object({
      reason: z.enum(REJECT_REASONS, { error: "Pick a reason" }),
      note: z.string().trim().max(500).optional().nullable(),
    }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: body.error.issues[0]?.message || "A reason is required" });
    const user = req.user as User;
    try {
      const outcome = await db.transaction(async tx => {
        const row = rowsOf(await tx.execute(sql`SELECT id, name, status, total, currency, crm_order_id, submitted_by, package FROM website.orders WHERE id = ${id} FOR UPDATE`))[0];
        if (!row) throw new HttpError(404, "Request not found");
        if (row.crm_order_id) throw new HttpError(409, "This request already has a CRM order and can't be rejected.");
        if (row.status === "rejected") throw new HttpError(409, "This request is already rejected.");
        const wasAwaiting = row.status === "pending_approval";
        if (wasAwaiting && user.role !== "admin") throw new HttpError(403, "This request is waiting for an admin decision.");
        await tx.execute(sql`UPDATE website.orders SET status = 'rejected', reject_reason = ${body.data.reason} WHERE id = ${id}`);
        await logActivity(id, user.id, wasAwaiting ? "declined" : "rejected", { reason: body.data.reason, note: body.data.note || null }, tx);
        return { row, wasAwaiting };
      });
      if (outcome.wasAwaiting && outcome.row.submitted_by) {
        await deps.notifySubmitterDecision(outcome.row.submitted_by, outcome.row, "declined", user.id).catch(e => console.error("[website-requests] decline notify failed:", e));
      }
      res.json(await getOrderRequest(id));
    } catch (err) { fail(res, req, err, "Reject"); }
  });

  /** Support (or admin): send a request to admins for approval. */
  app.post(`${base}/orders/:id/send-for-approval`, guard, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid request id" });
    const body = z.object({ note: z.string().trim().max(1000).optional().nullable() }).safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ message: "Note is too long" });
    const user = req.user as User;
    const note = body.data.note || null;
    try {
      const row = await db.transaction(async tx => {
        const current = rowsOf(await tx.execute(sql`SELECT id, name, status, total, currency, crm_order_id FROM website.orders WHERE id = ${id} FOR UPDATE`))[0];
        if (!current) throw new HttpError(404, "Request not found");
        if (current.crm_order_id || ["converted", "paid"].includes(current.status)) throw new HttpError(409, "This request already has a CRM order.");
        if (current.status === "rejected") throw new HttpError(409, "Rejected requests can't be sent for approval.");
        if (current.status === "pending_approval") throw new HttpError(409, "This request is already waiting for approval.");
        const updated = rowsOf(await tx.execute(sql`
          UPDATE website.orders
          SET status = 'pending_approval', submitted_by = ${user.id}, submitted_at = NOW(), approval_note = ${note}
          WHERE id = ${id}
          RETURNING id, name, status, total, currency, submitted_at`))[0];
        await logActivity(id, user.id, "sent_for_approval", { note, previousStatus: current.status }, tx);
        return updated;
      });
      deps.notifyApprovalRequested({ ...row, submittedAt: new Date(row.submitted_at).toISOString() }, user, note)
        .catch(e => console.error(`[website-requests] approval notification failed for ${id} (request was saved):`, e));
      res.json(await getOrderRequest(id));
    } catch (err) { fail(res, req, err, "Sending for approval"); }
  });

  /**
   * Admin: Verify & place order / Approve & place. Uses the same order-creation
   * function as the Orders page and runs the CRM order, services, payment
   * record, activity, website.orders update and the Meta claim in ONE
   * transaction. Row lock + crm_order_id check + unique index = no double
   * placing. The Meta Purchase is sent after the commit, never blocking.
   */
  const placeHandler = (mode: "place" | "approve") => async (req: Request, res: Response) => {
    const user = req.user as User;
    if (user.role !== "admin") {
      return res.status(403).json({ message: "Only an admin can place website orders. Use \"Send for approval\" instead." });
    }
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid request id" });
    const parsed = placeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    const data = parsed.data;
    if (data.amountReceived > data.totalPrice) return res.status(400).json({ message: "Amount received cannot be greater than total bill." });
    if (data.orderType === "documentation" && data.services.length === 0) return res.status(400).json({ message: "At least one service is required" });

    const services = data.orderType === "portfolio_website"
      ? [{ serviceType: "Website", quantity: 1, instructions: null }]
      : data.orderType === "resume_distribution"
      ? [{ serviceType: "Distribution Service", quantity: 1, instructions: null }]
      : data.services.map(s => ({ serviceType: s.serviceType, quantity: s.quantity, instructions: s.instructions || null }));
    const paymentType: "advance" | "full" = data.amountReceived >= data.totalPrice ? "full" : "advance";

    try {
      const result = await db.transaction(async tx => {
        const row = rowsOf(await tx.execute(sql`SELECT id, name, status, total, currency, crm_order_id, submitted_by FROM website.orders WHERE id = ${id} FOR UPDATE`))[0];
        if (!row) throw new HttpError(404, "Request not found");
        if (row.crm_order_id) throw new HttpError(409, "This request already has a CRM order.");
        if (row.status === "rejected") throw new HttpError(409, "Rejected requests can't be placed.");
        if (mode === "approve" && row.status !== "pending_approval") throw new HttpError(409, "This request is not waiting for approval any more. Reload the page.");

        const notesParts = [data.notes?.trim(), data.transactionId?.trim() ? `Transaction ID: ${data.transactionId.trim()}` : null].filter(Boolean);
        const order = await placeApprovedOrderTx(tx, {
          order: {
            clientName: data.clientName,
            clientPhone: data.clientPhone,
            clientEmail: data.clientEmail || null,
            clientType: data.clientType,
            orderType: data.orderType,
            numberOfRevisions: data.orderType === "resume_distribution" ? null : data.numberOfRevisions ?? null,
            remainingRevisions: data.orderType === "resume_distribution" ? null : data.numberOfRevisions ?? null,
            supportPeriod: data.supportPeriod ?? null,
            totalPrice: data.totalPrice,
            discountAmount: 0,
            advanceAmount: data.amountReceived,
            paymentMethod: data.paymentMethod || null,
            platform: data.platform || null,
            campaign: data.campaign || null,
            adSet: data.adSet || null,
            creative: data.creative || null,
            notes: notesParts.length ? notesParts.join("\n") : null,
          },
          services,
          designerId: data.assignedToId || null,
          actorId: user.id,
          source: { source: "website_request", websiteRequestId: id, submittedBy: row.submitted_by ?? null },
          // Due date from the website package (e.g. executive_bundle = 11.11 Bundle, 5 days).
          deliveryPackageKey: typeof row.package === "string" ? row.package : null,
        });

        // Payment record (approved) keeps the amount + proof on file and feeds the dashboard cash flow.
        if (data.amountReceived > 0) {
          const [verification] = await tx.insert(paymentVerifications).values({
            orderId: order.id,
            paymentType,
            amount: data.amountReceived,
            screenshotUrl: data.screenshotUrl || null,
            submittedById: row.submitted_by || user.id,
            status: "approved",
            reviewedById: user.id,
            reviewedAt: new Date(),
            notes: `Website request${data.transactionId ? ` · Txn ${data.transactionId}` : ""}`,
          }).returning({ id: paymentVerifications.id });
          await tx.insert(activityLogs).values({
            orderId: order.id, actorId: user.id, activityType: "payment_change", newValue: "approved",
            details: { paymentVerificationId: verification.id, paymentType, amount: data.amountReceived },
          });
        }

        // paid_amount is stored in rupees to match website.orders.total.
        const websiteStatus = data.amountReceived > 0 ? "paid" : "converted";
        await tx.execute(sql`
          UPDATE website.orders SET
            status = ${websiteStatus}::website.order_status,
            paid_amount = ${data.amountReceived / 100},
            crm_order_id = ${order.id},
            verified_by = ${user.id},
            verified_at = NOW(),
            paid_at = CASE WHEN ${data.amountReceived} > 0 THEN COALESCE(paid_at, NOW()) ELSE paid_at END
          WHERE id = ${id}
        `);
        // Meta Purchase: claimed here (once), sent after commit.
        const metaPayload = await claimWebsitePurchaseTx(txQueryOf(tx), id, order.id, data.amountReceived / 100, new Date());
        await logActivity(id, user.id, row.status === "pending_approval" ? "approved_and_placed" : "placed", {
          crmOrderId: order.id, orderNumber: order.orderNumber, amountReceived: data.amountReceived / 100, websiteStatus,
          meta: metaPayload ? "queued" : data.amountReceived > 0 ? "not_configured" : "no_payment",
        }, tx);
        return { order, row, metaPayload };
      });

      if (result.metaPayload) queuePurchase({ websiteOrderId: id, crmOrderId: result.order.id }, result.metaPayload);
      deps.afterPlacement(user, result.order).catch(err => console.error("[website-requests] post-placement notify failed:", err));
      if (result.row.status === "pending_approval" && result.row.submitted_by) {
        deps.notifySubmitterDecision(result.row.submitted_by, result.row, "approved", user.id, result.order.id)
          .catch(err => console.error("[website-requests] approval notify failed:", err));
      }
      res.status(201).json({ order: result.order, request: await getOrderRequest(id) });
    } catch (err) { fail(res, req, err, "Placing the order"); }
  };
  app.post(`${base}/orders/:id/place`, guard, placeHandler("place"));
  app.post(`${base}/orders/:id/approve`, guard, placeHandler("approve"));

  app.post(`${base}/orders/:id/meta-retry`, guard, async (req, res) => {
    const user = req.user as User;
    if (user.role !== "admin") return res.status(403).json({ message: "Only an admin can retry Meta events." });
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid request id" });
    try {
      const started = await retryPurchase({ kind: "website", id });
      if (!started) return res.status(409).json({ message: "Nothing to retry - the Purchase was already sent or is still sending." });
      await logActivity(id, user.id, "meta_retry");
      res.json(await getOrderRequest(id));
    } catch (err) { fail(res, req, err, "Meta retry"); }
  });

  // ── Free CV reviews ────────────────────────────────────────────────────────

  app.get(`${base}/reviews/stats`, guard, async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= $1)::int AS new_today,
          COUNT(*) FILTER (WHERE status = 'in_review')::int AS in_review,
          COUNT(*) FILTER (WHERE status IN ('sent','converted') AND sent_at >= $2)::int AS sent_this_month,
          COUNT(*) FILTER (WHERE status = 'converted' AND converted_at >= $2)::int AS converted_this_month,
          ${Object.entries(REVIEWS_CFG.statuses).map(([k, f]) => `COUNT(*) FILTER (WHERE ${f})::int AS s_${k}`).join(",\n          ")}
        FROM website.cv_reviews
      `, [getStartOfBusinessDay(), getStartOfBusinessMonth()]);
      const r = rows[0];
      res.json({
        newToday: r.new_today, inReview: r.in_review, sentThisMonth: r.sent_this_month, convertedThisMonth: r.converted_this_month,
        statusCounts: Object.fromEntries(Object.keys(REVIEWS_CFG.statuses).map(k => [k, r[`s_${k}`]])),
      });
    } catch (err) { fail(res, req, err, "Loading stats"); }
  });

  app.get(`${base}/reviews`, guard, async (req, res) => {
    try { res.json(await runList(REVIEWS_CFG, req.query as any)); } catch (err) { fail(res, req, err, "Loading reviews"); }
  });

  app.get(`${base}/reviews/export`, guard, async (req, res) => {
    try {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="free-cv-reviews-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send("﻿" + await runCsv(REVIEWS_CFG, req.query as any));
    } catch (err) { fail(res, req, err, "Export"); }
  });

  app.get(`${base}/reviews/:id`, guard, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid review id" });
    try {
      const [row, activity] = await Promise.all([
        pool.query(`SELECT ${REVIEW_COLUMNS}, landing_page, referrer FROM website.cv_reviews WHERE id = $1`, [id]),
        getActivity(id),
      ]);
      if (!row.rows[0]) return res.status(404).json({ message: "Review not found" });
      const r = row.rows[0];
      const crm = r.crm_order_id ? (await pool.query(`SELECT id, order_number FROM orders WHERE id = $1`, [r.crm_order_id])).rows[0] : null;
      res.json({ ...r, activity, crmOrder: crm ? { id: crm.id, orderNumber: crm.order_number } : null });
    } catch (err) { fail(res, req, err, "Loading review"); }
  });

  app.patch(`${base}/reviews/:id`, guard, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid review id" });
    const body = z.object({
      status: z.enum(["new", "in_review", "sent", "rejected"]).optional(),
      notes: z.string().max(5000).optional(),
      reason: z.enum(REJECT_REASONS).optional(),
    }).refine(b => b.status !== undefined || b.notes !== undefined, "Nothing to update")
      .refine(b => b.status !== "rejected" || !!b.reason, "Pick a reason")
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: body.error.issues[0]?.message || "Invalid update" });
    const user = req.user as User;
    const { status, notes, reason } = body.data;
    try {
      await db.transaction(async tx => {
        const row = rowsOf(await tx.execute(sql`SELECT id, status::text AS status, crm_order_id FROM website.cv_reviews WHERE id = ${id} FOR UPDATE`))[0];
        if (!row) throw new HttpError(404, "Review not found");
        if (status && status !== row.status) {
          if (row.status === "converted" || row.crm_order_id) throw new HttpError(409, "This review was already converted to an order.");
          const rule = REVIEW_TRANSITIONS[status];
          if (!rule.from.includes(row.status)) throw new HttpError(409, `Can't move a "${row.status.replace("_", " ")}" review to "${status.replace("_", " ")}". Reload the page.`);
          await tx.execute(sql`
            UPDATE website.cv_reviews SET
              status = ${status}::website.cv_review_status,
              review_started_by = CASE WHEN ${status} = 'in_review' THEN ${user.id} ELSE review_started_by END,
              review_started_at = CASE WHEN ${status} = 'in_review' THEN NOW() ELSE review_started_at END,
              sent_by = CASE WHEN ${status} = 'sent' THEN ${user.id} ELSE sent_by END,
              sent_at = CASE WHEN ${status} = 'sent' THEN NOW() ELSE sent_at END,
              reject_reason = CASE WHEN ${status} = 'rejected' THEN ${reason ?? null} ELSE reject_reason END
            WHERE id = ${id}`);
          await logActivity(id, user.id, rule.action, { from: row.status, to: status, reason: reason ?? null }, tx);
        } else if (status && status === row.status && notes === undefined) {
          throw new HttpError(409, `This review is already "${status.replace("_", " ")}".`);
        }
        if (notes !== undefined) {
          await tx.execute(sql`UPDATE website.cv_reviews SET internal_notes = ${notes.trim() || null} WHERE id = ${id}`);
          await logActivity(id, user.id, "notes_updated", undefined, tx);
        }
      });
      res.json((await pool.query(`SELECT ${REVIEW_COLUMNS} FROM website.cv_reviews WHERE id = $1`, [id])).rows[0]);
    } catch (err) { fail(res, req, err, "Updating review"); }
  });

  /**
   * Link a CRM order created from the prefilled order form to this review.
   * The order itself is created by POST /api/orders (normal role rules);
   * this marks the review converted in one transaction.
   */
  app.post(`${base}/reviews/:id/convert`, guard, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid review id" });
    const body = z.object({ orderId: z.number().int().positive() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Order id is required" });
    const user = req.user as User;
    try {
      await db.transaction(async tx => {
        const row = rowsOf(await tx.execute(sql`SELECT id, status::text AS status, crm_order_id FROM website.cv_reviews WHERE id = ${id} FOR UPDATE`))[0];
        if (!row) throw new HttpError(404, "Review not found");
        if (row.crm_order_id) throw new HttpError(409, "This review is already linked to an order.");
        const order = rowsOf(await tx.execute(sql`SELECT id, order_number, created_by_id FROM orders WHERE id = ${body.data.orderId}`))[0];
        if (!order) throw new HttpError(404, "Order not found");
        if (user.role !== "admin" && order.created_by_id !== user.id) throw new HttpError(403, "You can only link orders you created.");
        await tx.execute(sql`UPDATE website.cv_reviews SET status = 'converted', crm_order_id = ${order.id}, converted_at = NOW() WHERE id = ${id}`);
        await logActivity(id, user.id, "converted", { crmOrderId: order.id, orderNumber: order.order_number, from: row.status }, tx);
      });
      res.json((await pool.query(`SELECT ${REVIEW_COLUMNS} FROM website.cv_reviews WHERE id = $1`, [id])).rows[0]);
    } catch (err) { fail(res, req, err, "Converting review"); }
  });

  // ── Partners ───────────────────────────────────────────────────────────────

  app.get(`${base}/partners/stats`, guard, async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - interval '7 days')::int AS new_this_week,
          COUNT(*) FILTER (WHERE status = 'trial')::int AS in_trial,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*)::int AS total,
          COALESCE(array_agg(DISTINCT country_hq) FILTER (WHERE country_hq IS NOT NULL AND country_hq <> ''), '{}') AS countries,
          ${Object.entries(PARTNERS_CFG.statuses).map(([k, f]) => `COUNT(*) FILTER (WHERE ${f})::int AS s_${k}`).join(",\n          ")}
        FROM website.partners
      `);
      const r = rows[0];
      res.json({
        newThisWeek: r.new_this_week, inTrial: r.in_trial, active: r.active, total: r.total, countries: r.countries,
        statusCounts: Object.fromEntries(Object.keys(PARTNERS_CFG.statuses).map(k => [k, r[`s_${k}`]])),
      });
    } catch (err) { fail(res, req, err, "Loading stats"); }
  });

  app.get(`${base}/partners`, guard, async (req, res) => {
    try { res.json(await runList(PARTNERS_CFG, req.query as any)); } catch (err) { fail(res, req, err, "Loading partners"); }
  });

  app.get(`${base}/partners/export`, guard, async (req, res) => {
    try {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="agency-partners-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send("﻿" + await runCsv(PARTNERS_CFG, req.query as any));
    } catch (err) { fail(res, req, err, "Export"); }
  });

  app.get(`${base}/partners/:id`, guard, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid partner id" });
    try {
      const [row, activity] = await Promise.all([
        pool.query(`SELECT ${PARTNER_COLUMNS}, landing_page, referrer FROM website.partners WHERE id = $1`, [id]),
        getActivity(id),
      ]);
      if (!row.rows[0]) return res.status(404).json({ message: "Partner not found" });
      res.json({ ...row.rows[0], activity });
    } catch (err) { fail(res, req, err, "Loading partner"); }
  });

  app.patch(`${base}/partners/:id`, guard, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid partner id" });
    const body = z.object({
      status: z.enum(PARTNER_STATUS_VALUES).optional(),
      notes: z.string().max(5000).optional(),
    }).refine(b => b.status !== undefined || b.notes !== undefined, "Nothing to update").safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: body.error.issues[0]?.message || "Invalid update" });
    const user = req.user as User;
    const { status, notes } = body.data;
    try {
      await db.transaction(async tx => {
        const row = rowsOf(await tx.execute(sql`SELECT id, status::text AS status FROM website.partners WHERE id = ${id} FOR UPDATE`))[0];
        if (!row) throw new HttpError(404, "Partner not found");
        if (status && status !== row.status) {
          await tx.execute(sql`
            UPDATE website.partners SET status = ${status}::website.partner_status,
              contacted_at = CASE WHEN ${status} = 'contacted' THEN COALESCE(contacted_at, NOW()) ELSE contacted_at END
            WHERE id = ${id}`);
          await logActivity(id, user.id, "status_changed", { from: row.status, to: status }, tx);
        } else if (status && notes === undefined) {
          throw new HttpError(409, `This partner is already "${status}".`);
        }
        if (notes !== undefined) {
          await tx.execute(sql`UPDATE website.partners SET internal_notes = ${notes.trim() || null} WHERE id = ${id}`);
          await logActivity(id, user.id, "notes_updated", undefined, tx);
        }
      });
      res.json((await pool.query(`SELECT ${PARTNER_COLUMNS} FROM website.partners WHERE id = $1`, [id])).rows[0]);
    } catch (err) { fail(res, req, err, "Updating partner"); }
  });

  startNewRequestPoller(deps);
}

/**
 * Every 10s, look for new website submissions (orders, CV reviews, partners)
 * and push a bell notification to Admin + Support. Notification dedupe keys
 * (id + status) guarantee each item notifies each user at most once.
 */
function startNewRequestPoller(deps: Deps) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { rows } = await pool.query(`
        SELECT * FROM (
          SELECT id, name, status::text AS status, total, currency, 'order' AS kind, created_at FROM website.orders
            WHERE ${ORDER_NEW_SQL} AND updated_at >= NOW() - interval '15 minutes'
          UNION ALL
          SELECT id, name, status::text, NULL, NULL, 'review', created_at FROM website.cv_reviews
            WHERE status = 'new' AND created_at >= NOW() - interval '15 minutes'
          UNION ALL
          SELECT id, COALESCE(org_name, contact_name), status::text, NULL, NULL, 'partner', created_at FROM website.partners
            WHERE status = 'new' AND created_at >= NOW() - interval '15 minutes'
        ) t ORDER BY created_at ASC LIMIT 50
      `);
      if (rows.length === 0) return;
      const recipients = (await storage.getUsers())
        .filter(u => u.isActive && ALLOWED_ROLES.includes(u.role))
        .map(u => u.id);
      for (const row of rows) await deps.notifyNewRequest(recipients, row);
    } catch (err: any) {
      // website schema may be unavailable in some environments
      if (!String(err?.message || "").includes("does not exist")) console.error("[website-requests] poll failed:", err?.message || err);
    } finally {
      running = false;
    }
  };
  if (process.env.CRM_DISABLE_BACKGROUND === "1") return; // tests
  setInterval(tick, POLL_INTERVAL_MS).unref?.();
  setTimeout(tick, 5_000).unref?.();
}
