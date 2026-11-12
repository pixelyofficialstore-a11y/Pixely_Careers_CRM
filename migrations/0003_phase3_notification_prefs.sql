-- =============================================================================
-- 0003_phase3_notification_prefs.sql  (Phase 3 – Notifications + PWA)
--
-- Rule 0: SCHEMA ONLY. No existing row or value is changed.
--   * 1 NEW empty table: notification_preferences (one row per user, created
--     only when that user saves their notification settings)
-- Nothing is dropped, renamed, updated or deleted. Existing notifications and
-- push_subscriptions rows are untouched (push subscriptions are upserted on the
-- existing unique endpoint index by the app from now on; no delete-then-insert).
--
-- Requires 0001 (crm_app role, schema_migrations).
-- Applied with: pnpm db:migrate -- migrations/0003_phase3_notification_prefs.sql --approved
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Per-user notification settings. No row = defaults (everything on, no quiet hours).
--   muted_events: notification categories (e.g. 'new_order', 'daily_summary')
--                 whose phone/desktop push + sound are off. The bell still lists them.
--   quiet_start / quiet_end: minutes after midnight, Pakistan time (0..1439).
--                 Both NULL = no quiet hours. During quiet hours: no push, no sound.
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id      integer PRIMARY KEY REFERENCES public.users(id),
  muted_events text[] NOT NULL DEFAULT '{}',
  quiet_start  smallint CHECK (quiet_start IS NULL OR quiet_start BETWEEN 0 AND 1439),
  quiet_end    smallint CHECK (quiet_end IS NULL OR quiet_end BETWEEN 0 AND 1439),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Permissions (same model as 0001/0002)
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_preferences FROM anon, authenticated;
-- The app creates and updates a user's own settings; it never deletes them.
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO crm_app;

INSERT INTO public.schema_migrations (name) VALUES ('0003_phase3_notification_prefs')
ON CONFLICT (name) DO NOTHING;

COMMIT;
