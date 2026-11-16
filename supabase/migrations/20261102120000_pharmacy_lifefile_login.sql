-- Each LifeFile pharmacy keeps its own API login.
-- Doctors are named on the order; they do not have a separate API user.

ALTER TABLE public.life_file_pharmacies
  ADD COLUMN IF NOT EXISTS api_username text,
  ADD COLUMN IF NOT EXISTS api_password text,
  ADD COLUMN IF NOT EXISTS practice_id bigint;

COMMENT ON COLUMN public.life_file_pharmacies.api_username IS
  'API username for this pharmacy. Used for every order sent to it.';
COMMENT ON COLUMN public.life_file_pharmacies.api_password IS
  'API password for this pharmacy. Not a doctor website login.';
COMMENT ON COLUMN public.life_file_pharmacies.practice_id IS
  'Practice ID sent on every order for this pharmacy.';
