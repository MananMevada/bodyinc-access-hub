-- Provider journey: patient confirm/decline, consultation schedule, and claim lock.
-- Apply after 20261026120000_provider_journey.sql.

ALTER TABLE public.medication_requests
  ADD COLUMN IF NOT EXISTS previous_medicine_id uuid,
  ADD COLUMN IF NOT EXISTS previous_variant_id uuid,
  ADD COLUMN IF NOT EXISTS previous_package_id uuid,
  ADD COLUMN IF NOT EXISTS plan_change_token text,
  ADD COLUMN IF NOT EXISTS plan_change_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS plan_change_delta_cents integer,
  ADD COLUMN IF NOT EXISTS consultation_mode text,
  ADD COLUMN IF NOT EXISTS consultation_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_locked_by uuid,
  ADD COLUMN IF NOT EXISTS claim_locked_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS medication_requests_plan_change_token_key
  ON public.medication_requests (plan_change_token)
  WHERE plan_change_token IS NOT NULL;
