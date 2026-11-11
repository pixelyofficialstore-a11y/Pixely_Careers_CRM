/**
 * Meta Conversions API — server-side Purchase events.
 *
 * ENV:
 *   META_PIXEL_ID, META_CAPI_ACCESS_TOKEN  (required to send)
 *   META_TEST_EVENT_CODE                   (optional; events show in Events Manager → Test events)
 *   META_DEBUG=1                           (log the exact payload, hashed values only, token masked)
 *
 * Rules:
 *   - One Purchase per order. The caller "claims" the order inside its DB
 *     transaction (meta_event_id set, meta_status = 'pending' only when it was
 *     NULL), and calls dispatchPurchase() AFTER the commit. Nothing here ever
 *     blocks or fails the user's action.
 *   - 3 retries with 1s / 3s / 9s backoff; the final result (events_received,
 *     fbtrace_id or the error) is stored in meta_response.
 *   - PII is SHA-256 hashed after normalising. fbp, fbc, IP and user agent are
 *     sent as-is (Meta requires them unhashed).
 */
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { pool } from "../db";

const GRAPH_VERSION = "v21.0";
const RETRY_DELAYS_MS = [1_000, 3_000, 9_000];

export type MetaStatus = "pending" | "sent" | "test" | "failed";

export const metaConfig = () => ({
  pixelId: process.env.META_PIXEL_ID?.trim() || "",
  token: process.env.META_CAPI_ACCESS_TOKEN?.trim() || "",
  testCode: process.env.META_TEST_EVENT_CODE?.trim() || "",
  debug: process.env.META_DEBUG === "1",
});

export function isMetaConfigured() {
  const c = metaConfig();
  return !!(c.pixelId && c.token);
}

// ── Normalisation + hashing ──────────────────────────────────────────────────

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const hashed = (value: string | null | undefined) => (value ? sha256(value) : undefined);

/** Phone → E.164 digits without "+" (e.g. 923001234567). Pakistani local numbers get 92. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (/^03\d{9}$/.test(digits)) digits = `92${digits.slice(1)}`;
  else if (/^3\d{9}$/.test(digits)) digits = `92${digits}`;
  return digits.length >= 8 ? digits : null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

const NON_LETTER = new RegExp("[^\\p{L}]", "gu");
const normalizeNamePart = (raw: string | undefined) => {
  const v = (raw || "").trim().toLowerCase().replace(NON_LETTER, "");
  return v || null;
};

export function splitName(full: string | null | undefined): { fn: string | null; ln: string | null } {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { fn: null, ln: null };
  return { fn: normalizeNamePart(parts[0]), ln: parts.length > 1 ? normalizeNamePart(parts[parts.length - 1]) : null };
}

const PACKAGE_LABELS: Record<string, string> = {
  executive_bundle: "11.11 Bundle",
  executive: "Executive Career Branding",
  executive_career: "Executive Career Branding",
  pro: "International Career Pro",
  "international-pro": "International Career Pro",
  international_career_pro: "International Career Pro",
  international: "International Career Pro",
  ats: "ATS Career",
  ats_career: "ATS Career",
  starter: "ATS Career",
};
export const packageLabel = (key: string | null | undefined) =>
  PACKAGE_LABELS[(key || "").toLowerCase()] ?? (key || "").replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());

// ── Payload builders ─────────────────────────────────────────────────────────

type Payload = { data: any[]; test_event_code?: string };

/** a) Website request placed/approved with a verified payment. */
export function buildWebsitePurchase(row: {
  id: string; package: string | null; currency: string | null; name: string | null; whatsapp: string | null; email: string | null;
  fbp: string | null; fbc: string | null; client_ip: string | null; user_agent: string | null; event_source_url: string | null; landing_page: string | null;
  country?: string | null;
}, paidAmount: number, eventTime: Date): Payload {
  const { fn, ln } = splitName(row.name);
  const country = (row.country || "").trim().toLowerCase();
  const user_data = clean({
    ph: [hashed(normalizePhone(row.whatsapp))].filter(Boolean),
    em: [hashed(normalizeEmail(row.email))].filter(Boolean),
    fn: [hashed(fn)].filter(Boolean),
    ln: [hashed(ln)].filter(Boolean),
    country: /^[a-z]{2}$/.test(country) ? [sha256(country)] : undefined,
    external_id: [sha256(String(row.id))],
    fbp: row.fbp || undefined,
    fbc: row.fbc || undefined,
    client_ip_address: row.client_ip || undefined,
    client_user_agent: row.user_agent || undefined,
  });
  return withTestCode({
    data: [clean({
      event_name: "Purchase",
      event_time: Math.floor(eventTime.getTime() / 1000),
      event_id: `purchase_${row.id}`,
      action_source: "website",
      event_source_url: safeUrl(row.event_source_url) || safeUrl(row.landing_page) || undefined,
      user_data,
      custom_data: {
        value: round2(paidAmount),
        // paid_amount is what staff verified in the CRM, which is always PKR.
        currency: "PKR",
        content_ids: [row.package || "unknown"],
        content_name: packageLabel(row.package),
        content_type: "product",
        order_id: String(row.id),
      },
    })],
  });
}

/** b) Normal CRM order (WhatsApp/manual) — first recorded payment. Amounts in paisa. */
export function buildCrmPurchase(order: {
  id: number; orderNumber: string | null; clientName: string | null; clientPhone: string | null; clientEmail: string | null; orderType: string | null;
}, amountPaisa: number, eventTime: Date, services: string[] = []): Payload {
  const { fn, ln } = splitName(order.clientName);
  return withTestCode({
    data: [clean({
      event_name: "Purchase",
      event_time: Math.floor(eventTime.getTime() / 1000),
      event_id: `purchase_crm_${order.id}`,
      action_source: "chat",
      user_data: clean({
        ph: [hashed(normalizePhone(order.clientPhone))].filter(Boolean),
        em: [hashed(normalizeEmail(order.clientEmail))].filter(Boolean),
        fn: [hashed(fn)].filter(Boolean),
        ln: [hashed(ln)].filter(Boolean),
        external_id: [sha256(String(order.id))],
      }),
      custom_data: {
        value: round2(amountPaisa / 100),
        currency: "PKR",
        content_ids: services.length ? services : [order.orderType || "documentation"],
        content_name: services.length ? services.join(", ") : order.orderType || "CRM order",
        content_type: "product",
        order_id: order.orderNumber || String(order.id),
      },
    })],
  });
}

function withTestCode(payload: Payload): Payload {
  const { testCode } = metaConfig();
  return testCode ? { ...payload, test_event_code: testCode } : payload;
}

/** Drop empty arrays / undefined so Meta never receives blank keys. */
function clean<T extends Record<string, any>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))) as T;
}
const round2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;
const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

// ── Sending ──────────────────────────────────────────────────────────────────

export type SendResult = { ok: boolean; status: MetaStatus; response: Record<string, unknown> };

/** One POST to the Graph API (no retries). */
export async function postToMeta(payload: Payload): Promise<SendResult> {
  const { pixelId, token, debug } = metaConfig();
  if (!pixelId || !token) return { ok: false, status: "failed", response: { error: "META_PIXEL_ID / META_CAPI_ACCESS_TOKEN not set" } };
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`;
  if (debug) {
    const masked = token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-4)}` : "****";
    console.log(`[meta-capi] POST https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${masked}\n${JSON.stringify(payload, null, 2)}`);
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const body: any = await res.json().catch(() => ({}));
    if (debug) console.log(`[meta-capi] response ${res.status}: ${JSON.stringify(body)}`);
    if (res.ok && Number(body?.events_received) >= 1) {
      return {
        ok: true,
        status: payload.test_event_code ? "test" : "sent",
        response: { events_received: body.events_received, fbtrace_id: body.fbtrace_id, messages: body.messages, test_event_code: payload.test_event_code || null },
      };
    }
    return {
      ok: false,
      status: "failed",
      response: {
        http_status: res.status,
        error: body?.error?.message || `HTTP ${res.status}`,
        code: body?.error?.code,
        error_subcode: body?.error?.error_subcode,
        fbtrace_id: body?.error?.fbtrace_id || body?.fbtrace_id,
      },
    };
  } catch (err: any) {
    return { ok: false, status: "failed", response: { error: err?.name === "TimeoutError" ? "Timed out after 15s" : err?.message || String(err) } };
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Where the result is written. A website purchase also updates its CRM order. */
export type MetaTarget = { websiteOrderId?: string | null; crmOrderId?: number | null };

async function storeResult(target: MetaTarget, payload: Payload, result: SendResult, attempts: number) {
  const response = JSON.stringify({ ...result.response, attempts, at: new Date().toISOString() });
  const payloadJson = JSON.stringify(payload);
  const sentAt = result.ok ? new Date() : null;
  if (target.websiteOrderId) {
    await pool.query(
      `UPDATE website.orders SET meta_status = $2, meta_response = $3::jsonb, meta_payload = $4::jsonb,
         meta_purchase_sent_at = COALESCE($5, meta_purchase_sent_at) WHERE id = $1`,
      [target.websiteOrderId, result.status, response, payloadJson, sentAt],
    );
  }
  if (target.crmOrderId) {
    await pool.query(
      `UPDATE orders SET meta_status = $2, meta_response = $3::jsonb, meta_payload = $4::jsonb,
         meta_purchase_sent_at = COALESCE($5, meta_purchase_sent_at) WHERE id = $1`,
      [target.crmOrderId, result.status, response, payloadJson, sentAt],
    );
  }
}

/**
 * Send a claimed Purchase with retries and store the outcome. Call after the
 * transaction commits; never awaited by request handlers (fire and forget).
 */
export async function dispatchPurchase(target: MetaTarget, payload: Payload, delays = RETRY_DELAYS_MS): Promise<SendResult> {
  let result = await postToMeta(payload);
  let attempts = 1;
  for (const delay of delays) {
    if (result.ok) break;
    await sleep(delay);
    result = await postToMeta(payload);
    attempts++;
  }
  const label = target.websiteOrderId ? `website ${target.websiteOrderId}` : `crm order ${target.crmOrderId}`;
  if (result.ok) console.log(`[meta-capi] Purchase ${payload.data[0]?.event_id} (${label}) ${result.status}: events_received=${result.response.events_received} fbtrace_id=${result.response.fbtrace_id}`);
  else console.error(`[meta-capi] Purchase ${payload.data[0]?.event_id} (${label}) FAILED after ${attempts} attempts: ${result.response.error}`);
  try {
    await storeResult(target, payload, result, attempts);
  } catch (err) {
    console.error(`[meta-capi] could not store result for ${label}:`, err);
  }
  return result;
}

/** Fire-and-forget wrapper that never throws. */
export function queuePurchase(target: MetaTarget, payload: Payload) {
  dispatchPurchase(target, payload).catch(err => console.error("[meta-capi] dispatch crashed:", err));
}

// ── Claim + build helpers used by the routes ─────────────────────────────────

const WEBSITE_META_COLUMNS = `id, package, currency, name, whatsapp, email, fbp, fbc, client_ip, user_agent, event_source_url, landing_page, country`;

type TxQuery = (text: string, params: unknown[]) => Promise<{ rows: any[] }>;

/** Adapter: run "$1"-style SQL on a drizzle transaction. */
export const txQueryOf = (tx: any): TxQuery => async (text, params) => {
  const parts = text.split(/\$(\d+)/);
  const chunks = parts.map((p, i) => (i % 2 === 0 ? sql.raw(p) : sql`${params[Number(p) - 1]}`));
  const result: any = await tx.execute(sql.join(chunks, sql.raw("")));
  return { rows: result?.rows ?? result ?? [] };
};

let websiteSchemaPresent: boolean | null = null;
async function hasWebsiteOrders(): Promise<boolean> {
  if (websiteSchemaPresent === null) {
    const { rows } = await pool.query(`SELECT to_regclass('website.orders') IS NOT NULL AS ok`);
    websiteSchemaPresent = !!rows[0]?.ok;
  }
  return websiteSchemaPresent;
}

/**
 * Inside the placement transaction: claim the website row (and its new CRM
 * order) for a Purchase. Returns the payload to send after commit, or null when
 * Meta isn't configured / nothing was paid / it was already claimed.
 */
export async function claimWebsitePurchaseTx(
  txQuery: TxQuery,
  websiteOrderId: string, crmOrderId: number, paidAmount: number, eventTime: Date,
): Promise<Payload | null> {
  if (!isMetaConfigured() || !(paidAmount > 0)) return null;
  const eventId = `purchase_${websiteOrderId}`;
  const { rows } = await txQuery(
    `UPDATE website.orders SET meta_event_id = $2, meta_status = 'pending'
     WHERE id = $1 AND meta_event_id IS NULL RETURNING ${WEBSITE_META_COLUMNS}`,
    [websiteOrderId, eventId],
  );
  if (!rows[0]) return null;
  const payload = buildWebsitePurchase(rows[0], paidAmount, eventTime);
  // Payload is stored with the claim so a crash mid-send can still be retried.
  await txQuery(`UPDATE website.orders SET meta_payload = $2::jsonb WHERE id = $1`, [websiteOrderId, JSON.stringify(payload)]);
  await txQuery(
    `UPDATE orders SET meta_event_id = $2, meta_status = 'pending', meta_payload = $3::jsonb WHERE id = $1 AND meta_event_id IS NULL`,
    [crmOrderId, eventId, JSON.stringify(payload)],
  );
  return payload;
}

/**
 * Inside a payment transaction: claim a CRM order for its first-payment
 * Purchase. Skips orders that came from a website request (those send the
 * website Purchase instead).
 */
export async function claimCrmPurchaseTx(
  txQuery: TxQuery,
  orderId: number, amountPaisa: number, eventTime: Date,
): Promise<Payload | null> {
  if (!isMetaConfigured() || !(amountPaisa > 0)) return null;
  const notWebsite = (await hasWebsiteOrders())
    ? `AND NOT EXISTS (SELECT 1 FROM website.orders w WHERE w.crm_order_id = orders.id)`
    : "";
  const { rows } = await txQuery(
    `UPDATE orders SET meta_event_id = $2, meta_status = 'pending'
     WHERE id = $1 AND meta_event_id IS NULL ${notWebsite}
     RETURNING id, order_number, client_name, client_phone, client_email, order_type`,
    [orderId, `purchase_crm_${orderId}`],
  );
  const o = rows[0];
  if (!o) return null;
  const services = (await txQuery(`SELECT DISTINCT service_type FROM order_services WHERE order_id = $1 ORDER BY 1`, [orderId])).rows.map(r => r.service_type);
  const payload = buildCrmPurchase(
    { id: o.id, orderNumber: o.order_number, clientName: o.client_name, clientPhone: o.client_phone, clientEmail: o.client_email, orderType: o.order_type },
    amountPaisa, eventTime, services,
  );
  await txQuery(`UPDATE orders SET meta_payload = $2::jsonb WHERE id = $1`, [orderId, JSON.stringify(payload)]);
  return payload;
}

/**
 * Retry a failed Purchase (admin). Re-sends the stored payload (same event_id,
 * so Meta de-duplicates). Atomically flips failed → pending so two clicks can't
 * double-send. Returns false when there is nothing to retry.
 */
export async function retryPurchase(target: { kind: "website"; id: string } | { kind: "crm"; id: number }): Promise<boolean> {
  if (target.kind === "crm" && (await hasWebsiteOrders())) {
    // A CRM order placed from a website request shares the website Purchase.
    const { rows } = await pool.query(`SELECT id FROM website.orders WHERE crm_order_id = $1`, [target.id]);
    if (rows[0]) return retryPurchase({ kind: "website", id: rows[0].id });
  }
  const table = target.kind === "website" ? "website.orders" : "orders";
  const { rows } = await pool.query(
    `UPDATE ${table} SET meta_status = 'pending' WHERE id = $1 AND meta_status = 'failed' AND meta_payload IS NOT NULL
     RETURNING meta_payload${target.kind === "website" ? ", crm_order_id" : ""}`,
    [target.id],
  );
  if (!rows[0]) return false;
  const stored: Payload = rows[0].meta_payload;
  // Re-apply the CURRENT test code (it may have been added/removed since).
  const { test_event_code: _old, ...rest } = stored;
  const payload = withTestCode(rest as Payload);
  let crmOrderId: number | null = target.kind === "crm" ? target.id : rows[0].crm_order_id;
  if (target.kind === "website" && crmOrderId) {
    await pool.query(`UPDATE orders SET meta_status = 'pending' WHERE id = $1 AND meta_event_id = $2`, [crmOrderId, payload.data[0]?.event_id]);
  }
  queuePurchase(target.kind === "website" ? { websiteOrderId: target.id, crmOrderId } : { crmOrderId }, payload);
  return true;
}
