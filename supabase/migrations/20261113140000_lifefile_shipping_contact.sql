-- Clinic phone and shipping service id are not used yet.
-- Drop them if the earlier add was applied by hand.

ALTER TABLE public.life_file_pharmacies
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS shipping_service_id;
