-- =============================================================================
-- 0002_phase2_order_process.sql  (Phase 2 – One order process)
--
-- Rule 0: SCHEMA ONLY. No existing row or value is changed.
--   * 4 NEW NULLABLE columns on orders (existing rows stay NULL; old orders get
--     their work status / due date computed in code, never written back)
--   * 1 NEW NULLABLE column on package_configs (delivery days per package)
--   * 1 NEW empty table: refunds
--   * indexes for the new columns/table
-- Nothing is dropped, renamed, updated or deleted.
--
-- Requires 0001 (crm_app role, schema_migrations).
-- Applied with: pnpm db:migrate -- migrations/0002_phase2_order_process.sql --approved
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. orders: new pipeline fields (all NULLABLE, no defaults => no row rewrite) --
-- work_status: Request → Confirmed → In progress → Draft sent → Revisions →
-- Delivered (+ Canceled). "Closed" is computed (support period ended), never stored.
-- NULL on old rows = use the mapped legacy `status` (code only).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS work_status text
  CONSTRAINT orders_work_status_check CHECK (work_status IN
    ('request', 'confirmed', 'in_progress', 'draft_sent', 'revisions', 'delivered', 'canceled'));
-- Due date for new orders (created_at + package delivery days). NULL on old rows
-- = computed on the fly in code.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS due_at timestamp;
-- Admin approval of "pay later" (an order may be Confirmed without a verified payment).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pay_later_approved_by_id integer REFERENCES public.users(id);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pay_later_approved_at timestamp;

-- Overdue scan (only rows that have a stored due date).
CREATE INDEX IF NOT EXISTS orders_due_at_idx ON public.orders (due_at) WHERE due_at IS NOT NULL;

-- 2. package_configs: delivery days per package (NULL = code default) --------
ALTER TABLE public.package_configs ADD COLUMN IF NOT EXISTS delivery_days integer
  CONSTRAINT package_configs_delivery_days_check CHECK (delivery_days IS NULL OR delivery_days BETWEEN 1 AND 365);

-- 3. refunds (support requests → admin approves with an amount) -------------
-- Money in paisa, like every CRM table.
CREATE TABLE IF NOT EXISTS public.refunds (
  id                serial PRIMARY KEY,
  order_id          integer NOT NULL REFERENCES public.orders(id),
  complaint_id      integer REFERENCES public.complaints(id),
  status            text NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'approved', 'rejected', 'paid')),
  requested_amount  integer NOT NULL CHECK (requested_amount > 0),
  approved_amount   integer CHECK (approved_amount IS NULL OR approved_amount > 0),
  reason            text NOT NULL,
  method            text,
  admin_note        text,
  requested_by_id   integer NOT NULL REFERENCES public.users(id),
  requested_at      timestamp NOT NULL DEFAULT now(),
  decided_by_id     integer REFERENCES public.users(id),
  decided_at        timestamp,
  paid_at           timestamp
);
CREATE INDEX IF NOT EXISTS refunds_order_idx     ON public.refunds (order_id);
CREATE INDEX IF NOT EXISTS refunds_status_idx    ON public.refunds (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS refunds_complaint_idx ON public.refunds (complaint_id) WHERE complaint_id IS NOT NULL;

-- 4. Permissions (same model as 0001) ----------------------------------------
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refunds FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.refunds_id_seq FROM anon, authenticated;
-- The app records and decides refunds; it never deletes them.
GRANT SELECT, INSERT, UPDATE ON public.refunds TO crm_app;
GRANT USAGE, SELECT ON SEQUENCE public.refunds_id_seq TO crm_app;

INSERT INTO public.schema_migrations (name) VALUES ('0002_phase2_order_process')
ON CONFLICT (name) DO NOTHING;

COMMIT;
