import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";

export const listDeletedBackups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listBackupGroups } = await import("@/lib/data-backup.server");
    return listBackupGroups(supabaseAdmin as any);
  });

export const restoreDeletedBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ wipeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { restoreBackupGroup } = await import("@/lib/data-backup.server");
    return restoreBackupGroup(supabaseAdmin as any, data.wipeId);
  });
