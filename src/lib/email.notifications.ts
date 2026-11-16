/**
 * Domain helpers for Body Inc transactional emails.
 * Import only from server functions (lazy-import the Brevo client).
 */

import type { EmailTemplateKey } from "@/lib/email.templates";

export type ProfileContact = { email: string; name: string | null };

export async function resolveProfileContact(
  supabaseAdmin: any,
  userId: string | null | undefined,
): Promise<ProfileContact | null> {
  if (!userId) return null;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("email, full_name")
    .eq("id", userId)
    .maybeSingle();
  const email = (data as { email?: string | null } | null)?.email?.trim();
  if (!email) return null;
  return {
    email,
    name: (data as { full_name?: string | null } | null)?.full_name ?? null,
  };
}

export async function resolveMedicineName(
  supabaseAdmin: any,
  medicineId: string | null | undefined,
): Promise<string> {
  if (!medicineId) return "your medication";
  const { data } = await supabaseAdmin
    .from("medicines")
    .select("name")
    .eq("id", medicineId)
    .maybeSingle();
  return (data as { name?: string } | null)?.name?.trim() || "your medication";
}

/** Copied on every admin notification. Not added to patient or provider mail. */
const ADMIN_EMAIL_CC = "parth@appsrow.com";

const DEFAULT_PROVIDER_PORTAL = "https://provider.bodyinc.com";

/** Absolute provider site. A relative or localhost link makes the email button open a missing page. */
function providerPortalOrigin(): string {
  const configured = (process.env.PROVIDER_APP_URL || process.env.PROVIDER_PORTAL_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (
    /^https?:\/\//i.test(configured) &&
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(configured)
  ) {
    return configured;
  }
  return DEFAULT_PROVIDER_PORTAL;
}

type NotifyOpts = {
  supabaseAdmin: any;
  userId: string | null | undefined;
  template: EmailTemplateKey;
  params?: Record<string, string | number | boolean | null | undefined>;
};

/** Resolve contact + send email. Never throws. Returns whether Brevo accepted the message. */
export async function notifyUserById(opts: NotifyOpts): Promise<boolean> {
  try {
    const contact = await resolveProfileContact(opts.supabaseAdmin, opts.userId);
    if (!contact) {
      console.warn(`[email] no contact for user ${opts.userId}; skip ${opts.template}`);
      return false;
    }
    const { sendTransactionalEmail } = await import("@/integrations/brevo/client.server");
    const result = await sendTransactionalEmail({
      to: { email: contact.email, name: contact.name },
      ...(opts.template.startsWith("admin_") ? { cc: { email: ADMIN_EMAIL_CC } } : {}),
      template: opts.template,
      params: {
        FIRSTNAME: contact.name?.split(/\s+/)[0] ?? "",
        FULLNAME: contact.name ?? "",
        ...opts.params,
      },
    });
    if (!result.ok) {
      if (result.skipped) {
        console.warn(`[brevo] skipped ${opts.template}: ${result.reason}`);
      } else {
        console.error(`[brevo] ${opts.template} failed: ${result.error}`);
      }
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[email] notifyUserById ${opts.template} failed:`, e);
    return false;
  }
}

const PATIENT_TEMPLATE_STATUS: Partial<Record<EmailTemplateKey, string>> = {
  patient_approved: "approved",
  patient_rejected: "rejected",
  patient_additional_payment: "awaiting_additional_payment",
  patient_prescription_ready: "prescribed",
  patient_sent_to_pharmacy: "sent_to_pharmacy",
  patient_shipped: "dispatched",
  patient_delivered: "delivered",
  patient_provider_assigned: "provider_assigned",
};

/** Must match patient-portal `sendUnsentOrderStatusEmails` claim keys. */
const PATIENT_STATUS_REMINDER = "order_status";

function patientStatusClaim(template: EmailTemplateKey, requestId: string): {
  targetId: string;
  periodKey: string;
} {
  const status = PATIENT_TEMPLATE_STATUS[template];
  if (status) return { targetId: requestId, periodKey: status };
  return { targetId: requestId, periodKey: template };
}

async function claimPatientOrderEmail(
  supabaseAdmin: any,
  targetId: string,
  periodKey: string,
): Promise<boolean> {
  const { error } = await supabaseAdmin.from("email_reminders").insert({
    reminder_type: PATIENT_STATUS_REMINDER,
    target_id: targetId,
    period_key: periodKey,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  console.error(`[email] failed to claim ${PATIENT_STATUS_REMINDER}/${targetId}: ${error.message}`);
  return false;
}

async function releasePatientOrderEmail(
  supabaseAdmin: any,
  targetId: string,
  periodKey: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("email_reminders")
    .delete()
    .eq("reminder_type", PATIENT_STATUS_REMINDER)
    .eq("target_id", targetId)
    .eq("period_key", periodKey);
  if (error) {
    console.error(`[email] failed to release ${PATIENT_STATUS_REMINDER}/${targetId}: ${error.message}`);
  }
}

export async function notifyPatientRequestEvent(opts: {
  supabaseAdmin: any;
  request: {
    id: string;
    user_id?: string | null;
    medicine_id?: string | null;
    tracking_number?: string | null;
  };
  template: EmailTemplateKey;
  extraParams?: Record<string, string | number | boolean | null | undefined>;
}): Promise<boolean> {
  const claim = patientStatusClaim(opts.template, opts.request.id);
  if (!(await claimPatientOrderEmail(opts.supabaseAdmin, claim.targetId, claim.periodKey))) {
    return true;
  }

  const medicineName = await resolveMedicineName(opts.supabaseAdmin, opts.request.medicine_id);
  const sent = await notifyUserById({
    supabaseAdmin: opts.supabaseAdmin,
    userId: opts.request.user_id,
    template: opts.template,
    params: {
      ORDER_ID: opts.request.id,
      MEDICINE_NAME: medicineName,
      TRACKING_NUMBER: opts.request.tracking_number ?? "",
      PORTAL_URL: process.env.PATIENT_PORTAL_URL?.replace(/\/$/, "") ?? "",
      ...opts.extraParams,
    },
  });
  if (sent) return true;
  await releasePatientOrderEmail(opts.supabaseAdmin, claim.targetId, claim.periodKey);
  return false;
}

export function medicineChangeMailLinks(requestId: string, kind: "payment" | "consent") {
  const portalBase = process.env.PATIENT_PORTAL_URL?.replace(/\/$/, "") ?? "";
  if (!portalBase) return { PORTAL_URL: "", SECONDARY_URL: "" };
  const review = `${portalBase}/orders/${requestId}`;
  if (kind === "payment") {
    return { PORTAL_URL: `${review}/pay`, SECONDARY_URL: `${review}?action=decline` };
  }
  return {
    PORTAL_URL: `${review}?action=approve`,
    SECONDARY_URL: `${review}?action=reject`,
  };
}

/** One reminder, 24 hours after the change. Does not reuse the original plan-change email claim. */
export async function remindPatientOfPlanChange(opts: {
  supabaseAdmin: any;
  request: { id: string; user_id?: string | null; medicine_id?: string | null };
}): Promise<boolean> {
  const targetId = opts.request.id;
  const periodKey = "plan_change_reminder";
  if (!(await claimPatientOrderEmail(opts.supabaseAdmin, targetId, periodKey))) return false;
  const { data: row } = await opts.supabaseAdmin
    .from("medication_requests")
    .select("plan_change_token, plan_change_delta_cents, medicine_id, user_id")
    .eq("id", opts.request.id)
    .maybeSingle();
  const delta = Number(row?.plan_change_delta_cents ?? 0);
  const amount = Math.max(delta, 0);
  const waitingForConsent = amount <= 0 && Boolean(row?.plan_change_token);
  if (amount <= 0 && !waitingForConsent) {
    await releasePatientOrderEmail(opts.supabaseAdmin, targetId, periodKey);
    return false;
  }
  const medicineName = await resolveMedicineName(
    opts.supabaseAdmin,
    row?.medicine_id ?? opts.request.medicine_id,
  );
  const links = medicineChangeMailLinks(
    opts.request.id,
    waitingForConsent ? "consent" : "payment",
  );
  const sent = await notifyUserById({
    supabaseAdmin: opts.supabaseAdmin,
    userId: row?.user_id ?? opts.request.user_id,
    template: waitingForConsent ? "patient_plan_consent" : "patient_additional_payment",
    params: {
      ORDER_ID: opts.request.id,
      MEDICINE_NAME: medicineName,
      AMOUNT_DUE: (amount / 100).toFixed(2),
      CREDIT_AMOUNT: delta < 0 ? (Math.abs(delta) / 100).toFixed(2) : "0.00",
      IS_REMINDER: "1",
      PORTAL_URL: links.PORTAL_URL,
      SECONDARY_URL: links.SECONDARY_URL,
    },
  });
  if (sent) return true;
  await releasePatientOrderEmail(opts.supabaseAdmin, targetId, periodKey);
  return false;
}

export async function notifyProviderRequestEvent(opts: {
  supabaseAdmin: any;
  providerId: string | null | undefined;
  requestId: string;
  medicineId?: string | null;
  template: EmailTemplateKey;
  /** When set, skip email (provider claimed / acted themselves). */
  actorUserId?: string | null;
  extraParams?: Record<string, string | number | boolean | null | undefined>;
}): Promise<void> {
  if (!opts.providerId) return;
  if (opts.actorUserId && opts.actorUserId === opts.providerId) return;

  const medicineName = await resolveMedicineName(opts.supabaseAdmin, opts.medicineId);
  const providerPortal = providerPortalOrigin();
  const { data: reqRow } = await opts.supabaseAdmin
    .from("medication_requests")
    .select("user_id")
    .eq("id", opts.requestId)
    .maybeSingle();
  const patient = await resolveProfileContact(opts.supabaseAdmin, reqRow?.user_id);
  let patientName = patient?.name?.trim() || "";
  if (!patientName && reqRow?.user_id) {
    const { data: nameRow } = await opts.supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", reqRow.user_id)
      .maybeSingle();
    patientName = (nameRow as { full_name?: string | null } | null)?.full_name?.trim() || "";
  }

  await notifyUserById({
    supabaseAdmin: opts.supabaseAdmin,
    userId: opts.providerId,
    template: opts.template,
    params: {
      ORDER_ID: opts.requestId,
      MEDICINE_NAME: medicineName,
      PATIENT_NAME: patientName || "A patient",
      REQUEST_URL: `${providerPortal}/provider/requests/${opts.requestId}`,
      ...opts.extraParams,
    },
  });
}

const CLAIM_READY_STATUSES = [
  "payment_completed",
  "provider_assigned",
  "pending_review",
  "awaiting_additional_payment",
  "approved",
  "prescribed",
];

/** One email per new unassigned patient, to every active provider licensed in that state. */
export async function notifyProvidersPatientReadyToClaim(supabaseAdmin: any): Promise<void> {
  try {
    const { filledSessionIdSet, loadShopIntakeState, shopIntakeReady } = await import(
      "@/lib/clinical-intake"
    );
    const { shopCheckoutRequestIdSet, userIdsInOpenChat } = await import("@/lib/order-groups");
    const { data: rows, error } = await supabaseAdmin
      .from("medication_requests")
      .select(
        "id, user_id, session_id, medicine_id, status, order_group_id, subscription_id, stripe_invoice_id, kind",
      )
      .is("provider_id", null)
      .in("status", CLAIM_READY_STATUSES)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error || !rows?.length) return;

    const sessionIds = Array.from(
      new Set(rows.map((r: any) => r.session_id).filter(Boolean)),
    ) as string[];
    const userIds = Array.from(new Set(rows.map((r: any) => r.user_id).filter(Boolean))) as string[];
    const [filled, inChat, shopIds, shopIntake] = await Promise.all([
      filledSessionIdSet(supabaseAdmin, sessionIds),
      userIdsInOpenChat(supabaseAdmin, userIds),
      shopCheckoutRequestIdSet(supabaseAdmin, rows as any[]),
      loadShopIntakeState(
        supabaseAdmin,
        rows.map((row: { id: string }) => row.id),
      ),
    ]);
    let ready = rows.filter((r: any) => {
      const fromShop = shopIds.has(r.id);
      const intakeReady = fromShop
        ? shopIntakeReady(shopIntake.byRequest.get(r.id))
        : Boolean(r.session_id && filled.has(r.session_id));
      return intakeReady && r.user_id && (inChat.has(r.user_id) || fromShop);
    });
    const groupIds = Array.from(new Set(ready.map((r: any) => r.order_group_id).filter(Boolean)));
    if (groupIds.length) {
      const { data: taken } = await supabaseAdmin
        .from("medication_requests")
        .select("order_group_id")
        .in("order_group_id", groupIds)
        .not("provider_id", "is", null);
      const takenGroups = new Set((taken ?? []).map((r: any) => r.order_group_id).filter(Boolean));
      ready = ready.filter((r: any) => !r.order_group_id || !takenGroups.has(r.order_group_id));
    }
    if (!ready.length) return;

    const readyIds = ready.map((r: any) => r.id).filter(Boolean);
    const { data: already } = await supabaseAdmin
      .from("email_reminders")
      .select("target_id")
      .eq("reminder_type", "provider_claim_offer")
      .eq("period_key", "ready")
      .in("target_id", readyIds);
    const announced = new Set((already ?? []).map((r: any) => r.target_id));

    const byPatient = new Map<string, any[]>();
    for (const row of ready as any[]) {
      const list = byPatient.get(row.user_id) ?? [];
      list.push(row);
      byPatient.set(row.user_id, list);
    }

    const { data: providers, error: provErr } = await supabaseAdmin
      .from("providers")
      .select("id, license_states, is_active, is_unavailable")
      .eq("is_active", true);
    if (provErr || !providers?.length) return;
    const active = (providers as any[]).filter((p) => !p.is_unavailable);
    const seenProvider = new Set<string>();
    const uniqueProviders = active.filter((p) => {
      if (!p.id || seenProvider.has(p.id)) return false;
      seenProvider.add(p.id);
      return true;
    });

    const portal = providerPortalOrigin();

    for (const rows of byPatient.values()) {
      const group = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      if (group.some((row) => announced.has(row.id))) continue;
      const lead = group[0];
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name, state_code")
        .eq("id", lead.user_id)
        .maybeSingle();
      const state = String((profile as any)?.state_code ?? "")
        .trim()
        .toUpperCase();
      const patientName = (profile as any)?.full_name?.trim() || "A patient";
      if (!state) continue;
      const licensed = uniqueProviders.filter((p) =>
        ((p.license_states ?? []) as string[])
          .map((s) => String(s).toUpperCase())
          .includes(state),
      );
      if (!licensed.length) continue;
      const medicineNames = Array.from(
        new Set(
          (
            await Promise.all(group.map((row) => resolveMedicineName(supabaseAdmin, row.medicine_id)))
          ).filter(Boolean),
        ),
      );
      const { error: claimErr } = await supabaseAdmin.from("email_reminders").insert({
        reminder_type: "provider_claim_offer",
        target_id: lead.id,
        period_key: "ready",
      });
      if (claimErr) continue;
      announced.add(lead.id);
      for (const row of group.slice(1)) {
        const { error: siblingErr } = await supabaseAdmin.from("email_reminders").insert({
          reminder_type: "provider_claim_offer",
          target_id: row.id,
          period_key: "ready",
        });
        if (!siblingErr) announced.add(row.id);
      }
      const seenInbox = new Set<string>();
      for (const provider of licensed) {
        const contact = await resolveProfileContact(supabaseAdmin, provider.id);
        const inbox = contact?.email?.trim().toLowerCase();
        if (!inbox || seenInbox.has(inbox)) continue;
        seenInbox.add(inbox);
        await notifyUserById({
          supabaseAdmin,
          userId: provider.id,
          template: "provider_patient_ready",
          params: {
            ORDER_ID: lead.id,
            MEDICINE_NAME: medicineNames.join(", ") || "a treatment",
            PATIENT_NAME: patientName,
            REQUEST_URL: `${portal}/provider/requests/${lead.id}`,
            ORDER_SOURCE: shopIds.has(lead.id) ? "shop" : "onboarding",
          },
        });
      }
    }
  } catch (e) {
    console.error("[email] notifyProvidersPatientReadyToClaim failed:", e);
  }
}

/** Email every admin when a provider clinically approves an order (ready for pharmacy send). */
export async function notifyAdminsProviderApproved(opts: {
  supabaseAdmin: any;
  requestId: string;
  medicineId?: string | null;
  providerId?: string | null;
  patientUserId?: string | null;
}): Promise<number> {
  try {
    const { data: roleRows } = await opts.supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIds = Array.from(
      new Set(((roleRows ?? []) as { user_id: string }[]).map((r) => r.user_id).filter(Boolean)),
    );
    if (adminIds.length === 0) return 0;

    const medicineName = await resolveMedicineName(opts.supabaseAdmin, opts.medicineId);
    const [provider, patient] = await Promise.all([
      resolveProfileContact(opts.supabaseAdmin, opts.providerId),
      resolveProfileContact(opts.supabaseAdmin, opts.patientUserId),
    ]);

    const adminPortal =
      process.env.ADMIN_APP_URL?.replace(/\/$/, "") ||
      process.env.APP_URL?.replace(/\/$/, "") ||
      "https://admin.bodyinc.com";

    let sentCount = 0;
    for (const adminId of adminIds) {
      const ok = await notifyUserById({
        supabaseAdmin: opts.supabaseAdmin,
        userId: adminId,
        template: "admin_provider_approved",
        params: {
          ORDER_ID: opts.requestId,
          MEDICINE_NAME: medicineName,
          PROVIDER_NAME: provider?.name ?? "Provider",
          PATIENT_NAME: patient?.name ?? "Patient",
          REQUEST_URL: `${adminPortal}/admin/requests/${opts.requestId}`,
        },
      });
      if (ok) sentCount += 1;
    }
    return sentCount;
  } catch (e) {
    console.error("[email] notifyAdminsProviderApproved failed:", e);
    return 0;
  }
}

const NEW_FEEDBACK_REMINDER = "admin_new_feedback";

async function listAdminUserIds(supabaseAdmin: any): Promise<string[]> {
  const { data: roleRows } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
  return Array.from(
    new Set(((roleRows ?? []) as { user_id: string }[]).map((r) => r.user_id).filter(Boolean)),
  );
}

function adminPortalBase(): string {
  return (
    process.env.ADMIN_APP_URL?.replace(/\/$/, "") ||
    process.env.APP_URL?.replace(/\/$/, "") ||
    "https://admin.bodyinc.com"
  );
}

/** Email every admin when a patient submits new feedback. */
export async function notifyAdminsNewFeedback(opts: {
  supabaseAdmin: any;
  feedback: {
    id: string;
    full_name?: string | null;
    email?: string | null;
    message: string;
    category?: string | null;
  };
}): Promise<number> {
  try {
    const adminIds = await listAdminUserIds(opts.supabaseAdmin);
    if (adminIds.length === 0) return 0;

    const patientName = opts.feedback.full_name?.trim() || "A patient";
    const category = opts.feedback.category?.trim() || "inquiry";
    let sentCount = 0;
    for (const adminId of adminIds) {
      const ok = await notifyUserById({
        supabaseAdmin: opts.supabaseAdmin,
        userId: adminId,
        template: "admin_new_feedback",
        params: {
          PATIENT_NAME: patientName,
          PATIENT_EMAIL: opts.feedback.email ?? "",
          CATEGORY: category,
          MESSAGE: opts.feedback.message,
          FEEDBACK_URL: `${adminPortalBase()}/admin/feedback`,
        },
      });
      if (ok) sentCount += 1;
    }
    return sentCount;
  } catch (e) {
    console.error("[email] notifyAdminsNewFeedback failed:", e);
    return 0;
  }
}

async function claimNewFeedbackEmail(supabaseAdmin: any, feedbackId: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from("email_reminders").insert({
    reminder_type: NEW_FEEDBACK_REMINDER,
    target_id: feedbackId,
    period_key: "",
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  console.error("[email] claim admin_new_feedback failed:", error.message);
  return false;
}

export async function notifyNewFeedbackIfNeeded(
  supabaseAdmin: any,
  feedbackId: string,
): Promise<boolean> {
  const { data: row, error } = await supabaseAdmin
    .from("patient_feedback")
    .select("id, email, full_name, message, category")
    .eq("id", feedbackId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return false;
  if (!(await claimNewFeedbackEmail(supabaseAdmin, feedbackId))) return true;
  await notifyAdminsNewFeedback({ supabaseAdmin, feedback: row });
  return true;
}

/** Send admin emails for any new feedback that has not been notified yet. */
export async function dispatchPendingNewFeedbackEmails(supabaseAdmin: any): Promise<void> {
  try {
    const { data: rows } = await supabaseAdmin
      .from("patient_feedback")
      .select("id, email, full_name, message, category")
      .gte("created_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(40);
    if (!rows?.length) return;

    const ids = rows.map((r: { id: string }) => r.id);
    const { data: sent } = await supabaseAdmin
      .from("email_reminders")
      .select("target_id")
      .eq("reminder_type", NEW_FEEDBACK_REMINDER)
      .in("target_id", ids);
    const sentSet = new Set(((sent ?? []) as { target_id: string }[]).map((s) => s.target_id));

    for (const row of rows as Array<{
      id: string;
      email: string | null;
      full_name: string | null;
      message: string;
      category: string | null;
    }>) {
      if (sentSet.has(row.id)) continue;
      if (!(await claimNewFeedbackEmail(supabaseAdmin, row.id))) continue;
      await notifyAdminsNewFeedback({ supabaseAdmin, feedback: row });
    }
  } catch (e) {
    console.error("[email] dispatchPendingNewFeedbackEmails failed:", e);
  }
}

export async function claimEmailReminder(
  supabaseAdmin: any,
  reminderType: string,
  targetId: string,
  periodKey: string,
): Promise<boolean> {
  const { error } = await supabaseAdmin.from("email_reminders").insert({
    reminder_type: reminderType,
    target_id: targetId,
    period_key: periodKey,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  console.error(`[email] failed to claim ${reminderType}/${targetId}: ${error.message}`);
  return false;
}

export async function releaseEmailReminder(
  supabaseAdmin: any,
  reminderType: string,
  targetId: string,
  periodKey: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("email_reminders")
    .delete()
    .eq("reminder_type", reminderType)
    .eq("target_id", targetId)
    .eq("period_key", periodKey);
  if (error) {
    console.error(`[email] failed to release ${reminderType}/${targetId}: ${error.message}`);
  }
}

/** One-off mail to an address that may not have an account yet. Never throws. */
export async function notifyEmailAddress(opts: {
  email: string;
  name?: string | null;
  template: EmailTemplateKey;
  params?: Record<string, string | number | boolean | null | undefined>;
}): Promise<boolean> {
  try {
    const email = opts.email.trim();
    if (!email) return false;
    const { sendTransactionalEmail } = await import("@/integrations/brevo/client.server");
    const name = opts.name?.trim() || null;
    const result = await sendTransactionalEmail({
      to: { email, name },
      template: opts.template,
      params: {
        FIRSTNAME: name?.split(/\s+/)[0] ?? "",
        FULLNAME: name ?? "",
        ...opts.params,
      },
    });
    if (!result.ok) {
      const detail = result.skipped ? result.reason : result.error;
      console.error(`[brevo] ${opts.template} failed: ${detail}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[email] notifyEmailAddress ${opts.template} failed:`, e);
    return false;
  }
}

/** Last medicine-change email, the day before the 7 days run out. */
export async function remindPatientPlanChangeFinal(opts: {
  supabaseAdmin: any;
  request: { id: string; user_id?: string | null; medicine_id?: string | null };
}): Promise<boolean> {
  const periodKey = "plan_change_final";
  if (!(await claimEmailReminder(opts.supabaseAdmin, PATIENT_STATUS_REMINDER, opts.request.id, periodKey))) {
    return false;
  }
  const { data: row } = await opts.supabaseAdmin
    .from("medication_requests")
    .select("plan_change_token, plan_change_delta_cents, medicine_id, user_id, status")
    .eq("id", opts.request.id)
    .maybeSingle();
  if (row?.status !== "awaiting_additional_payment") {
    await releaseEmailReminder(opts.supabaseAdmin, PATIENT_STATUS_REMINDER, opts.request.id, periodKey);
    return false;
  }
  const delta = Number(row?.plan_change_delta_cents ?? 0);
  const amount = Math.max(delta, 0);
  const waitingForConsent = amount <= 0 && Boolean(row?.plan_change_token);
  if (amount <= 0 && !waitingForConsent) {
    await releaseEmailReminder(opts.supabaseAdmin, PATIENT_STATUS_REMINDER, opts.request.id, periodKey);
    return false;
  }
  const medicineName = await resolveMedicineName(
    opts.supabaseAdmin,
    row?.medicine_id ?? opts.request.medicine_id,
  );
  const links = medicineChangeMailLinks(opts.request.id, waitingForConsent ? "consent" : "payment");
  const sent = await notifyUserById({
    supabaseAdmin: opts.supabaseAdmin,
    userId: row?.user_id ?? opts.request.user_id,
    template: waitingForConsent ? "patient_plan_consent" : "patient_additional_payment",
    params: {
      ORDER_ID: opts.request.id,
      MEDICINE_NAME: medicineName,
      AMOUNT_DUE: (amount / 100).toFixed(2),
      CREDIT_AMOUNT: delta < 0 ? (Math.abs(delta) / 100).toFixed(2) : "0.00",
      IS_REMINDER: "1",
      IS_FINAL: "1",
      PORTAL_URL: links.PORTAL_URL,
      SECONDARY_URL: links.SECONDARY_URL,
    },
  });
  if (sent) return true;
  await releaseEmailReminder(opts.supabaseAdmin, PATIENT_STATUS_REMINDER, opts.request.id, periodKey);
  return false;
}

/** Renewal invoice failed. One email per invoice, even if Stripe retries the card. */
export async function notifyRenewalCardFailed(
  supabaseAdmin: any,
  invoice: { id?: string | null; subscription?: unknown; billing_reason?: string | null },
): Promise<boolean> {
  if (invoice.billing_reason && invoice.billing_reason !== "subscription_cycle") return false;
  const subscription = invoice.subscription as { id?: string } | string | null | undefined;
  const stripeSubscriptionId = typeof subscription === "string" ? subscription : subscription?.id;
  if (!stripeSubscriptionId || !invoice.id) return false;

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, medicine_id, status")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle();
  if (!sub?.id) return false;

  if (sub.status !== "past_due") {
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "past_due", updated_at: new Date().toISOString() })
      .eq("id", sub.id);
  }
  if (!sub.user_id) return false;

  const periodKey = invoice.id;
  if (!(await claimEmailReminder(supabaseAdmin, "renewal_card_failed", sub.id, periodKey))) return false;
  const medicineName = await resolveMedicineName(supabaseAdmin, sub.medicine_id);
  const sent = await notifyUserById({
    supabaseAdmin,
    userId: sub.user_id,
    template: "patient_renewal_failed",
    params: {
      MEDICINE_NAME: medicineName,
      PORTAL_URL: process.env.PATIENT_PORTAL_URL?.replace(/\/$/, "") ?? "",
    },
  });
  if (sent) return true;
  await releaseEmailReminder(supabaseAdmin, "renewal_card_failed", sub.id, periodKey);
  return false;
}

/** The assigned provider opened the case, so the one-day waiting email should not go out. */
export async function markProviderCaseOpened(supabaseAdmin: any, requestId: string): Promise<void> {
  await claimEmailReminder(supabaseAdmin, "provider_case_opened", requestId, "opened");
}
