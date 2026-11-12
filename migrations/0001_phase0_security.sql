-- =============================================================================
-- 0001_phase0_security.sql  (Phase 0 – Security Lockdown)
--
-- Rule 0: SCHEMA / PERMISSIONS ONLY. No existing row or value is changed.
--   * adds 5 NULLABLE columns to users (existing rows get NULL)
--   * creates 3 NEW empty tables: schema_migrations, audit_events, files
--   * creates indexes (new tables + 3 missing FK indexes on small tables)
--   * enables RLS on website_request_activity (+ the 2 new tables)
--   * revokes the public Supabase API roles (anon, authenticated) from CRM tables
--   * creates the least-privilege app role crm_app
-- Nothing is dropped. Duplicate indexes are reported, NOT removed.
--
-- Applied with: pnpm db:migrate -- migrations/0001_phase0_security.sql --approved
-- {{CRM_APP_PASSWORD}} is filled in by the apply script from CRM_APP_DB_PASSWORD
-- (.env); the password is never printed or committed.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 0. Migration bookkeeping ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  name        text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text NOT NULL DEFAULT current_user
);

-- 1. users: security columns (all NULLABLE, no defaults => no row rewrite) -----
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS must_change_password boolean;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_changed_at  timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sessions_valid_after timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS totp_secret          text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS totp_enabled         boolean;

-- 2. audit_events (append-only security log) --------------------------------
CREATE TABLE IF NOT EXISTS public.audit_events (
  id          serial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  actor_id    integer REFERENCES public.users(id),
  actor_role  text,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  success     boolean NOT NULL DEFAULT true,
  ip          text,
  user_agent  text,
  details     jsonb
);
CREATE INDEX IF NOT EXISTS audit_events_created_idx        ON public.audit_events (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_action_created_idx ON public.audit_events (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx          ON public.audit_events (actor_id);

-- 3. files (private Cloudinary uploads served via GET /api/files/:id) -------
CREATE TABLE IF NOT EXISTS public.files (
  id             serial PRIMARY KEY,
  public_id      text NOT NULL,
  resource_type  text NOT NULL DEFAULT 'image',
  delivery_type  text NOT NULL DEFAULT 'authenticated',
  format         text,
  mime_type      text,
  bytes          integer,
  kind           text NOT NULL,
  order_id       integer REFERENCES public.orders(id),
  uploaded_by_id integer NOT NULL REFERENCES public.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_order_idx    ON public.files (order_id);
CREATE INDEX IF NOT EXISTS files_uploader_idx ON public.files (uploaded_by_id);

-- 4. Missing indexes used on hot paths (tables are small: <= 48 rows) --------
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx              ON public.push_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS support_designer_assignments_support_idx  ON public.support_designer_assignments (support_user_id);
CREATE INDEX IF NOT EXISTS support_designer_assignments_designer_idx ON public.support_designer_assignments (designer_user_id);
-- Reported, intentionally NOT dropped (owner decision):
--   public.orders: orders_order_number_key + orders_order_number_unique (same column, both UNIQUE)
--   website.orders: orders_whatsapp_idx + orders_whatsapp_crm_idx (same column)

-- 5. RLS + revoke public API roles ---------------------------------------------
-- The CRM never uses Supabase's REST API (anon/authenticated). Today those roles
-- hold ALL privileges (incl. TRUNCATE/DELETE) on every CRM table.
ALTER TABLE public.website_request_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
-- Tables created later by the owner role don't get anon/authenticated grants either.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- 6. Least-privilege application role -----------------------------------------
-- BYPASSRLS: RLS is on for every table with no policies (deny-all for API roles);
-- the app enforces access server-side. crm_app has NO DDL, NO TRUNCATE, and
-- DELETE only where the app deletes today.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app LOGIN BYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE CONNECTION LIMIT 30 PASSWORD '{{CRM_APP_PASSWORD}}';
  ELSE
    ALTER ROLE crm_app LOGIN BYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE CONNECTION LIMIT 30 PASSWORD '{{CRM_APP_PASSWORD}}';
  END IF;
END
$$;

ALTER ROLE crm_app SET statement_timeout = '30s';
ALTER ROLE crm_app SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE crm_app SET search_path = public;

GRANT CONNECT ON DATABASE postgres TO crm_app;
GRANT USAGE ON SCHEMA public, website TO crm_app;
REVOKE CREATE ON SCHEMA public FROM crm_app;

-- public: read/insert/update everywhere
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO crm_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO crm_app;

-- DELETE only where the app deletes (see storage.ts / routes.ts):
--   admin hard-delete of an order and its children, catalog/settings removals,
--   designer re-assignment, push unsubscribe + expired push endpoints,
--   express-session logout/expiry.
GRANT DELETE ON
  public.orders,
  public.order_services,
  public.activity_logs,
  public.payment_verifications,
  public.client_reviews,
  public.client_suggestions,
  public.notifications,
  public.support_designer_assignments,
  public.services_catalog,
  public.package_configs,
  public.platforms_catalog,
  public.complaint_category_configs,
  public.push_subscriptions,
  public.user_sessions
TO crm_app;

-- audit_events is append-only for the app.
REVOKE UPDATE, DELETE ON public.audit_events FROM crm_app;
-- schema_migrations is owner-only.
REVOKE ALL ON public.schema_migrations FROM crm_app;

-- website schema (checkout tables): the CRM reads and updates, never deletes.
GRANT SELECT, UPDATE ON website.orders, website.cv_reviews, website.partners TO crm_app;
GRANT SELECT ON website.calls, website.events TO crm_app;

INSERT INTO public.schema_migrations (name) VALUES ('0001_phase0_security')
ON CONFLICT (name) DO NOTHING;

COMMIT;
