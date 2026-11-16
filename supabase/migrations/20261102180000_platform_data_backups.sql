-- Rows removed by the admin "clear data" action stay here.
-- The app does not read this table, so cleared data is not shown in the live system.

CREATE TABLE IF NOT EXISTS public.platform_data_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wipe_id uuid NOT NULL,
  group_key text NOT NULL,
  table_name text NOT NULL,
  row_data jsonb NOT NULL,
  wiped_by uuid,
  wiped_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_data_backups IS
  'Backup of rows removed from the live system by the admin clear action.';

ALTER TABLE public.platform_data_backups ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS platform_data_backups_wipe_id_idx
  ON public.platform_data_backups (wipe_id);

CREATE INDEX IF NOT EXISTS platform_data_backups_table_idx
  ON public.platform_data_backups (table_name, wiped_at DESC);
