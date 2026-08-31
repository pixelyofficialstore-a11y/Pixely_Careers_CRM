/**
 * Startup migration: creates all tables if they don't exist, then ensures
 * any columns added after the initial deploy are present.
 * Idempotent — safe to run on every startup.
 */
import { pool } from "./db";

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Core tables (no foreign-key deps) ───────────────────────────────────

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          SERIAL PRIMARY KEY,
        username    TEXT NOT NULL UNIQUE,
        password    TEXT NOT NULL,
        role        TEXT NOT NULL DEFAULT 'designer',
        name        TEXT NOT NULL,
        title       TEXT,
        avatar      TEXT,
        is_active   BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS platforms_catalog (
        id                   SERIAL PRIMARY KEY,
        name                 TEXT NOT NULL UNIQUE,
        is_active            BOOLEAN NOT NULL DEFAULT true,
        has_campaign_fields  BOOLEAN NOT NULL DEFAULT false,
        sort_order           INTEGER NOT NULL DEFAULT 0,
        created_at           TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS services_catalog (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        is_active  BOOLEAN NOT NULL DEFAULT true,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS complaint_category_configs (
        id         SERIAL PRIMARY KEY,
        key        TEXT NOT NULL UNIQUE,
        label      TEXT NOT NULL,
        is_active  BOOLEAN NOT NULL DEFAULT true,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      INSERT INTO complaint_category_configs (key, label, sort_order)
      VALUES
        ('communication_issue', 'Communication Issue', 10),
        ('slow_response', 'Slow Response', 20),
        ('delivery_delay', 'Delivery Delay', 30),
        ('work_quality_issue', 'Work Quality Issue', 40),
        ('instructions_not_followed', 'Instructions Not Followed', 50),
        ('revision_handling_issue', 'Revision Handling Issue', 60),
        ('incorrect_information', 'Incorrect Information Provided', 70),
        ('unprofessional_behavior', 'Unprofessional Behavior', 80),
        ('process_policy_violation', 'Process / Policy Violation', 90),
        ('unauthorized_commitment', 'Unauthorized Commitment', 100),
        ('other', 'Other', 110)
      ON CONFLICT (key) DO NOTHING
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_finance (
        id              SERIAL PRIMARY KEY,
        month           TEXT NOT NULL UNIQUE,
        total_collected INTEGER DEFAULT 0,
        total_remaining INTEGER DEFAULT 0,
        total_orders    INTEGER DEFAULT 0,
        paid_orders     INTEGER DEFAULT 0,
        updated_at      TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Orders (depends on users) ────────────────────────────────────────────

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id                      SERIAL PRIMARY KEY,
        order_number            TEXT,
        client_name             TEXT NOT NULL,
        client_phone            TEXT,
        client_email            TEXT,
        client_type             TEXT NOT NULL DEFAULT 'national',
        status                  TEXT NOT NULL DEFAULT 'new',
        priority                TEXT NOT NULL DEFAULT 'normal',
        assigned_to_id          INTEGER REFERENCES users(id),
        ready_date              TIMESTAMP,
        payment_status          TEXT DEFAULT 'pending',
        advance_payment_status  TEXT DEFAULT 'pending',
        intended_designer_id    INTEGER REFERENCES users(id),
        total_price             INTEGER NOT NULL DEFAULT 0,
        advance_amount          INTEGER DEFAULT 0,
        remaining_amount        INTEGER DEFAULT 0,
        platform                TEXT,
        campaign                TEXT,
        ad_set                  TEXT,
        creative                TEXT,
        package_type            TEXT,
        notes                   TEXT,
        internal_notes          TEXT,
        created_by_id           INTEGER REFERENCES users(id),
        created_at              TIMESTAMP DEFAULT NOW()
      )
    `);

    // Unique constraint on order_number
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_number_unique'
        ) THEN
          ALTER TABLE orders ADD CONSTRAINT orders_order_number_unique UNIQUE (order_number);
        END IF;
      END $$
    `);

    // ── Order services (depends on orders) ──────────────────────────────────

    await client.query(`
      CREATE TABLE IF NOT EXISTS order_services (
        id           SERIAL PRIMARY KEY,
        order_id     INTEGER NOT NULL REFERENCES orders(id),
        service_type TEXT NOT NULL,
        quantity     INTEGER NOT NULL DEFAULT 1,
        instructions TEXT,
        status       TEXT NOT NULL DEFAULT 'new'
      )
    `);

    // ── Notifications (depends on users) ────────────────────────────────────

    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id),
        type         TEXT NOT NULL,
        title        TEXT NOT NULL DEFAULT '',
        message      TEXT NOT NULL,
        priority     TEXT NOT NULL DEFAULT 'update',
        read         BOOLEAN NOT NULL DEFAULT false,
        related_id   INTEGER,
        related_type TEXT,
        created_at   TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Activity logs (depends on orders + users) ────────────────────────────

    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id             SERIAL PRIMARY KEY,
        order_id       INTEGER REFERENCES orders(id),
        actor_id       INTEGER REFERENCES users(id),
        activity_type  TEXT NOT NULL,
        previous_value TEXT,
        new_value      TEXT,
        details        JSONB,
        created_at     TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Payment verifications (depends on orders + users) ───────────────────

    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_verifications (
        id                   SERIAL PRIMARY KEY,
        order_id             INTEGER NOT NULL REFERENCES orders(id),
        payment_type         TEXT NOT NULL,
        amount               INTEGER NOT NULL,
        screenshot_url       TEXT,
        screenshot_data      TEXT,
        screenshot_mime_type TEXT,
        submitted_by_id      INTEGER NOT NULL REFERENCES users(id),
        status               TEXT DEFAULT 'pending_confirmation',
        reviewed_by_id       INTEGER REFERENCES users(id),
        reviewed_at          TIMESTAMP,
        notes                TEXT,
        created_at           TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Complaints (depends on orders + users) ───────────────────────────────

    await client.query(`
      CREATE TABLE IF NOT EXISTS complaints (
        id                         SERIAL PRIMARY KEY,
        complaint_number           TEXT NOT NULL UNIQUE,
        order_id                   INTEGER NOT NULL REFERENCES orders(id),
        complaint_against_user_id  INTEGER NOT NULL REFERENCES users(id),
        filed_by_user_id           INTEGER NOT NULL REFERENCES users(id),
        category                   TEXT NOT NULL,
        description                TEXT NOT NULL,
        status                     TEXT NOT NULL DEFAULT 'new',
        admin_notes                TEXT,
        resolution                 TEXT,
        resolved_by_user_id        INTEGER REFERENCES users(id),
        resolved_at                TIMESTAMP,
        created_at                 TIMESTAMP DEFAULT NOW(),
        updated_at                 TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS complaints_order_id_idx
        ON complaints(order_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS complaints_against_user_id_idx
        ON complaints(complaint_against_user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS complaints_filed_by_user_id_idx
        ON complaints(filed_by_user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS complaints_status_idx
        ON complaints(status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS complaints_created_at_idx
        ON complaints(created_at)
    `);

    // Complaints are permanent audit records. Remove an earlier cascade rule if
    // present so deleting an order cannot silently erase complaint history.
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'complaints_order_id_fkey'
            AND confdeltype = 'c'
        ) THEN
          ALTER TABLE complaints DROP CONSTRAINT complaints_order_id_fkey;
          ALTER TABLE complaints
            ADD CONSTRAINT complaints_order_id_fkey
            FOREIGN KEY (order_id) REFERENCES orders(id);
        END IF;
      END $$
    `);

    // ── Support-designer assignments (depends on users) ──────────────────────

    await client.query(`
      CREATE TABLE IF NOT EXISTS support_designer_assignments (
        id               SERIAL PRIMARY KEY,
        support_user_id  INTEGER NOT NULL REFERENCES users(id),
        designer_user_id INTEGER NOT NULL REFERENCES users(id),
        assigned_at      TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Push subscriptions (depends on users) ────────────────────────────────

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

    // ── Additive ALTER columns for existing installs ─────────────────────────
    // Safe on fresh DBs (columns already exist); safe on old DBs (IF NOT EXISTS)

    await client.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS order_number           TEXT,
        ADD COLUMN IF NOT EXISTS priority               TEXT NOT NULL DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS payment_status         TEXT DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS advance_payment_status TEXT DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS intended_designer_id   INTEGER REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS platform               TEXT,
        ADD COLUMN IF NOT EXISTS campaign               TEXT,
        ADD COLUMN IF NOT EXISTS ad_set                 TEXT,
        ADD COLUMN IF NOT EXISTS creative               TEXT,
        ADD COLUMN IF NOT EXISTS package_type           TEXT,
        ADD COLUMN IF NOT EXISTS internal_notes         TEXT,
        ADD COLUMN IF NOT EXISTS discount_amount        INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS payment_method         TEXT,
        ADD COLUMN IF NOT EXISTS payment_date           TIMESTAMP,
        ADD COLUMN IF NOT EXISTS delivered_at           TIMESTAMP,
        ADD COLUMN IF NOT EXISTS client_type            TEXT NOT NULL DEFAULT 'national'
    `);

    await client.query(`
      ALTER TABLE order_services
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'
    `);

    await client.query(`
      ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS title        TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS priority     TEXT NOT NULL DEFAULT 'update',
        ADD COLUMN IF NOT EXISTS related_id   INTEGER,
        ADD COLUMN IF NOT EXISTS related_type TEXT
    `);

    await client.query(`
      ALTER TABLE payment_verifications
        ADD COLUMN IF NOT EXISTS screenshot_data      TEXT,
        ADD COLUMN IF NOT EXISTS screenshot_mime_type TEXT,
        ADD COLUMN IF NOT EXISTS reviewed_by_id       INTEGER REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS reviewed_at          TIMESTAMP,
        ADD COLUMN IF NOT EXISTS notes                TEXT
    `);

    await client.query(`
      ALTER TABLE platforms_catalog
        ADD COLUMN IF NOT EXISTS has_campaign_fields BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS sort_order          INTEGER NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE services_catalog
        ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS title     TEXT,
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
