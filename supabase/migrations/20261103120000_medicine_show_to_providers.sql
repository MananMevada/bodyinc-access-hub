ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS show_to_providers boolean NOT NULL DEFAULT false;
