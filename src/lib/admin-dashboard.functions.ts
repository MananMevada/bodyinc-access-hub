import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";

const input = z
  .object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) })
  .default({ days: 30 });

export const getAdminDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => input.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildAdminDashboard } = await import("@/lib/admin-dashboard.server");
    return buildAdminDashboard(supabaseAdmin, data.days);
  });
