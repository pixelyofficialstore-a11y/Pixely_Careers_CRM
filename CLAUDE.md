# CLAUDE.md

## ⛔ RULE 0: DATA PROTECTION (overrides everything)

The CRM runs against the **live production Supabase database**, including from local dev.

1. **NEVER modify existing data.** No UPDATE, DELETE, MERGE, TRUNCATE, re-format, convert, dedupe or "clean up" of any existing row or value. Not even one word.
2. **Allowed DB changes are SCHEMA ONLY:**
   - new tables, new NULLABLE columns, new indexes, new views
   - renaming a table or column (the data stays identical)
   - never drop anything that holds data
3. **New logic lives in code or new columns:**
   - old status values are mapped in code
   - money units are converted only for display (CRM tables = paisa, `website.orders` = rupees)
   - metrics are computed with queries
4. **Before ANY migration:**
   - run `pg_dump` to a backup file and confirm it exists
   - print the exact SQL
   - **WAIT for written approval from the owner**

   `drizzle-kit push` / drop or any auto-sync is FORBIDDEN. Reviewed SQL migrations only.
5. **Tests** use a separate test DB, or transactions that are ROLLED BACK. No test rows left in production. When rolling back on a pooled connection, destroy the connection afterwards so late async writes can't autocommit.
6. If anything seems to need a data change, **STOP and ask the owner.**

The one allowed automatic removal: expired web-push subscription rows that the app itself created (endpoint returns 404/410).

---

## Project

- Express 5 + React 18/Vite + Drizzle + Supabase Postgres, deployed on Railway (Dockerfile).
- `CRM_AUDIT.md` is the source of truth for the current state.
- Two DB schemas: `public` (CRM) and `website` (pixelycareers.com checkout; the site's source isn't in this repo).
- Roles: `admin`, `support`, `designer`. Enforcement is server-side only.
- Commands:
  - `pnpm dev` (port 5000)
  - `pnpm check` (tsc)
  - `pnpm test`
  - `pnpm build`
- Never print secret values (.env, tokens, passwords).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
