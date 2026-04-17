/**
 * Startup migration: ensures the production database schema is up to date.
 * Uses ADD COLUMN IF NOT EXISTS so it is safe to run on every startup.
 * This covers columns added via direct SQL in dev that were never pushed to prod.
 */
import { pool } from "./db";

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── orders ─────────────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS order_number         TEXT,
        ADD COLUMN IF NOT EXISTS priority             TEXT NOT NULL DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS payment_status       TEXT DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS advance_payment_status TEXT DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS intended_designer_id INTEGER REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS campaign             TEXT,
        ADD COLUMN IF NOT EXISTS ad_set               TEXT,
        ADD COLUMN IF NOT EXISTS creative             TEXT,
        ADD COLUMN IF NOT EXISTS package_type         TEXT,
        ADD COLUMN IF NOT EXISTS internal_notes       TEXT
    `);

    // Unique constraint on order_number (safe to run if already exists)
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'orders_order_number_unique'
        ) THEN
          ALTER TABLE orders ADD CONSTRAINT orders_order_number_unique UNIQUE (order_number);
        END IF;
      END $$
    `);

    // ── order_services ─────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE order_services
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'
    `);

    // ── notifications ──────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS title    TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'update',
        ADD COLUMN IF NOT EXISTS related_id   INTEGER,
        ADD COLUMN IF NOT EXISTS related_type TEXT
    `);

    // ── payment_verifications ──────────────────────────────────────────────
    await client.query(`
      ALTER TABLE payment_verifications
        ADD COLUMN IF NOT EXISTS screenshot_data      TEXT,
        ADD COLUMN IF NOT EXISTS screenshot_mime_type TEXT,
        ADD COLUMN IF NOT EXISTS reviewed_by_id       INTEGER REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS reviewed_at          TIMESTAMP,
        ADD COLUMN IF NOT EXISTS notes                TEXT
    `);

    // ── push_subscriptions ─────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint   TEXT NOT NULL UNIQUE,
        p256dh     TEXT NOT NULL,
        auth       TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── platforms_catalog ──────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE platforms_catalog
        ADD COLUMN IF NOT EXISTS has_campaign_fields BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS sort_order          INTEGER NOT NULL DEFAULT 0
    `);

    // ── services_catalog ───────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE services_catalog
        ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0
    `);

    // ── package_configs ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS package_configs (
        id         SERIAL PRIMARY KEY,
        key        TEXT NOT NULL UNIQUE,
        label      TEXT NOT NULL,
        is_active  BOOLEAN NOT NULL DEFAULT true,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── users ──────────────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS title    TEXT,
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true
    `);

    await client.query("COMMIT");
    console.log("[migrate] Schema up to date.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[migrate] Migration failed:", err);
    throw err;
  } finally {
    client.release();
  }
}
