# Pixely Careers CRM — Audit (read-only)

Date: 2026-11-12 · Scope: the code in the working tree (branch `main` plus uncommitted spec #1–#3 work), config files, the live Supabase schema and metadata (read-only queries), `npm audit` and `tsc`. No changes were made. "Unverified" means it could not be confirmed from the code or DB.

---

## 1. OVERVIEW

### Stack
| Layer | Tech (package.json range) |
|---|---|
| Runtime | Node 20.20.2 (Dockerfile `bookworm-slim`); pnpm 10.26.1 |
| Server | Express ^5.2.1, passport ^0.7 + passport-local ^1.0 (scrypt), express-session ^1.19 + connect-pg-simple ^10 |
| DB | Supabase Postgres 17.6 (ap-southeast-1), pg ^8.23, drizzle-orm ^0.39.3, drizzle-kit ^0.31.10 |
| Client | React ^18.3.1, Vite ^7.3.6, wouter ^3.10, TanStack Query ^5.101, Tailwind ^3.4 + shadcn/Radix, recharts ^2.15, framer-motion ^11 |
| Validation | zod ^3.25 (shared contracts in `shared/routes.ts`) |
| Files/Media | Cloudinary ^2.10, multer ^2.2, sharp ^0.34.5, local disk `uploads/` |
| Other | web-push ^3.6 (VAPID), SSE (in-memory), jspdf ^4.2, xlsx ^0.18.5, Meta CAPI (`server/lib/metaCapi.ts`) |
| Build | `script/build.ts` (Vite for the client, esbuild for the server, output `dist/index.cjs`); TypeScript ^5.6.3 |

### Folder structure (top 2 levels)
```
client/src/{App.tsx, main.tsx, index.css, assets/, components/ (47 ui/*), hooks/, lib/, pages/ (11)}
server/{index.ts, routes.ts (~2.5k lines), storage.ts, db.ts, migrate.ts, orderCreation.ts, websiteRequests.ts,
        cloudinary.ts, sse.ts, cleanup.ts, seed.ts, static.ts, vite.ts, lib/metaCapi.ts, replit_integrations/}
shared/{schema.ts, routes.ts, business-time.ts, case-access.ts, order-accounting.ts, *.test.ts}
script/ (build + 2 one-off migrations)   scripts/ (run-migrations, post-merge.sh, fixture gen)
attached_assets/  screenshots/  uploads/ (85 files tracked in git)  Fake/ (empty)  do_restore.mjs  replit.md
Dockerfile  railway.toml  drizzle.config.ts  vite.config.ts  tailwind.config.ts  tsconfig.json
```

### Hosting / deploy
- Railway builds from the `Dockerfile`, runs as user `node`, starts with `node dist/index.cjs`, healthcheck `GET /health` (`railway.toml`).
- Railway region: **Unverified** (not in the config). The DB is in ap-southeast-1; the app server should be in the same region.
- `trust proxy` = 1 in production (`server/routes.ts:294`).
- Migrations run at boot (`server/migrate.ts`). Some one-off scripts live in `script/`.

### Environment variables (names only)
| Var | Used in code | In local `.env` | Notes |
|---|---|---|---|
| SUPABASE_DATABASE_URL | yes | yes | primary DB |
| DATABASE_URL | yes (fallback) | no | |
| SESSION_SECRET | yes | yes | code falls back to a hardcoded literal if this is missing |
| NODE_ENV, PORT | yes | yes | |
| CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET | yes | **no** | locally, uploads fall back to base64 in the DB |
| VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT | yes | **no** | locally, push is disabled |
| META_PIXEL_ID / META_CAPI_ACCESS_TOKEN / META_TEST_EVENT_CODE | yes | **no** | CAPI is disabled until set |
| META_DEBUG, PG_POOL_MAX, SLOW_QUERY_MS | yes (optional) | no | have defaults |
| PRIVATE_OBJECT_DIR, PUBLIC_OBJECT_SEARCH_PATHS, REPL_ID | yes | no | **Replit leftovers, effectively unused** |
- Production (Railway) variables: **Unverified** (no access).

---

## 2. FEATURES & PAGES
| Page | URL | Purpose | Main actions | Roles (sidebar / guard) | Status |
|---|---|---|---|---|---|
| Auth | `/auth` | Login | Log in | public | Working. No password reset, no rate limiting |
| Dashboard | `/` | KPIs, finance, workload | Month/designer filters | all (finance shown to admin only) | Working; heavy polling (10s) |
| Orders | `/orders` | Order list and detail | Create multi-service order, edit, assign, status, deliverables, revisions, payment request, cancel, delete, case-report PDF, export, Meta retry | all (fields limited by role) | Working; loads all orders at once (1.5 MB) |
| Payments | `/payments` | Payment verification queue | Submit screenshot, approve or disapprove (admin) | all | Working; history before 2026-09-12 missing (cause Unverified) |
| Complaints | `/complaints` | Complaint cases | File (admin/support), resolve or dismiss (admin), designer explanation | all | Working |
| Feedback | `/feedback` | Client reviews and suggestions | Create or edit review, suggestion; admin decisions | all | Working |
| Website Requests | `/website-requests` | Website orders, CV reviews, partners (schema `website`) | Place or approve order, reject, send for approval, notes, convert review, export, Meta retry | admin, support | Working (spec #1/#3, uncommitted) |
| Team | `/users` | Users and designer assignments | Create or edit users, activate or deactivate, assign designers to support | admin (`TeamPage.tsx:73`) | Working |
| Analytics | `/stats` | Charts | Filters | admin (Redirect `AnalyticsPage.tsx:74`) | Working; computed in the browser from all orders |
| Admin Settings | `/admin-settings` | Catalogs (services, platforms, packages, complaint categories) | CRUD | admin (`AdminSettingsPage.tsx:48`) | Working |
| Not found | `*` | 404 | – | – | OK |

---

## 3. ROLES & ACCESS
- **Roles:** `admin`, `support`, `designer`. Stored in `users.role` (text) together with `users.is_active`. Current users: 2 admin; 2 support active, 4 inactive; 5 designer active, 6 inactive.
- **Sessions:** express-session with the `user_sessions` table (119 rows). Cookie is 1 year and rolling; `secure` and `sameSite=none` in production.
- **Enforcement:** server only, through `requireAuth` and `requireRole` (`server/routes.ts:404–413`) plus checks inside handlers (`canAccessOrder`, `shared/case-access.ts`). Client-side guards only hide UI.
- **DB layer:** the app connects as `postgres` (BYPASSRLS), so RLS does not protect anything for the app.

### Permission matrix (API)
| Action | admin | support | designer |
|---|---|---|---|
| List users (`GET /api/users`) | ✓ | ✓ | ✓ (all users, safe fields) |
| Create or edit users, designer assignments | ✓ | ✗ | ✗ |
| List orders | all | all (Unverified scope, in `storage.getOrders`) | assigned only |
| Create order | ✓ | ✓ | ✗ |
| Edit order | all fields | limited; reassign only to own designers | own order: `status`, `remainingRevisions` only; cannot cancel; locked after delivery |
| Cancel or delete order, Meta retry | ✓ | ✗ | ✗ |
| Submit payment verification | remaining only | ✓ | own order, remaining only |
| Approve or disapprove payment | ✓ | ✗ | ✗ |
| File complaint | ✓ | ✓ | ✗ |
| Resolve complaint | ✓ | ✗ | ✗ |
| Designer explanation | ✗ | ✗ | ✓ |
| Reviews and suggestions create/edit | ✓ | ✓ | ✓ (only on orders they can access) |
| Suggestion decisions | ✓ | ✗ | ✗ |
| Catalogs CRUD | ✓ | read | read |
| Website Requests (all routes) | ✓ | ✓ | ✗ |
| Stats `finance` block | ✓ | stripped | stripped |

### UI-hidden but API-open (flags)
| Endpoint | Issue |
|---|---|
| `GET /api/avatars/:filename` (`routes.ts:570`) | **No auth.** Serves files with the extension from the uploaded filename, so stored XSS is possible (e.g. `.html`/`.svg`) |
| `POST /api/uploads/request-url`, `GET /objects/uploads/:objectId` (`replit_integrations/object_storage/routes.ts:38,73`) | **No auth.** Replit leftovers, still registered (`routes.ts:2299`) |
| `GET /api/payment-files/:filename` and `/db/:filename` (`routes.ts:2255,2275`) | Any logged-in user can fetch any payment screenshot if they know or guess the filename. No ownership check |
| `GET /api/users` | Designers can list every user, including inactive ones (safe fields) |
| `GET /api/push/vapid-public-key` | No auth (public key, fine) |

---

## 4. DATA MODEL

### Tables (approximate rows; -1 = never analyzed)
| Schema.table | Rows | RLS | Notes |
|---|---|---|---|
| public.orders | 1,214 | on | 11 indexes. **Duplicate unique indexes** `orders_order_number_key` and `orders_order_number_unique` |
| public.order_services | 1,076 | on | FK to orders |
| public.activity_logs | 1,139 | on | (order_id, created_at) index |
| public.notifications | 816 | on | 5 indexes incl. unread and dedupe |
| public.payment_verifications | 205 | on | all 205 screenshots on Cloudinary; 0 base64 |
| public.user_sessions | 119 | on | 0 expired |
| public.push_subscriptions | 48 | on | cascade on user delete |
| public.client_reviews | 35 | on | one per order (unique) |
| public.support_designer_assignments | 31 | on | **no unique on (support, designer)** (Unverified whether this is intended) |
| public.users | 17 | on | unique username |
| public.complaints (+ notes, evidence, designer_evidence) | -1 | on | evidence tables cascade |
| public.client_suggestions, suggestion_notes | -1 | on | |
| public.services_catalog, platforms_catalog, package_configs, complaint_category_configs, monthly_finance | -1 | on | config |
| **public.website_request_activity** | 0 | **OFF** | **created by my spec #1 migration; anon/authenticated have full grants** |
| website.orders | 6 | on | money in **rupees**; trigger `updated_at`; unique `crm_order_id` |
| website.events | 93 | on | |
| website.cv_reviews, partners, calls | -1 | on | |
| website.__drizzle_migrations | -1 | off | the website app's migrations |
- RLS is on with 0 policies everywhere else, which denies anon/authenticated (good). The app bypasses it as `postgres`.
- Relations: orders → users (created_by, assigned_to, intended_designer, canceled_by, refund_recorded_by). order_services, activity_logs, payment_verifications, complaints, client_reviews and client_suggestions → orders. Most actor columns → users. `website.orders.crm_order_id` links to the CRM order (no FK across schemas; Unverified).
- Money: CRM tables use **paisa** (integer); `website.orders` uses **rupees**. Conversion happens in `server/orderCreation.ts` and `websiteRequests.ts`.

### Order lifecycle
`pending_payment` → `new` → `working` → `ready` → `delivered`; `canceled` from admin.
Current counts: delivered 1,136 · canceled 30 · ready 23 · new 17 · pending_payment 4 · working 4.
Designers cannot leave `delivered`. From `ready` they can only move to `delivered`, and only when the remaining balance is 0.
Website orders use `cart`/`abandoned` → `payment_submitted`/`pending_approval` → `paid`/`converted`/`rejected` (enum `website.order_status`). Current: cart 4, payment_submitted 2.

### Payment flow
1. Support or designer submits `POST /api/payment-verifications` with a screenshot (advance, full or remaining). Admin advance and full payments are auto-approved.
2. The screenshot goes to Cloudinary (or base64 in the DB if Cloudinary isn't configured).
3. Admin approves or disapproves. Approval updates the order amounts and status, writes activity logs, sends notifications and push, and fires Meta CAPI Purchase (if configured).
- Counts: approved advance 84, remaining 93, full 26; disapproved remaining 2.
- **No rows before 2026-09-12** (cause Unverified: an old export or restore? `cleanup.ts` is disabled).

### File storage
| What | Where | Risk |
|---|---|---|
| Payment, complaint and feedback screenshots | Cloudinary `secure_url` (public URLs) | Anyone with the URL can view them; no signed URLs |
| Avatars | Local disk `uploads/avatars` | **Ephemeral on Railway** (lost on redeploy); served without auth |
| Legacy payment files | `uploads/` (85 files **tracked in git**) | PII in the repo |
| Fallback | base64 in `payment_verifications.screenshot_data` | 0 rows use it today |

---

## 5. BACKEND

### Routes (`server/routes.ts` unless noted). Auth: P = public, A = requireAuth, R[...] = requireRole
| Method | Path | Purpose | Auth | Validation |
|---|---|---|---|---|
| GET | /health | healthcheck (`index.ts:84`) | P | – |
| POST | /api/login · /api/logout | session | P | zod |
| GET | /api/user | current user | A-ish | – |
| GET | /api/notifications/stream | SSE | A | – |
| GET | /api/users | list users | A | – |
| POST · PATCH | /api/users · /api/users/:id | create, edit | R[admin] | zod |
| POST | /api/users/me/avatar | upload avatar (multer to disk) | A | type and size (Unverified detail) |
| GET | /api/avatars/:filename | serve avatar | **P** | `..` and `/` checks |
| GET | /api/designer-assignments | own assignments | A | – |
| GET · PUT | /api/designer-assignments/:supportUserId | admin manage | R[admin] | partial |
| GET | /api/orders | list (role-filtered, **unpaginated**) | A | – |
| POST | /api/orders | create multi-service order | R[admin,support] | zod |
| GET | /api/orders/:id (+ /complaints, /activity, /client-case-report, /client-reviews, /client-suggestions, /payment-verifications) | detail | A + access check | id |
| PATCH | /api/orders/:id | update (role-specific rules) | A + in-handler | zod + rules |
| PATCH | /api/order-services/:id | service deliverable | A + designer check | partial |
| POST | /api/orders/:id/cancel · /meta-retry | admin ops | R[admin] | – |
| DELETE | /api/orders/:id | delete order | R[admin] | – |
| POST | /api/feedback/upload | upload | R[all] | multer |
| GET · POST · PATCH | /api/feedback/reviews(/:id), /suggestions(/:id), /stats | feedback | A + `canAccessOrder`; decisions admin | zod |
| GET | /api/complaints, /actionable-count, /:id, /:id/history | complaints | A (filtered) | – |
| POST | /api/complaints, /upload | file | R[admin,support] | zod |
| PATCH | /api/complaints/:id | resolve | R[admin] | zod |
| POST · PATCH | /api/complaints/designer-explanation/upload, /:id/designer-explanation | explanation | R[designer] | zod |
| GET · PATCH | /api/notifications, /unread-count, /mark-all-read, /:id/read | notifications | A | – |
| GET · POST · DELETE | /api/push/vapid-public-key (P), /subscribe, /unsubscribe | web push | A | partial |
| GET | /api/stats | dashboard stats | A (finance admin only) | regex query params |
| GET | /api/payment-verifications(/pending-count) | queue | A / R[admin] | – |
| POST | /api/payment-verifications | submit | A + role rules | manual checks (not zod) |
| PATCH | /api/payment-verifications/:id/approve · /disapprove | review | A + `role==='admin'` in handler | id |
| GET | /api/payment-files/db/:filename · /:filename | serve screenshot | A (**no ownership check**) | `basename` |
| GET · POST · PATCH · DELETE | /api/{platforms-catalog, complaint-categories, services-catalog, package-configs}(/:id) | catalogs | GET A; writes R[admin] | zod |
| GET · PATCH · POST | /api/website-requests/{counts, orders(+stats, export, :id, notes, reject, send-for-approval, place, approve, meta-retry), reviews(+stats, export, :id, convert), partners(+stats, export, :id)} (`websiteRequests.ts:307–791`) | website inbox | R[admin,support] | zod/manual |
| POST · GET | /api/uploads/request-url, /objects/uploads/:objectId (`replit_integrations`) | Replit object storage | **P** | – |

### Business logic location
- Mostly inline in the route handlers (`routes.ts` ~2.5k lines). Data access in `storage.ts`.
- Separate modules: `orderCreation.ts`, `websiteRequests.ts`, `shared/order-accounting.ts`, `shared/case-access.ts`, `shared/business-time.ts`, `lib/metaCapi.ts`.

### Integrations
| Integration | Status |
|---|---|
| Supabase Postgres | Active |
| Cloudinary | Active in production (205/205 screenshots); not configured locally |
| Web Push (VAPID) | Code active; production keys Unverified; not configured locally |
| SSE | Active, in-memory only (one instance; breaks if scaled horizontally) |
| Meta Conversions API | Built and tested (91/91 rolled-back E2E). **Disabled until the env vars are set** |
| Replit object storage | Dead (no Replit env) but routes still registered |
| Cleanup job (`cleanup.ts`) | **Disabled** (commented out in `index.ts`) |

### Error handling and logging
- Global `[api-error]` handler. Request logger logs 4xx/5xx bodies and flags `[slow]` requests over 1s.
- Slow-query log `[slow-query]` with the route, using AsyncLocalStorage (`db.ts`).
- Handlers mix `try/catch`, `{message}` and `{error}` response shapes, which is inconsistent.
- No structured logger or error tracking (e.g. Sentry).

---

## 6. FRONTEND
- **Design system:** shadcn/ui (47 components in `components/ui`, about 23 unused), Tailwind and CSS variables in `index.css`. Pages are consistent with each other.
- **Data loading:**
  - TanStack Query with `staleTime` 30s and `refetchOnWindowFocus: true` (`lib/queryClient.ts`).
  - Many polls run even in background tabs: NotificationBell 5s (`NotificationBell.tsx:277`), Sidebar 5s and 10s (`Sidebar.tsx:41,50`), Dashboard stats 10s (`DashboardPage.tsx:480`), Complaints 10s, Website Requests 10s, Orders 30s.
  - SSE also pushes events, so polling duplicates it.
- **Mobile:**
  - Responsive classes are present on most pages.
  - PaymentsPage (2 `sm/md` classes), TeamPage (3) and AuthPage (0) are likely weak on mobile.
  - Not tested in a browser: **Unverified**.
- **Large components:** `OrdersPage.tsx` 3,405 lines; `WebsiteRequestsPage.tsx` 1,471; `AdminSettingsPage.tsx` 891; `DashboardPage.tsx` 847.
- **Known UI bugs:**
  - TS type mismatches in `ImageDropzone.tsx:100–101` and `TeamPage.tsx:481` (the role Select `onValueChange` type). Runtime impact Unverified.
  - Polling observed refetching `/api/stats` and the counts about once per second on window focus (staleTime 0 on the Dashboard stats query).

---

## 7. SECURITY
| Area | Rating | Evidence |
|---|---|---|
| Supabase RLS / DB user | **Critical** | `public.website_request_activity` has RLS **OFF** with anon/authenticated grants, so it can be read and written through the Supabase REST API with the public anon key. (Introduced by my earlier migration.) The app uses `postgres` (bypasses RLS); there is no least-privilege DB role. `ssl: rejectUnauthorized:false` (`db.ts:26`) |
| Secrets in repo | **Critical** | Committed `attached_assets/Database_*.zip` (DB exports incl. password hashes), `production_data_export_*.json` (client phones), 85 files in `uploads/`. All are in git history. `.env` is ignored (good) |
| Authentication | Needs work | scrypt + timingSafeEqual (good). **Hardcoded session secret fallback**, 1-year rolling cookie, no login rate limit or lockout, no password reset, no 2FA |
| Authorization | Needs work | Server checks are solid for orders, complaints and payments. Gaps: unauthenticated avatars and Replit routes; payment files have no ownership check |
| Input validation / SQL | Needs work | zod on most writes. Payment submit uses manual checks. Drizzle is parameterized, but the **installed drizzle-orm 0.39.3 has a SQL-injection advisory (fixed in ≥0.45.2)** |
| Uploads | Needs work | Avatars keep the user-supplied extension and are served publicly (stored XSS). Cloudinary URLs are public. multer has a DoS advisory |
| CORS / CSRF / headers / rate limiting | **Needs work (high)** | No helmet/CSP/HSTS. **`sameSite=none` without a CSRF token.** No rate limiting anywhere. CORS: no middleware (same-origin only) — OK |
| Audit logs | OK / Needs work | `activity_logs` for orders, `website_request_activity` for website. No audit trail for user/role changes or logins |
| npm audit | **Critical** | 1 critical (`proxy-addr` IP spoofing, fix ≥2.0.8), 32 high, 35 moderate, 14 low. Highs include drizzle-orm SQLi, multer DoS, sharp (libvips), body-parser and path-to-regexp DoS, **xlsx (no fix available)**, lodash, form-data, rollup, vite, dompurify, zod |

---

## 8. PERFORMANCE

### Top 10 causes
| # | Cause | Evidence |
|---|---|---|
| 1 | `/api/orders` returns every order, unpaginated (~1.5 MB, 0.44s) | `routes.ts:617` → `storage.getOrders` |
| 2 | Dashboard and Analytics compute in the browser from the full orders list | `AnalyticsPage.tsx:69`, `DashboardPage.tsx:468–490` |
| 3 | Polling fan-out in background tabs (5s/10s) on top of SSE | `NotificationBell.tsx:277,286`, `Sidebar.tsx:41,50`, `ComplaintsPage.tsx:260,267`, `WebsiteRequestsPage.tsx:628` |
| 4 | Dashboard stats `staleTime 0` + refetchOnWindowFocus → refetch storms | `DashboardPage.tsx:480`, `lib/queryClient.ts` |
| 5 | `/api/stats` cold run 2.3s (aggregates on every call; 6ms when cached) | `storage.getStats`, measured |
| 6 | Notifications sent one recipient at a time (sequential awaits) | `dispatchNotifications` in `routes.ts` (Unverified exact line) |
| 7 | App region vs DB (ap-southeast-1) | Railway region **Unverified** |
| 8 | Duplicate unique index on `orders.order_number` (write overhead) | DB: `orders_order_number_key` + `orders_order_number_unique` |
| 9 | Very large page bundles (`OrdersPage` 3.4k lines, xlsx/jspdf); code splitting Unverified | `client/src/pages/OrdersPage.tsx` |
| 10 | Pool max 10, connect timeout 10s; transient "connection timeout" seen in dev | `db.ts:27`, dev log |

### Slowest pages (measured on the dev server against prod DB)
1. Dashboard (stats 2.3s cold, plus orders)
2. Orders (0.44s + 1.5 MB)
3. Analytics (all orders)
4. Payments (0.20s)
5. Website Requests (0.14–0.17s)

---

## 9. CODE QUALITY
- **TypeScript:** `tsc` reports **22 errors**:
  - 15 in dead `client/src/hooks/use-chats.ts`
  - `ImageDropzone.tsx` ×2
  - `TeamPage.tsx:481`
  - `server/db.ts:2` (missing `@types/pg`)
  - `routes.ts:1435` (activity type enum missing `complaint_designer_explanation`)
  - `sse.ts:29` (target / downlevelIteration)
  - `shared/routes.ts:250` (`errorSchemas.conflict` missing)

  About 98–102 uses of `any`.
- **Dead code:**
  - `use-chats.ts` (references an old chat API)
  - `server/cleanup.ts` (disabled)
  - `replit_integrations/*`
  - `replit.md`, `do_restore.mjs`, empty `Fake/`
  - about 23 unused shadcn components
  - one-off migration scripts in `script/`
  - committed screenshots and zips (`pixelchat-pro-main_*.zip`)
- **Duplication:**
  - role sanitization repeated in each route
  - inconsistent `{message}` vs `{error}` responses
  - money formatting/conversion in multiple places (paisa vs rupees)
- **TODO/FIXME:** 0 found.
- **Tests:** 16 unit tests (`shared/*.test.ts`), all passing. No API, integration or E2E suite in the repo (the 91-case Meta E2E was a temporary script, not committed). No CI config found.

---

## 10. SUMMARY

| Area | Stage | Verdict |
|---|---|---|
| Frontend | 75% | Feature-complete and consistent UI; heavy pages, polling overload, mobile Unverified |
| Backend | 75% | Business rules are thorough and enforced on the server; monolithic routes file, no pagination, few tests |
| Security | 40% | Good password hashing and role checks, but an RLS gap, PII in git, no rate limit, CSRF or headers, and vulnerable deps |
| Performance | 55% | Fine at ~1.2k orders; full-list loading and polling won't scale |

### Top 10 issues
| # | Problem | Where | Impact | 1-line fix |
|---|---|---|---|---|
| 1 | RLS off + anon grants on `website_request_activity` | DB `public.website_request_activity` | Public read/write via Supabase API | `ALTER TABLE public.website_request_activity ENABLE ROW LEVEL SECURITY;` (not applied) |
| 2 | DB exports, client PII and uploads committed | `attached_assets/*.zip`, `*export*.json`, `uploads/` | Leak of password hashes and phone numbers | Remove from the repo, purge history, rotate passwords |
| 3 | Vulnerable deps (proxy-addr critical, drizzle SQLi, multer, sharp, xlsx) | `package.json` | RCE/DoS/SQLi/IP spoof exposure | Upgrade drizzle ≥0.45.2, express deps, multer ≥2.5, sharp ≥0.35.5; replace xlsx |
| 4 | Unauthenticated avatar serving with user extension | `routes.ts:570`, `:525` | Stored XSS | Force image extension/content-type + `nosniff`; move to Cloudinary |
| 5 | No CSRF with `sameSite=none` | session config `routes.ts:~299` | Cross-site state changes | Use `sameSite=lax` (same origin) or add CSRF tokens |
| 6 | No login rate limit, no security headers | `server/index.ts` | Brute force, clickjacking | Add `express-rate-limit` on `/api/login` + `helmet` |
| 7 | Hardcoded session secret fallback | `routes.ts:~299` | Forgeable sessions if the env var is missing | Throw at boot if `SESSION_SECRET` is unset |
| 8 | Unpaginated `/api/orders` + client-side analytics | `routes.ts:617`, Dashboard/Analytics | Slow pages, 1.5 MB payloads | Server pagination + server-side aggregates |
| 9 | Polling fan-out + staleTime 0 | NotificationBell, Sidebar, Dashboard | DB load, refetch storms | Rely on SSE; 30–60s polls; stop background polling |
| 10 | Unauthenticated Replit upload routes; payment files lack ownership check | `replit_integrations/.../routes.ts:38,73`, `routes.ts:2255,2275` | Abuse, data exposure | Unregister the Replit routes; check order access before serving the file |

### Quick wins (< 1 hour each)
- Enable RLS on `website_request_activity`.
- Unregister the Replit object-storage routes.
- Drop the duplicate `orders_order_number_unique` index.
- Fail boot without `SESSION_SECRET`.
- Add `helmet` + a login rate limit.
- Set Dashboard stats `staleTime` to 30s and disable `refetchIntervalInBackground`.
- Delete `use-chats.ts` (removes 15 tsc errors); add `@types/pg`.
- Add `.gitignore` entries for `uploads/`, `attached_assets/*.zip`, `*export*.json`.
- Set the Railway region to Singapore (match the DB).
