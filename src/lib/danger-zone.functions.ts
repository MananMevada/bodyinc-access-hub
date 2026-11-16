import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";
import { WIPE_GROUPS, TABLES, expandGroups, type WipeGroupKey } from "@/lib/danger-zone";

type BackupDb = { from: (table: string) => any };

async function archiveRows(
  db: BackupDb,
  wipeId: string,
  group: string,
  table: string,
  wipedBy: string,
  rows: any[],
  label: string,
) {
  const { storeDeletedRows } = await import("@/lib/data-backup.server");
  await storeDeletedRows(db as any, {
    wipeId,
    group,
    table,
    rows,
    wipedBy,
    label,
  });
}

async function archiveTable(
  db: BackupDb,
  wipeId: string,
  group: string,
  table: string,
  wipedBy: string,
  label: string,
) {
  const rows: any[] = [];
  const page = 500;
  for (let from = 0; ; from += page) {
    const { data, error } = await db.from(table).select("*").range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < page) break;
  }
  await archiveRows(db, wipeId, group, table, wipedBy, rows, label);
  return rows.length;
}

async function archiveMatching(
  db: BackupDb,
  wipeId: string,
  group: string,
  table: string,
  column: string,
  ids: string[],
  wipedBy: string,
  label: string,
) {
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await db.from(table).select("*").in(column, chunk);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
  }
  await archiveRows(db, wipeId, group, table, wipedBy, rows, label);
}

const inputSchema = z.object({
  groups: z
    .array(z.enum(WIPE_GROUPS.map((g) => g.key) as [WipeGroupKey, ...WipeGroupKey[]]))
    .min(1),
});

export const wipePlatformData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const groups = expandGroups(data.groups);
    const deleted: Record<string, number> = {};
    const wipeId = crypto.randomUUID();
    const db = supabaseAdmin as never as { from: (t: string) => any };
    const label = `Clear data: ${groups.join(", ")}`;

    for (const entry of TABLES) {
      if (!groups.includes(entry.group)) continue;
      const stored = await archiveTable(db, wipeId, entry.group, entry.table, context.userId, label);
      const { error } = await db.from(entry.table).delete().not(entry.col, "is", null);
      if (error) throw new Error(`${entry.table}: ${error.message}`);
      deleted[entry.group] = (deleted[entry.group] ?? 0) + stored;
    }

    if (groups.includes("orders")) {
      const { data: logs, error: logError } = await db
        .from("admin_activity_log")
        .select("*")
        .in("action", ["request.change_medicine", "subscription.change_medicine"]);
      if (logError) throw new Error(`admin_activity_log: ${logError.message}`);
      await archiveRows(db, wipeId, "orders", "admin_activity_log", context.userId, logs ?? [], label);
      const { deleteMedicineChangeHistory } = await import("@/lib/audit.functions");
      await deleteMedicineChangeHistory(supabaseAdmin, { all: true });
    }

    if (groups.includes("patient")) {
      const { data: patientRoles } = await supabaseAdmin
        .from("user_roles")
        .select("*")
        .eq("role", "patient");
      const roles = patientRoles ?? [];
      const patientUserIds = roles.map((r: { user_id: string }) => r.user_id);
      if (patientUserIds.length > 0) {
        const { authUserBackup } = await import("@/lib/data-backup.server");
        const authRows = [];
        for (const uid of patientUserIds) {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(uid);
          if (authUser.user) authRows.push(authUserBackup(authUser.user));
        }
        await archiveRows(db, wipeId, "patient", "auth.users", context.userId, authRows, label);
        await archiveRows(db, wipeId, "patient", "user_roles", context.userId, roles, label);
        await archiveMatching(db, wipeId, "patient", "patient_consultations", "user_id", patientUserIds, context.userId, label);
        await archiveMatching(db, wipeId, "patient", "referrals", "referrer_user_id", patientUserIds, context.userId, label);
        await archiveMatching(db, wipeId, "patient", "referrals", "referred_user_id", patientUserIds, context.userId, label);
        await archiveMatching(db, wipeId, "patient", "notifications", "user_id", patientUserIds, context.userId, label);
        await archiveMatching(db, wipeId, "patient", "profiles", "id", patientUserIds, context.userId, label);

        await supabaseAdmin.from("patient_consultations").delete().in("user_id", patientUserIds);
        await supabaseAdmin.from("referrals").delete().in("referrer_user_id", patientUserIds);
        await supabaseAdmin.from("referrals").delete().in("referred_user_id", patientUserIds);
        await supabaseAdmin.from("notifications").delete().in("user_id", patientUserIds);
        await supabaseAdmin.from("profiles").delete().in("id", patientUserIds);
        await supabaseAdmin.from("user_roles").delete().in("user_id", patientUserIds).eq("role", "patient");
        for (const uid of patientUserIds) {
          try {
            await supabaseAdmin.auth.admin.deleteUser(uid);
          } catch {}
        }
        deleted["patient"] = (deleted["patient"] ?? 0) + patientUserIds.length;
      }
    }

    await supabaseAdmin.from("admin_activity_log").insert({
      admin_user_id: context.userId,
      action: "danger.wipe",
      entity: "platform_data",
      entity_id: null,
      before: null,
      after: { groups, deleted, wipe_id: wipeId, backup: "platform_data_backups" } as never,
    });

    return { ok: true, groups, deleted };
  });
