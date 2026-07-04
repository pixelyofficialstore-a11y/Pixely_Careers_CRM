---
name: DB schema sync (migrate.ts vs schema.ts)
description: How Postgres schema changes must be applied in PixelCRM so live Supabase data is never lost.
---

# Schema is applied by server/migrate.ts, NOT drizzle db:push

`runMigrations()` in `server/migrate.ts` runs on every startup (inside a transaction) and is the project's idempotent schema mechanism: `CREATE TABLE IF NOT EXISTS` + additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` blocks.

**Rule:** Any column added to `shared/schema.ts` (Drizzle) MUST also be added to the matching additive ALTER block in `server/migrate.ts`, or order/other queries will fail against a DB that predates the column.

**Why:** The app connects to a live Supabase DB (`SUPABASE_DATABASE_URL`, fallback `DATABASE_URL`) holding real production data (hundreds of orders). Supabase was populated externally and can lag behind `schema.ts`. Drizzle selects explicit columns, so a column defined in schema.ts but absent in the DB breaks the query.

**How to apply safely (owner demands NO destructive DB ops):**
- Only additive `ADD COLUMN IF NOT EXISTS`, nullable or with a DEFAULT. Never drop/rename/truncate/alter-type. Never run `drizzle-kit push` against Supabase (it can drop columns / the un-modeled `user_sessions` table).
- Add the column to migrate.ts, then restart the workflow — startup migration applies it. Verify read-only via `information_schema.columns` and re-check row counts are unchanged.
- Inspect the live Supabase schema by running a Node script from the workspace root (has env vars + node_modules `pg`); the code_execution sandbox does NOT expose workspace secrets, and `/tmp` scripts can't resolve `pg`.
