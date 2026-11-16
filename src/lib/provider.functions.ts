import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertProvider } from "@/lib/provider-guard";
import { ageFromDob, bmiFrom } from "@/lib/format";
import { PENDING_REQUEST_STATUSES } from "@/lib/request-status";
import {
  completedIntakeUserIds,
  filledSessionIdSet,
  intakeSessionForOrder,
  loadShopIntakeState,
  orderHasIntake,
  repairOrdersAwaitingIntake,
  shopIntakeReady,
} from "@/lib/clinical-intake";
import {
  CLOSED_ORDER_STATUSES,
  clusterPurchases,
  collapseOrderRows,
  countPurchaseGroups,
  leadOf,
  loadSiblingRows,
  shopCheckoutRequestIdSet,
  userIdsInOpenChat,
} from "@/lib/order-groups";

type Ctx = { supabase: any; userId: string };

// Clinical-only patient projections. Contact details (email, phone), addresses, Stripe ids and
// any money figures are deliberately never selected on the practitioner side.
const PROFILE_CLINICAL_COLS = "id, full_name, dob, sex, state_code";
const SESSION_CLINICAL_COLS =
  "id, full_name, dob, sex, state_code, height_cm, weight_kg, created_at";

const ACTIVE_CONSULT_STATUSES = [
  "payment_completed",
  "provider_assigned",
  "pending_review",
  "awaiting_additional_payment",
  "approved",
  "prescribed",
];

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

// A practitioner may claim an order that still needs a clinician. Orders already sent to the
// pharmacy (or further along fulfillment) are not claimable.
const CLAIMABLE_STATUSES = [
  "payment_completed",
  "provider_assigned",
  "pending_review",
  "awaiting_additional_payment",
  "approved",
  "prescribed",
];

// Patient keys are "u_<user id>" for account holders and "s_<intake session id>" for guests.
function parsePatientKey(key: string): { kind: "user" | "session"; id: string } {
  const kind = key.startsWith("s_") ? "session" : "user";
  return { kind, id: key.slice(2) };
}
export function patientKey(kind: "user" | "session", id: string): string {
  return `${kind === "session" ? "s" : "u"}_${id}`;
}

export const providerDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertProvider(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const me = context.userId;
    const { expireOverduePlanChanges } = await import("@/lib/plan-change.server");
    await expireOverduePlanChanges(supabaseAdmin, me);

    const { data: rows } = await supabaseAdmin
      .from("medication_requests")
      .select(
        "id, status, created_at, updated_at, user_id, session_id, subscription_id, provider_id, kind, order_group_id",
      )
      .eq("provider_id", me)
      .limit(1000);

    const list = (rows ?? []) as any[];
    await repairOrdersAwaitingIntake(supabaseAdmin, list);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const sessionIds = list.map((row) => row.session_id).filter(Boolean);
    const userIds = list.map((row) => row.user_id).filter(Boolean);
    const [filledSessions, completedUsers, shopIntake] = await Promise.all([
      filledSessionIdSet(supabaseAdmin, sessionIds),
      completedIntakeUserIds(supabaseAdmin, userIds),
      loadShopIntakeState(
        supabaseAdmin,
        list.map((row) => row.id),
      ),
    ]);
    const intakeReady = (row: any) =>
      shopIntake.shopIds.has(row.id)
        ? shopIntakeReady(shopIntake.byRequest.get(row.id))
        : Boolean(row.session_id && filledSessions.has(row.session_id)) ||
          Boolean(row.user_id && completedUsers.has(row.user_id));
    const hiddenUntilIntake = new Set([
      "payment_completed",
      "provider_assigned",
      "pending_review",
      "awaiting_additional_payment",
    ]);

    const counts = {
      pending_review: countPurchaseGroups(
        list,
        (r) => r.status === "pending_review" && intakeReady(r),
      ),
      awaiting_additional_payment: countPurchaseGroups(
        list,
        (r) => r.status === "awaiting_additional_payment" && intakeReady(r),
      ),
      approved: countPurchaseGroups(
        list,
        (r) => r.status === "approved" || r.status === "prescribed",
      ),
      prescribed_today: countPurchaseGroups(
        list,
        (r) => r.status === "prescribed" && new Date(r.updated_at) >= startOfDay,
      ),
      open: countPurchaseGroups(
        list,
        (r) => OPEN_STATUSES.includes(r.status) && (intakeReady(r) || !hiddenUntilIntake.has(r.status)),
      ),
    };

    const claimable = await countClaimable(supabaseAdmin, me);
    const launchpad = await providerLaunchpad(supabaseAdmin, me);
    try {
      const { notifyProvidersPatientReadyToClaim } = await import("@/lib/email.notifications");
      await notifyProvidersPatientReadyToClaim(supabaseAdmin);
    } catch (e) {
      console.error("[dashboard] provider claim email failed:", e);
    }

    const { data: meProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", me)
      .maybeSingle();

    return { ...counts, claimable, full_name: meProfile?.full_name ?? "", ...launchpad };
  });

async function providerStates(supabaseAdmin: any, me: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("providers")
    .select("license_states")
    .eq("id", me)
    .maybeSingle();
  return ((data?.license_states ?? []) as string[]).map((s) => String(s).toUpperCase());
}

// Unassigned open orders whose patient state is covered by this provider's licences.
async function loadClaimable(
  supabaseAdmin: any,
  me: string,
  statuses: readonly string[] = CLAIMABLE_STATUSES,
): Promise<any[]> {
  const states = await providerStates(supabaseAdmin, me);
  if (states.length === 0) return [];

  const { data: rows } = await supabaseAdmin
    .from("medication_requests")
    .select(
      "id, user_id, session_id, medicine_id, kind, status, requires_consultation, created_at, claim_locked_by, claim_locked_at, order_group_id, subscription_id, stripe_invoice_id",
    )
    .is("provider_id", null)
    .in("status", [...statuses])
    .order("created_at", { ascending: false })
    .limit(300);

  let list = (rows ?? []) as any[];
  const groupIds = Array.from(new Set(list.map((r) => r.order_group_id).filter(Boolean)));
  if (groupIds.length) {
    const { data: taken } = await supabaseAdmin
      .from("medication_requests")
      .select("order_group_id")
      .in("order_group_id", groupIds)
      .not("provider_id", "is", null);
    const takenGroups = new Set((taken ?? []).map((r: any) => r.order_group_id).filter(Boolean));
    list = list.filter((r) => !r.order_group_id || !takenGroups.has(r.order_group_id));
  }
  if (list.length === 0) return [];

  const userIds = Array.from(new Set(list.map((r) => r.user_id).filter(Boolean)));
  const sessionIds = Array.from(new Set(list.map((r) => r.session_id).filter(Boolean)));
  const medIds = Array.from(new Set(list.map((r) => r.medicine_id).filter(Boolean)));

  const [{ data: profiles }, { data: sessions }, { data: meds }, filledSessions, completedUsers, openChat, shopIds, shopIntake] =
    await Promise.all([
    userIds.length
      ? supabaseAdmin.from("profiles").select("id, full_name, state_code, dob").in("id", userIds)
      : Promise.resolve({ data: [] as any[] }),
    sessionIds.length
      ? supabaseAdmin
          .from("intake_sessions")
          .select("id, full_name, state_code, dob")
          .in("id", sessionIds)
      : Promise.resolve({ data: [] as any[] }),
    medIds.length
      ? supabaseAdmin.from("medicines").select("id, name").in("id", medIds)
      : Promise.resolve({ data: [] as any[] }),
    filledSessionIdSet(supabaseAdmin, sessionIds),
    completedIntakeUserIds(supabaseAdmin, userIds),
    userIdsInOpenChat(supabaseAdmin, userIds),
    shopCheckoutRequestIdSet(supabaseAdmin, list),
    loadShopIntakeState(
      supabaseAdmin,
      list.map((row) => row.id),
    ),
  ]);

  const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  const sMap = new Map((sessions ?? []).map((s: any) => [s.id, s]));
  const medMap = new Map((meds ?? []).map((m: any) => [m.id, m.name]));

  const ready = list
    .map((r) => {
      const p: any = pMap.get(r.user_id);
      const sess: any = !p ? sMap.get(r.session_id) : null;
      const state = (p?.state_code ?? sess?.state_code ?? null) as string | null;
      const intakeFilled = shopIntake.shopIds.has(r.id)
        ? shopIntakeReady(shopIntake.byRequest.get(r.id))
        : Boolean(
            (r.session_id && filledSessions.has(r.session_id)) ||
              (r.user_id && completedUsers.has(r.user_id)),
          );
      return {
        id: r.id,
        user_id: r.user_id ?? null,
        session_id: r.session_id ?? null,
        order_group_id: r.order_group_id ?? null,
        patient_name: p?.full_name ?? sess?.full_name ?? "Patient",
        patient_id: p?.id ?? sess?.id ?? null,
        dob: p?.dob ?? sess?.dob ?? null,
        state_code: state,
        medicine_name: String(medMap.get(r.medicine_id) ?? "—"),
        kind: r.kind,
        status: r.status,
        requires_consultation: r.requires_consultation,
        intake_filled: intakeFilled,
        in_chat: Boolean(r.user_id && openChat.has(r.user_id)),
        from_shop: shopIds.has(r.id),
        claim_locked_by: r.claim_locked_by ?? null,
        claim_locked_at: r.claim_locked_at ?? null,
        created_at: r.created_at,
      };
    })
    .filter(
      (r) =>
        r.intake_filled &&
        (r.in_chat || r.from_shop) &&
        !!r.state_code &&
        states.includes(String(r.state_code).toUpperCase()),
    );

  return collapseOrderRows(ready).map(({ user_id: _user, session_id: _session, ...row }) => row);
}

async function countClaimable(
  supabaseAdmin: any,
  me: string,
  statuses: readonly string[] = CLAIMABLE_STATUSES,
): Promise<number> {
  const rows = await loadClaimable(supabaseAdmin, me, statuses);
  return rows.length;
}

/** True when this unassigned open request is in one of the provider's licensed states. */
async function canClaimRequest(
  supabaseAdmin: any,
  me: string,
  requestId: string,
): Promise<boolean> {
  const states = await providerStates(supabaseAdmin, me);
  if (states.length === 0) return false;

  const { data: req } = await supabaseAdmin
    .from("medication_requests")
    .select("id, user_id, session_id, provider_id, status")
    .eq("id", requestId)
    .maybeSingle();

  if (!req || req.provider_id || !CLAIMABLE_STATUSES.includes(req.status)) return false;

  let state: string | null = null;
  if (req.user_id) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("state_code")
      .eq("id", req.user_id)
      .maybeSingle();
    state = profile?.state_code ?? null;
  }
  if (!state && req.session_id) {
    const { data: session } = await supabaseAdmin
      .from("intake_sessions")
      .select("state_code")
      .eq("id", req.session_id)
      .maybeSingle();
    state = session?.state_code ?? null;
  }

  return !!state && states.includes(String(state).toUpperCase());
}

export const providerSidebarCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertProvider(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const me = context.userId;
    // Badges count work that still needs a decision. Approved, prescribed, shipped,
    // and "waiting on the patient" orders stay on the lists but drop off the badge.
    const [{ data: pendingRows, error }, queue] = await Promise.all([
      supabaseAdmin
        .from("medication_requests")
        .select("id, session_id, user_id, subscription_id, provider_id, status")
        .eq("provider_id", me)
        .in("status", [...PENDING_REQUEST_STATUSES]),
      countClaimable(supabaseAdmin, me, PENDING_REQUEST_STATUSES),
    ]);
    if (error) throw new Error(error.message);
    const pending = (pendingRows ?? []) as {
      id: string;
      session_id: string | null;
      user_id: string | null;
      subscription_id: string | null;
      provider_id: string | null;
      status: string | null;
    }[];
    await repairOrdersAwaitingIntake(supabaseAdmin, pending);
    const sessionIds = pending.map((row) => row.session_id).filter(Boolean) as string[];
    const userIds = pending.map((row) => row.user_id).filter(Boolean) as string[];
    const [filledSessions, completedUsers, shopIntake] = await Promise.all([
      filledSessionIdSet(supabaseAdmin, sessionIds),
      completedIntakeUserIds(supabaseAdmin, userIds),
      loadShopIntakeState(
        supabaseAdmin,
        pending.map((row) => row.id),
      ),
    ]);
    const requests = pending.filter((row) =>
      shopIntake.shopIds.has(row.id)
        ? shopIntakeReady(shopIntake.byRequest.get(row.id))
        : Boolean(row.session_id && filledSessions.has(row.session_id)) ||
          Boolean(row.user_id && completedUsers.has(row.user_id)),
    ).length;
    return { requests, queue };
  });

export const listClaimableRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ search: z.string().trim().max(200).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertProvider(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let rows = await loadClaimable(supabaseAdmin, context.userId);
    if (data.search) {
      const s = data.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.patient_name.toLowerCase().includes(s) ||
          String(r.medicine_name).toLowerCase().includes(s) ||
          r.id.toLowerCase().includes(s) ||
          (r.order_item_ids ?? []).some((id: string) => id.toLowerCase().includes(s)),
      );
    }
    return rows;
  });

// Claim a single unassigned order for myself. Racy claims lose: the update is conditional on the
// order still having no provider.
export const claimRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertProvider(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const me = context.userId;

    if (!(await canClaimRequest(supabaseAdmin, me, data.requestId))) {
      throw new Error(
        "This order is no longer available to claim, or is outside your licensed states.",
      );
    }

    const { data: current } = await supabaseAdmin
      .from("medication_requests")
      .select("id, status, user_id, medicine_id, session_id, subscription_id, stripe_invoice_id, kind")
      .eq("id", data.requestId)
      .maybeSingle();

    const shopIntake = current
      ? await loadShopIntakeState(supabaseAdmin, [current.id])
      : { shopIds: new Set<string>(), byRequest: new Map() };
    const fromShop = Boolean(current && shopIntake.shopIds.has(current.id));
    if (current && fromShop) {
      const decision = shopIntake.byRequest.get(current.id);
      const finished = decision?.finishedSessionId ?? null;
      if (!shopIntakeReady(decision)) throw new Error("intake form missing");
      if (finished && current.session_id !== finished) {
        current.session_id = finished;
        await supabaseAdmin.from("medication_requests").update({ session_id: finished }).eq("id", current.id);
        if (current.subscription_id) {
          await supabaseAdmin
            .from("subscriptions")
            .update({ session_id: finished })
            .eq("id", current.subscription_id);
        }
      }
    } else if (!(await orderHasIntake(supabaseAdmin, current?.session_id, current?.user_id))) {
      throw new Error("intake form missing");
    } else if (current && !current.session_id) {
      const sessionId = await intakeSessionForOrder(
        supabaseAdmin,
        current.session_id,
        current.user_id,
      );
      if (sessionId) {
        current.session_id = sessionId;
        await supabaseAdmin
          .from("medication_requests")
          .update({ session_id: sessionId })
          .eq("id", current.id)
          .is("session_id", null);
        if (current.subscription_id) {
          await supabaseAdmin
            .from("subscriptions")
            .update({ session_id: sessionId })
            .eq("id", current.subscription_id)
            .is("session_id", null);
        }
      }
    }
    if (
      !fromShop &&
      (!current?.user_id || !(await userIdsInOpenChat(supabaseAdmin, [current.user_id])).has(current.user_id))
    ) {
      throw new Error("This patient is not in chat.");
    }

    const { data: meProv, error: unavailErr } = await supabaseAdmin
      .from("providers")
      .select("is_unavailable")
      .eq("id", me)
      .maybeSingle();
    if (unavailErr && !/is_unavailable/i.test(unavailErr.message)) throw new Error(unavailErr.message);
    if (meProv?.is_unavailable) {
      throw new Error("You are marked unavailable. Turn availability back on before claiming an order.");
    }

    const nowIso = new Date().toISOString();
    const lockCutoff = new Date(Date.now() - 45_000).toISOString();
    const { data: locked, error: lockErr } = await supabaseAdmin
      .from("medication_requests")
      .update({ claim_locked_by: me, claim_locked_at: nowIso, updated_at: nowIso })
      .eq("id", data.requestId)
      .is("provider_id", null)
      .or(`claim_locked_at.is.null,claim_locked_at.lt."${lockCutoff}",claim_locked_by.eq.${me}`)
      .select("id")
      .maybeSingle();
    if (lockErr) throw new Error(lockErr.message);
    if (!locked) {
      throw new Error("This order is locked while another practitioner claims it.");
    }

    const nextStatus =
      current?.status === "payment_completed" || current?.status === "provider_assigned"
        ? "pending_review"
        : undefined;

    const { data: updated, error } = await supabaseAdmin
      .from("medication_requests")
      .update({
        provider_id: me,
        claim_locked_by: null,
        claim_locked_at: null,
        updated_at: new Date().toISOString(),
        ...(nextStatus ? { status: nextStatus } : {}),
      })
      .eq("id", data.requestId)
      .eq("claim_locked_by", me)
      .is("provider_id", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) {
      await supabaseAdmin
        .from("medication_requests")
        .update({ claim_locked_by: null, claim_locked_at: null })
        .eq("id", data.requestId)
        .eq("claim_locked_by", me);
      throw new Error("Another practitioner just claimed this order.");
    }

    await supabaseAdmin.from("medication_request_events").insert({
      request_id: data.requestId,
      status: "provider_assigned",
      actor_role: "provider",
      created_by: me,
      note: "Claimed by practitioner",
    });

    const siblings = (await loadSiblingRows(supabaseAdmin, data.requestId)).filter(
      (row) =>
        row.id !== data.requestId &&
        !row.provider_id &&
        !CLOSED_ORDER_STATUSES.includes(row.status),
    );
    if (siblings.length) {
      const siblingIds = siblings.map((row) => row.id);
      const now = new Date().toISOString();
      await supabaseAdmin
        .from("medication_requests")
        .update({
          provider_id: me,
          claim_locked_by: null,
          claim_locked_at: null,
          updated_at: now,
        })
        .in("id", siblingIds)
        .is("provider_id", null);
      const early = siblings.filter((row) =>
        ["payment_completed", "provider_assigned"].includes(row.status),
      );
      if (early.length) {
        await supabaseAdmin
          .from("medication_requests")
          .update({ status: "pending_review", updated_at: now })
          .in(
            "id",
            early.map((row) => row.id),
          )
          .eq("provider_id", me);
      }
      await supabaseAdmin.from("medication_request_events").insert(
        siblings.map((row) => ({
          request_id: row.id,
          status: "provider_assigned",
          actor_role: "provider",
          created_by: me,
          note: "Claimed with the rest of this order",
        })),
      );
    }

    void import("@/lib/email.notifications")
      .then(async ({ notifyPatientRequestEvent }) => {
        const portalBase = process.env.PATIENT_PORTAL_URL?.replace(/\/$/, "") ?? "";
        await notifyPatientRequestEvent({
          supabaseAdmin,
          request: {
            id: data.requestId,
            user_id: current?.user_id,
            medicine_id: current?.medicine_id,
          },
          template: "patient_provider_assigned",
          extraParams: {
            PORTAL_URL: portalBase ? `${portalBase}/consultations` : "",
          },
        });
      })
      .catch((e) => console.error("[claimRequest] patient email failed:", e));

    return { ok: true };
  });

export const listMyPatients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ search: z.string().trim().max(200).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertProvider(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows } = await supabaseAdmin
      .from("medication_requests")
      .select("id, user_id, session_id, medicine_id, status, created_at")
      .eq("provider_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(500);

    const list = (rows ?? []) as any[];
    const userIds = Array.from(new Set(list.map((r) => r.user_id).filter(Boolean)));
    const sessionIds = Array.from(
      new Set(
        list
          .filter((r) => !r.user_id)
          .map((r) => r.session_id)
          .filter(Boolean),
      ),
    );
    const medIds = Array.from(new Set(list.map((r) => r.medicine_id).filter(Boolean)));

    const [{ data: profiles }, { data: sessions }, { data: meds }] = await Promise.all([
      userIds.length
        ? supabaseAdmin.from("profiles").select(PROFILE_CLINICAL_COLS).in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),
      sessionIds.length
        ? supabaseAdmin.from("intake_sessions").select(SESSION_CLINICAL_COLS).in("id", sessionIds)
        : Promise.resolve({ data: [] as any[] }),
      medIds.length
        ? supabaseAdmin.from("medicines").select("id, name").in("id", medIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const sMap = new Map((sessions ?? []).map((s: any) => [s.id, s]));
    const medMap = new Map((meds ?? []).map((m: any) => [m.id, m.name]));

    const byKey = new Map<string, any>();
    for (const r of list) {
      const p: any = pMap.get(r.user_id);
      const sess: any = !p ? sMap.get(r.session_id) : null;
      const src = p ?? sess;
      if (!src) continue;
      const key = patientKey(p ? "user" : "session", src.id);
      const existing = byKey.get(key);
      if (existing) {
        existing.order_count += 1;
        continue;
      }
      byKey.set(key, {
        key,
        name: src.full_name ?? "Patient",
        patient_id: src.id,
        is_guest: !p,
        sex: src.sex ?? null,
        dob: src.dob ?? null,
        age: ageFromDob(src.dob),
        state_code: src.state_code ?? null,
        latest_medicine: medMap.get(r.medicine_id) ?? "—",
        latest_status: r.status,
        last_order_at: r.created_at,
        order_count: 1,
      });
    }

    let result = Array.from(byKey.values());
    if (data.search) {
      const s = data.search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(s) ||
          String(p.latest_medicine).toLowerCase().includes(s) ||
          String(p.state_code ?? "")
            .toLowerCase()
            .includes(s) ||
          p.key.toLowerCase().includes(s) ||
          String(p.dob ?? "")
            .toLowerCase()
            .includes(s),
      );
    }
    return result;
  });

export const getMyPatient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ key: z.string().trim().min(3).max(80) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertProvider(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const me = context.userId;
    const { kind, id } = parsePatientKey(data.key);

    // Access control: the practitioner must own at least one order for this patient.
    const scopeCol = kind === "user" ? "user_id" : "session_id";
    const { data: myOrders } = await supabaseAdmin
      .from("medication_requests")
      .select(
        "id, medicine_id, package_id, kind, status, requires_consultation, created_at, session_id, user_id",
      )
      .eq("provider_id", me)
      .eq(scopeCol, id)
      .order("created_at", { ascending: false })
      .limit(100);
    const orders = (myOrders ?? []) as any[];
    if (orders.length === 0) throw new Error("Patient not found.");

    const src =
      kind === "user"
        ? (
            await supabaseAdmin
              .from("profiles")
              .select(PROFILE_CLINICAL_COLS)
              .eq("id", id)
              .maybeSingle()
          ).data
        : (
            await supabaseAdmin
              .from("intake_sessions")
              .select(SESSION_CLINICAL_COLS)
              .eq("id", id)
              .maybeSingle()
          ).data;
    if (!src) throw new Error("Patient not found.");

    // Clinical intake: for account holders find the session they claimed; guests already are one.
    let session: any = kind === "session" ? src : null;
    if (!session) {
      session = (
        await supabaseAdmin
          .from("intake_sessions")
          .select(SESSION_CLINICAL_COLS)
          .eq("claimed_by_user_id", id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data;
    }
    if (!session) {
      const sessionIdFromOrder = orders.find((o) => o.session_id)?.session_id;
      if (sessionIdFromOrder) {
        session = (
          await supabaseAdmin
            .from("intake_sessions")
            .select(SESSION_CLINICAL_COLS)
            .eq("id", sessionIdFromOrder)
            .maybeSingle()
        ).data;
      }
    }

    let goals: string[] = [];
    let eligibility: any[] = [];
    let answers: any[] = [];
    if (session) {
      const [{ data: cats }, { data: elig }, { data: resp }] = await Promise.all([
        supabaseAdmin
          .from("intake_session_categories")
          .select("medication_categories(name)")
          .eq("session_id", session.id),
        supabaseAdmin
          .from("intake_session_eligibility_results")
          .select("result, reason, evaluated_at, medicines(name)")
          .eq("session_id", session.id)
          .order("evaluated_at", { ascending: false }),
        supabaseAdmin
          .from("intake_session_questionnaire_responses")
          .select(
            "id, answer_text, answer_number, answer_boolean, answer_option_ids, created_at, questionnaire_questions(prompt, question_type)",
          )
          .eq("session_id", session.id)
          .order("created_at", { ascending: true }),
      ]);
      goals = ((cats ?? []) as any[])
        .map((c) => c.medication_categories?.name)
        .filter(Boolean) as string[];
      eligibility = ((elig ?? []) as any[]).map((e) => ({
        medicine_name: e.medicines?.name ?? "—",
        result: e.result,
        reason: e.reason,
        evaluated_at: e.evaluated_at,
      }));

      const optionIds = Array.from(
        new Set(((resp ?? []) as any[]).flatMap((r) => r.answer_option_ids ?? [])),
      );
      const { data: opts } = optionIds.length
        ? await supabaseAdmin
            .from("questionnaire_question_options")
            .select("id, label")
            .in("id", optionIds)
        : { data: [] as any[] };
      const optMap = new Map((opts ?? []).map((o: any) => [o.id, o.label]));

      answers = ((resp ?? []) as any[]).map((r) => {
        const chosen = (r.answer_option_ids ?? [])
          .map((oid: string) => optMap.get(oid))
          .filter(Boolean);
        const value =
          chosen.length > 0
            ? chosen.join(", ")
            : (r.answer_text ??
              (r.answer_number != null ? String(r.answer_number) : null) ??
              (r.answer_boolean != null ? (r.answer_boolean ? "Yes" : "No") : null));
        return {
          id: r.id,
          prompt: r.questionnaire_questions?.prompt ?? "Question",
          answer: value ?? "—",
        };
      });
    }

    const medIds = Array.from(new Set(orders.map((o) => o.medicine_id).filter(Boolean)));
    const pkgIds = Array.from(new Set(orders.map((o) => o.package_id).filter(Boolean)));
    const [{ data: meds }, { data: pkgs }, { data: rxs }] = await Promise.all([
      medIds.length
        ? supabaseAdmin.from("medicines").select("id, name").in("id", medIds)
        : Promise.resolve({ data: [] as any[] }),
      pkgIds.length
        ? supabaseAdmin.from("packages").select("id, name, duration_months").in("id", pkgIds)
        : Promise.resolve({ data: [] as any[] }),
      supabaseAdmin
        .from("prescriptions")
        .select("id, medicine_name, directions, status, created_at")
        .in(
          "request_id",
          orders.map((o) => o.id),
        )
        .order("created_at", { ascending: false }),
    ]);
    const medMap = new Map((meds ?? []).map((m: any) => [m.id, m.name]));
    const pkgMap = new Map((pkgs ?? []).map((p: any) => [p.id, p]));

    return {
      key: data.key,
      patient: {
        id: src.id,
        name: src.full_name ?? "Patient",
        is_guest: kind === "session",
        sex: src.sex ?? null,
        dob: src.dob ?? null,
        age: ageFromDob(src.dob),
        state_code: src.state_code ?? null,
        height_cm: session?.height_cm ?? null,
        weight_kg: session?.weight_kg ?? null,
        bmi: bmiFrom(session?.height_cm, session?.weight_kg),
      },
      goals,
      eligibility,
      answers,
      orders: orders.map((o) => ({
        id: o.id,
        medicine_name: medMap.get(o.medicine_id) ?? "—",
        plan_name: (pkgMap.get(o.package_id) as any)?.name ?? null,
        kind: o.kind,
        status: o.status,
        created_at: o.created_at,
      })),
      prescriptions: rxs ?? [],
    };
  });

export const getMyProviderProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertProvider(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const me = context.userId;

    const [{ data: prov }, { data: profile }] = await Promise.all([
      supabaseAdmin.from("providers").select("*").eq("id", me).maybeSingle(),
      supabaseAdmin
        .from("profiles")
        .select("full_name, email, avatar_url")
        .eq("id", me)
        .maybeSingle(),
    ]);
    if (!prov) throw new Error("Practitioner record not found.");

    return {
      full_name: (profile as any)?.full_name ?? "",
      email: (profile as any)?.email ?? "",
      avatar_url: (profile as any)?.avatar_url ?? null,
      bio: prov.bio ?? "",
      credentials: prov.credentials ?? "",
      specialty: prov.specialty ?? "",
      languages: (prov.languages ?? []) as string[],
      consultation_types: (prov.consultation_types ?? []) as string[],
      years_experience: prov.years_experience ?? null,
      license_states: (prov.license_states ?? []) as string[],
      // Read-only, admin-controlled:
      license_number: prov.license_number ?? null,
      npi: prov.npi ?? null,
      dea: prov.dea ?? null,
      is_active: prov.is_active,
      availability_note: prov.availability_note ?? "",
      is_unavailable: Boolean(prov.is_unavailable),
    };
  });

const profileInput = z.object({
  full_name: z.string().trim().min(2).max(120),
  avatar_url: z.string().trim().url().max(500).nullable().optional(),
  bio: z.string().trim().max(2000).optional(),
  credentials: z.string().trim().max(200).optional(),
  specialty: z.string().trim().max(200).optional(),
  years_experience: z.number().int().min(0).max(80).nullable().optional(),
  languages: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  consultation_types: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  license_states: z
    .array(
      z
        .string()
        .trim()
        .length(2)
        .regex(/^[A-Za-z]{2}$/),
    )
    .max(60)
    .optional(),
  availability_note: z.string().trim().max(2000).optional(),
  is_unavailable: z.boolean().optional(),
});

// A practitioner may edit their presentation fields plus their licensed states. NPI, DEA, licence
// number and active status stay admin-controlled and are never read from this input.
export const updateMyProviderProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => profileInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertProvider(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const me = context.userId;

    const { error: profErr } = await supabaseAdmin
      .from("profiles")
      .update({
        full_name: data.full_name,
        ...(data.avatar_url !== undefined ? { avatar_url: data.avatar_url } : {}),
      })
      .eq("id", me);
    if (profErr) throw new Error(profErr.message);

    const { error: provErr } = await supabaseAdmin
      .from("providers")
      .update({
        bio: data.bio ?? null,
        credentials: data.credentials ?? null,
        specialty: data.specialty ?? null,
        years_experience: data.years_experience ?? null,
        languages: data.languages ?? [],
        consultation_types: data.consultation_types ?? [],
        ...(data.availability_note !== undefined
          ? { availability_note: data.availability_note || null }
          : {}),
        ...(data.is_unavailable !== undefined ? { is_unavailable: data.is_unavailable } : {}),
        ...(data.license_states
          ? {
              license_states: Array.from(new Set(data.license_states.map((s) => s.toUpperCase()))),
              practice_states: Array.from(new Set(data.license_states.map((s) => s.toUpperCase()))),
            }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", me);
    if (provErr) throw new Error(provErr.message);
    const released = data.is_unavailable ? await releaseUnreviewed(supabaseAdmin, me) : 0;
    return { ok: true, released };
  });

type WorkItem = {
  id: string;
  patient_name: string;
  patient_id: string | null;
  dob: string | null;
  medicine_name: string;
  status: string;
  plan_change_delta_cents: number | null;
  requires_consultation: boolean;
  consultation_status: "Not required" | "Required" | "In progress" | "Completed";
  consultation_mode: "instant" | "scheduled";
  consultation_scheduled_at: string | null;
  patient_waiting: boolean;
  priority: number;
};

async function loadAssignedWork(supabaseAdmin: any, me: string): Promise<WorkItem[]> {
  const { data: rows } = await supabaseAdmin
    .from("medication_requests")
    .select(
      "id, status, plan_change_delta_cents, requires_consultation, user_id, session_id, subscription_id, provider_id, medicine_id, kind, created_at, consultation_mode, consultation_scheduled_at, order_group_id",
    )
    .eq("provider_id", me)
    .in("status", ACTIVE_CONSULT_STATUSES)
    .order("created_at", { ascending: false })
    .limit(200);

  const list = (rows ?? []) as any[];
  if (list.length === 0) return [];
  await repairOrdersAwaitingIntake(supabaseAdmin, list);

  const userIds = Array.from(new Set(list.map((r) => r.user_id).filter(Boolean)));
  const sessionIds = Array.from(
    new Set(list.filter((r) => !r.user_id).map((r) => r.session_id).filter(Boolean)),
  );
  const medIds = Array.from(new Set(list.map((r) => r.medicine_id).filter(Boolean)));

  const allSessionIds = Array.from(new Set(list.map((r) => r.session_id).filter(Boolean)));
  const [{ data: profiles }, { data: sessions }, { data: meds }, { data: consults }, filledSessions, completedUsers, shopIntake] =
    await Promise.all([
      userIds.length
        ? supabaseAdmin.from("profiles").select("id, full_name, dob").in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),
      sessionIds.length
        ? supabaseAdmin.from("intake_sessions").select("id, full_name, dob").in("id", sessionIds)
        : Promise.resolve({ data: [] as any[] }),
      medIds.length
        ? supabaseAdmin
            .from("medicines")
            .select("id, name, requires_consultation")
            .in("id", medIds)
        : Promise.resolve({ data: [] as any[] }),
      userIds.length
        ? supabaseAdmin
            .from("patient_consultations")
            .select("user_id, ended_at, started_at")
            .in("user_id", userIds)
            .order("started_at", { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
      filledSessionIdSet(supabaseAdmin, allSessionIds),
      completedIntakeUserIds(supabaseAdmin, userIds),
      loadShopIntakeState(
        supabaseAdmin,
        list.map((row) => row.id),
      ),
    ]);
  const ready = list.filter((r) => {
    if (!r.provider_id) return false;
    if (shopIntake.shopIds.has(r.id)) {
      return shopIntakeReady(shopIntake.byRequest.get(r.id));
    }
    return (
      Boolean(r.session_id && filledSessions.has(r.session_id)) ||
      Boolean(r.user_id && completedUsers.has(r.user_id))
    );
  });

  const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  const sMap = new Map((sessions ?? []).map((s: any) => [s.id, s]));
  const medMap = new Map((meds ?? []).map((m: any) => [m.id, m]));
  const consultByUser = new Map<string, { ended_at: string | null }>();
  for (const row of (consults ?? []) as any[]) {
    const prev = consultByUser.get(row.user_id);
    if (!prev) consultByUser.set(row.user_id, { ended_at: row.ended_at ?? null });
    else if (!row.ended_at) consultByUser.set(row.user_id, { ended_at: null });
  }

  return clusterPurchases(ready).map((members) => {
    const r = leadOf(members);
    const profile = pMap.get(r.user_id) as any;
    const session = !profile ? (sMap.get(r.session_id) as any) : null;
    const consult = r.user_id ? consultByUser.get(r.user_id) : undefined;
    const requires = members.some((member) => {
      const med = medMap.get(member.medicine_id) as { requires_consultation?: boolean } | undefined;
      return med ? Boolean(med.requires_consultation) : Boolean(member.requires_consultation);
    });
    let consultation_status: WorkItem["consultation_status"] = "Not required";
    if (requires) {
      if (!consult) consultation_status = "Required";
      else if (!consult.ended_at) consultation_status = "In progress";
      else consultation_status = "Completed";
    }
    const patient_waiting = consultation_status === "In progress";
    const priority = patient_waiting
      ? 0
      : r.status === "approved" || r.status === "prescribed"
        ? 1
        : 2;
    const names = [
      ...new Set(
        members
          .map((member) => String((medMap.get(member.medicine_id) as { name?: string } | undefined)?.name ?? ""))
          .filter(Boolean),
      ),
    ];
    const scheduled = members.find((member) => member.consultation_mode === "scheduled");
    return {
      id: r.id,
      patient_name: profile?.full_name ?? session?.full_name ?? "Patient",
      patient_id: profile?.id ?? session?.id ?? null,
      dob: profile?.dob ?? session?.dob ?? null,
      medicine_name: names.join(", ") || "—",
      status: r.status,
      plan_change_delta_cents: r.plan_change_delta_cents ?? null,
      requires_consultation: requires,
      consultation_status,
      consultation_mode: scheduled ? "scheduled" : "instant",
      consultation_scheduled_at: scheduled?.consultation_scheduled_at ?? r.consultation_scheduled_at ?? null,
      patient_waiting,
      priority,
    };
  });
}

async function providerLaunchpad(supabaseAdmin: any, me: string) {
  const work = await loadAssignedWork(supabaseAdmin, me);
  const ranked = [...work].sort((a, b) => a.priority - b.priority || a.patient_name.localeCompare(b.patient_name));
  const next =
    ranked.find((row) => row.patient_waiting) ??
    ranked.find(
      (row) =>
        (row.requires_consultation || row.consultation_mode === "scheduled") &&
        row.consultation_status !== "Completed",
    ) ??
    null;
  return {
    next_consultation: next,
    priority: ranked.slice(0, 8),
    consultation_count: work.filter(showsInConsultationWindow).length,
  };
}

function showsInConsultationWindow(row: WorkItem) {
  return (
    row.consultation_mode === "scheduled" ||
    row.requires_consultation ||
    row.consultation_status === "In progress" ||
    row.consultation_status === "Required"
  );
}

/** Assigned patients with a required, in-progress, or scheduled consultation. */
export const listConsultationWindow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertProvider(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const work = await loadAssignedWork(supabaseAdmin, context.userId);
    return work.filter(showsInConsultationWindow);
  });

export const listConsultationHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertProvider(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const me = context.userId;
    const { data: orders } = await supabaseAdmin
      .from("medication_requests")
      .select("id, user_id, medicine_id")
      .eq("provider_id", me)
      .not("user_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    const list = (orders ?? []) as any[];
    const userIds = Array.from(new Set(list.map((r) => r.user_id).filter(Boolean)));
    if (userIds.length === 0) return [];

    const { data: consults, error } = await supabaseAdmin
      .from("patient_consultations")
      .select("id, user_id, started_at, ended_at")
      .in("user_id", userIds)
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: false })
      .limit(100);
    if (error) {
      if (/ended_at/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    const rows = (consults ?? []) as any[];
    if (rows.length === 0) return [];

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, dob")
      .in("id", Array.from(new Set(rows.map((r) => r.user_id))));
    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const orderByUser = new Map<string, any>();
    for (const order of list) {
      if (!orderByUser.has(order.user_id)) orderByUser.set(order.user_id, order);
    }
    const medIds = Array.from(
      new Set([...orderByUser.values()].map((o: any) => o.medicine_id).filter(Boolean)),
    );
    const { data: meds } = medIds.length
      ? await supabaseAdmin.from("medicines").select("id, name").in("id", medIds)
      : { data: [] as any[] };
    const medMap = new Map((meds ?? []).map((m: any) => [m.id, m.name]));

    return rows.map((row) => {
      const order = orderByUser.get(row.user_id);
      const profile = pMap.get(row.user_id) as any;
      return {
        id: row.id,
        request_id: order?.id ?? null,
        patient_name: profile?.full_name ?? "Patient",
        patient_id: row.user_id,
        dob: profile?.dob ?? null,
        medicine_name: order ? (medMap.get(order.medicine_id) ?? "—") : "—",
        started_at: row.started_at,
        ended_at: row.ended_at,
      };
    });
  });

async function releaseUnreviewed(supabaseAdmin: any, me: string) {
  const now = new Date().toISOString();
  const base = () =>
    supabaseAdmin
      .from("medication_requests")
      .update({ provider_id: null, updated_at: now })
      .eq("provider_id", me)
      .in("status", ["pending_review", "provider_assigned", "payment_completed"])
      .select("id, status");
  let { data: rows, error } = await supabaseAdmin
    .from("medication_requests")
    .update({
      provider_id: null,
      claim_locked_by: null,
      claim_locked_at: null,
      updated_at: now,
    })
    .eq("provider_id", me)
    .in("status", ["pending_review", "provider_assigned", "payment_completed"])
    .select("id, status");
  if (error && /claim_locked/i.test(error.message)) {
    const fallback = await base();
    rows = fallback.data;
    error = fallback.error;
  }
  if (error) throw new Error(error.message);
  const released = (rows ?? []) as { id: string; status: string }[];
  if (released.length) {
    await supabaseAdmin.from("medication_request_events").insert(
      released.map((row) => ({
        request_id: row.id,
        status: row.status,
        actor_role: "provider",
        created_by: me,
        note: "Provider unavailable — returned to the unassigned queue",
      })),
    );
  }
  return released.length;
}

/** Return this provider's unreviewed orders to the queue so another practitioner can claim them. */
export const releaseUnreviewedOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertProvider(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const released = await releaseUnreviewed(supabaseAdmin, context.userId);
    return { released };
  });

export const remindPlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertProvider(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req } = await supabaseAdmin
      .from("medication_requests")
      .select("id, status, provider_id, user_id, medicine_id")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!req || req.provider_id !== context.userId) throw new Error("Order not found.");
    if (req.status !== "awaiting_additional_payment") {
      throw new Error("This order is not waiting on the patient.");
    }
    const { remindPatientOfPlanChange } = await import("@/lib/email.notifications");
    const email_sent = await remindPatientOfPlanChange({
      supabaseAdmin,
      request: req,
    });
    await supabaseAdmin.from("medication_request_events").insert({
      request_id: req.id,
      status: req.status,
      actor_role: "provider",
      created_by: context.userId,
      note: email_sent
        ? "Reminder sent to the patient to pay the difference."
        : "Payment reminder was already sent today.",
    });
    return { ok: true, email_sent };
  });

const CLOSED = ["sent_to_pharmacy", "dispatched", "delivered", "rejected", "cancelled", "refunded"];

export const escalateRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertProvider(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const me = context.userId;
    const { data: req } = await supabaseAdmin
      .from("medication_requests")
      .select("id, status, provider_id")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!req || req.provider_id !== me) throw new Error("Only the assigned practitioner can escalate this order.");
    if (CLOSED.includes(req.status)) throw new Error("This order can no longer be escalated.");

    const siblings = (await loadSiblingRows(supabaseAdmin, req.id)).filter(
      (row) => row.provider_id === me && !CLOSED_ORDER_STATUSES.includes(row.status),
    );
    const targets = siblings.length ? siblings : [req];
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("medication_requests")
      .update({
        provider_id: null,
        claim_locked_by: null,
        claim_locked_at: null,
        updated_at: now,
      })
      .in(
        "id",
        targets.map((row) => row.id),
      )
      .eq("provider_id", me);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("medication_request_events").insert(
      targets.map((row) => ({
        request_id: row.id,
        status: row.status,
        actor_role: "provider",
        created_by: me,
        note: "Escalated to another provider",
      })),
    );
    return { ok: true };
  });

export const scheduleConsultation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        mode: z.enum(["instant", "scheduled"]),
        scheduledAt: z.string().trim().min(8).max(40).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertProvider(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const me = context.userId;
    const { data: req } = await supabaseAdmin
      .from("medication_requests")
      .select("id, status, provider_id")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!req || req.provider_id !== me) throw new Error("Order not found.");
    if (CLOSED.includes(req.status)) throw new Error("This order can no longer be scheduled.");
    let scheduledAt: string | null = null;
    if (data.mode === "scheduled") {
      const when = data.scheduledAt ? new Date(data.scheduledAt) : null;
      if (!when || Number.isNaN(when.getTime())) {
        throw new Error("Choose a date and time for a scheduled consultation.");
      }
      scheduledAt = when.toISOString();
    }

    const siblings = (await loadSiblingRows(supabaseAdmin, req.id)).filter(
      (row) => row.provider_id === me && !CLOSED_ORDER_STATUSES.includes(row.status),
    );
    const targets = siblings.length ? siblings : [req];
    const { error } = await supabaseAdmin
      .from("medication_requests")
      .update({
        consultation_mode: data.mode,
        consultation_scheduled_at: scheduledAt,
        updated_at: new Date().toISOString(),
      })
      .in(
        "id",
        targets.map((row) => row.id),
      )
      .eq("provider_id", me);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("medication_request_events").insert({
      request_id: req.id,
      status: req.status,
      actor_role: "provider",
      created_by: me,
      note:
        data.mode === "scheduled"
          ? `Consultation scheduled for ${scheduledAt}.`
          : "Consultation set to instant.",
    });
    return { ok: true };
  });
