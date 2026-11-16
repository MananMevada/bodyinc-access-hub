-- The consultation questionnaire for a shop purchase is stored on the consultation,
-- separate from an earlier onboarding intake session.

ALTER TABLE public.patient_consultations
  ADD COLUMN IF NOT EXISTS form_submitted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS form_submission_id text,
  ADD COLUMN IF NOT EXISTS form_submitted_at timestamptz;

CREATE INDEX IF NOT EXISTS patient_consultations_form_sub_id_idx
  ON public.patient_consultations (form_submission_id)
  WHERE form_submission_id IS NOT NULL;
