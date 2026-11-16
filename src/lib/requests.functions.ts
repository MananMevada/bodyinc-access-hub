/* eslint-disable no-empty */
/* eslint-disable prefer-const */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertReviewer, assertAdmin } from "@/lib/admin-guard";
import { clinicalEventNote, PENDING_REQUEST_STATUSES } from "@/lib/request-status";
import {
  completedIntakeUserIds,
  filledSessionIdSet,
  intakeSessionForOrder,
  loadClinicalIntake,
  loadPastOrders,
  loadShopIntakeState,
  orderHasIntake,
  repairOrdersAwaitingIntake,
  shopIntakeReady,
  withShopConsultationIntake,
} from "@/lib/clinical-intake";
import {
  CLOSED_ORDER_STATUSES,
  collapseOrderRows,
  findGroupConsultation,
  loadOrderLines,
  loadSiblingRows,
  userIdsInOpenChat,
} from "@/lib/order-groups";

type Ctx = { supabase: any; userId: string };

// Non-terminal statuses for the default queue view.
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

/** The medicine switch is the current rule. The copy saved on the order can be older. */
async function liveConsultationRequired(
  supabaseAdmin: any,
  rows: { medicine_id?: string | null; requires_consultation?: boolean | null }[],
): Promise<boolean> {
  const ids = [...new Set(rows.map((row) => row.medicine_id).filter(Boolean))] as string[];
  if (ids.length === 0) return rows.some((row) => Boolean(row.requires_consultation));
  const { data, error } = await supabaseAdmin
    .from("medicines")
    .select("id, requires_consultation")
    .in("id", ids);
  if (error || !data) return rows.some((row) => Boolean(row.requires_consultation));
  const flags = new Map(
    (data as { id: string; requires_consultation?: boolean }[]).map((med) => [
      med.id,
      Boolean(med.requires_consultation),
    ]),
  );
  return rows.some((row) =>
    row.medicine_id && flags.has(row.medicine_id)
      ? flags.get(row.medicine_id)
      : Boolean(row.requires_consultation),
  );
}

function blockedLifeFileSend(message: string): "sent" | "in_flight" | null {
  if (message.includes("already being sent to LifeFile")) return "in_flight";
  if (message.includes("already submitted to LifeFile")) return "sent";
  return null;
}

async function logEvent(
  supabaseAdmin: any,
  requestId: string,
  status: string,
  actorRole: "admin" | "provider" | "system",
  createdBy: string | null,
  note?: string | null,
): Promise<void> {
  await supabaseAdmin.from("medication_request_events").insert({
    request_id: requestId,
    status,
    actor_role: actorRole,
    created_by: createdBy,
    note: note ?? null,
  });
}

/** Create the prescription if needed, submit to LifeFile, and mark the order sent. */
export async function fulfillApprovedRequest(
  supabaseAdmin: any,
  req: {
    id: string;
    status: string;
    provider_id: string | null;
    user_id: string | null;
    medicine_id: string | null;
    variant_id: string | null;
    package_id?: string | null;
    life_file_order_id?: string | null;
    life_file_status?: string | null;
  },
  actor: { role: "admin" | "provider" | "system"; userId: string | null },
  directions?: string,
) {
  if (req.life_file_order_id) {
    throw new Error("This order was already submitted to LifeFile.");
  }

  const { assertLifeFileReady } = await import("@/integrations/lifefile/submit.server");
  await assertLifeFileReady(supabaseAdmin, req);

  const { data: existingRxRows, error: existingRxError } = await supabaseAdmin
    .from("prescriptions")
    .select("id")
    .eq("request_id", req.id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (existingRxError) throw new Error(existingRxError.message);
  const existingRx = existingRxRows?.[0] ?? null;
  let createdRxId: string | null = null;

  if (!existingRx) {
    const { data: med } = req.medicine_id
      ? await supabaseAdmin.from("medicines").select("name").eq("id", req.medicine_id).maybeSingle()
      : { data: null };
    const { data: inserted, error: rxError } = await supabaseAdmin
      .from("prescriptions")
      .insert({
        request_id: req.id,
        user_id: req.user_id,
        provider_id: req.provider_id,
        medicine_id: req.medicine_id,
        variant_id: req.variant_id,
        package_id: req.package_id ?? null,
        medicine_name: (med as { name?: string } | null)?.name ?? "Medication",
        directions: directions?.trim() || null,
      })
      .select("id")
      .single();
    if (rxError) throw new Error(rxError.message);
    createdRxId = inserted?.id ?? null;
  } else if (directions?.trim()) {
    await supabaseAdmin
      .from("prescriptions")
      .update({ directions: directions.trim() })
      .eq("id", existingRx.id);
  }

  const { submitRequestToLifeFile } = await import("@/integrations/lifefile/submit.server");
  let lf;
  try {
    lf = await submitRequestToLifeFile(
      supabaseAdmin,
      {
        id: req.id,
        status: "prescribed",
        provider_id: req.provider_id,
        user_id: req.user_id,
        medicine_id: req.medicine_id,
        variant_id: req.variant_id,
        life_file_order_id: req.life_file_order_id,
        life_file_status: req.life_file_status,
      },
      { allowRetry: true },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (createdRxId && !blockedLifeFileSend(message)) {
      await supabaseAdmin.from("prescriptions").delete().eq("id", createdRxId);
    }
    throw error;
  }

  await supabaseAdmin
    .from("medication_requests")
    .update({ status: "sent_to_pharmacy", updated_at: new Date().toISOString() })
    .eq("id", req.id);
  await logEvent(
    supabaseAdmin,
    req.id,
    "sent_to_pharmacy",
    actor.role,
    actor.userId,
    `Life File order ID: ${lf.lifeFileOrderId}${lf.pharmacyName ? ` (${lf.pharmacyName})` : ""}`,
  );

  void import("@/lib/email.notifications")
    .then(({ notifyPatientRequestEvent }) =>
      notifyPatientRequestEvent({
        supabaseAdmin,
        request: req,
        template: "patient_sent_to_pharmacy",
        extraParams: { TRACKING_NUMBER: "" },
      }),
    )
    .catch((e) => console.error("[fulfillApprovedRequest] email failed:", e));

  return {
    lifeFileOrderId: lf.lifeFileOrderId as string,
    pharmacyName: lf.pharmacyName as string | null,
  };
}

const PHARMACY_HOLD_STATUSES = new Set([
  "payment_completed",
  "provider_assigned",
  "pending_review",
  "awaiting_additional_payment",
  "approved",
]);

/** Prescribe if needed and submit to LifeFile. A failed send leaves the order at Prescription approved. */
export async function prescribeAndSendToPharmacy(
  supabaseAdmin: any,
  req: {
    id: string;
    provider_id: string | null;
    user_id: string | null;
    medicine_id: string | null;
    variant_id: string | null;
    package_id?: string | null;
  },
  actor: { role: "admin" | "provider" | "system"; userId: string | null },
): Promise<{ lifeFileOrderId: string | null; error: string | null; retry: boolean }> {
  const { data: fresh, error: loadError } = await supabaseAdmin
    .from("medication_requests")
    .select(
      "id, status, provider_id, user_id, medicine_id, variant_id, package_id, life_file_order_id, life_file_status",
    )
    .eq("id", req.id)
    .maybeSingle();
  if (loadError) return { lifeFileOrderId: null, error: loadError.message, retry: true };
  const row = (fresh ?? req) as {
    id: string;
    status?: string;
    provider_id: string | null;
    user_id: string | null;
    medicine_id: string | null;
    variant_id: string | null;
    package_id?: string | null;
    life_file_order_id?: string | null;
    life_file_status?: string | null;
  };

  if (row.life_file_order_id) {
    if (row.status && !["sent_to_pharmacy", "dispatched", "delivered"].includes(row.status)) {
      await supabaseAdmin
        .from("medication_requests")
        .update({ status: "sent_to_pharmacy", updated_at: new Date().toISOString() })
        .eq("id", req.id);
    }
    return { lifeFileOrderId: row.life_file_order_id, error: null, retry: false };
  }

  const now = new Date().toISOString();
  if (req.medicine_id) {
    const { data: med } = await supabaseAdmin
      .from("medicines")
      .select("name")
      .eq("id", req.medicine_id)
      .maybeSingle();
    await supabaseAdmin
      .from("prescriptions")
      .update({
        medicine_id: req.medicine_id,
        variant_id: req.variant_id,
        package_id: req.package_id ?? null,
        medicine_name: (med as { name?: string } | null)?.name ?? "Medication",
        updated_at: now,
      })
      .eq("request_id", req.id)
      .neq("status", "voided");
  }

  if (!row.status || PHARMACY_HOLD_STATUSES.has(row.status)) {
    let statusUpdate = supabaseAdmin
      .from("medication_requests")
      .update({ status: "approved", updated_at: now })
      .eq("id", req.id);
    if (row.status) statusUpdate = statusUpdate.eq("status", row.status);
    await statusUpdate;
  }

  if (!row.provider_id) {
    await logEvent(
      supabaseAdmin,
      req.id,
      "approved",
      actor.role,
      actor.userId,
      "Automatic pharmacy send needs an assigned provider.",
    );
    return { lifeFileOrderId: null, error: "This order has no assigned provider.", retry: false };
  }

  try {
    const sent = await fulfillApprovedRequest(
      supabaseAdmin,
      {
        id: req.id,
        status: "approved",
        provider_id: row.provider_id,
        user_id: row.user_id ?? req.user_id,
        medicine_id: req.medicine_id ?? row.medicine_id,
        variant_id: req.variant_id ?? row.variant_id,
        package_id: req.package_id ?? row.package_id,
        life_file_order_id: row.life_file_order_id,
        life_file_status: row.life_file_status,
      },
      actor,
    );
    return { lifeFileOrderId: sent.lifeFileOrderId, error: null, retry: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pharmacy send failed.";
    const blocked = blockedLifeFileSend(message);
    if (blocked === "in_flight") {
      return { lifeFileOrderId: null, error: null, retry: true };
    }
    if (blocked === "sent") {
      const { data: fresh } = await supabaseAdmin
        .from("medication_requests")
        .select("life_file_order_id, status")
        .eq("id", req.id)
        .maybeSingle();
      const orderId =
        (fresh as { life_file_order_id?: string | null } | null)?.life_file_order_id ??
        row.life_file_order_id ??
        null;
      const freshStatus = (fresh as { status?: string } | null)?.status;
      if (
        orderId &&
        freshStatus &&
        !["sent_to_pharmacy", "dispatched", "delivered"].includes(freshStatus)
      ) {
        await supabaseAdmin
          .from("medication_requests")
          .update({ status: "sent_to_pharmacy", updated_at: new Date().toISOString() })
          .eq("id", req.id)
          .eq("status", freshStatus);
      }
      return { lifeFileOrderId: orderId, error: null, retry: false };
    }
    await supabaseAdmin
      .from("medication_requests")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", req.id)
      .in("status", [
        "payment_completed",
        "provider_assigned",
        "pending_review",
        "awaiting_additional_payment",
        "approved",
        "prescribed",
      ]);
    await logEvent(
      supabaseAdmin,
      req.id,
      "approved",
      actor.role,
      actor.userId,
      `Pharmacy send did not go through: ${message}`.slice(0, 500),
    );
    const permanent =
      /no assigned provider|no patient|patient profile not found|provider record not found|provider profile not found|npi is required|prescription not found/i.test(
        message,
      );
    return { lifeFileOrderId: null, error: message, retry: !permanent };
  }
}

// Loads a request and enforces provider scoping: a provider may only touch requests assigned to
// them; an admin may touch any. If `opts?.allowUnassigned` is true, an unassigned request (provider_id = null)
// may also be accessed by a provider (e.g. for reviewing and claiming in the provider queue).
async function loadScopedRequest(
  supabaseAdmin: any,
  requestId: string,
  role: "admin" | "provider",
  userId: string,
  cols: string,
  opts?: { allowUnassigned?: boolean },
): Promise<any> {
  const selectCols =
    cols === "*" ||
    cols
      .split(",")
      .map((s) => s.trim())
      .includes("provider_id")
      ? cols
      : `${cols}, provider_id`;

  const { data: req, error } = await supabaseAdmin
    .from("medication_requests")
    .select(selectCols)
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!req) throw new Error("Request not found.");

  if (role === "provider") {
    const isAssignedToMe = req.provider_id === userId;
    const isUnassignedAllowed = Boolean(opts?.allowUnassigned && !req.provider_id);
    if (!isAssignedToMe && !isUnassignedAllowed) {
      throw new Error("Forbidden");
    }
  }
  return req;
}

async function resolvePaymentIntentForPayment(stripe: any, payment: any): Promise<string | null> {
  if (payment.stripe_payment_intent_id) return payment.stripe_payment_intent_id;
  if (!payment.stripe_invoice_id) return null;
  try {
    const inv = await stripe.invoices.retrieve(payment.stripe_invoice_id, { expand: ["payments"] });
    for (const entry of inv?.payments?.data ?? []) {
      const pi = entry?.payment?.payment_intent;
      const piId = typeof pi === "string" ? pi : pi?.id;
      if (piId) return piId;
    }
  } catch {
    // fall through
  }
  return null;
}

const listInput = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.string().trim().max(40).optional(),
  })
  .default({});

export const listRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const role = await assertReviewer(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (role === "provider") {
      const { expireOverduePlanChanges } = await import("@/lib/plan-change.server");
      await expireOverduePlanChanges(supabaseAdmin, context.userId);
    }

    const { normalizeIdSearch, uuidPrefixRange } = await import("@/lib/format");
    const term = data.search ? normalizeIdSearch(data.search) : "";
    const idRange = term ? uuidPrefixRange(term) : null;
    const SELECT_COLS =
      "id, user_id, session_id, subscription_id, provider_id, medicine_id, package_id, kind, status, requires_consultation, tracking_number, created_at, life_file_status, life_file_order_id, life_file_error, life_file_pharmacy_id, life_file_submitted_at, order_group_id, plan_change_delta_cents";

    let q = supabaseAdmin
      .from("medication_requests")
      .select(SELECT_COLS)
      .order("created_at", { ascending: false })
      .limit(300);

    if (role === "provider") q = q.eq("provider_id", context.userId);

    if (data.status && data.status !== "all") {
      q =
        data.status === "open"
          ? q.in("status", OPEN_STATUSES)
          : data.status === "ready"
            ? q.in("status", ["approved", "prescribed"])
            : data.status === "sent_to_pharmacy"
              ? q.in("status", ["sent_to_pharmacy", "dispatched", "delivered"])
              : q.eq("status", data.status);
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    let list = rows ?? [];

    // ID search must find the record regardless of the active status filter or page limit.
    if (idRange) {
      let idQ = supabaseAdmin
        .from("medication_requests")
        .select(SELECT_COLS)
        .gte("id", idRange.lo)
        .lte("id", idRange.hi)
        .limit(50);
      if (role === "provider") idQ = idQ.eq("provider_id", context.userId);
      const { data: idRows, error: idErr } = await idQ;
      if (idErr) throw new Error(idErr.message);
      const byId = new Map<string, any>();
      for (const r of list as any[]) byId.set(r.id, r);
      for (const r of (idRows ?? []) as any[]) byId.set(r.id, r);
      list = [...byId.values()].sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }

    await repairOrdersAwaitingIntake(supabaseAdmin, list as any[]);

    const userIds = Array.from(new Set(list.map((r: any) => r.user_id).filter(Boolean)));
    const sessionIds = Array.from(
      new Set(
        list
          .filter((r: any) => !r.user_id)
          .map((r: any) => r.session_id)
          .filter(Boolean),
      ),
    );
    const medIds = Array.from(new Set(list.map((r: any) => r.medicine_id).filter(Boolean)));
    const provIds = Array.from(new Set(list.map((r: any) => r.provider_id).filter(Boolean)));
    const pharmacyIds = Array.from(
      new Set(list.map((r: any) => r.life_file_pharmacy_id).filter(Boolean)),
    );

    const [
      { data: profiles },
      { data: sessions },
      { data: meds },
      { data: provs },
      { data: pharmacies },
      shopIntake,
    ] = await Promise.all([
      userIds.length
        ? supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),
      sessionIds.length
        ? supabaseAdmin.from("intake_sessions").select("id, full_name, email").in("id", sessionIds)
        : Promise.resolve({ data: [] as any[] }),
      medIds.length
        ? supabaseAdmin
            .from("medicines")
            .select("id, name, requires_consultation")
            .in("id", medIds)
        : Promise.resolve({ data: [] as any[] }),
      provIds.length
        ? supabaseAdmin.from("profiles").select("id, full_name, email").in("id", provIds)
        : Promise.resolve({ data: [] as any[] }),
      pharmacyIds.length
        ? supabaseAdmin.from("life_file_pharmacies").select("id, name").in("id", pharmacyIds)
        : Promise.resolve({ data: [] as any[] }),
      loadShopIntakeState(
        supabaseAdmin,
        (list as { id: string }[]).map((row) => row.id),
      ),
    ]);

    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const sMap = new Map((sessions ?? []).map((s: any) => [s.id, s]));
    const medMap = new Map((meds ?? []).map((m: any) => [m.id, m]));
    const provMap = new Map((provs ?? []).map((p: any) => [p.id, p]));
    const pharmacyMap = new Map((pharmacies ?? []).map((p: any) => [p.id, p]));

    let result: any[] = list.map((r: any) => {
      const p = pMap.get(r.user_id) as any;
      const sess = !p ? (sMap.get(r.session_id) as any) : null;
      const prov = provMap.get(r.provider_id) as any;
      const pharmacy = pharmacyMap.get(r.life_file_pharmacy_id) as any;
      return {
        id: r.id,
        user_id: r.user_id ?? null,
        session_id: r.session_id ?? null,
        order_group_id: r.order_group_id ?? null,
        customer_name: p?.full_name ?? sess?.full_name ?? null,
        customer_email: p?.email ?? sess?.email ?? null,
        is_guest: !p && !!sess,
        medicine_name: (medMap.get(r.medicine_id) as any)?.name ?? "—",
        provider_name: prov?.full_name ?? null,
        pharmacy_name: pharmacy?.name ?? null,
        kind: r.kind,
        status: r.status,
        plan_change_delta_cents: r.plan_change_delta_cents ?? null,
        requires_consultation:
          (medMap.get(r.medicine_id) as any)?.requires_consultation ?? r.requires_consultation,
        tracking_number: r.tracking_number,
        life_file_status: r.life_file_status ?? null,
        life_file_order_id: r.life_file_order_id ?? null,
        life_file_error: r.life_file_error ?? null,
        life_file_submitted_at: r.life_file_submitted_at ?? null,
        created_at: r.created_at,
      };
    });

    if (role === "provider") {
      const sessionIds = list.map((r: any) => r.session_id).filter(Boolean);
      const userIds = Array.from(new Set(list.map((r: any) => r.user_id).filter(Boolean)));
      const [filledSessions, completedUsers, consultRes] = await Promise.all([
        filledSessionIdSet(supabaseAdmin, sessionIds),
        completedIntakeUserIds(supabaseAdmin, userIds),
        userIds.length
          ? supabaseAdmin
              .from("patient_consultations")
              .select("user_id, ended_at, started_at")
              .in("user_id", userIds)
              .order("started_at", { ascending: false })
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const consultByUser = new Map<string, { ended_at: string | null }>();
      for (const row of ((consultRes as any).data ?? []) as any[]) {
        const prev = consultByUser.get(row.user_id);
        if (!prev) consultByUser.set(row.user_id, { ended_at: row.ended_at ?? null });
        else if (!row.ended_at) consultByUser.set(row.user_id, { ended_at: null });
      }
      result = result.map((row: any) => {
        const source = list.find((r: any) => r.id === row.id);
        const consult = source?.user_id ? consultByUser.get(source.user_id) : undefined;
        let consultation_status = "Not required";
        if (row.requires_consultation) {
          if (!consult) consultation_status = "Required";
          else if (!consult.ended_at) consultation_status = "In progress";
          else consultation_status = "Completed";
        }
        return {
          ...row,
          intake_filled: shopIntake.shopIds.has(row.id)
            ? shopIntakeReady(shopIntake.byRequest.get(row.id))
            : Boolean(
                (source?.session_id && filledSessions.has(source.session_id)) ||
                  (source?.user_id && completedUsers.has(source.user_id)),
              ),
          consultation_status,
          patient_waiting: consultation_status === "In progress",
        };
      });
      const hiddenUntilIntake = new Set([
        "payment_completed",
        "provider_assigned",
        "pending_review",
        "awaiting_additional_payment",
      ]);
      result = result.filter(
        (row: any) => row.intake_filled || !hiddenUntilIntake.has(row.status),
      );
    }

    result = collapseOrderRows(result).map(({ user_id: _user, session_id: _session, order_group_id: _group, ...row }) => row);

    if (term) {
      const s = term.toLowerCase();
      result = result.filter(
        (r: any) =>
          (r.customer_name ?? "").toLowerCase().includes(s) ||
          (role !== "provider" && (r.customer_email ?? "").toLowerCase().includes(s)) ||
          (r.medicine_name ?? "").toLowerCase().includes(s) ||
          r.id.toLowerCase().replace(/-/g, "").startsWith(s.replace(/-/g, "")) ||
          r.id.toLowerCase().includes(s) ||
          (r.order_item_ids ?? []).some((id: string) => id.toLowerCase().includes(s)),
      );
    }
    if (role === "provider") {
      result = result.map(({ customer_email: _email, ...row }: any) => row);
    }
    return result;
  });

export const countOpenRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count, error } = await supabaseAdmin
      .from("medication_requests")
      .select("id", { count: "exact", head: true })
      .in("status", [...PENDING_REQUEST_STATUSES]);
    if (error) throw new Error(error.message);
    return count ?? 0;
  });

export const getRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const role = await assertReviewer(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (role === "provider") {
      const { expireOverduePlanChanges } = await import("@/lib/plan-change.server");
      await expireOverduePlanChanges(supabaseAdmin, context.userId);
    }

    const req = await loadScopedRequest(supabaseAdmin, data.requestId, role, context.userId, "*", {
      allowUnassigned: true,
    });
    await repairOrdersAwaitingIntake(supabaseAdmin, [req]);
    const shopIntake = await loadShopIntakeState(supabaseAdmin, [req.id]);
    const shopDecision = shopIntake.byRequest.get(req.id);
    const fromShop = shopIntake.shopIds.has(req.id);

    if (role === "provider" && !req.provider_id) {
      const filled = fromShop
        ? shopIntakeReady(shopDecision)
        : await orderHasIntake(supabaseAdmin, req.session_id, req.user_id);
      const inChat = req.user_id
        ? (await userIdsInOpenChat(supabaseAdmin, [req.user_id])).has(req.user_id)
        : false;
      if (!filled || (!fromShop && !inChat)) throw new Error("This order is not in your queue.");
    }

    if (role === "provider" && req.provider_id === context.userId) {
      const { markProviderCaseOpened } = await import("@/lib/email.notifications");
      await markProviderCaseOpened(supabaseAdmin, req.id);
    }

    const siblings = await loadSiblingRows(supabaseAdmin, req.id);
    const order_items = await loadOrderLines(supabaseAdmin, req.id);
    const groupConsult = await findGroupConsultation(
      supabaseAdmin,
      siblings.length ? siblings : [req],
    );
    req.requires_consultation = await liveConsultationRequired(
      supabaseAdmin,
      siblings.length ? siblings : [req],
    );
    // A shop order shows only the form for this purchase. An earlier intake stays off this screen.
    const intakeSessionId = fromShop
      ? (shopDecision?.finishedSessionId ?? null)
      : await intakeSessionForOrder(supabaseAdmin, req.session_id, req.user_id);
    if (fromShop && req.session_id && req.session_id !== intakeSessionId) {
      req.session_id = shopDecision?.ownSessionId ?? null;
    }

    const [
      profileRes,
      sessionRes,
      medRes,
      pkgRes,
      provRes,
      eventsRes,
      rxRes,
      addPayRes,
    ] = await Promise.all([
      req.user_id
        ? supabaseAdmin
            .from("profiles")
            .select("id, full_name, email, state_code, dob, sex")
            .eq("id", req.user_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      intakeSessionId
        ? supabaseAdmin
            .from("intake_sessions")
            .select("id, full_name, email, state_code, dob, sex, height_cm, weight_kg")
            .eq("id", intakeSessionId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      req.medicine_id
        ? supabaseAdmin.from("medicines").select("id, name").eq("id", req.medicine_id).maybeSingle()
        : Promise.resolve({ data: null }),
      req.package_id
        ? supabaseAdmin
            .from("packages")
            .select("id, name, price, duration_months")
            .eq("id", req.package_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      req.provider_id
        ? supabaseAdmin
            .from("profiles")
            .select("id, full_name, email")
            .eq("id", req.provider_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin
        .from("medication_request_events")
        .select("id, status, note, actor_role, created_at")
        .eq("request_id", req.id)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("prescriptions")
        .select("id, medicine_name, directions, status, document_url, created_at")
        .eq("request_id", req.id)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("additional_payments")
        .select("id, amount_cents, currency, reason, status, created_at, paid_at")
        .eq("request_id", req.id)
        .order("created_at", { ascending: false }),
    ]);

    const consultRow = groupConsult;
    const completedEvent = ((eventsRes.data ?? []) as any[]).find(
      (ev) => typeof ev.note === "string" && /consultation (completed|ended)/i.test(ev.note),
    );
    const consultationPayload = consultRow
      ? {
          id: consultRow.id,
          qb_appointment_id: consultRow.qb_appointment_id,
          started_at: consultRow.started_at,
          ended_at: consultRow.ended_at ?? (completedEvent ? completedEvent.created_at : null),
          is_ended: Boolean(consultRow.ended_at || completedEvent),
        }
      : null;

    const patient = (profileRes.data as any) ?? (sessionRes.data as any) ?? null;
    const patientPayload = patient
      ? {
          name: patient.full_name ?? null,
          email: patient.email ?? null,
          state_code: patient.state_code ?? null,
          is_guest: !profileRes.data && !!sessionRes.data,
        }
      : null;

    const intake = await withShopConsultationIntake(
      await loadClinicalIntake(supabaseAdmin, intakeSessionId, sessionRes.data as any),
      fromShop ? shopDecision : undefined,
    );

    if (role === "provider") {
      const {
        payment_id: _paymentId,
        subscription_id: _subscriptionId,
        stripe_invoice_id: _invoiceId,
        stripe_refund_id: _refundId,
        ...safeRequest
      } = req as Record<string, unknown>;
      const identity = (profileRes.data as any) ?? (sessionRes.data as any) ?? null;
      const past_orders = await loadPastOrders(supabaseAdmin, {
        requestId: req.id,
        userId: req.user_id,
        sessionId: req.session_id,
        excludeIds: order_items.map((line) => line.id),
      });
      return {
        request: safeRequest as Record<string, string | number | boolean | null>,
        patient: patientPayload
          ? {
              id: identity?.id ?? null,
              name: patientPayload.name,
              email: null,
              state_code: patientPayload.state_code,
              is_guest: patientPayload.is_guest,
              dob: identity?.dob ?? null,
              sex: identity?.sex ?? null,
            }
          : null,
        intake,
        past_orders,
        medicine: medRes.data ?? null,
        package: pkgRes.data
          ? {
              id: pkgRes.data.id,
              name: pkgRes.data.name,
              price: 0,
              duration_months: pkgRes.data.duration_months,
            }
          : null,
        provider: provRes.data ?? null,
        consultation: consultationPayload,
        events: (
          (eventsRes.data ?? []) as {
            id: string;
            status: string;
            note: string | null;
            actor_role: string;
            created_at: string;
          }[]
        ).map((ev) => ({
          ...ev,
          note: clinicalEventNote(ev.note),
        })),
        prescriptions: rxRes.data ?? [],
        additional_payments: [],
        order_items,
      };
    }

    return {
      request: req,
      patient: patientPayload,
      intake,
      medicine: medRes.data ?? null,
      package: pkgRes.data ?? null,
      provider: provRes.data ?? null,
      consultation: consultationPayload,
      events: eventsRes.data ?? [],
      prescriptions: rxRes.data ?? [],
      additional_payments: addPayRes.data ?? [],
      order_items,
    };
  });

export const approveRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        note: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const role = await assertReviewer(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const req = await loadScopedRequest(
      supabaseAdmin,
      data.requestId,
      role,
      context.userId,
      "id, status, provider_id, user_id, session_id, subscription_id, medicine_id, variant_id, package_id, requires_consultation, life_file_order_id, life_file_status",
    );
    req.requires_consultation = await liveConsultationRequired(supabaseAdmin, [req]);
    if (req.status !== "pending_review") {
      throw new Error(
        req.status === "approved"
          ? "This order is already approved. Prescribe next."
          : `Cannot approve a request that is ${req.status}.`,
      );
    }
    if (req.life_file_order_id) {
      throw new Error("This order was already sent to LifeFile.");
    }
    if (!req.provider_id) {
      throw new Error("Assign a provider before approving.");
    }
    // Clinical approval is provider-only. Finishing the consultation prescribes and sends.
    if (role !== "provider" || req.provider_id !== context.userId) {
      throw new Error(
        "Only the assigned provider can approve this order. Assign a provider and have them approve from the practitioner portal.",
      );
    }
    const shopIntake = await loadShopIntakeState(supabaseAdmin, [req.id]);
    if (
      shopIntake.shopIds.has(req.id)
        ? !shopIntakeReady(shopIntake.byRequest.get(req.id))
        : !(await orderHasIntake(supabaseAdmin, req.session_id, req.user_id))
    ) {
      throw new Error("intake form missing");
    }
    if (
      req.requires_consultation &&
      (req.user_id || req.subscription_id) &&
      !(await consultationOpened(supabaseAdmin, req))
    ) {
      throw new Error("Open the consultation before approving this order.");
    }

    await supabaseAdmin
      .from("medication_requests")
      .update({
        status: "approved",
        decision_by: context.userId,
        decision_at: new Date().toISOString(),
        decision_note: data.note?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.id);
    await logEvent(
      supabaseAdmin,
      req.id,
      "approved",
      role,
      context.userId,
      data.note?.trim() || null,
    );

    const { notifyPatientRequestEvent, notifyAdminsProviderApproved } = await import(
      "@/lib/email.notifications"
    );
    const email_sent = await notifyPatientRequestEvent({
      supabaseAdmin,
      request: req,
      template: "patient_approved",
      extraParams: { DECISION_NOTE: data.note?.trim() || "" },
    });
    void notifyAdminsProviderApproved({
      supabaseAdmin,
      requestId: req.id,
      medicineId: req.medicine_id,
      providerId: req.provider_id,
      patientUserId: req.user_id,
    }).catch((e) => console.error("[approveRequest] admin email failed:", e));

    if (!req.requires_consultation) {
      try {
        await fulfillApprovedRequest(
          supabaseAdmin,
          { ...req, status: "approved" },
          { role, userId: context.userId },
        );
        return {
          ok: true,
          email_sent,
          admin_emails_sent: true,
          status: "sent_to_pharmacy",
          pharmacy_error: null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not send to the pharmacy.";
        const blocked = blockedLifeFileSend(message);
        if (blocked) {
          return {
            ok: true,
            email_sent,
            admin_emails_sent: true,
            status: blocked === "sent" ? "sent_to_pharmacy" : "approved",
            pharmacy_error: null,
          };
        }
        return {
          ok: true,
          email_sent,
          admin_emails_sent: true,
          status: "approved",
          pharmacy_error: message,
        };
      }
    }

    return {
      ok: true,
      email_sent,
      admin_emails_sent: true,
      status: "approved",
      pharmacy_error: null,
    };
  });

async function consultationOpened(
  supabaseAdmin: any,
  req: { id: string; user_id?: string | null; subscription_id?: string | null },
): Promise<boolean> {
  let q = supabaseAdmin
    .from("patient_consultations")
    .select("id")
    .order("started_at", { ascending: false })
    .limit(1);
  if (req.subscription_id) q = q.eq("subscription_id", req.subscription_id);
  else if (req.user_id) q = q.eq("user_id", req.user_id);
  else return false;
  const { data } = await q;
  if (((data ?? []) as unknown[]).length > 0) return true;
  return consultationFinished(supabaseAdmin, req);
}

async function consultationFinished(
  supabaseAdmin: any,
  req: { id: string; user_id?: string | null; subscription_id?: string | null },
): Promise<boolean> {
  let q = supabaseAdmin
    .from("patient_consultations")
    .select("id, ended_at")
    .order("started_at", { ascending: false })
    .limit(8);
  if (req.subscription_id) q = q.eq("subscription_id", req.subscription_id);
  else if (req.user_id) q = q.eq("user_id", req.user_id);
  else return false;
  const { data } = await q;
  if (((data ?? []) as any[]).some((row) => row.ended_at)) return true;
  const { data: events } = await supabaseAdmin
    .from("medication_request_events")
    .select("note")
    .eq("request_id", req.id);
  return ((events ?? []) as any[]).some(
    (ev) => typeof ev.note === "string" && /consultation (completed|ended|concluded)/i.test(ev.note),
  );
}

export const rejectRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ requestId: z.string().uuid(), note: z.string().trim().max(500).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const role = await assertReviewer(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getStripe } = await import("@/integrations/stripe/client.server");
    const stripe = getStripe();

    const req = await loadScopedRequest(
      supabaseAdmin,
      data.requestId,
      role,
      context.userId,
      "id, status, provider_id, user_id, medicine_id, payment_id, subscription_id, stripe_invoice_id",
    );
    if (!["pending_review", "awaiting_additional_payment"].includes(req.status)) {
      throw new Error(`Cannot reject a request that is ${req.status}.`);
    }
    if (role === "provider" && (data.note?.trim().length ?? 0) < 10) {
      throw new Error("A reason is required to reject this order.");
    }

    // Refund the charge for this order.
    let payment: any = null;
    if (req.payment_id) {
      const { data: p } = await supabaseAdmin
        .from("payments")
        .select("id, stripe_payment_intent_id, stripe_invoice_id")
        .eq("id", req.payment_id)
        .maybeSingle();
      payment = p ?? null;
    }
    if (!payment && req.stripe_invoice_id) {
      const { data: p } = await supabaseAdmin
        .from("payments")
        .select("id, stripe_payment_intent_id, stripe_invoice_id")
        .eq("stripe_invoice_id", req.stripe_invoice_id)
        .maybeSingle();
      payment = p ?? null;
    }
    if (!payment) throw new Error("Could not find the payment for this order to refund.");

    const paymentIntentId = await resolvePaymentIntentForPayment(stripe, payment);
    if (!paymentIntentId) {
      throw new Error(
        "Could not resolve the Stripe charge for this order; refund it from the Stripe dashboard, then reject.",
      );
    }
    const refund = await stripe.refunds.create({ payment_intent: paymentIntentId });
    if (!payment.stripe_payment_intent_id) {
      await supabaseAdmin
        .from("payments")
        .update({ stripe_payment_intent_id: paymentIntentId })
        .eq("id", payment.id);
    }
    await supabaseAdmin.from("payments").update({ status: "refunded" }).eq("id", payment.id);

    // Stop future billing on the subscription behind this order.
    if (req.subscription_id) {
      const { data: sub } = await supabaseAdmin
        .from("subscriptions")
        .select("id, stripe_subscription_id")
        .eq("id", req.subscription_id)
        .maybeSingle();
      if (sub?.stripe_subscription_id) {
        try {
          await stripe.subscriptions.cancel(sub.stripe_subscription_id);
        } catch (e) {
          console.error("[requests] cancel subscription on reject failed:", e);
        }
        await supabaseAdmin.from("subscriptions").update({ status: "canceled" }).eq("id", sub.id);
      }
    }

    // Void any still-pending Workflow C payment request — the order is being refunded and closed.
    await supabaseAdmin
      .from("additional_payments")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("request_id", req.id)
      .eq("status", "pending");

    await supabaseAdmin
      .from("medication_requests")
      .update({
        status: "rejected",
        decision_by: context.userId,
        decision_at: new Date().toISOString(),
        decision_note: data.note?.trim() || null,
        stripe_refund_id: refund.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.id);

    await logEvent(
      supabaseAdmin,
      req.id,
      "rejected",
      role,
      context.userId,
      data.note?.trim() || null,
    );

    const { notifyPatientRequestEvent } = await import("@/lib/email.notifications");
    const email_sent = await notifyPatientRequestEvent({
      supabaseAdmin,
      request: req,
      template: "patient_rejected",
      extraParams: { DECISION_NOTE: data.note?.trim() || "" },
    });

    return { ok: true, stripe_refund_id: refund.id, email_sent };
  });

export const changeRequestMedicine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        packageId: z.string().uuid(),
        note: z.string().trim().max(500).optional(),
        // Required when the new medicine sits outside the current medicine's categories.
        crossCategoryReason: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const role = await assertReviewer(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getStripe } = await import("@/integrations/stripe/client.server");
    const { applyPackageChangeToSubscription } = await import("@/lib/subscription-reschedule");
    const stripe = getStripe();

    const req = await loadScopedRequest(
      supabaseAdmin,
      data.requestId,
      role,
      context.userId,
      "id, status, provider_id, user_id, subscription_id, package_id, medicine_id, variant_id, requires_consultation, previous_medicine_id, previous_variant_id, previous_package_id",
    );
    if (!["pending_review", "approved", "awaiting_additional_payment"].includes(req.status)) {
      throw new Error(`Cannot change medicine on a request that is ${req.status}.`);
    }

    const { data: newPkg, error: pkgErr } = await supabaseAdmin
      .from("packages")
      .select(
        "id, medicine_id, variant_id, duration_months, price, stripe_price_id, is_active, medicines(name), medicine_variants(name)",
      )
      .eq("id", data.packageId)
      .maybeSingle();
    if (pkgErr) throw new Error(pkgErr.message);
    if (!newPkg) throw new Error("Selected plan not found.");
    if (newPkg.id === req.package_id) {
      throw new Error("That is already this order's medicine, variant and plan.");
    }
    const { planIsSelectable } = await import("@/lib/medicines.functions");
    await planIsSelectable(supabaseAdmin, newPkg);

    // Cross-category switches need an explicit clinical reason, which is logged on the order.
    const currentMedicineId = (req as any).medicine_id as string | null;
    let crossCategory = false;
    if (currentMedicineId && currentMedicineId !== newPkg.medicine_id) {
      const { data: catRows } = await supabaseAdmin
        .from("medication_category_medicines")
        .select("category_id, medicine_id")
        .in("medicine_id", [currentMedicineId, newPkg.medicine_id]);
      const oldCats = new Set(
        ((catRows ?? []) as any[])
          .filter((r) => r.medicine_id === currentMedicineId)
          .map((r) => r.category_id),
      );
      const newCats = ((catRows ?? []) as any[])
        .filter((r) => r.medicine_id === newPkg.medicine_id)
        .map((r) => r.category_id);
      crossCategory =
        oldCats.size > 0 && newCats.length > 0 && !newCats.some((c) => oldCats.has(c));
    }
    if (crossCategory && !data.crossCategoryReason) {
      throw new Error(
        "This medicine is in a different treatment category. A clinical reason is required.",
      );
    }
    const clinicalReason = data.note?.trim() || data.crossCategoryReason?.trim() || "";
    if (role === "provider" && clinicalReason.length < 10) {
      throw new Error("A clinical reason is required to change this medicine.");
    }

    let currentPrice = 0;
    let curPkg: any = null;
    if (req.package_id) {
      const { data: cur } = await supabaseAdmin
        .from("packages")
        .select("price, duration_months, medicines(name), medicine_variants(name)")
        .eq("id", req.package_id)
        .maybeSingle();
      curPkg = cur ?? null;
      currentPrice = Number(cur?.price ?? 0);
    }
    let deltaCents = Math.round((Number(newPkg.price) - currentPrice) * 100);
    let restoreMedicineId = currentMedicineId as string | null;
    let restoreVariantId = ((req as { variant_id?: string | null }).variant_id ?? null) as
      | string
      | null;
    let restorePackageId = (req.package_id ?? null) as string | null;
    if (
      role === "provider" &&
      req.status === "awaiting_additional_payment" &&
      (req.previous_package_id != null || req.previous_medicine_id != null)
    ) {
      restoreMedicineId = req.previous_medicine_id ?? null;
      restoreVariantId = req.previous_variant_id ?? null;
      restorePackageId = req.previous_package_id ?? null;
      if (req.previous_package_id) {
        const { data: originalPkg } = await supabaseAdmin
          .from("packages")
          .select("price")
          .eq("id", req.previous_package_id)
          .maybeSingle();
        if (originalPkg) {
          deltaCents = Math.round((Number(newPkg.price) - Number(originalPkg.price ?? 0)) * 100);
        }
      }
    }

    // Load the subscription (for the go-forward reschedule + the customer for a credit).
    let sub: any = null;
    if (req.subscription_id) {
      const { data: s } = await supabaseAdmin
        .from("subscriptions")
        .select("id, stripe_subscription_id, stripe_customer_id")
        .eq("id", req.subscription_id)
        .maybeSingle();
      sub = s ?? null;
    }
    let billingCustomerId: string | null = sub?.stripe_customer_id ?? null;
    let billingNote: string | null = null;

    // Admin changes reschedule the subscription now. A practitioner change waits
    // for the patient to pay, or to approve when nothing extra is due.
    if (role !== "provider" && sub?.stripe_subscription_id) {
      const billing = await applyPackageChangeToSubscription({
        stripe,
        supabaseAdmin,
        sub: { id: sub.id, stripe_subscription_id: sub.stripe_subscription_id },
        pkg: newPkg as any,
      });
      billingCustomerId = billing.stripeCustomerId ?? billingCustomerId;
      if (!billing.billingUpdated) {
        billingNote =
          "Stripe does not have this subscription in the current account, so the next bill was not changed.";
      }
    }

    // Update the order's prescribed medicine snapshot.
    await supabaseAdmin
      .from("medication_requests")
      .update({
        medicine_id: newPkg.medicine_id,
        variant_id: newPkg.variant_id,
        package_id: newPkg.id,
        decision_by: context.userId,
        decision_at: new Date().toISOString(),
        decision_note: data.note?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.id);

    // Variant is part of the label so a dose-only change reads clearly on the timeline and emails.
    const medName = (newPkg as any).medicines?.name ?? "the new medication";
    const variantName = (newPkg as any).medicine_variants?.name ?? null;
    const medLabel = variantName ? `${medName} (${variantName})` : medName;

    // Structured audit row so the admin "Medicine changes" history has a complete record of
    // who switched what, for both practitioner and admin initiated changes.
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_user_id: context.userId,
      action: "request.change_medicine",
      entity: "medication_requests",
      entity_id: req.id,
      before: {
        medicine_id: currentMedicineId,
        medicine_name: curPkg?.medicines?.name ?? null,
        variant_name: curPkg?.medicine_variants?.name ?? null,
        package_id: req.package_id,
        duration_months: curPkg?.duration_months ?? null,
        price: currentPrice,
      },
      after: {
        medicine_id: newPkg.medicine_id,
        medicine_name: medName,
        variant_name: variantName,
        package_id: newPkg.id,
        duration_months: (newPkg as any).duration_months ?? null,
        price: Number(newPkg.price),
        delta_cents: deltaCents,
        cross_category: crossCategory,
        cross_category_reason: data.crossCategoryReason ?? null,
        note: data.note?.trim() || null,
        actor_role: role,
        user_id: req.user_id,
      },
    } as any);

    if (crossCategory) {
      await logEvent(
        supabaseAdmin,
        req.id,
        "category_changed",
        role,
        context.userId,
        `Switched to a different treatment category (${medLabel}). Reason: ${data.crossCategoryReason}`,
      );
      await supabaseAdmin.from("medication_request_notes").insert({
        request_id: req.id,
        author_id: context.userId,
        author_role: role,
        body: `Category change → ${medLabel}. Clinical reason: ${data.crossCategoryReason}`,
      });
    } else if (data.note?.trim()) {
      await logEvent(
        supabaseAdmin,
        req.id,
        req.status,
        role,
        context.userId,
        `Medicine changed to ${medLabel}. Reason: ${data.note.trim()}`,
      );
      await supabaseAdmin.from("medication_request_notes").insert({
        request_id: req.id,
        author_id: context.userId,
        author_role: role,
        body: `Medicine change → ${medLabel}. Clinical reason: ${data.note.trim()}`,
      });
    }

    if (role === "provider" && deltaCents > 0) {
      const now = new Date().toISOString();
      const portalBase = process.env.PATIENT_PORTAL_URL?.replace(/\/$/, "") ?? "";
      const payUrl = portalBase ? `${portalBase}/orders/${req.id}/pay` : "";

      await supabaseAdmin
        .from("additional_payments")
        .update({ status: "cancelled", updated_at: now })
        .eq("request_id", req.id)
        .eq("status", "pending");

      const { error: payErr } = await supabaseAdmin.from("additional_payments").insert({
        request_id: req.id,
        user_id: req.user_id,
        amount_cents: deltaCents,
        currency: "usd",
        reason: `Price difference for changing to ${medLabel}`,
        from_package_id: restorePackageId,
        to_package_id: newPkg.id,
        status: "pending",
      });
      if (payErr) throw new Error(payErr.message ?? "Could not record the additional payment.");

      await supabaseAdmin
        .from("medication_requests")
        .update({
          status: "awaiting_additional_payment",
          previous_medicine_id: restoreMedicineId,
          previous_variant_id: restoreVariantId,
          previous_package_id: restorePackageId,
          plan_change_token: null,
          plan_change_deadline: (
            await import("@/lib/plan-change.server")
          ).planChangeDeadline(),
          plan_change_delta_cents: deltaCents,
          updated_at: now,
        })
        .eq("id", req.id);
      await logEvent(
        supabaseAdmin,
        req.id,
        "awaiting_additional_payment",
        role,
        context.userId,
        `Changed to ${medLabel}; waiting for the patient to pay $${(deltaCents / 100).toFixed(2)}.`,
      );

      const { notifyPatientRequestEvent, medicineChangeMailLinks } = await import(
        "@/lib/email.notifications"
      );
      const links = medicineChangeMailLinks(req.id, "payment");
      const email_sent = await notifyPatientRequestEvent({
        supabaseAdmin,
        request: { ...req, medicine_id: newPkg.medicine_id },
        template: "patient_additional_payment",
        extraParams: {
          MEDICINE_NAME: medLabel,
          AMOUNT_DUE: (deltaCents / 100).toFixed(2),
          AMOUNT_DUE_CENTS: deltaCents,
          PORTAL_URL: links.PORTAL_URL || payUrl,
          SECONDARY_URL: links.SECONDARY_URL,
        },
      });

      return {
        ok: true,
        delta_cents: deltaCents,
        status: "awaiting_additional_payment",
        email_sent,
      };
    }

    if (role === "provider") {
      const now = new Date().toISOString();
      const { planChangeDeadline, newPlanChangeToken } = await import("@/lib/plan-change.server");
      await supabaseAdmin
        .from("medication_requests")
        .update({
          status: "awaiting_additional_payment",
          previous_medicine_id: restoreMedicineId,
          previous_variant_id: restoreVariantId,
          previous_package_id: restorePackageId,
          plan_change_token: newPlanChangeToken(),
          plan_change_deadline: planChangeDeadline(),
          plan_change_delta_cents: deltaCents,
          updated_at: now,
        })
        .eq("id", req.id);
      await logEvent(
        supabaseAdmin,
        req.id,
        "awaiting_additional_payment",
        role,
        context.userId,
        deltaCents < 0
          ? `Changed to ${medLabel}. Waiting for the patient to approve. $${(Math.abs(deltaCents) / 100).toFixed(2)} is credited on the next bill only after they approve.`
          : `Changed to ${medLabel}. Waiting for the patient to approve.`,
      );
      const { notifyPatientRequestEvent, medicineChangeMailLinks } = await import(
        "@/lib/email.notifications"
      );
      const links = medicineChangeMailLinks(req.id, "consent");
      const email_sent = await notifyPatientRequestEvent({
        supabaseAdmin,
        request: { ...req, medicine_id: newPkg.medicine_id },
        template: "patient_plan_consent",
        extraParams: {
          MEDICINE_NAME: medLabel,
          CREDIT_AMOUNT: deltaCents < 0 ? (Math.abs(deltaCents) / 100).toFixed(2) : "0.00",
          PORTAL_URL: links.PORTAL_URL,
          SECONDARY_URL: links.SECONDARY_URL,
        },
      });
      return {
        ok: true,
        delta_cents: deltaCents,
        status: "awaiting_additional_payment",
        email_sent,
      };
    }

    if (deltaCents > 0) {
      // More expensive: collect the difference, then pharmacy dispatch runs on payment success.
      const now = new Date().toISOString();
      await supabaseAdmin
        .from("additional_payments")
        .update({ status: "cancelled", updated_at: now })
        .eq("request_id", req.id)
        .eq("status", "pending");

      const { data: payRow, error: payErr } = await supabaseAdmin
        .from("additional_payments")
        .insert({
          request_id: req.id,
          user_id: req.user_id,
          amount_cents: deltaCents,
          currency: "usd",
          reason: `Price difference for changing to ${medLabel}`,
          from_package_id: req.package_id,
          to_package_id: newPkg.id,
          status: "pending",
        })
        .select("id")
        .single();
      if (payErr || !payRow) throw new Error(payErr?.message ?? "Could not record the additional payment.");

      let customerEmail: string | null = null;
      let customerId = (sub?.stripe_customer_id as string | null) ?? null;
      if (req.user_id) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("email, stripe_customer_id")
          .eq("id", req.user_id)
          .maybeSingle();
        customerEmail = (profile as { email?: string | null } | null)?.email ?? null;
        customerId =
          customerId ||
          ((profile as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null);
      }

      const portalBase = process.env.PATIENT_PORTAL_URL?.replace(/\/$/, "") ?? "";
      let payUrl = portalBase ? `${portalBase}/orders/${req.id}/pay` : "";
      if (!payUrl) {
        try {
          const { createAdditionalPaymentCheckout } = await import(
            "@/lib/additional-payment-dispatch.server"
          );
          const checkout = await createAdditionalPaymentCheckout({
            paymentId: payRow.id,
            requestId: req.id,
            amountCents: deltaCents,
            medicineLabel: medLabel,
            customerId,
            customerEmail,
          });
          if (checkout) {
            payUrl = checkout.url;
            await supabaseAdmin
              .from("additional_payments")
              .update({ stripe_checkout_session_id: checkout.id, updated_at: now })
              .eq("id", payRow.id);
          }
        } catch (checkoutErr) {
          console.error("[requests] additional payment checkout failed:", checkoutErr);
        }
      }

      await supabaseAdmin
        .from("medication_requests")
        .update({
          status: "awaiting_additional_payment",
          plan_change_delta_cents: deltaCents,
          updated_at: now,
        })
        .eq("id", req.id);
      await logEvent(
        supabaseAdmin,
        req.id,
        "awaiting_additional_payment",
        role,
        context.userId,
        [`Changed to ${medLabel}; additional $${(deltaCents / 100).toFixed(2)} due.`, billingNote]
          .filter(Boolean)
          .join(" "),
      );

      const { notifyPatientRequestEvent, notifyProviderRequestEvent, medicineChangeMailLinks } =
        await import("@/lib/email.notifications");
      const links = medicineChangeMailLinks(req.id, "payment");
      const email_sent = await notifyPatientRequestEvent({
        supabaseAdmin,
        request: { ...req, medicine_id: newPkg.medicine_id },
        template: "patient_additional_payment",
        extraParams: {
          MEDICINE_NAME: medLabel,
          AMOUNT_DUE: (deltaCents / 100).toFixed(2),
          AMOUNT_DUE_CENTS: deltaCents,
          PORTAL_URL: links.PORTAL_URL || payUrl,
          SECONDARY_URL: links.SECONDARY_URL,
        },
      });
      await notifyProviderRequestEvent({
        supabaseAdmin,
        providerId: req.provider_id,
        requestId: req.id,
        medicineId: newPkg.medicine_id,
        template: "provider_needs_attention",
        actorUserId: context.userId,
      });

      return {
        ok: true,
        delta_cents: deltaCents,
        status: "awaiting_additional_payment",
        email_sent,
      };
    }

    if (deltaCents < 0 && billingCustomerId) {
      // Cheaper: credit the difference to the customer balance so it settles the next invoice.
      try {
        await stripe.customers.createBalanceTransaction(billingCustomerId, {
          amount: deltaCents, // negative = credit toward future invoices
          currency: "usd",
          description: `Credit for changing to ${medLabel} (settles next cycle)`,
        });
      } catch (e) {
        console.error("[requests] customer balance credit failed:", e);
        billingNote = billingNote ?? "The lower price could not be credited in Stripe.";
      }
    } else if (deltaCents < 0) {
      billingNote = billingNote ?? "The lower price could not be credited because Stripe has no customer for this patient.";
    }

    // Same price or cheaper: the change is approved immediately.
    await supabaseAdmin
      .from("medication_requests")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", req.id);
    await logEvent(
      supabaseAdmin,
      req.id,
      "approved",
      role,
      context.userId,
      [
        deltaCents < 0
          ? `Changed to ${medLabel}; $${(Math.abs(deltaCents) / 100).toFixed(2)} credited next cycle.`
          : `Changed to ${medLabel}.`,
        billingNote,
      ]
        .filter(Boolean)
        .join(" "),
    );

    // Nothing is due, so the patient is not emailed. A still-open consultation sends the
    // order when the practitioner finishes it. An already-finished visit sends now.
    const consultAlreadyFinished = await consultationFinished(supabaseAdmin, req);
    const deferPharmacy = Boolean(req.requires_consultation) && !consultAlreadyFinished;
    const sent = deferPharmacy
      ? { error: null as string | null, lifeFileOrderId: null as string | null }
      : await prescribeAndSendToPharmacy(
          supabaseAdmin,
          {
            id: req.id,
            provider_id: req.provider_id,
            user_id: req.user_id,
            medicine_id: newPkg.medicine_id,
            variant_id: newPkg.variant_id,
            package_id: newPkg.id,
          },
          { role: "admin", userId: context.userId },
        );

    return {
      ok: true,
      delta_cents: deltaCents,
      status: !deferPharmacy && !sent.error ? "sent_to_pharmacy" : "approved",
      email_sent: false,
      lifeFileOrderId: sent.lifeFileOrderId,
      pharmacy_error: sent.error,
    };
  });

export const generatePrescription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        directions: z.string().trim().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const role = await assertReviewer(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const req = await loadScopedRequest(
      supabaseAdmin,
      data.requestId,
      role,
      context.userId,
      "id, status, provider_id, user_id, medicine_id, variant_id, package_id",
    );
    if (req.status !== "approved") {
      throw new Error(
        req.status === "awaiting_additional_payment"
          ? "The additional payment must be completed before generating the prescription."
          : `Cannot generate a prescription for a request that is ${req.status}.`,
      );
    }

    const { data: pendingPay } = await supabaseAdmin
      .from("additional_payments")
      .select("id")
      .eq("request_id", req.id)
      .eq("status", "pending")
      .maybeSingle();
    if (pendingPay) {
      throw new Error(
        "An additional payment is still pending for this order.",
      );
    }

    const { data: med } = req.medicine_id
      ? await supabaseAdmin.from("medicines").select("name").eq("id", req.medicine_id).maybeSingle()
      : { data: null };

    const { data: rx, error } = await supabaseAdmin
      .from("prescriptions")
      .insert({
        request_id: req.id,
        user_id: req.user_id,
        provider_id: req.provider_id,
        medicine_id: req.medicine_id,
        variant_id: req.variant_id,
        package_id: req.package_id,
        medicine_name: (med as any)?.name ?? "Medication",
        directions: data.directions?.trim() || null,
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);

    await supabaseAdmin
      .from("medication_requests")
      .update({ status: "prescribed", updated_at: new Date().toISOString() })
      .eq("id", req.id);
    await logEvent(supabaseAdmin, req.id, "prescribed", role, context.userId);

    const { notifyPatientRequestEvent } = await import("@/lib/email.notifications");
    const email_sent = await notifyPatientRequestEvent({
      supabaseAdmin,
      request: req,
      template: "patient_prescription_ready",
      extraParams: {
        MEDICINE_NAME: (med as any)?.name ?? "Medication",
        PRESCRIPTION_ID: rx?.id ?? "",
      },
    });

    return {
      ok: true,
      prescription_id: rx?.id ?? null,
      email_sent,
      status: "prescribed",
    };
  });

/** Admin: create Rx if needed + submit to LifeFile after provider approval. */
export const sendRequestToPharmacy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        directions: z.string().trim().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const role = await assertReviewer(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const req = await loadScopedRequest(
      supabaseAdmin,
      data.requestId,
      role,
      context.userId,
      "id, status, provider_id, user_id, medicine_id, variant_id, package_id, life_file_order_id, life_file_status",
    );

    const providerSendFailed =
      role === "admin" && req.status === "pending_review" && req.life_file_status === "failed";
    if (role === "provider") {
      if (req.provider_id !== context.userId) throw new Error("Order not found.");
      if (req.status !== "prescribed") {
        throw new Error("Prescribe before sending this order to the pharmacy.");
      }
    } else if (!["approved", "prescribed"].includes(req.status) && !providerSendFailed) {
      throw new Error(
        req.status === "pending_review"
          ? "Wait for the provider to approve this order before sending to pharmacy."
          : `Cannot send to pharmacy while the order is ${req.status}.`,
      );
    }
    if (!req.provider_id) {
      throw new Error("This order has no assigned provider.");
    }
    if (req.life_file_order_id) {
      throw new Error("This order was already submitted to LifeFile.");
    }

    const sent = await fulfillApprovedRequest(
      supabaseAdmin,
      req,
      { role, userId: context.userId },
      data.directions,
    );

    return {
      ok: true,
      lifeFileOrderId: sent.lifeFileOrderId,
      lifeFilePharmacyName: sent.pharmacyName,
      email_sent: true,
      status: "sent_to_pharmacy",
    };
  });

// Admin-only manual assignment. Used when a provider is licensed in the patient's state, so the
// order is created unassigned and the admin routes it to the right provider.
export const assignRequestProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ requestId: z.string().uuid(), providerId: z.string().uuid().nullable() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const role = await assertReviewer(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("medication_requests")
      .select("id, medicine_id, status, provider_id, user_id, session_id, subscription_id")
      .eq("id", data.requestId)
      .maybeSingle();

    if (!existing) throw new Error("Request not found.");

    if (data.providerId !== existing.provider_id) {
      const group = await loadSiblingRows(supabaseAdmin, data.requestId);
      const consult = await findGroupConsultation(
        supabaseAdmin,
        group.length ? group : [existing],
      );
      let consultationDone = Boolean(consult?.ended_at);
      if (!consultationDone) {
        const { data: events } = await supabaseAdmin
          .from("medication_request_events")
          .select("note")
          .eq("request_id", existing.id);
        consultationDone = ((events ?? []) as { note?: string | null }[]).some(
          (ev) => typeof ev.note === "string" && /consultation (completed|ended)/i.test(ev.note),
        );
      }
      if (consultationDone) {
        throw new Error(
          "The consultation is already complete, so the provider cannot be changed.",
        );
      }
    }

    if (role === "provider" && existing.provider_id && existing.provider_id !== context.userId) {
      throw new Error(
        "Forbidden: You cannot reassign a consultation that is assigned to another provider.",
      );
    }

    // Same provider again — no DB write, no duplicate email.
    if (data.providerId && existing.provider_id === data.providerId) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", data.providerId)
        .maybeSingle();
      return {
        ok: true,
        alreadyAssigned: true,
        providerName: (profile as { full_name?: string } | null)?.full_name ?? "this provider",
      };
    }

    if (data.providerId) {
      const { data: targetProv, error: unavailErr } = await supabaseAdmin
        .from("providers")
        .select("is_unavailable")
        .eq("id", data.providerId)
        .maybeSingle();
      if (unavailErr && !/is_unavailable/i.test(unavailErr.message)) throw new Error(unavailErr.message);
      if (targetProv?.is_unavailable) {
        throw new Error("This practitioner is unavailable. Choose someone else.");
      }

      const [profileRes, sessionRes] = await Promise.all([
        existing.user_id
          ? supabaseAdmin
              .from("profiles")
              .select("state_code")
              .eq("id", existing.user_id)
              .maybeSingle()
          : Promise.resolve({ data: null as { state_code?: string } | null }),
        existing.session_id
          ? supabaseAdmin
              .from("intake_sessions")
              .select("state_code")
              .eq("id", existing.session_id)
              .maybeSingle()
          : Promise.resolve({ data: null as { state_code?: string } | null }),
      ]);
      let patientState =
        profileRes.data?.state_code?.trim().toUpperCase() ||
        sessionRes.data?.state_code?.trim().toUpperCase() ||
        null;
      if (!patientState) {
        throw new Error("This patient has no state on file, so a provider cannot be assigned yet.");
      }

      const { data: provider } = await supabaseAdmin
        .from("providers")
        .select("license_states")
        .eq("id", data.providerId)
        .maybeSingle();
      const licensed = ((provider?.license_states ?? []) as string[]).map((s) =>
        String(s).toUpperCase(),
      );
      if (!licensed.includes(patientState)) {
        throw new Error(
          `This practitioner is not licensed in ${patientState}. Choose someone licensed in the patient's state.`,
        );
      }
      const shopIntake = await loadShopIntakeState(supabaseAdmin, [existing.id]);
      if (shopIntake.shopIds.has(existing.id)) {
        const decision = shopIntake.byRequest.get(existing.id);
        const finished = decision?.finishedSessionId ?? null;
        if (!shopIntakeReady(decision)) {
          throw new Error(
            "This patient has not finished the intake form, so the order cannot be assigned yet.",
          );
        }
        if (finished && existing.session_id !== finished) {
          existing.session_id = finished;
          await supabaseAdmin
            .from("medication_requests")
            .update({ session_id: finished, updated_at: new Date().toISOString() })
            .eq("id", existing.id);
          if (existing.subscription_id) {
            await supabaseAdmin
              .from("subscriptions")
              .update({ session_id: finished })
              .eq("id", existing.subscription_id);
          }
        }
      } else if (!(await orderHasIntake(supabaseAdmin, existing.session_id, existing.user_id))) {
        throw new Error(
          "This patient has not finished the intake form, so the order cannot be assigned yet.",
        );
      } else if (!existing.session_id) {
        const sessionId = await intakeSessionForOrder(
          supabaseAdmin,
          existing.session_id,
          existing.user_id,
        );
        if (sessionId) {
          existing.session_id = sessionId;
          await supabaseAdmin
            .from("medication_requests")
            .update({ session_id: sessionId, updated_at: new Date().toISOString() })
            .eq("id", existing.id)
            .is("session_id", null);
          if (existing.subscription_id) {
            await supabaseAdmin
              .from("subscriptions")
              .update({ session_id: sessionId })
              .eq("id", existing.subscription_id)
              .is("session_id", null);
          }
        }
      }
    }

    const patch: {
      provider_id: string | null;
      updated_at: string;
      status?: "pending_review";
    } = {
      provider_id: data.providerId,
      updated_at: new Date().toISOString(),
    };
    if (
      data.providerId &&
      (existing.status === "payment_completed" || existing.status === "provider_assigned")
    ) {
      patch.status = "pending_review";
    }

    const siblings = (await loadSiblingRows(supabaseAdmin, data.requestId)).filter(
      (row) =>
        row.id !== data.requestId &&
        !CLOSED_ORDER_STATUSES.includes(row.status) &&
        (row.provider_id == null || row.provider_id === existing.provider_id),
    );
    const moving = [existing, ...siblings];
    for (const row of moving) {
      const rowPatch = {
        ...patch,
        ...(existing.session_id && !row.session_id ? { session_id: existing.session_id } : {}),
      };
      if (
        rowPatch.status &&
        row.status !== "payment_completed" &&
        row.status !== "provider_assigned"
      ) {
        delete rowPatch.status;
      }
      const { error } = await supabaseAdmin
        .from("medication_requests")
        .update(rowPatch)
        .eq("id", row.id);
      if (error) throw new Error(error.message);
    }
    if (data.providerId) {
      const { data: provProfile } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", data.providerId)
        .maybeSingle();
      const doctorName = (provProfile as any)?.full_name?.trim() || "doctor";
      const assignmentNote =
        role === "admin"
          ? `admin added ${doctorName} into the chat`
          : `Provider reassigned to ${doctorName}`;

      await logEvent(
        supabaseAdmin,
        data.requestId,
        "provider_assigned",
        role === "admin" ? "admin" : "provider",
        context.userId,
        assignmentNote,
      );
      for (const row of siblings) {
        await logEvent(
          supabaseAdmin,
          row.id,
          "provider_assigned",
          role === "admin" ? "admin" : "provider",
          context.userId,
          assignmentNote,
        );
      }

      try {
        await supabaseAdmin.from("medication_request_notes").insert({
          request_id: data.requestId,
          author_id: context.userId,
          author_role: role === "admin" ? "admin" : "provider",
          body: assignmentNote,
        });
      } catch (noteErr) {
        console.warn("[assignRequestProvider] write note error:", noteErr);
      }

      // Auto-sync QuickBlox: ensure practitioner agent exists and directly assign consultation appointment
      try {
        const { isQuickbloxConfigured, getQuickbloxConfig } =
          await import("@/lib/consultations/config");
        if (isQuickbloxConfigured()) {
          const { provisionBodyIncProviderAgent, sessionForBodyIncProvider } =
            await import("@/lib/consultations/provider-agent");
          const {
            reassignAppointmentToProvider,
            ensurePatientQuickbloxClient,
            createPatientAppointment,
            ensureDialogOccupants,
            removeDialogOccupants,
            sendChatMessageToDialog,
          } = await import("@/lib/consultations/quickblox");

          const agent = await provisionBodyIncProviderAgent(supabaseAdmin, data.providerId);
          let prevToken: string | undefined;
          let prevQbUserId: number | null = null;
          if (existing.provider_id && existing.provider_id !== data.providerId) {
            try {
              const prevSession = await sessionForBodyIncProvider(
                supabaseAdmin,
                existing.provider_id,
              );
              prevToken = prevSession.token;
              prevQbUserId = prevSession.userId ?? null;
            } catch {
              const { data: prevProv } = await supabaseAdmin
                .from("providers")
                .select("qb_user_id")
                .eq("id", existing.provider_id)
                .maybeSingle();
              prevQbUserId = prevProv?.qb_user_id ?? null;
            }
          }

          const conds: string[] = [];
          if (existing.subscription_id)
            conds.push(`subscription_id.eq.${existing.subscription_id}`);
          if (existing.user_id) conds.push(`user_id.eq.${existing.user_id}`);

          let consultations: any[] = [];
          if (conds.length > 0) {
            const { data: cRows } = await supabaseAdmin
              .from("patient_consultations")
              .select("id, qb_appointment_id, qb_user_id, qb_dialog_id, started_at")
              .or(conds.join(","));
            consultations = cRows ?? [];
          }

          const qbConfig = getQuickbloxConfig();
          const adminQbId = qbConfig.providerId ?? 142814409;

          if (consultations.length > 0) {
            for (const c of consultations) {
              if (c.qb_appointment_id) {
                try {
                  const res = await reassignAppointmentToProvider({
                    appointmentId: c.qb_appointment_id,
                    qbProviderId: agent.qbUserId,
                    currentProviderToken: prevToken,
                    dialogId: c.qb_dialog_id ?? null,
                  });
                  const activeDialogId = res?.dialogId || c.qb_dialog_id;
                  if (res?.dialogId && !c.qb_dialog_id) {
                    await supabaseAdmin
                      .from("patient_consultations")
                      .update({ qb_dialog_id: res.dialogId })
                      .eq("id", c.id);
                  }
                  if (activeDialogId) {
                    const occupants = [agent.qbUserId, adminQbId];
                    if (c.qb_user_id) occupants.push(c.qb_user_id);
                    await ensureDialogOccupants({
                      dialogId: activeDialogId,
                      occupantsIds: occupants,
                    });
                    if (
                      prevQbUserId &&
                      prevQbUserId !== agent.qbUserId &&
                      prevQbUserId !== adminQbId &&
                      prevQbUserId !== c.qb_user_id
                    ) {
                      await removeDialogOccupants({
                        dialogId: activeDialogId,
                        occupantsIds: [prevQbUserId],
                        token: prevToken,
                      });
                    }
                    await sendChatMessageToDialog({
                      dialogId: activeDialogId,
                      message: assignmentNote,
                    });
                  }
                } catch (rErr) {
                  console.warn("[assignRequestProvider] reassign error:", rErr);
                }
              }
            }
          } else if (existing.user_id && existing.subscription_id) {
            // No appointment in Supabase yet — provision it directly assigned to this doctor
            const [{ data: prof }, { data: intake }, { data: med }] = await Promise.all([
              supabaseAdmin
                .from("profiles")
                .select("full_name, dob, sex")
                .eq("id", existing.user_id)
                .maybeSingle(),
              existing.session_id
                ? supabaseAdmin
                    .from("intake_sessions")
                    .select("full_name, dob, sex")
                    .eq("id", existing.session_id)
                    .maybeSingle()
                : Promise.resolve({ data: null }),
              existing.medicine_id
                ? supabaseAdmin
                    .from("medicines")
                    .select("name")
                    .eq("id", existing.medicine_id)
                    .maybeSingle()
                : Promise.resolve({ data: null }),
            ]);

            const dobRaw = prof?.dob ?? intake?.dob ?? null;
            const dob = dobRaw ? String(dobRaw).slice(0, 10) : null;
            if (dob) {
              const fullName = prof?.full_name?.trim() || intake?.full_name?.trim() || "Patient";
              const medicineName = med?.name?.trim() || "treatment";
              const client = await ensurePatientQuickbloxClient({
                userId: existing.user_id,
                subscriptionId: existing.subscription_id,
                fullName,
                dob,
                sex: prof?.sex ?? intake?.sex ?? null,
              });

              const agentSession = await sessionForBodyIncProvider(supabaseAdmin, data.providerId);
              const newAppt = await createPatientAppointment({
                clientId: client.userId,
                providerId: agent.qbUserId,
                providerToken: agentSession.token,
                description: `${medicineName} consultation`,
              });

              await supabaseAdmin.from("patient_consultations").insert({
                user_id: existing.user_id,
                subscription_id: existing.subscription_id,
                qb_user_id: client.userId,
                qb_appointment_id: newAppt._id,
                qb_dialog_id: newAppt.dialog_id ?? null,
              });

              if (newAppt.dialog_id) {
                await ensureDialogOccupants({
                  dialogId: newAppt.dialog_id,
                  occupantsIds: [agent.qbUserId, adminQbId, client.userId],
                });
                await sendChatMessageToDialog({
                  dialogId: newAppt.dialog_id,
                  message: assignmentNote,
                });
              }
            }
          }
        }
      } catch (qbSyncErr) {
        console.warn("[assignRequestProvider] QuickBlox sync error:", qbSyncErr);
      }

      // Don't block the admin UI on Brevo — send emails in the background.
      const medicineId = existing.medicine_id ?? null;
      const status = existing.status;
      void import("@/lib/email.notifications")
        .then(async ({ notifyPatientRequestEvent, notifyProviderRequestEvent }) => {
          const portalBase = process.env.PATIENT_PORTAL_URL?.replace(/\/$/, "") ?? "";
          await notifyPatientRequestEvent({
            supabaseAdmin,
            request: { id: data.requestId, user_id: existing.user_id, medicine_id: medicineId },
            template: "patient_provider_assigned",
            extraParams: {
              PORTAL_URL: portalBase ? `${portalBase}/consultations` : "",
            },
          });
          await notifyProviderRequestEvent({
            supabaseAdmin,
            providerId: data.providerId!,
            requestId: data.requestId,
            medicineId,
            template:
              status === "pending_review" ? "provider_ready_for_review" : "provider_assigned",
            actorUserId: context.userId,
          });
        })
        .catch((e) => console.error("[assignRequestProvider] email failed:", e));
    }
    return { ok: true, alreadyAssigned: false };
  });

export const getPrescription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ prescriptionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const role = await assertReviewer(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rx } = await supabaseAdmin
      .from("prescriptions")
      .select("id, user_id, provider_id, medicine_name, directions, created_at")
      .eq("id", data.prescriptionId)
      .maybeSingle();
    if (!rx) throw new Error("Prescription not found.");
    if (role === "provider" && rx.provider_id !== context.userId) throw new Error("Forbidden");

    const [patientRes, provRes] = await Promise.all([
      rx.user_id
        ? supabaseAdmin.from("profiles").select("full_name").eq("id", rx.user_id).maybeSingle()
        : Promise.resolve({ data: null }),
      rx.provider_id
        ? supabaseAdmin.from("profiles").select("full_name").eq("id", rx.provider_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    return {
      id: rx.id,
      medicineName: rx.medicine_name,
      directions: rx.directions,
      createdAt: rx.created_at,
      patientName: (patientRes.data as { full_name?: string } | null)?.full_name ?? "Patient",
      providerName: (provRes.data as { full_name?: string } | null)?.full_name ?? null,
    };
  });

const FULFILLMENT_STATUSES = ["sent_to_pharmacy", "dispatched", "delivered", "cancelled"] as const;

export const advanceRequestStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        status: z.enum(FULFILLMENT_STATUSES),
        trackingNumber: z.string().trim().max(200).optional(),
        note: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const role = await assertReviewer(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const req = await loadScopedRequest(
      supabaseAdmin,
      data.requestId,
      role,
      context.userId,
      "id, status, provider_id, user_id, medicine_id, variant_id, tracking_number, life_file_order_id, life_file_status",
    );

    let lifeFileOrderId: string | number | null = null;

    if (data.status === "sent_to_pharmacy") {
      // Already submitted successfully — allow status mark without re-sending.
      if (req.life_file_order_id) {
        lifeFileOrderId = req.life_file_order_id;
      } else {
        const { submitRequestToLifeFile } = await import("@/integrations/lifefile/submit.server");
        const lf = await submitRequestToLifeFile(supabaseAdmin, req, { allowRetry: true });
        lifeFileOrderId = lf.lifeFileOrderId;
      }
    }

    const update: {
      status: string;
      updated_at: string;
      tracking_number?: string | null;
    } = {
      status: data.status,
      updated_at: new Date().toISOString(),
    };

    if (data.trackingNumber !== undefined) {
      update.tracking_number = data.trackingNumber || null;
    }

    const { error } = await supabaseAdmin
      .from("medication_requests")
      .update(update)
      .eq("id", req.id);

    if (error) throw new Error(error.message);

    await logEvent(
      supabaseAdmin,
      req.id,
      data.status,
      role,
      context.userId,
      data.note?.trim() ||
        (lifeFileOrderId != null
          ? `Life File order ID: ${lifeFileOrderId}`
          : data.trackingNumber
            ? `Tracking: ${data.trackingNumber}`
            : null),
    );

    const tracking =
      data.trackingNumber !== undefined
        ? data.trackingNumber || null
        : (req.tracking_number as string | null);

    const statusTemplate =
      data.status === "sent_to_pharmacy"
        ? ("patient_sent_to_pharmacy" as const)
        : data.status === "dispatched"
          ? ("patient_shipped" as const)
          : data.status === "delivered"
            ? ("patient_delivered" as const)
            : null;

    let email_sent: boolean | undefined;
    if (statusTemplate) {
      const { notifyPatientRequestEvent } = await import("@/lib/email.notifications");

      email_sent = await notifyPatientRequestEvent({
        supabaseAdmin,
        request: { ...req, tracking_number: tracking },
        template: statusTemplate,
        extraParams: {
          TRACKING_NUMBER: tracking ?? "",
        },
      });
    }

    return {
      ok: true,
      lifeFileOrderId,
      email_sent,
    };
  });

/** Admin/provider retry after a failed LifeFile submission (PDF §12). */
export const retryLifeFileSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const req = await loadScopedRequest(
      supabaseAdmin,
      data.requestId,
      "admin",
      context.userId,
      "id, status, provider_id, user_id, medicine_id, variant_id, life_file_order_id, life_file_status",
    );

    if (!["prescribed", "approved", "sent_to_pharmacy"].includes(req.status)) {
      throw new Error(`Cannot retry LifeFile for a request that is ${req.status}.`);
    }
    if (req.life_file_order_id) {
      throw new Error("This order was already submitted to LifeFile.");
    }

    const { data: hasRx } = await supabaseAdmin
      .from("prescriptions")
      .select("id")
      .eq("request_id", req.id)
      .limit(1)
      .maybeSingle();
    if (!hasRx) {
      throw new Error("Prescribe before sending to the pharmacy.");
    }

    const { submitRequestToLifeFile } = await import("@/integrations/lifefile/submit.server");
    const lf = await submitRequestToLifeFile(supabaseAdmin, req, { allowRetry: true });

    await supabaseAdmin
      .from("medication_requests")
      .update({ status: "sent_to_pharmacy", updated_at: new Date().toISOString() })
      .eq("id", req.id);
    await logEvent(
      supabaseAdmin,
      req.id,
      "sent_to_pharmacy",
      "admin",
      context.userId,
      `Life File order ID: ${lf.lifeFileOrderId}${lf.pharmacyName ? ` (${lf.pharmacyName})` : ""}`,
    );

    const { notifyPatientRequestEvent } = await import("@/lib/email.notifications");
    const email_sent = await notifyPatientRequestEvent({
      supabaseAdmin,
      request: req,
      template: "patient_sent_to_pharmacy",
      extraParams: { TRACKING_NUMBER: "" },
    });

    return { ok: true, lifeFileOrderId: lf.lifeFileOrderId, email_sent };
  });

export const listRequestNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const role = await assertReviewer(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await loadScopedRequest(
      supabaseAdmin,
      data.requestId,
      role,
      context.userId,
      "id, provider_id",
      {
        allowUnassigned: true,
      },
    );

    const { data: rows, error } = await supabaseAdmin
      .from("medication_request_notes")
      .select("id, body, author_id, author_role, created_at")
      .eq("request_id", data.requestId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const authorIds = Array.from(
      new Set(((rows ?? []) as any[]).map((r) => r.author_id).filter(Boolean)),
    );
    const { data: profiles } = authorIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", authorIds)
      : { data: [] as any[] };
    const nameMap = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name]));

    return ((rows ?? []) as any[]).map((r) => ({
      id: r.id,
      body: r.body,
      author_role: r.author_role,
      author_name: nameMap.get(r.author_id) ?? "Team member",
      is_mine: r.author_id === context.userId,
      created_at: r.created_at,
    }));
  });

export const addRequestNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ requestId: z.string().uuid(), body: z.string().trim().min(1).max(4000) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const role = await assertReviewer(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await loadScopedRequest(
      supabaseAdmin,
      data.requestId,
      role,
      context.userId,
      "id, provider_id",
      {
        allowUnassigned: true,
      },
    );

    const { error } = await supabaseAdmin.from("medication_request_notes").insert({
      request_id: data.requestId,
      author_id: context.userId,
      author_role: role,
      body: data.body,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const CONSULT_OUTCOMES = {
  no_show: {
    status: "consultation_no_show",
    note: "Patient no-show. Reschedule the visit.",
  },
  call_dropped: {
    status: "consultation_dropped",
    note: "Call dropped. Resume the visit or reschedule.",
  },
  reschedule: {
    status: "consultation_reschedule",
    note: "Reschedule requested.",
  },
} as const;

export const recordConsultationOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        outcome: z.enum(["no_show", "call_dropped", "reschedule"]),
        note: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const role = await assertReviewer(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const req = await loadScopedRequest(
      supabaseAdmin,
      data.requestId,
      role,
      context.userId,
      "id, status, provider_id",
    );
    if (data.outcome === "reschedule" && (data.note?.trim().length ?? 0) < 3) {
      throw new Error("Add a short note for the reschedule.");
    }
    const preset = CONSULT_OUTCOMES[data.outcome];
    const note = [preset.note, data.note?.trim()].filter(Boolean).join(" ");
    const { error } = await supabaseAdmin.from("medication_request_events").insert({
      request_id: req.id,
      status: preset.status,
      actor_role: role,
      created_by: context.userId,
      note,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
