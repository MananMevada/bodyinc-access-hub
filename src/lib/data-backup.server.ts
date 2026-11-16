// Copies rows into platform_data_backups before they are removed, and writes a copy back.

type BackupDb = { from: (table: string) => any; auth: { admin: any } };

const RESTORE_ORDER = [
  "auth.users",
  "profiles",
  "user_roles",
  "providers",
  "medication_categories",
  "life_file_pharmacies",
  "medicines",
  "medicine_variants",
  "packages",
  "medication_category_medicines",
  "questionnaires",
  "questionnaire_categories",
  "questionnaire_questions",
  "questionnaire_question_options",
  "questionnaire_medicines",
  "medication_relationships",
  "provider_life_file_credentials",
  "promo_codes",
  "portal_offers",
  "intake_sessions",
  "subscriptions",
  "payments",
  "shop_checkout_orders",
  "shop_checkout_order_items",
  "medication_requests",
  "medication_request_events",
  "medication_request_notes",
  "prescriptions",
  "additional_payments",
  "shop_checkout_events",
  "patient_consultations",
  "notifications",
  "refund_requests",
  "subscription_cancellation_feedback",
  "intake_session_questionnaire_responses",
  "intake_session_eligibility_results",
  "intake_session_medicines",
  "intake_session_categories",
  "admin_activity_log",
];

export function newBackupId(): string {
  return crypto.randomUUID();
}

export function authUserBackup(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  email_confirmed_at?: string | null;
}) {
  return {
    id: user.id,
    email: user.email ?? null,
    user_metadata: user.user_metadata ?? {},
    email_confirmed: Boolean(user.email_confirmed_at),
  };
}

export async function fetchMatching(
  db: BackupDb,
  table: string,
  column: string,
  ids: string[],
): Promise<any[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const rows: any[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const { data, error } = await db.from(table).select("*").in(column, chunk);
    if (error) {
      if (/does not exist|schema cache|could not find/i.test(error.message)) return rows;
      throw new Error(`${table}: ${error.message}`);
    }
    rows.push(...(data ?? []));
  }
  return rows;
}

export async function storeDeletedRows(
  db: BackupDb,
  opts: {
    wipeId: string;
    group: string;
    table: string;
    rows: any[];
    wipedBy: string | null;
    label?: string | null;
  },
): Promise<void> {
  const rows = opts.rows.filter(Boolean);
  for (let i = 0; i < rows.length; i += 100) {
    const withLabel = rows.slice(i, i + 100).map((row) => ({
      wipe_id: opts.wipeId,
      group_key: opts.group,
      table_name: opts.table,
      row_data: row,
      wiped_by: opts.wipedBy,
      label: opts.label ?? null,
    }));
    const { error } = await db.from("platform_data_backups").insert(withLabel);
    if (!error) continue;
    if (!/label/i.test(error.message)) throw new Error(`backup ${opts.table}: ${error.message}`);
    const plain = withLabel.map(({ label: _label, ...row }) => row);
    const retry = await db.from("platform_data_backups").insert(plain);
    if (retry.error) throw new Error(`backup ${opts.table}: ${retry.error.message}`);
  }
}

/** Save the rows, then run the delete. The copy stays even if the delete fails partway. */
export async function backupThen(
  db: BackupDb,
  opts: {
    wipeId: string;
    group: string;
    wipedBy: string | null;
    label: string;
    batches: Array<{ table: string; rows: any[] }>;
  },
  remove: () => Promise<void>,
): Promise<void> {
  for (const batch of opts.batches) {
    await storeDeletedRows(db, {
      wipeId: opts.wipeId,
      group: opts.group,
      table: batch.table,
      rows: batch.rows,
      wipedBy: opts.wipedBy,
      label: opts.label,
    });
  }
  await remove();
}

function isDuplicate(message: string): boolean {
  return /duplicate key|already exists|unique constraint/i.test(message);
}

/** A plan the patient already ended stays ended. Restore does not put it back on the portal. */
function patientCanceledSubscription(row: any): boolean {
  const status = String(row?.status ?? "").toLowerCase();
  return status === "canceled" || status === "cancelled" || row?.cancel_at_period_end === true;
}

async function insertIgnoringDuplicates(db: BackupDb, table: string, rows: any[]) {
  for (const row of rows) {
    const { error } = await db.from(table).insert(row);
    if (error && !isDuplicate(error.message)) {
      throw new Error(`${table}: ${error.message}`);
    }
  }
}

async function restoreAuthUser(db: BackupDb, row: any) {
  if (!row?.id || !row?.email) return;
  const { error } = await db.auth.admin.createUser({
    id: row.id,
    email: row.email,
    password: `${crypto.randomUUID()}Aa1!`,
    email_confirm: true,
    user_metadata: row.user_metadata ?? {},
  });
  if (error && !isDuplicate(error.message) && !/already been registered|already exists/i.test(error.message)) {
    throw new Error(`Account ${row.email}: ${error.message}`);
  }
}

export type BackupGroup = {
  wipeId: string;
  label: string;
  group: string;
  wipedAt: string;
  tables: string[];
  rowCount: number;
  restored: boolean;
};

export async function listBackupGroups(db: BackupDb): Promise<BackupGroup[]> {
  const withLabel = await db
    .from("platform_data_backups")
    .select("wipe_id, group_key, table_name, wiped_at, label, restored_at")
    .order("wiped_at", { ascending: false })
    .limit(3000);
  let data = withLabel.data as any[] | null;
  if (withLabel.error && /label|restored_at/i.test(withLabel.error.message)) {
    const plain = await db
      .from("platform_data_backups")
      .select("wipe_id, group_key, table_name, wiped_at")
      .order("wiped_at", { ascending: false })
      .limit(3000);
    if (plain.error) throw new Error(plain.error.message);
    data = plain.data;
  } else if (withLabel.error) {
    throw new Error(withLabel.error.message);
  }

  const groups = new Map<string, BackupGroup>();
  for (const row of data ?? []) {
    const current = groups.get(row.wipe_id) ?? {
      wipeId: row.wipe_id,
      label: row.label || row.group_key || "Deleted data",
      group: row.group_key,
      wipedAt: row.wiped_at,
      tables: [] as string[],
      rowCount: 0,
      restored: true,
    };
    current.rowCount += 1;
    if (!current.tables.includes(row.table_name)) current.tables.push(row.table_name);
    if (!row.restored_at) current.restored = false;
    if (row.label) current.label = row.label;
    groups.set(row.wipe_id, current);
  }
  return Array.from(groups.values());
}

export async function restoreBackupGroup(
  db: BackupDb,
  wipeId: string,
): Promise<{ restored: number; needsPasswordReset: boolean }> {
  const { data, error } = await db
    .from("platform_data_backups")
    .select("id, table_name, row_data, restored_at")
    .eq("wipe_id", wipeId);
  if (error) throw new Error(error.message);
  const pending = ((data ?? []) as any[]).filter((row) => !row.restored_at);
  if (!pending.length) throw new Error("This copy was already put back.");

  const skippedSubscriptionIds = new Set(
    pending
      .filter((row) => row.table_name === "subscriptions" && patientCanceledSubscription(row.row_data))
      .map((row) => row.row_data?.id)
      .filter(Boolean),
  );
  const byTable = new Map<string, any[]>();
  for (const row of pending) {
    if (row.table_name === "subscriptions" && patientCanceledSubscription(row.row_data)) continue;
    if (
      row.table_name === "subscription_cancellation_feedback" &&
      skippedSubscriptionIds.has(row.row_data?.subscription_id)
    ) {
      continue;
    }
    const list = byTable.get(row.table_name) ?? [];
    list.push(row.row_data);
    byTable.set(row.table_name, list);
  }

  const ordered = [
    ...RESTORE_ORDER.filter((table) => byTable.has(table)),
    ...Array.from(byTable.keys()).filter((table) => !RESTORE_ORDER.includes(table)),
  ];

  let restored = 0;
  for (const table of ordered) {
    const rows = byTable.get(table) ?? [];
    if (table === "auth.users") {
      for (const row of rows) await restoreAuthUser(db, row);
    } else {
      await insertIgnoringDuplicates(db, table, rows);
    }
    restored += rows.length;
  }

  const marked = await db
    .from("platform_data_backups")
    .update({ restored_at: new Date().toISOString() })
    .eq("wipe_id", wipeId);
  if (marked.error && !/restored_at/i.test(marked.error.message)) {
    throw new Error(marked.error.message);
  }

  return {
    restored,
    needsPasswordReset: byTable.has("auth.users"),
  };
}
