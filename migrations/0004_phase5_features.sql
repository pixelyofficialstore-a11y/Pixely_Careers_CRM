-- =============================================================================
-- 0004_phase5_features.sql  (Phase 5 – client profiles, WhatsApp templates,
--                            Marketing ROI, catalog)
--
-- Rule 0: SCHEMA ONLY. No existing row or value is changed.
--   * 1 helper function   public.pk_phone_key(text)  (pure: digits -> one key)
--   * 1 NEW NULLABLE column orders.client_key  (filled only on NEW orders;
--     old orders are matched by phone through the function, never rewritten)
--   * 1 index             orders by phone key (fast client lookup)
--   * 1 view              public.client_profiles  (computed from orders)
--   * 3 NEW empty tables  ad_spend, whatsapp_templates, catalog_items
-- Nothing is dropped, renamed, updated or deleted. The app gets
-- SELECT/INSERT/UPDATE on the new tables only (no delete: rows are switched
-- off with is_active, spend is corrected by editing the amount).
--
-- Requires 0001 (crm_app role, schema_migrations).
-- Applied with: pnpm db:migrate -- migrations/0004_phase5_features.sql --approved
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- 1) Phone -> client key. Pakistani numbers in any format become 92XXXXXXXXXX
--    ("0300 1234567", "+92 300 1234567", "300-1234567" -> "923001234567").
--    Other countries: digits only, leading 00 removed. Empty -> NULL.
CREATE OR REPLACE FUNCTION public.pk_phone_key(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN d ~ '^03[0-9]{9}$' THEN '92' || substr(d, 2)
    WHEN d ~ '^3[0-9]{9}$'  THEN '92' || d
    WHEN d ~ '^00'          THEN nullif(substr(d, 3), '')
    ELSE nullif(d, '')
  END
  FROM (SELECT regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') AS d) x
$$;

-- 2) New nullable column: the client key stored on NEW orders only.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS client_key text;

-- 3) Index for "find client by WhatsApp number" (old + new orders).
CREATE INDEX IF NOT EXISTS orders_client_key_idx
  ON public.orders ((coalesce(client_key, public.pk_phone_key(client_phone))));

-- 4) Client profiles, computed live from orders (nothing copied).
--    Money in paisa. "Spent" = placed, not canceled orders.
CREATE OR REPLACE VIEW public.client_profiles
WITH (security_invoker = true) AS
SELECT
  k.client_key,
  (array_agg(o.client_name  ORDER BY o.created_at DESC NULLS LAST, o.id DESC))[1] AS name,
  (array_agg(o.client_phone ORDER BY o.created_at DESC NULLS LAST, o.id DESC))[1] AS phone,
  (array_agg(o.client_email ORDER BY o.created_at DESC NULLS LAST, o.id DESC)
     FILTER (WHERE o.client_email IS NOT NULL AND o.client_email <> ''))[1]        AS email,
  count(*)::int                                                                   AS order_count,
  count(*) FILTER (WHERE o.status NOT IN ('pending_payment', 'canceled'))::int    AS placed_count,
  coalesce(sum(o.total_price - coalesce(o.discount_amount, 0))
     FILTER (WHERE o.status NOT IN ('pending_payment', 'canceled')), 0)::bigint   AS total_spent,
  min(o.created_at)                                                               AS first_order_at,
  max(o.created_at)                                                               AS last_order_at,
  (array_agg(o.platform ORDER BY o.created_at ASC NULLS LAST, o.id ASC)
     FILTER (WHERE o.platform IS NOT NULL AND o.platform <> ''))[1]               AS first_platform,
  (array_agg(o.campaign ORDER BY o.created_at ASC NULLS LAST, o.id ASC)
     FILTER (WHERE o.campaign IS NOT NULL AND o.campaign <> ''))[1]               AS first_campaign
FROM public.orders o
CROSS JOIN LATERAL (SELECT coalesce(o.client_key, public.pk_phone_key(o.client_phone)) AS client_key) k
WHERE k.client_key IS NOT NULL
GROUP BY k.client_key;

-- 5) Ad spend (admin enters it). amount in paisa. One row per day + platform + campaign.
CREATE TABLE IF NOT EXISTS public.ad_spend (
  id            serial PRIMARY KEY,
  spend_date    date    NOT NULL,
  platform      text    NOT NULL DEFAULT 'meta',
  campaign      text    NOT NULL DEFAULT '',
  amount        bigint  NOT NULL CHECK (amount >= 0),
  notes         text,
  created_by_id integer REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (spend_date, platform, campaign)
);
CREATE INDEX IF NOT EXISTS ad_spend_date_idx ON public.ad_spend (spend_date);

-- 6) WhatsApp quick-reply templates (editable in Settings).
--    kind: payment_received | draft_ready | revision_done | delivered | review_request | custom
--    Body placeholders: {name} {order} {amount} {balance} {link}
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id            serial PRIMARY KEY,
  kind          text    NOT NULL DEFAULT 'custom',
  label         text    NOT NULL,
  body          text    NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  updated_by_id integer REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 7) One catalog for packages and add-ons (CRM reads it now; the website can
--    read it later through GET /api/public/catalog). price in paisa.
CREATE TABLE IF NOT EXISTS public.catalog_items (
  id              serial PRIMARY KEY,
  kind            text    NOT NULL CHECK (kind IN ('package', 'addon')),
  key             text    NOT NULL UNIQUE,
  label           text    NOT NULL,
  description     text,
  price           bigint  NOT NULL DEFAULT 0 CHECK (price >= 0),
  currency        text    NOT NULL DEFAULT 'PKR',
  market          text    NOT NULL DEFAULT 'pk',
  services        text[]  NOT NULL DEFAULT '{}',
  website_key     text,
  crm_package_key text,
  delivery_days   integer CHECK (delivery_days IS NULL OR delivery_days BETWEEN 1 AND 365),
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  updated_by_id   integer REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Permissions (same model as 0001-0003)
ALTER TABLE public.ad_spend           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_items      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_spend, public.whatsapp_templates, public.catalog_items, public.client_profiles FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.ad_spend_id_seq, public.whatsapp_templates_id_seq, public.catalog_items_id_seq FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.pk_phone_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pk_phone_key(text) TO crm_app;
GRANT SELECT ON public.client_profiles TO crm_app;
GRANT SELECT, INSERT, UPDATE ON public.ad_spend, public.whatsapp_templates, public.catalog_items TO crm_app;
GRANT USAGE, SELECT ON SEQUENCE public.ad_spend_id_seq, public.whatsapp_templates_id_seq, public.catalog_items_id_seq TO crm_app;

INSERT INTO public.schema_migrations (name) VALUES ('0004_phase5_features')
ON CONFLICT (name) DO NOTHING;

COMMIT;
