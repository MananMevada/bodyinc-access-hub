import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";

const MEDICINE_CHANGE_ACTIONS = [
  "request.change_medicine",
  "subscription.change_medicine",
] as const;

type MedicineChangeLogRow = {
  id: string;
  entity: string;
  entity_id: string | null;
  after: { user_id?: string | null } | null;
};

function logUserId(row: MedicineChangeLogRow): string | null {
  return row.after?.user_id ?? null;
}

async function deleteActivityLogIds(supabaseAdmin: any, ids: string[]) {
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error } = await supabaseAdmin.from("admin_activity_log").delete().in("id", chunk);
    if (error) {
      console.error("[audit] delete medicine-change rows failed:", error.message);
      throw new Error(error.message);
    }
  }
}

async function loadMedicineChangeLogs(supabaseAdmin: any): Promise<MedicineChangeLogRow[]> {
  const { data, error } = await supabaseAdmin
    .from("admin_activity_log")
    .select("id, entity, entity_id, after")
    .in("action", MEDICINE_CHANGE_ACTIONS)
    .limit(5000);
  if (error) {
    console.error("[audit] load medicine changes failed:", error.message);
    return [];
  }
  return (data ?? []) as MedicineChangeLogRow[];
}

export async function deleteMedicineChangeHistory(
  supabaseAdmin: any,
  opts: { userId?: string; entityIds?: string[]; all?: boolean },
) {
  if (opts.all) {
    const { error } = await supabaseAdmin
      .from("admin_activity_log")
      .delete()
      .in("action", MEDICINE_CHANGE_ACTIONS);
    if (error) throw new Error(error.message);
    return;
  }

  const entityIdSet = new Set(opts.entityIds ?? []);
  const logs = await loadMedicineChangeLogs(supabaseAdmin);
  const ids = logs
    .filter((row) => {
      if (opts.userId && logUserId(row) === opts.userId) return true;
      if (row.entity_id && entityIdSet.has(row.entity_id)) return true;
      return false;
    })
    .map((row) => row.id);

  if (ids.length) await deleteActivityLogIds(supabaseAdmin, ids);
}

/** Drop medicine-change rows that no longer belong to a living patient. */
export async function purgeOrphanedMedicineChangeHistory(supabaseAdmin: any) {
  const list = await loadMedicineChangeLogs(supabaseAdmin);
  if (list.length === 0) return;

  const reqIds = Array.from(
    new Set(
      list
        .filter((r) => r.entity === "medication_requests" && r.entity_id && !logUserId(r))
        .map((r) => r.entity_id as string),
    ),
  );
  const subIds = Array.from(
    new Set(
      list
        .filter((r) => r.entity === "subscriptions" && r.entity_id && !logUserId(r))
        .map((r) => r.entity_id as string),
    ),
  );

  const ownerByEntityId = new Map<string, string>();
  if (reqIds.length) {
    const { data: reqs } = await supabaseAdmin
      .from("medication_requests")
      .select("id, user_id")
      .in("id", reqIds);
    (reqs ?? []).forEach((r: { id: string; user_id: string | null }) => {
      if (r.user_id) ownerByEntityId.set(r.id, r.user_id);
    });
  }
  if (subIds.length) {
    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("id, user_id")
      .in("id", subIds);
    (subs ?? []).forEach((s: { id: string; user_id: string | null }) => {
      if (s.user_id) ownerByEntityId.set(s.id, s.user_id);
    });
  }

  const ownerOf = (row: MedicineChangeLogRow): string | null =>
    logUserId(row) ?? (row.entity_id ? (ownerByEntityId.get(row.entity_id) ?? null) : null);

  const ownerIds = Array.from(new Set(list.map(ownerOf).filter((id): id is string => Boolean(id))));
  const { data: profiles } = ownerIds.length
    ? await supabaseAdmin.from("profiles").select("id").in("id", ownerIds)
    : { data: [] as Array<{ id: string }> };
  const livingPatients = new Set(((profiles ?? []) as Array<{ id: string }>).map((p) => p.id));

  const orphanIds = list
    .filter((row) => {
      const ownerId = ownerOf(row);
      return !ownerId || !livingPatients.has(ownerId);
    })
    .map((row) => row.id);

  if (orphanIds.length === 0) return;
  try {
    await deleteActivityLogIds(supabaseAdmin, orphanIds);
  } catch (error) {
    console.error("[audit] purge orphaned medicine changes failed:", error);
  }
}

const medicineChangesInput = z
  .object({
    search: z.string().trim().max(200).optional(),
    role: z.enum(["all", "admin", "provider"]).default("all"),
    crossCategoryOnly: z.boolean().default(false),
    days: z.number().int().min(1).max(3650).optional(),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .default({ page: 1, limit: 25, role: "all", crossCategoryOnly: false });

/**
 * Every medicine / plan switch performed by an admin or a practitioner, read from the
 * structured audit rows written by `changeRequestMedicine` and `changeSubscriptionMedicine`.
 */
export const listMedicineChanges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => medicineChangesInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normalizeIdSearch } = await import("@/lib/format");
    await purgeOrphanedMedicineChangeHistory(supabaseAdmin);

    const from = (data.page - 1) * data.limit;
    const to = from + data.limit - 1;

    let q = supabaseAdmin
      .from("admin_activity_log")
      .select("id, admin_user_id, action, entity, entity_id, before, after, created_at", {
        count: "exact",
      })
      .in("action", ["request.change_medicine", "subscription.change_medicine"])
      .order("created_at", { ascending: false });

    if (data.days) {
      q = q.gte("created_at", new Date(Date.now() - data.days * 86400000).toISOString());
    }
    let idMatchOnly = false;
    if (data.search) {
      const s = normalizeIdSearch(data.search).toLowerCase();
      // Only treat the term as an ID when it reads like a uuid fragment; otherwise it is a
      // name / medicine search that has to be applied after the profile join.
      if (s && /^[0-9a-f-]+$/.test(s)) {
        q = q.ilike("entity_id", `${s}%`);
        idMatchOnly = true;
      }
    }

    const { data: rows, count, error } = await q.range(from, to);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as any[];

    const actorIds = Array.from(new Set(list.map((r) => r.admin_user_id).filter(Boolean)));

    // Older rows (and subscription changes logged before user_id was captured) have no
    // patient on the payload — resolve it from the linked record instead.
    const ownerByEntityId = new Map<string, string>();
    const missingSubs = list
      .filter((r) => !r?.after?.user_id && r.entity === "subscriptions" && r.entity_id)
      .map((r) => r.entity_id as string);
    const missingReqs = list
      .filter((r) => !r?.after?.user_id && r.entity === "medication_requests" && r.entity_id)
      .map((r) => r.entity_id as string);
    if (missingSubs.length) {
      const { data: subs } = await supabaseAdmin
        .from("subscriptions")
        .select("id, user_id")
        .in("id", Array.from(new Set(missingSubs)));
      (subs ?? []).forEach((s: any) => s.user_id && ownerByEntityId.set(s.id, s.user_id));
    }
    if (missingReqs.length) {
      const { data: reqs } = await supabaseAdmin
        .from("medication_requests")
        .select("id, user_id")
        .in("id", Array.from(new Set(missingReqs)));
      (reqs ?? []).forEach((s: any) => s.user_id && ownerByEntityId.set(s.id, s.user_id));
    }

    const ownerOf = (r: any): string | null =>
      r?.after?.user_id ?? (r.entity_id ? (ownerByEntityId.get(r.entity_id) ?? null) : null);

    const patientIds = Array.from(new Set(list.map(ownerOf).filter(Boolean))) as string[];
    const allIds = Array.from(new Set([...actorIds, ...patientIds])) as string[];

    const { data: profiles } = allIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", allIds)
      : { data: [] as any[] };
    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    const label = (snap: any) => {
      if (!snap) return "—";
      const name = snap.medicine_name ?? "—";
      const variant = snap.variant_name ? ` (${snap.variant_name})` : "";
      const months = snap.duration_months ? ` · ${snap.duration_months} mo` : "";
      return `${name}${variant}${months}`;
    };

    let result = list.flatMap((r) => {
      const actor = r.admin_user_id ? (pMap.get(r.admin_user_id) as any) : null;
      const ownerId = ownerOf(r);
      const patient = ownerId ? (pMap.get(ownerId) as any) : null;
      if (!patient) return [];
      return [
        {
          id: r.id,
          created_at: r.created_at,
          entity: r.entity as string,
          entity_id: r.entity_id as string | null,
          source: r.action === "subscription.change_medicine" ? "subscription" : "order",
          actor_name: actor?.full_name ?? actor?.email ?? null,
          actor_role: (r?.after?.actor_role ?? "admin") as string,
          patient_name: patient?.full_name ?? null,
          patient_email: patient?.email ?? null,
          from_label: label(r.before),
          to_label: label(r.after),
          delta_cents: Number(r?.after?.delta_cents ?? 0),
          cross_category: Boolean(r?.after?.cross_category),
          cross_category_reason: r?.after?.cross_category_reason ?? null,
          note: r?.after?.note ?? null,
        },
      ];
    });

    if (data.role !== "all") result = result.filter((r) => r.actor_role === data.role);
    if (data.crossCategoryOnly) result = result.filter((r) => r.cross_category);
    if (data.search && !idMatchOnly) {
      const s = data.search.toLowerCase();
      result = result.filter(
        (r) =>
          (r.patient_name ?? "").toLowerCase().includes(s) ||
          (r.patient_email ?? "").toLowerCase().includes(s) ||
          r.from_label.toLowerCase().includes(s) ||
          r.to_label.toLowerCase().includes(s),
      );
    }

    const total = count ?? 0;
    return {
      data: result,
      total,
      page: data.page,
      page_size: data.limit,
      total_pages: total ? Math.ceil(total / data.limit) : 0,
    };
  });
