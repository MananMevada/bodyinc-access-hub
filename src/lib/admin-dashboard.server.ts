// Aggregation for the admin dashboard. Kept out of the *.functions.ts wrapper so the
// server-function module stays a thin, splittable shell.

import { clusterPurchases, leadOf } from "@/lib/order-groups";

const OPEN_STATUSES = [
  "payment_completed",
  "provider_assigned",
  "pending_review",
  "awaiting_additional_payment",
  "approved",
  "prescribed",
  "sent_to_pharmacy",
  "dispatched",
];

const UNASSIGNED_STATUSES = ["payment_completed", "pending_review"];

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function emptySeries(days: number, end: Date): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function delta(current: number, previous: number): number | null {
  if (!previous) return current ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

type Row = Record<string, any>;

export async function buildAdminDashboard(supabaseAdmin: any, days: number) {
  const now = new Date();
  const startISO = new Date(now.getTime() - days * 86400000).toISOString();
  const prevStartISO = new Date(now.getTime() - days * 2 * 86400000).toISOString();

  const [paymentsRes, profilesRes, patientRolesRes, requestsRes, subsRes, sessionsRes, activityRes] =
    await Promise.all([
      supabaseAdmin
        .from("payments")
        .select("amount_cents, status, created_at")
        .gte("created_at", prevStartISO)
        .limit(5000),
      supabaseAdmin
        .from("profiles")
        .select("id, created_at")
        .gte("created_at", prevStartISO)
        .limit(5000),
      supabaseAdmin.from("user_roles").select("user_id").eq("role", "patient").limit(5000),
      supabaseAdmin
        .from("medication_requests")
        .select(
          "id, status, provider_id, medicine_id, user_id, session_id, kind, created_at, order_group_id",
        )
        .order("created_at", { ascending: false })
        .limit(2000),
      supabaseAdmin.from("subscriptions").select("status").limit(5000),
      supabaseAdmin
        .from("intake_sessions")
        .select("id, status, created_at, expires_at")
        .in("status", ["in_progress", "payment_pending"])
        .limit(2000),
      supabaseAdmin
        .from("admin_activity_log")
        .select("id, admin_user_id, action, entity, created_at")
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

  const payments = (paymentsRes.data ?? []) as Row[];
  const patientIds = new Set(
    ((patientRolesRes.data ?? []) as Row[]).map((r) => r.user_id as string),
  );
  const profiles = ((profilesRes.data ?? []) as Row[]).filter((p) => patientIds.has(p.id));
  const requests = (requestsRes.data ?? []) as Row[];
  const subs = (subsRes.data ?? []) as Row[];
  const sessions = (sessionsRes.data ?? []) as Row[];
  const activityRows = (activityRes.data ?? []) as Row[];

  const inWindow = (iso: string) => iso >= startISO;
  const inPrevWindow = (iso: string) => iso >= prevStartISO && iso < startISO;

  const succeeded = payments.filter((p) => p.status === "succeeded");
  const revenue = succeeded
    .filter((p) => inWindow(p.created_at))
    .reduce((s, p) => s + Number(p.amount_cents ?? 0), 0);
  const revenuePrev = succeeded
    .filter((p) => inPrevWindow(p.created_at))
    .reduce((s, p) => s + Number(p.amount_cents ?? 0), 0);

  const newPatients = profiles.filter((p) => inWindow(p.created_at)).length;
  const newPatientsPrev = profiles.filter((p) => inPrevWindow(p.created_at)).length;

  const reqInWindow = requests.filter((r) => inWindow(r.created_at));
  const reqPrev = requests.filter((r) => inPrevWindow(r.created_at));

  const activeSubs = subs.filter((s) => s.status === "active" || s.status === "trialing").length;

  // Daily series
  const labels = emptySeries(days, now);
  const revenueByDay = new Map<string, number>();
  for (const p of succeeded) {
    if (!inWindow(p.created_at)) continue;
    const k = dayKey(p.created_at);
    revenueByDay.set(k, (revenueByDay.get(k) ?? 0) + Number(p.amount_cents ?? 0));
  }
  const patientsByDay = new Map<string, number>();
  for (const p of profiles) {
    if (!inWindow(p.created_at)) continue;
    const k = dayKey(p.created_at);
    patientsByDay.set(k, (patientsByDay.get(k) ?? 0) + 1);
  }

  const series = labels.map((d) => ({
    date: d,
    revenue_cents: revenueByDay.get(d) ?? 0,
    patients: patientsByDay.get(d) ?? 0,
  }));

  // Status breakdown across all open + recent orders
  const statusCounts = new Map<string, number>();
  for (const r of requests) {
    statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  }
  const byStatus = Array.from(statusCounts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  // Attention queues
  const nowISO = now.toISOString();
  const attention = {
    unassigned: clusterPurchases(
      requests.filter((r) => !r.provider_id && UNASSIGNED_STATUSES.includes(r.status)) as any[],
    ).length,
    pending_review: requests.filter((r) => r.status === "pending_review").length,
    awaiting_payment: requests.filter((r) => r.status === "awaiting_additional_payment").length,
    failed_payments: payments.filter((p) => p.status === "failed" && inWindow(p.created_at)).length,
    abandoned_sessions: sessions.filter((s) => s.expires_at < nowISO || s.created_at < startISO)
      .length,
    open_orders: requests.filter((r) => OPEN_STATUSES.includes(r.status)).length,
  };

  // Recent purchases, one row per checkout even when it contains several medicines.
  const recentGroups = clusterPurchases(requests as any[])
    .sort(
      (a, b) =>
        new Date(b[0]?.created_at ?? 0).getTime() - new Date(a[0]?.created_at ?? 0).getTime(),
    )
    .slice(0, 8);
  const recentRaw = recentGroups.map((members) => leadOf(members));
  const medIds = Array.from(
    new Set(
      requests
        .filter((r) => inWindow(r.created_at))
        .map((r) => r.medicine_id)
        .concat(recentRaw.map((r) => r.medicine_id))
        .filter(Boolean),
    ),
  ) as string[];
  const userIds = Array.from(new Set(recentRaw.map((r) => r.user_id).filter(Boolean))) as string[];
  const sessionIds = Array.from(
    new Set(
      recentRaw
        .filter((r) => !r.user_id)
        .map((r) => r.session_id)
        .filter(Boolean),
    ),
  ) as string[];
  const providerIds = Array.from(
    new Set(recentRaw.map((r) => r.provider_id).filter(Boolean)),
  ) as string[];

  const [medsRes, usersRes, sessNamesRes, provsRes] = await Promise.all([
    medIds.length
      ? supabaseAdmin.from("medicines").select("id, name").in("id", medIds)
      : { data: [] },
    userIds.length
      ? supabaseAdmin.from("profiles").select("id, full_name").in("id", userIds)
      : { data: [] },
    sessionIds.length
      ? supabaseAdmin.from("intake_sessions").select("id, full_name").in("id", sessionIds)
      : { data: [] },
    providerIds.length
      ? supabaseAdmin.from("profiles").select("id, full_name").in("id", providerIds)
      : { data: [] },
  ]);

  const medMap = new Map(((medsRes.data ?? []) as Row[]).map((m) => [m.id, m.name]));
  const nameMap = new Map(((usersRes.data ?? []) as Row[]).map((p) => [p.id, p.full_name]));
  const sessMap = new Map(((sessNamesRes.data ?? []) as Row[]).map((p) => [p.id, p.full_name]));
  const provMap = new Map(((provsRes.data ?? []) as Row[]).map((p) => [p.id, p.full_name]));

  const recent = recentGroups.map((members) => {
    const r = leadOf(members);
    const names = [
      ...new Set(
        members
          .map((member) => medMap.get(member.medicine_id) as string | undefined)
          .filter(Boolean),
      ),
    ];
    return {
      id: r.id as string,
      status: r.status as string,
      created_at: r.created_at as string,
      medicine: names.join(", ") || "—",
      patient:
        (r.user_id ? (nameMap.get(r.user_id) as string) : (sessMap.get(r.session_id) as string)) ??
        "Guest",
      provider: r.provider_id ? ((provMap.get(r.provider_id) as string) ?? "—") : null,
    };
  });

  // Top medicines by volume in the window
  const volume = new Map<string, number>();
  for (const r of reqInWindow) {
    if (!r.medicine_id) continue;
    volume.set(r.medicine_id, (volume.get(r.medicine_id) ?? 0) + 1);
  }
  const topMedicines = Array.from(volume.entries())
    .map(([id, count]) => ({ id, name: (medMap.get(id) as string) ?? "—", count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Activity feed
  const adminIds = Array.from(
    new Set(activityRows.map((a) => a.admin_user_id).filter(Boolean)),
  ) as string[];
  const { data: adminProfiles } = adminIds.length
    ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", adminIds)
    : { data: [] };
  const adminMap = new Map(((adminProfiles ?? []) as Row[]).map((p) => [p.id, p.full_name]));
  const activity = activityRows.map((a) => ({
    id: a.id as string,
    action: a.action as string,
    entity: a.entity as string,
    created_at: a.created_at as string,
    admin_name: a.admin_user_id ? ((adminMap.get(a.admin_user_id) as string) ?? null) : null,
  }));

  return {
    days,
    kpis: {
      revenue_cents: revenue,
      revenue_delta: delta(revenue, revenuePrev),
      new_patients: newPatients,
      new_patients_delta: delta(newPatients, newPatientsPrev),
      requests: reqInWindow.length,
      requests_delta: delta(reqInWindow.length, reqPrev.length),
      active_subscriptions: activeSubs,
    },
    attention,
    series,
    byStatus,
    recent,
    topMedicines,
    activity,
  };
}
