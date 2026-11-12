/**
 * Phase 0 HTTP tests against the real route table.
 * All DB access runs in ONE transaction that is rolled back (txHarness).
 * Run: pnpm test
 */
import "dotenv/config";
process.env.CRM_DISABLE_BACKGROUND = "1";

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { beginTestTransaction, rollbackTestTransaction, tableExists, testQuery, securityColumnsExist } from "./txHarness";
import { applySecurityHeaders } from "../security/headers";
import { apiErrorFormat } from "../security/errors";
import { resetLoginLimiter } from "../security/rateLimit";
import { CSRF_COOKIE, CSRF_HEADER } from "../security/csrf";
import { pool } from "../db";

let server: Server;
let base = "";
let app: express.Express;
let csrf = "";

/** Test-only: impersonate a user without a session (header never exists in the real app). */
const TEST_USER_HEADER = "x-test-user";

async function request(method: string, path: string, opts: { user?: object; body?: unknown; csrf?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (opts.user) headers[TEST_USER_HEADER] = JSON.stringify(opts.user);
  if (opts.csrf !== false && csrf) {
    headers.cookie = `${CSRF_COOKIE}=${csrf}`;
    headers[CSRF_HEADER] = csrf;
  }
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), redirect: "manual" });
}

const designer = (id = 900001) => ({ id, role: "designer", name: "Test Designer", username: "t-designer", isActive: true, mustChangePassword: false });

before(async () => {
  await beginTestTransaction();
  app = express();
  applySecurityHeaders(app);
  app.use(apiErrorFormat);
  app.use(express.json());
  app.use((req, _res, next) => {
    const raw = req.get(TEST_USER_HEADER);
    if (raw) (req as any).user = JSON.parse(raw);
    next();
  });
  server = createServer(app);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
  app.use("/api", (_req, res) => res.status(404).json({ message: "Not found." }));
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const res = await fetch(`${base}/api/user`);
  csrf = new RegExp(`${CSRF_COOKIE}=([a-f0-9]{64})`).exec(res.headers.get("set-cookie") || "")?.[1] || "";
  assert.ok(csrf, "CSRF cookie issued");
});

after(async () => {
  await new Promise<void>(r => server.close(() => r()));
  await rollbackTestTransaction();
  await pool.end();
});

function apiRoutes(): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  const stack = (app as any).router?.stack || (app as any)._router?.stack || [];
  for (const layer of stack) {
    const route = layer.route;
    if (!route || typeof route.path !== "string" || !route.path.startsWith("/api")) continue;
    for (const method of Object.keys(route.methods)) {
      if (route.methods[method] && method !== "_all") out.push({ method: method.toUpperCase(), path: route.path.replace(/:[A-Za-z]+/g, "1") });
    }
  }
  return out;
}

// Routes that are intentionally reachable without a session.
const PUBLIC = new Set(["POST /api/login", "POST /api/logout", "GET /api/push/vapid-public-key"]);

describe("no-SEO headers", () => {
  test("X-Robots-Tag, robots.txt, frame/nosniff/referrer", async () => {
    const res = await fetch(`${base}/robots.txt`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Disallow: \//);
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal((await fetch(`${base}/sitemap.xml`)).status, 404);
  });
});

describe("401 without a session", () => {
  test("every protected /api route rejects anonymous requests", async () => {
    const routes = apiRoutes();
    assert.ok(routes.length > 60, `found ${routes.length} routes`);
    const failures: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      if (PUBLIC.has(key)) continue;
      const res = await request(r.method, r.path, { body: r.method === "GET" ? undefined : {} });
      if (res.status !== 401) failures.push(`${key} → ${res.status}`);
      else {
        const body = await res.json();
        if (body?.error?.code !== "UNAUTHENTICATED") failures.push(`${key} → bad body ${JSON.stringify(body)}`);
      }
    }
    assert.deepEqual(failures, []);
  });
});

describe("403 for the wrong role", () => {
  const ADMIN_ONLY: Array<[string, string]> = [
    ["GET", "/api/audit-events"],
    ["POST", "/api/users"],
    ["PATCH", "/api/users/1"],
    ["POST", "/api/users/1/reset-password"],
    ["POST", "/api/user/2fa/setup"],
    ["DELETE", "/api/orders/1"],
    ["POST", "/api/orders/1/cancel"],
    ["POST", "/api/orders/1/meta-retry"],
    ["PATCH", "/api/payment-verifications/1/approve"],
    ["PATCH", "/api/payment-verifications/1/disapprove"],
    ["GET", "/api/payment-verifications/pending-count"],
    ["GET", "/api/designer-assignments/1"],
    ["PUT", "/api/designer-assignments/1"],
    ["POST", "/api/services-catalog"],
    ["DELETE", "/api/platforms-catalog/1"],
    ["POST", "/api/complaint-categories"],
    ["POST", "/api/package-configs"],
    ["GET", "/api/payment-files/legacy.png"],
    ["PATCH", "/api/complaints/1"],
  ];
  test("a designer gets 403 on admin-only routes", async () => {
    const failures: string[] = [];
    for (const [method, path] of ADMIN_ONLY) {
      const res = await request(method, path, { user: designer(), body: method === "GET" ? undefined : {} });
      if (res.status !== 403) failures.push(`${method} ${path} → ${res.status}`);
    }
    assert.deepEqual(failures, []);
  });

  test("a designer only sees admins + their own support lead(s) in /api/users", async (t) => {
    if (!(await securityColumnsExist())) {
      t.skip("users security columns not created yet (migration 0001 pending approval)");
      return;
    }
    const d = await testQuery("select id from users where role = 'designer' and is_active order by id limit 1");
    if (!d.rows.length) return;
    const res = await request("GET", "/api/users", { user: { ...designer(d.rows[0].id) } });
    assert.equal(res.status, 200);
    const list = await res.json() as Array<Record<string, unknown>>;
    const support = await testQuery("select support_user_id from support_designer_assignments where designer_user_id = $1", [d.rows[0].id]);
    const allowed = new Set<number>([d.rows[0].id, ...support.rows.map(r => r.support_user_id)]);
    for (const u of list) {
      assert.ok(u.role === "admin" || allowed.has(u.id as number), `designer can see user ${u.id} (${u.role})`);
      assert.equal(u.password, undefined);
      assert.equal(u.username, undefined);
    }
  });
});

describe("CSRF on the real app", () => {
  test("state-changing request without the token is rejected before the route runs", async () => {
    const res = await request("POST", "/api/login", { body: { username: "x", password: "y" }, csrf: false });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, "CSRF_INVALID");
  });
});

describe("login lockout over HTTP", () => {
  test("6th attempt within 15 min is locked with 429", async (t) => {
    if (!(await securityColumnsExist())) {
      t.skip("users security columns not created yet (migration 0001 pending approval)");
      return;
    }
    resetLoginLimiter();
    const username = `nobody-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      const res = await request("POST", "/api/login", { body: { username, password: "wrong-password" } });
      assert.equal(res.status, 401, `attempt ${i + 1}`);
    }
    const locked = await request("POST", "/api/login", { body: { username, password: "wrong-password" } });
    assert.equal(locked.status, 429);
    const body = await locked.json();
    assert.equal(body.error.code, "LOGIN_LOCKED");
    assert.ok(Number(locked.headers.get("retry-after")) > 800);
    resetLoginLimiter();
  });
});

describe("private files", () => {
  test("signed URL expires after 10 minutes", async () => {
    const { default: cloudinary } = await import("../cloudinary");
    const prev = cloudinary.config();
    cloudinary.config({ cloud_name: prev.cloud_name || "test-cloud", api_key: prev.api_key || "123", api_secret: prev.api_secret || "test-secret" });
    const { signedDownloadUrl, SIGNED_URL_TTL_SECONDS } = await import("../files");
    const now = Date.UTC(2026, 10, 12, 10, 0, 0);
    const url = new URL(signedDownloadUrl({ publicId: "pixelcrm/payments/x", format: "jpg", resourceType: "image", deliveryType: "authenticated" }, now));
    assert.equal(SIGNED_URL_TTL_SECONDS, 600);
    assert.equal(Number(url.searchParams.get("expires_at")), Math.floor(now / 1000) + 600);
    assert.ok(url.searchParams.get("signature"));
  });

  test("a designer can't open a file from another designer's order", async (t) => {
    if (!(await tableExists("public.files"))) {
      t.skip("files table not created yet (migration 0001 pending approval)");
      return;
    }
    const pair = await testQuery(`
      select o.id as order_id, o.assigned_to_id as owner_id,
             (select id from users u where u.role = 'designer' and u.id <> o.assigned_to_id order by id limit 1) as other_id,
             (select id from users u where u.role = 'admin' order by id limit 1) as admin_id
      from orders o join users d on d.id = o.assigned_to_id and d.role = 'designer'
      order by o.id desc limit 1`);
    const row = pair.rows[0];
    if (!row?.other_id) {
      t.skip("needs two designers and an assigned order");
      return;
    }
    // Inserted inside the rolled-back transaction only.
    const file = await testQuery(
      `insert into files (public_id, kind, order_id, uploaded_by_id) values ('pixelcrm/test/rollback', 'payment', $1, $2) returning id`,
      [row.order_id, row.admin_id],
    );
    const id = file.rows[0].id;
    const other = await request("GET", `/api/files/${id}`, { user: designer(row.other_id) });
    assert.equal(other.status, 403);
    const owner = await request("GET", `/api/files/${id}`, { user: designer(row.owner_id) });
    assert.ok([302, 503].includes(owner.status), `owner gets the file (status ${owner.status})`);
    const anon = await request("GET", `/api/files/${id}`);
    assert.equal(anon.status, 401);
  });
});
