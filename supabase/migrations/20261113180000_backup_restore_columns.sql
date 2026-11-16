-- Lets every admin delete keep a name, and lets a stored copy be marked once it is put back.

ALTER TABLE public.platform_data_backups
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS restored_at timestamptz;

COMMENT ON COLUMN public.platform_data_backups.label IS
  'Who or what was deleted, shown in Settings so an admin can restore the right copy.';

COMMENT ON COLUMN public.platform_data_backups.restored_at IS
  'Set when this copy has been written back into the live tables.';
