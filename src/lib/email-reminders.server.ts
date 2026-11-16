import {
  claimEmailReminder,
  notifyEmailAddress,
  notifyProviderRequestEvent,
  notifyUserById,
  releaseEmailReminder,
  resolveMedicineName,
} from "@/lib/email.notifications";

const DAY_MS = 24 * 60 * 60 * 1000;
const ONBOARDING_LATER_DAYS = 3;
const TZ = "America/New_York";
const CLOSED = new Set(["rejected", "cancelled", "delivered"]);

let sweeping = false;
let lastSweep = 0;

function nyDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addCalendarDays(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return utc.toISOString().slice(0, 10);
}

function formatVisit(when: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(when);
}

async function remindAbandonedOnboarding(supabaseAdmin: any, now: number) {
  const cutoff = new Date(now - DAY_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("intake_sessions")
    .select("id, email, full_name, updated_at, expires_at")
    .eq("status", "payment_pending")
    .is("claimed_by_user_id", null)
    .not("email", "is", null)
    .lt("updated_at", cutoff)
    .gt("updated_at", new Date(now - 5 * DAY_MS).toISOString())
    .gt("expires_at", new Date(now).toISOString())
    .order("updated_at", { ascending: true })
    .limit(80);
  if (error) {
    console.error("[email] onboarding reminder lookup failed:", error.message);
    return;
  }
  for (const row of (data ?? []) as Array<{
    id: string;
    email: string;
    full_name: string | null;
    updated_at: string;
  }>) {
    const age = now - new Date(row.updated_at).getTime();
    const later = age >= ONBOARDING_LATER_DAYS * DAY_MS;
    const periodKey = later ? "few_days" : "next_day";
    if (!(await claimEmailReminder(supabaseAdmin, "onboarding_payment_pending", row.id, periodKey))) {
      continue;
    }
    if (later) {
      await claimEmailReminder(supabaseAdmin, "onboarding_payment_pending", row.id, "next_day");
    }
    const sent = await notifyEmailAddress({
      email: row.email,
      name: row.full_name,
      template: "patient_onboarding_payment",
      params: { IS_LATER: later ? "1" : "0" },
    });
    if (!sent) {
      await releaseEmailReminder(supabaseAdmin, "onboarding_payment_pending", row.id, periodKey);
    }
  }
}

async function remindVisitsTomorrow(supabaseAdmin: any, now: number) {
  const tomorrow = addCalendarDays(nyDateKey(new Date(now)), 1);
  const { data, error } = await supabaseAdmin
    .from("medication_requests")
    .select("id, status, user_id, provider_id, medicine_id, consultation_scheduled_at")
    .eq("consultation_mode", "scheduled")
    .not("consultation_scheduled_at", "is", null)
    .gte("consultation_scheduled_at", new Date(now).toISOString())
    .lte("consultation_scheduled_at", new Date(now + 2 * DAY_MS).toISOString())
    .limit(80);
  if (error) {
    console.error("[email] visit reminder lookup failed:", error.message);
    return;
  }
  for (const row of (data ?? []) as Array<{
    id: string;
    status: string;
    user_id: string | null;
    provider_id: string | null;
    medicine_id: string | null;
    consultation_scheduled_at: string;
  }>) {
    if (CLOSED.has(row.status)) continue;
    const when = new Date(row.consultation_scheduled_at);
    if (nyDateKey(when) !== tomorrow) continue;
    const visitTime = formatVisit(when);
    const medicineName = await resolveMedicineName(supabaseAdmin, row.medicine_id);
    if (row.user_id) {
      if (await claimEmailReminder(supabaseAdmin, "visit_tomorrow", row.id, "patient")) {
        const sent = await notifyUserById({
          supabaseAdmin,
          userId: row.user_id,
          template: "patient_visit_tomorrow",
          params: { MEDICINE_NAME: medicineName, VISIT_TIME: visitTime, ORDER_ID: row.id },
        });
        if (!sent) await releaseEmailReminder(supabaseAdmin, "visit_tomorrow", row.id, "patient");
      }
    }
    if (row.provider_id) {
      if (await claimEmailReminder(supabaseAdmin, "visit_tomorrow", row.id, "provider")) {
        await notifyProviderRequestEvent({
          supabaseAdmin,
          providerId: row.provider_id,
          requestId: row.id,
          medicineId: row.medicine_id,
          template: "provider_visit_tomorrow",
          extraParams: { VISIT_TIME: visitTime, MEDICINE_NAME: medicineName },
        });
      }
    }
  }
}

async function remindUnopenedReviews(supabaseAdmin: any, now: number) {
  const cutoff = new Date(now - DAY_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("medication_requests")
    .select("id, provider_id, medicine_id, updated_at")
    .eq("status", "pending_review")
    .not("provider_id", "is", null)
    .lt("updated_at", cutoff)
    .gt("updated_at", new Date(now - 3 * DAY_MS).toISOString())
    .order("updated_at", { ascending: true })
    .limit(80);
  if (error) {
    console.error("[email] review reminder lookup failed:", error.message);
    return;
  }
  const rows = (data ?? []) as Array<{ id: string; provider_id: string; medicine_id: string | null }>;
  if (!rows.length) return;
  const ids = rows.map((row) => row.id);
  const [{ data: opened }, { data: events }] = await Promise.all([
    supabaseAdmin
      .from("email_reminders")
      .select("target_id")
      .eq("reminder_type", "provider_case_opened")
      .in("target_id", ids),
    supabaseAdmin
      .from("medication_request_events")
      .select("request_id, created_by, actor_role")
      .in("request_id", ids)
      .eq("actor_role", "provider"),
  ]);
  const openedIds = new Set(
    ((opened ?? []) as { target_id: string }[]).map((row) => row.target_id),
  );
  const touched = new Set(
    ((events ?? []) as { request_id: string; created_by: string | null }[])
      .filter((event) => event.created_by)
      .map((event) => `${event.request_id}:${event.created_by}`),
  );
  for (const row of rows) {
    if (openedIds.has(row.id) || touched.has(`${row.id}:${row.provider_id}`)) continue;
    if (!(await claimEmailReminder(supabaseAdmin, "provider_review_waiting", row.id, "day1"))) continue;
    await notifyProviderRequestEvent({
      supabaseAdmin,
      providerId: row.provider_id,
      requestId: row.id,
      medicineId: row.medicine_id,
      template: "provider_review_waiting",
    });
  }
}

/** Daily reminders. Safe to call more than once; each email is claimed before it is sent. */
export async function sendScheduledReminders(
  supabaseAdmin: any,
  opts?: { force?: boolean },
): Promise<void> {
  if (sweeping) return;
  if (!opts?.force && Date.now() - lastSweep < 60 * 60 * 1000) return;
  sweeping = true;
  lastSweep = Date.now();
  try {
    const { expireOverduePlanChanges } = await import("@/lib/plan-change.server");
    await expireOverduePlanChanges(supabaseAdmin);
    const now = Date.now();
    await remindAbandonedOnboarding(supabaseAdmin, now);
    await remindVisitsTomorrow(supabaseAdmin, now);
    await remindUnopenedReviews(supabaseAdmin, now);
  } catch (error) {
    console.error("[email] scheduled reminders failed:", error);
  } finally {
    sweeping = false;
  }
}
