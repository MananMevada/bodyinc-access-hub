import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";

const listInput = z
  .object({
    search: z.string().trim().max(200).optional(),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .default({ page: 1, limit: 20 });

export const listActivityLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const from = (data.page - 1) * data.limit;
    const to = from + data.limit - 1;

    let query = supabaseAdmin
      .from("admin_activity_log")
      .select("id, admin_user_id, action, entity, entity_id, before, after, created_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (data.search) {
      const s = data.search;
      query = query.or(`action.ilike.%${s}%,entity.ilike.%${s}%,entity_id.ilike.%${s}%`);
    }

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);

    const adminIds = Array.from(
      new Set((rows ?? []).map((r) => r.admin_user_id).filter(Boolean)),
    ) as string[];
    const { data: profiles } = adminIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", adminIds)
      : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
    const pMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const total = count ?? 0;
    return {
      data: (rows ?? []).map((r) => {
        const admin = r.admin_user_id ? pMap.get(r.admin_user_id) : null;
        return {
          ...r,
          admin_name: admin?.full_name ?? null,
          admin_email: admin?.email ?? null,
        };
      }),
      total,
      page: data.page,
      page_size: data.limit,
      total_pages: total ? Math.ceil(total / data.limit) : 0,
    };
  });
