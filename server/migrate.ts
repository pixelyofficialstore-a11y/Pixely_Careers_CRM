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

    // ── Client feedback (depends on orders + users) ──────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS client_reviews (
        id SERIAL PRIMARY KEY,
        review_number TEXT NOT NULL UNIQUE,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        rating INTEGER,
        review_for_designer_id INTEGER REFERENCES users(id),
        feedback_text TEXT NOT NULL DEFAULT '',
        whatsapp_feedback_received BOOLEAN NOT NULL DEFAULT false,
        facebook_review_received BOOLEAN NOT NULL DEFAULT false,
        video_review_received BOOLEAN NOT NULL DEFAULT false,
        marketing_permission TEXT NOT NULL DEFAULT 'not_asked',
        public_review_link TEXT,
        screenshot_url TEXT,
        created_by_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(order_id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS client_suggestions (
        id SERIAL PRIMARY KEY,
        suggestion_number TEXT NOT NULL UNIQUE,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        category TEXT NOT NULL,
        related_designer_id INTEGER REFERENCES users(id),
        suggestion_text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',
        screenshot_url TEXT,
        admin_notes TEXT,
        created_by_id INTEGER NOT NULL REFERENCES users(id),
        reviewed_by_user_id INTEGER REFERENCES users(id),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS client_reviews_designer_idx ON client_reviews(review_for_designer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS client_reviews_created_at_idx ON client_reviews(created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS client_suggestions_order_idx ON client_suggestions(order_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS client_suggestions_designer_idx ON client_suggestions(related_designer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS client_suggestions_status_idx ON client_suggestions(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS client_suggestions_created_at_idx ON client_suggestions(created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS activity_logs_order_created_idx ON activity_logs(order_id, created_at DESC)`);

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
        resolution_outcome         TEXT,
        screenshot_url             TEXT,
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
      ALTER TABLE complaints
        ADD COLUMN IF NOT EXISTS resolution_outcome TEXT,
        ADD COLUMN IF NOT EXISTS screenshot_url TEXT
    `);
    await client.query(`CREATE SEQUENCE IF NOT EXISTS review_number_seq`);
    await client.query(`CREATE SEQUENCE IF NOT EXISTS suggestion_number_seq`);
    await client.query(`
      WITH maximum AS (
        SELECT GREATEST(COALESCE((SELECT MAX(regexp_replace(review_number, '^.*-', '')::bigint)
          FROM client_reviews WHERE review_number ~ '^REV-[0-9]{4}-[0-9]+$'), 0),
          COALESCE((SELECT last_value FROM review_number_seq), 0)) AS value
      ) SELECT setval('review_number_seq', GREATEST(value, 1), value > 0) FROM maximum
    `);
    // Translate the short-lived feedback schema additively; retain every value.
    await client.query(`
      ALTER TABLE client_reviews
        ADD COLUMN IF NOT EXISTS review_for_designer_id INTEGER REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS feedback_text TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS whatsapp_feedback_received BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS facebook_review_received BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS video_review_received BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS public_review_link TEXT,
        ADD COLUMN IF NOT EXISTS screenshot_url TEXT;
      ALTER TABLE client_suggestions
        ADD COLUMN IF NOT EXISTS related_designer_id INTEGER REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS suggestion_text TEXT,
        ADD COLUMN IF NOT EXISTS screenshot_url TEXT,
        ADD COLUMN IF NOT EXISTS admin_notes TEXT,
        ADD COLUMN IF NOT EXISTS reviewed_by_user_id INTEGER REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
    `);
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='client_reviews' AND column_name='designer_id') THEN
          UPDATE client_reviews SET review_for_designer_id = COALESCE(review_for_designer_id, designer_id),
            feedback_text = CASE WHEN feedback_text = '' THEN COALESCE(comment, '') ELSE feedback_text END,
            facebook_review_received = COALESCE(facebook_review_received, channel_facebook),
            screenshot_url = COALESCE(screenshot_url, image_url),
            public_review_link = COALESCE(public_review_link, public_link);
          ALTER TABLE client_reviews ALTER COLUMN marketing_permission TYPE TEXT USING CASE WHEN marketing_permission::text IN ('true','t','1') THEN 'yes' WHEN marketing_permission::text IN ('false','f','0') THEN 'no' ELSE 'not_asked' END;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='client_suggestions' AND column_name='suggestion') THEN
          UPDATE client_suggestions SET suggestion_text = COALESCE(suggestion_text, suggestion), screenshot_url = COALESCE(screenshot_url, image_url);
          ALTER TABLE client_suggestions ALTER COLUMN suggestion_text SET NOT NULL;
        END IF;
      END $$;
    `);
    await client.query(`
      WITH maximum AS (
        SELECT GREATEST(COALESCE((SELECT MAX(regexp_replace(suggestion_number, '^.*-', '')::bigint)
          FROM client_suggestions WHERE suggestion_number ~ '^SUG-[0-9]{4}-[0-9]+$'), 0),
          COALESCE((SELECT last_value FROM suggestion_number_seq), 0)) AS value
      ) SELECT setval('suggestion_number_seq', GREATEST(value, 1), value > 0) FROM maximum
    `);
    // Legacy review rows are safely returned to the current workflow entry state.
    await client.query(`UPDATE complaints SET status = 'new' WHERE status = 'under_review'`);
    // The sequence is global, so suffixes cannot reset across months or deletions.
    await client.query(`CREATE SEQUENCE IF NOT EXISTS complaint_number_seq`);
    await client.query(`
      WITH maximum AS (
        SELECT GREATEST(
          COALESCE((
            SELECT MAX(regexp_replace(complaint_number, '^.*-', '')::bigint)
            FROM complaints
            WHERE complaint_number ~ '^CMP-([0-9]{4}-)?[0-9]+$'
          ), 0),
          COALESCE((SELECT last_value FROM complaint_number_seq), 0)
        ) AS value
      )
      SELECT setval('complaint_number_seq', GREATEST(value, 1), value > 0) FROM maximum
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
