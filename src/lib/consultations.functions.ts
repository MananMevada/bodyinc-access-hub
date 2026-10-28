/* eslint-disable no-empty */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertReviewer } from "@/lib/admin-guard";
import { isQuickbloxConfigured, getQuickbloxConfig } from "@/lib/consultations/config";
import {
  addProviderToDialogOccupants,
  buildProviderAppointmentUrl,
  buildProviderInboxUrl,
  claimAppointmentForSession,
  createPatientAppointment,
  endQuickbloxAppointment,
  ensurePatientQuickbloxClient,
  getAppointmentById,
  getOwnerProviderAuth,
  isAppointmentOpen,
  listAllAppointments,
  listProviderAppointments,
  qbPasswordForProvider,
  type QbAppointment,
  type QuickbloxProviderSession,
} from "@/lib/consultations/quickblox";
import { sessionForBodyIncProvider } from "@/lib/consultations/provider-agent";
import { ageFromDob, bmiFrom } from "@/lib/format";

export type ConsultationVisitStatus = "open" | "ended" | "unknown";

export type ConsultationRow = {
  id: string;
  user_id: string;
  subscription_id: string;
  qb_appointment_id: string;
  started_at: string;
  patient_name: string | null;
  patient_email: string | null;
  medicine_name: string | null;
  plan_label: string | null;
  subscription_status: string | null;
  visit_status: ConsultationVisitStatus;
  request_id: string | null;
};

export type ListConsultationsResult = {
  configured: boolean;
  rows: ConsultationRow[];
};

export type OpenConsultationResult = { ok: true; url: string } | { ok: false; message: string };

const listInput = z
  .object({
    search: z.string().trim().max(200).optional(),
    userId: z.string().uuid().optional(),
  })
  .default({});

const openInput = z.object({
  consultationId: z.string().uuid(),
});

const startFromRequestInput = z.object({
  requestId: z.string().uuid(),
});

function missingTable(error: { message?: string; code?: string } | null) {
  const message = error?.message ?? "";
  return error?.code === "42P01" || /patient_consultations/i.test(message);
}

function missingEndedAtColumn(error: { message?: string; code?: string } | null) {
  const message = error?.message ?? "";
  return error?.code === "42703" || /ended_at/i.test(message);
}

function visitFromAppointment(item: QbAppointment): ConsultationVisitStatus {
  return isAppointmentOpen(item) ? "open" : "ended";
}

async function assignedPatientIds(supabaseAdmin: any, providerId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("medication_requests")
    .select("user_id")
    .eq("provider_id", providerId)
    .not("user_id", "is", null);
  if (error) throw new Error(error.message);
  return [
    ...new Set((data ?? []).map((row: { user_id: string | null }) => row.user_id).filter(Boolean)),
  ] as string[];
}

async function visitStatusByAppointmentId(neededIds: string[], extraTokens: string[] = []) {
  const map = new Map<string, ConsultationVisitStatus>();
  const dateEnd = new Map<string, string | null>();

  const fill = (items: QbAppointment[]) => {
    for (const item of items) {
      if (!item._id) continue;
      const next = visitFromAppointment(item);
      // A close on any QuickBlox login wins. The clinic account often still looks open.
      if (map.get(item._id) === "ended") continue;
      map.set(item._id, next);
      if (next === "ended" || !dateEnd.has(item._id)) {
        dateEnd.set(item._id, item.date_end ?? null);
      }
    }
  };

  const lists = [
    listProviderAppointments(),
    listAllAppointments(),
    ...extraTokens.map((token) => listProviderAppointments(token)),
  ];
  const results = await Promise.allSettled(lists);
  for (const result of results) {
    if (result.status !== "fulfilled") {
      console.warn("[consultations] list provider appointments failed:", result.reason);
      continue;
    }
    fill(result.value);
  }

  const missing = neededIds.filter((id) => id && !map.has(id));
  for (let i = 0; i < missing.length; i += 8) {
    const chunk = missing.slice(i, i + 8);
    const fetched = await Promise.all(
      chunk.map(async (id) => {
        const item = await getAppointmentById(id, extraTokens[0]);
        return item ? ([id, item] as const) : null;
      }),
    );
    for (const row of fetched) {
      if (!row) continue;
      fill([row[1]]);
    }
  }

  return { status: map, dateEnd };
}

async function persistEndedAt(
  supabaseAdmin: any,
  rows: { id: string; qb_appointment_id: string; ended_at?: string | null }[],
  visit: { status: Map<string, ConsultationVisitStatus>; dateEnd: Map<string, string | null> },
) {
  const now = new Date().toISOString();
  const updates = rows.flatMap((row) => {
    const status = visit.status.get(row.qb_appointment_id);
    if (!status) return [];
    if (status === "ended" && !row.ended_at) {
      return [{ id: row.id, ended_at: visit.dateEnd.get(row.qb_appointment_id) || now }];
    }
    return [];
  });

  await Promise.all(
    updates.map(async (update) => {
      const { error } = await supabaseAdmin
        .from("patient_consultations")
        .update({ ended_at: update.ended_at, updated_at: now })
        .eq("id", update.id);
      if (error && !missingEndedAtColumn(error)) {
        console.warn("[consultations] persist ended_at failed:", error.message);
      }
    }),
  );
}

async function reviewerQuickbloxSession(
  role: "admin" | "provider",
  userId: string,
  supabaseAdmin: any,
) {
  if (role === "provider") {
    try {
      return await sessionForBodyIncProvider(supabaseAdmin, userId);
    } catch (err) {
      console.warn(
        "[consultations] provider session failed, falling back to clinic admin session:",
        err instanceof Error ? err.message : err,
      );
      return getOwnerProviderAuth();
    }
  }
  return getOwnerProviderAuth();
}

export const pendingConsultationCountQueryKey = ["pending-consultation-count"] as const;

/** Open visits only. Closed consultations stay on the list and off the sidebar badge. */
export const countPendingConsultations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await assertReviewer(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const loadRows = async (includeEndedAt: boolean) => {
      let q = supabaseAdmin
        .from("patient_consultations")
        .select(
          includeEndedAt
            ? "id, user_id, qb_appointment_id, ended_at"
            : "id, user_id, qb_appointment_id",
        )
        .limit(300);
      if (role === "provider") {
        const ids = await assignedPatientIds(supabaseAdmin, context.userId);
        if (ids.length === 0) return { data: [], error: null };
        q = q.in("user_id", ids);
      }
      return q;
    };

    let { data: rows, error } = await loadRows(true);
    if (error && missingEndedAtColumn(error)) {
      ({ data: rows, error } = await loadRows(false));
    }
    if (error) {
      if (missingTable(error)) return 0;
      throw new Error(error.message);
    }

    const consultations = (rows ?? []).map((row) => ({
      qb_appointment_id: String((row as { qb_appointment_id?: string }).qb_appointment_id ?? ""),
      ended_at:
        "ended_at" in (row as object)
          ? ((row as { ended_at?: string | null }).ended_at ?? null)
          : null,
    }));
    if (consultations.length === 0) return 0;

    const extraTokens: string[] = [];
    if (role === "provider") {
      try {
        extraTokens.push((await sessionForBodyIncProvider(supabaseAdmin, context.userId)).token);
      } catch (sessionError) {
        console.warn("[consultations] provider session for count failed:", sessionError);
      }
    }

    const visit = await visitStatusByAppointmentId(
      consultations.map((row) => row.qb_appointment_id),
      extraTokens,
    );

    return consultations.filter((row) => {
      if (row.ended_at) return false;
      return visit.status.get(row.qb_appointment_id) !== "ended";
    }).length;
  });

export const listConsultations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<ListConsultationsResult> => {
    const role = await assertReviewer(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("patient_consultations")
      .select("id, user_id, subscription_id, qb_appointment_id, started_at, ended_at")
      .order("started_at", { ascending: false })
      .limit(300);

    if (data.userId) q = q.eq("user_id", data.userId);

    if (role === "provider") {
      const ids = await assignedPatientIds(supabaseAdmin, context.userId);
      if (ids.length === 0) return { configured: isQuickbloxConfigured(), rows: [] };
      if (data.userId && !ids.includes(data.userId)) {
        return { configured: isQuickbloxConfigured(), rows: [] };
      }
      q = q.in("user_id", ids);
    }

    let { data: rows, error } = await q;
    if (error && missingEndedAtColumn(error)) {
      const fallback = supabaseAdmin
        .from("patient_consultations")
        .select("id, user_id, subscription_id, qb_appointment_id, started_at")
        .order("started_at", { ascending: false })
        .limit(300);
      const retried = data.userId ? fallback.eq("user_id", data.userId) : fallback;
      const scoped =
        role === "provider"
          ? retried.in("user_id", await assignedPatientIds(supabaseAdmin, context.userId))
          : retried;
      const res: any = await scoped;
      rows = res.data;
      error = res.error;
    }
    if (error) {
      if (missingTable(error)) return { configured: isQuickbloxConfigured(), rows: [] };
      throw new Error(error.message);
    }

    const consultations = (rows ?? []).map((row) => ({
      ...row,
      ended_at: "ended_at" in row ? ((row as { ended_at?: string | null }).ended_at ?? null) : null,
    }));
    if (consultations.length === 0) {
      return { configured: isQuickbloxConfigured(), rows: [] };
    }

    const userIds = [...new Set(consultations.map((row) => row.user_id))];
    const subIds = [...new Set(consultations.map((row) => row.subscription_id))];

    const providerIds = new Set<string>();
    if (role === "provider") providerIds.add(context.userId);
    const { data: assigned } = await supabaseAdmin
      .from("medication_requests")
      .select("provider_id")
      .in("user_id", userIds)
      .not("provider_id", "is", null);
    for (const row of assigned ?? []) {
      if (row.provider_id) providerIds.add(row.provider_id);
    }
    const extraTokens: string[] = [];
    await Promise.all(
      [...providerIds].map(async (providerId) => {
        try {
          extraTokens.push((await sessionForBodyIncProvider(supabaseAdmin, providerId)).token);
        } catch (error) {
          console.warn("[consultations] provider QuickBlox session failed:", error);
        }
      }),
    );

    const [{ data: profiles }, { data: subs }, visit] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds),
      supabaseAdmin
        .from("subscriptions")
        .select("id, status, medicine_id, package_id")
        .in("id", subIds),
      visitStatusByAppointmentId(
        consultations.map((row) => row.qb_appointment_id),
        extraTokens,
      ),
    ]);

    void persistEndedAt(supabaseAdmin, consultations, visit);

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const subMap = new Map((subs ?? []).map((s: any) => [s.id, s]));
    const medIds = [
      ...new Set(
        (subs ?? []).map((s: any) => s.medicine_id).filter((id: string | null) => Boolean(id)),
      ),
    ];
    const pkgIds = [
      ...new Set(
        (subs ?? []).map((s: any) => s.package_id).filter((id: string | null) => Boolean(id)),
      ),
    ];

    const [{ data: meds }, { data: pkgs }, { data: reqRows }] = await Promise.all([
      medIds.length
        ? supabaseAdmin.from("medicines").select("id, name").in("id", medIds)
        : Promise.resolve({ data: [] as any[] }),
      pkgIds.length
        ? supabaseAdmin.from("packages").select("id, name").in("id", pkgIds)
        : Promise.resolve({ data: [] as any[] }),
      userIds.length || subIds.length
        ? (supabaseAdmin as any)
            .from("medication_requests")
            .select("id, user_id, subscription_id")
            .or(
              [
                userIds.length ? `user_id.in.(${userIds.join(",")})` : null,
                subIds.length ? `subscription_id.in.(${subIds.join(",")})` : null,
              ]
                .filter(Boolean)
                .join(","),
            )
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const medMap = new Map((meds ?? []).map((m: any) => [m.id, m.name as string]));
    const pkgMap = new Map((pkgs ?? []).map((p: any) => [p.id, p.name as string]));

    const reqBySubId = new Map<string, string>();
    const reqByUserId = new Map<string, string>();
    for (const r of (reqRows ?? []) as any[]) {
      if (r.subscription_id && !reqBySubId.has(r.subscription_id)) {
        reqBySubId.set(r.subscription_id, r.id);
      }
      if (r.user_id && !reqByUserId.has(r.user_id)) {
        reqByUserId.set(r.user_id, r.id);
      }
    }

    const search = data.search?.trim().toLowerCase();
    const mapped: ConsultationRow[] = consultations.map((row) => {
      const profile = profileMap.get(row.user_id);
      const sub = subMap.get(row.subscription_id);
      const reqId =
        (row.subscription_id ? reqBySubId.get(row.subscription_id) : null) ??
        (row.user_id ? reqByUserId.get(row.user_id) : null) ??
        null;
      return {
        id: row.id,
        user_id: row.user_id,
        subscription_id: row.subscription_id,
        request_id: reqId,
        qb_appointment_id: row.qb_appointment_id,
        started_at: row.started_at,
        patient_name: profile?.full_name ?? null,
        patient_email: role === "admin" ? (profile?.email ?? null) : null,
        medicine_name: sub?.medicine_id ? (medMap.get(sub.medicine_id) ?? null) : null,
        plan_label: sub?.package_id ? (pkgMap.get(sub.package_id) ?? null) : null,
        subscription_status: sub?.status ?? null,
        visit_status:
          visit.status.get(row.qb_appointment_id) === "ended" || row.ended_at
            ? "ended"
            : (visit.status.get(row.qb_appointment_id) ?? "unknown"),
      };
    });

    const filtered = search
      ? mapped.filter((row) => {
          const haystack = [
            row.patient_name,
            row.patient_email,
            row.medicine_name,
            row.plan_label,
            row.user_id,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(search);
        })
      : mapped;

    return { configured: isQuickbloxConfigured(), rows: filtered };
  });

export const openConsultation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => openInput.parse(input))
  .handler(async ({ data, context }): Promise<OpenConsultationResult> => {
    const role = await assertReviewer(context);
    if (!isQuickbloxConfigured()) {
      return { ok: false, message: "Consultations are not available yet." };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("patient_consultations")
      .select("id, user_id, qb_appointment_id")
      .eq("id", data.consultationId)
      .maybeSingle();

    if (error) {
      if (missingTable(error))
        return { ok: false, message: "Consultations are not available yet." };
      return { ok: false, message: error.message };
    }
    if (!row?.qb_appointment_id) return { ok: false, message: "Consultation not found." };

    if (role === "provider") {
      const ids = await assignedPatientIds(supabaseAdmin, context.userId);
      if (!ids.includes(row.user_id)) return { ok: false, message: "Forbidden" };
    }

    try {
      const session = await reviewerQuickbloxSession(role, context.userId, supabaseAdmin);
      try {
        await claimAppointmentForSession({
          appointmentId: row.qb_appointment_id,
          qbProviderId: session.userId,
          token: session.token,
        });
      } catch (error) {
        console.warn("[consultations] reassign failed:", error);
      }
      return {
        ok: true,
        url: buildProviderAppointmentUrl({
          token: session.token,
          appointmentId: row.qb_appointment_id,
        }),
      };
    } catch (error) {
      console.error("[consultations] open failed:", error);
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Unable to open this consultation.",
      };
    }
  });

export const startRequestConsultation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => startFromRequestInput.parse(input))
  .handler(async ({ data, context }): Promise<OpenConsultationResult> => {
    const role = await assertReviewer(context);
    if (!isQuickbloxConfigured()) {
      return { ok: false, message: "Consultations are not available yet." };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req, error } = await supabaseAdmin
      .from("medication_requests")
      .select("id, user_id, provider_id, subscription_id, medicine_id, status, session_id")
      .eq("id", data.requestId)
      .maybeSingle();
    if (error) return { ok: false, message: error.message };
    if (!req) return { ok: false, message: "Request not found." };
    if (role === "provider" && req.provider_id !== context.userId) {
      return { ok: false, message: "Forbidden" };
    }
    if (!req.user_id) {
      return {
        ok: false,
        message: "This patient does not have an account yet, so a consultation cannot start.",
      };
    }
    if (!req.subscription_id) {
      return { ok: false, message: "This order is missing a subscription." };
    }

    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from("patient_consultations")
      .select("id, qb_appointment_id, qb_dialog_id, started_at")
      .eq("subscription_id", req.subscription_id)
      .eq("user_id", req.user_id)
      .order("started_at", { ascending: true });
    if (existingError) return { ok: false, message: existingError.message };
    const existing = (existingRows ?? []).find((row) => row.qb_appointment_id) ?? null;
    const storedId = existing?.qb_appointment_id ?? null;

    try {
      const session = await reviewerQuickbloxSession(role, context.userId, supabaseAdmin);

      let targetProviderQbId = session.userId;
      if (req.provider_id) {
        try {
          const { provisionBodyIncProviderAgent } =
            await import("@/lib/consultations/provider-agent");
          const provAgent = await provisionBodyIncProviderAgent(supabaseAdmin, req.provider_id);
          targetProviderQbId = provAgent.qbUserId;
        } catch (provErr) {
          console.warn("[consultations] provision assigned provider agent failed:", provErr);
        }
      }

      if (storedId) {
        try {
          await claimAppointmentForSession({
            appointmentId: storedId,
            qbProviderId: targetProviderQbId,
            token: session.token,
            dialogId: existing?.qb_dialog_id ?? null,
          });
        } catch (error) {
          console.warn("[consultations] reassign failed:", error);
        }
        return {
          ok: true,
          url: buildProviderAppointmentUrl({
            token: session.token,
            appointmentId: storedId,
          }),
        };
      }

      const [{ data: profile }, { data: intake }, { data: medicine }] = await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("full_name, dob, sex")
          .eq("id", req.user_id)
          .maybeSingle(),
        req.session_id
          ? supabaseAdmin
              .from("intake_sessions")
              .select("full_name, dob, sex")
              .eq("id", req.session_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        req.medicine_id
          ? supabaseAdmin.from("medicines").select("name").eq("id", req.medicine_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const dobRaw = profile?.dob ?? intake?.dob ?? null;
      const dob = dobRaw ? String(dobRaw).slice(0, 10) : null;
      if (!dob) {
        return {
          ok: false,
          message: "Patient date of birth is required before starting a consultation.",
        };
      }

      const fullName = profile?.full_name?.trim() || intake?.full_name?.trim() || "Patient";
      const medicineName = medicine?.name?.trim() || "treatment";
      const client = await ensurePatientQuickbloxClient({
        userId: req.user_id,
        subscriptionId: req.subscription_id,
        fullName,
        dob,
        sex: profile?.sex ?? intake?.sex ?? null,
      });

      const appointment = await createPatientAppointment({
        clientId: client.userId,
        providerId: targetProviderQbId,
        providerToken: session.token,
        description: `${medicineName} consultation`,
      });

      if (appointment.dialog_id) {
        if (targetProviderQbId) {
          void addProviderToDialogOccupants({
            dialogId: appointment.dialog_id,
            qbProviderId: targetProviderQbId,
          }).catch(() => {});
        }
        if (session.userId && session.userId !== targetProviderQbId) {
          void addProviderToDialogOccupants({
            dialogId: appointment.dialog_id,
            qbProviderId: session.userId,
          }).catch(() => {});
        }
      }

      const consultationWrite = existing?.id
        ? supabaseAdmin
            .from("patient_consultations")
            .update({
              qb_user_id: client.userId,
              qb_appointment_id: appointment._id,
              qb_dialog_id: appointment.dialog_id ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id)
        : supabaseAdmin.from("patient_consultations").insert({
            user_id: req.user_id,
            subscription_id: req.subscription_id,
            qb_user_id: client.userId,
            qb_appointment_id: appointment._id,
            qb_dialog_id: appointment.dialog_id ?? null,
          });
      const { error: insertError } = await consultationWrite;
      if (insertError && insertError.code !== "23505") {
        return { ok: false, message: insertError.message };
      }
      if (insertError?.code === "23505") {
        const { data: racedRows } = await supabaseAdmin
          .from("patient_consultations")
          .select("qb_appointment_id")
          .eq("subscription_id", req.subscription_id)
          .eq("user_id", req.user_id)
          .order("started_at", { ascending: true })
          .limit(1);
        const racedId = racedRows?.[0]?.qb_appointment_id;
        if (racedId) {
          return {
            ok: true,
            url: buildProviderAppointmentUrl({
              token: session.token,
              appointmentId: racedId,
            }),
          };
        }
      }

      await supabaseAdmin.from("medication_request_events").insert({
        request_id: req.id,
        status: req.status,
        actor_role: role,
        created_by: context.userId,
        note: "Consultation started",
      });

      try {
        const { notifyUserById } = await import("@/lib/email.notifications");
        const portal = process.env.PATIENT_PORTAL_URL?.replace(/\/$/, "") ?? "";
        await notifyUserById({
          supabaseAdmin,
          userId: req.user_id,
          template: "patient_consultation_started",
          params: {
            MEDICINE_NAME: medicineName,
            PORTAL_URL: portal ? `${portal}/consultations` : "",
          },
        });
      } catch (error) {
        console.warn("[consultations] patient start email failed:", error);
      }

      return {
        ok: true,
        url: buildProviderAppointmentUrl({
          token: session.token,
          appointmentId: appointment._id,
        }),
      };
    } catch (error) {
      console.error("[consultations] start from request failed:", error);
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Unable to start this consultation.",
      };
    }
  });

export const openProviderInbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OpenConsultationResult> => {
    const role = await assertReviewer(context);
    if (!isQuickbloxConfigured()) {
      return { ok: false, message: "Consultations are not available yet." };
    }
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const session = await reviewerQuickbloxSession(role, context.userId, supabaseAdmin);
      return { ok: true, url: buildProviderInboxUrl(session.token) };
    } catch (error) {
      console.error("[consultations] inbox open failed:", error);
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Unable to open QuickBlox.",
      };
    }
  });

export type LiveQueueItem = {
  appointmentId: string;
  clientId: number;
  dialogId: string | null;
  patientName: string;
  patientEmail: string | null;
  medicineName: string | null;
  description: string;
  createdAt: number;
  updatedAt: number;
  dateEnd: string | null;
  isEnded: boolean;
  priority: number;
  requestId: string | null;
  isActiveCurrent: boolean;
  providerId?: string | null;
  providerName?: string | null;
  isAssigned?: boolean;
};

export type PatientConsultationHistoryItem = {
  id: string;
  appointmentId: string;
  requestId?: string | null;
  startedAt: string;
  endedAt: string | null;
  medicineName?: string | null;
  providerName?: string | null;
  status: "completed" | "in_progress";
  durationMinutes?: number | null;
};

export type ConsultationRoomData = {
  request: {
    id: string;
    status: string;
    requires_consultation: boolean;
    created_at: string;
    medicine_id: string | null;
    package_id: string | null;
    variant_id: string | null;
  };
  patient: {
    id: string;
    name: string;
    email: string | null;
    is_guest: boolean;
    dob: string | null;
    age: number | null;
    sex: string | null;
    state_code: string | null;
    height_cm: number | null;
    weight_kg: number | null;
    bmi: number | null;
    phone: string | null;
  };
  goals: string[];
  answers: Array<{
    id: string;
    prompt: string;
    answer: string;
    isDisqualifying: boolean;
  }>;
  eligibility: Array<{
    medicine_name: string;
    result: string;
    reason: string | null;
    evaluated_at: string | null;
  }>;
  jotformAnswers?: Array<{
    label: string;
    value: string;
  }>;
  jotformSubmittedAt?: string | null;
  patientConsultationHistory?: PatientConsultationHistoryItem[];
  totalPatientConsultations?: number;
  events?: Array<{
    id: string;
    status: string;
    actor_role: string | null;
    note: string | null;
    created_at: string;
  }>;
  pastConsultations?: Array<{
    id: string;
    appointmentId: string;
    startedAt: string;
    endedAt: string | null;
  }>;
  medicine: {
    id: string;
    name: string;
  } | null;
  package: {
    id: string;
    name: string;
    price: number | null;
    duration_months: number | null;
  } | null;
  provider: {
    id: string;
    full_name: string;
    email: string | null;
  } | null;
  consultation: {
    id: string;
    appointmentId: string;
    qbUserId: number | null;
    dialogId: string | null;
    dialogJid: string | null;
    startedAt: string | null;
    endedAt: string | null;
    isEnded: boolean;
    embedUrl: string;
    externalUrl: string;
  };
  quickblox: {
    appId: number;
    authKey: string;
    authSecret: string;
    accountKey: string;
    providerSession: {
      token: string;
      userId: number;
      password?: string;
    };
    patientQbUserId: number | null;
    adminQbUserId?: number | null;
    userDirectory?: Record<number, { name: string; role: "admin" | "provider" | "patient" }>;
  };
  liveQueue: LiveQueueItem[];
};

export const getConsultationRoomDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; message?: string; data?: ConsultationRoomData }> => {
      const role = await assertReviewer(context);
      if (!isQuickbloxConfigured()) {
        return { ok: false, message: "QuickBlox consultations are not configured yet." };
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: req, error: reqErr } = await supabaseAdmin
        .from("medication_requests")
        .select(
          "id, user_id, provider_id, subscription_id, medicine_id, package_id, variant_id, status, session_id, requires_consultation, created_at",
        )
        .eq("id", data.requestId)
        .maybeSingle();

      if (reqErr) return { ok: false, message: reqErr.message };
      if (!req) return { ok: false, message: "Medication request not found." };
      if (role === "provider" && req.provider_id !== context.userId) {
        return { ok: false, message: "Forbidden: You are not assigned to this consultation." };
      }

      // Retrieve or provision QuickBlox consultation
      let existingConsultation: any = null;
      if (req.subscription_id || req.user_id) {
        let q = supabaseAdmin
          .from("patient_consultations")
          .select("id, qb_appointment_id, qb_user_id, qb_dialog_id, started_at, created_at")
          .order("started_at", { ascending: false });
        if (req.subscription_id) {
          q = q.eq("subscription_id", req.subscription_id);
        } else if (req.user_id) {
          q = q.eq("user_id", req.user_id);
        }
        const { data: rows } = await q;
        existingConsultation = rows?.[0] ?? null;
      }

      const reviewerSession = await reviewerQuickbloxSession(role, context.userId, supabaseAdmin);
      const qbConfig = getQuickbloxConfig();

      // Resolve assigned provider's QuickBlox agent and session
      let targetProviderQbId = reviewerSession.userId;
      if (req.provider_id) {
        try {
          const { provisionBodyIncProviderAgent } =
            await import("@/lib/consultations/provider-agent");
          const provAgent = await provisionBodyIncProviderAgent(supabaseAdmin, req.provider_id);
          targetProviderQbId = provAgent.qbUserId;
        } catch (provErr) {
          console.warn("[consultations] provision assigned provider failed:", provErr);
        }
      }

      // Effective session: ALWAYS use the authentic logged-in reviewer's session (Admin is Admin, Doctor is Doctor)
      const session = reviewerSession;

      // Load Patient Profile and Intake Session
      const [
        { data: profile },
        { data: orderSession },
        { data: medRow },
        { data: pkgRow },
        { data: provRow },
      ] = await Promise.all([
        req.user_id
          ? supabaseAdmin
              .from("profiles")
              .select("id, full_name, email, dob, sex, phone, state_code")
              .eq("id", req.user_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        req.session_id
          ? supabaseAdmin
              .from("intake_sessions")
              .select("id, full_name, email, dob, sex, phone, state_code, height_cm, weight_kg")
              .eq("id", req.session_id)
              .maybeSingle()
          : req.user_id
            ? supabaseAdmin
                .from("intake_sessions")
                .select("id, full_name, email, dob, sex, phone, state_code, height_cm, weight_kg")
                .eq("claimed_by_user_id", req.user_id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        req.medicine_id
          ? supabaseAdmin
              .from("medicines")
              .select("id, name")
              .eq("id", req.medicine_id)
              .maybeSingle()
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
      ]);

      const patientSource = profile ?? orderSession;
      const dobRaw = patientSource?.dob ?? orderSession?.dob ?? null;
      const dob = dobRaw ? String(dobRaw).slice(0, 10) : null;
      const fullName = patientSource?.full_name?.trim() || "Patient";
      const medicineName = medRow?.name?.trim() || "treatment";

      // Query QuickBlox appointments for this provider session to inspect the live queue and find active visit
      let providerAppts: QbAppointment[] = [];
      try {
        if (session?.token) {
          providerAppts = await listProviderAppointments(session.token);
        }
      } catch (listErr) {
        console.warn("[consultations] listProviderAppointments failed:", listErr);
      }

      let appointmentId = existingConsultation?.qb_appointment_id ?? "";
      let qbDialogId = existingConsultation?.qb_dialog_id ?? null;
      let patientQbUserId = existingConsultation?.qb_user_id ?? null;
      let consultationRecordId = existingConsultation?.id ?? "";
      let consultationStartedAt = existingConsultation?.started_at ?? new Date().toISOString();
      let consultationEndedAt = existingConsultation?.ended_at ?? null;

      // Check if QuickBlox already has an active open appointment for this patient/client
      let apptDetail: QbAppointment | null = null;
      const openAppt = providerAppts.find(
        (a) =>
          (!a.date_end || a.date_end === "") &&
          (patientQbUserId ? a.client_id === patientQbUserId : true),
      );

      if (openAppt) {
        // Use the active open appointment from QuickBlox
        appointmentId = openAppt._id;
        qbDialogId = openAppt.dialog_id ?? qbDialogId;
        patientQbUserId = openAppt.client_id ?? patientQbUserId;
        apptDetail = openAppt;
        consultationEndedAt = null;

        // Ensure Supabase is synced with this active appointment
        if (consultationRecordId) {
          await supabaseAdmin
            .from("patient_consultations")
            .update({
              qb_appointment_id: openAppt._id,
              qb_dialog_id: openAppt.dialog_id ?? null,
              ...(openAppt.client_id ? { qb_user_id: openAppt.client_id } : {}),
              ended_at: null,
            })
            .eq("id", consultationRecordId);
        } else if (req.user_id && req.subscription_id) {
          const { data: ins } = await supabaseAdmin
            .from("patient_consultations")
            .insert({
              user_id: req.user_id,
              subscription_id: req.subscription_id,
              qb_user_id: openAppt.client_id ?? 0,
              qb_appointment_id: openAppt._id,
              qb_dialog_id: openAppt.dialog_id ?? null,
            })
            .select("id, started_at")
            .maybeSingle();
          if (ins) {
            consultationRecordId = ins.id;
            consultationStartedAt = ins.started_at;
          }
        }
      } else if (patientQbUserId) {
        const latestClientAppt = providerAppts.find((a) => a.client_id === patientQbUserId);
        if (latestClientAppt) {
          appointmentId = latestClientAppt._id;
          qbDialogId = latestClientAppt.dialog_id ?? qbDialogId;
          apptDetail = latestClientAppt;
          if (latestClientAppt.date_end) {
            consultationEndedAt = latestClientAppt.date_end;
          }
        }
      }

      // If no appointment exists yet and we have a user & subscription, provision it now
      if (!appointmentId && req.user_id && req.subscription_id && dob) {
        try {
          const client = await ensurePatientQuickbloxClient({
            userId: req.user_id,
            subscriptionId: req.subscription_id,
            fullName,
            dob,
            sex: patientSource?.sex ?? null,
          });
          patientQbUserId = client.userId;

          const newAppointment = await createPatientAppointment({
            clientId: client.userId,
            providerId: targetProviderQbId,
            providerToken: session.token,
            description: `${medicineName} consultation`,
          });

          appointmentId = newAppointment._id;
          qbDialogId = newAppointment.dialog_id ?? null;
          apptDetail = newAppointment;

          const { data: inserted } = await supabaseAdmin
            .from("patient_consultations")
            .insert({
              user_id: req.user_id,
              subscription_id: req.subscription_id,
              qb_user_id: client.userId,
              qb_appointment_id: newAppointment._id,
              qb_dialog_id: newAppointment.dialog_id ?? null,
            })
            .select("id, started_at")
            .maybeSingle();

          if (inserted) {
            consultationRecordId = inserted.id;
            consultationStartedAt = inserted.started_at;
          }

          await supabaseAdmin.from("medication_request_events").insert({
            request_id: req.id,
            status: req.status,
            actor_role: role,
            created_by: context.userId,
            note: "Consultation started",
          });
        } catch (provErr) {
          console.warn("[consultations] Auto-provision appointment failed:", provErr);
        }
      } else if (appointmentId && !apptDetail) {
        try {
          await claimAppointmentForSession({
            appointmentId,
            qbProviderId: targetProviderQbId,
            token: session.token,
            dialogId: qbDialogId,
          });
        } catch (claimErr) {
          console.warn("[consultations] Claim appointment for session failed:", claimErr);
        }

        // Ensure we have dialog_id and client_id from QuickBlox
        try {
          const appt = await getAppointmentById(appointmentId, session.token);
          apptDetail = appt;
          if (appt?.dialog_id) {
            qbDialogId = appt.dialog_id;
            void addProviderToDialogOccupants({
              dialogId: appt.dialog_id,
              qbProviderId: targetProviderQbId,
            }).catch(() => {});
          }
          if (appt?.client_id) patientQbUserId = appt.client_id;
          if (consultationRecordId && appt?.dialog_id) {
            await supabaseAdmin
              .from("patient_consultations")
              .update({
                qb_dialog_id: appt.dialog_id,
                ...(appt.client_id ? { qb_user_id: appt.client_id } : {}),
              })
              .eq("id", consultationRecordId);
          }
        } catch (inspectErr) {
          console.warn("[consultations] Inspect appointment failed:", inspectErr);
        }
      }

      // Load Intake Session questionnaire responses & categories
      const sessionId = orderSession?.id ?? req.session_id ?? null;
      let goals: string[] = [];
      let eligibility: Array<{
        medicine_name: string;
        result: string;
        reason: string | null;
        evaluated_at: string | null;
      }> = [];
      let answers: Array<{
        id: string;
        prompt: string;
        answer: string;
        isDisqualifying: boolean;
      }> = [];

      if (sessionId) {
        const [{ data: cats }, { data: elig }, { data: resp }] = await Promise.all([
          supabaseAdmin
            .from("intake_session_categories")
            .select("medication_categories(name)")
            .eq("session_id", sessionId),
          supabaseAdmin
            .from("intake_session_eligibility_results")
            .select("result, reason, evaluated_at, medicines(name)")
            .eq("session_id", sessionId)
            .order("evaluated_at", { ascending: false }),
          supabaseAdmin
            .from("intake_session_questionnaire_responses")
            .select(
              "id, answer_text, answer_number, answer_boolean, answer_option_ids, created_at, questionnaire_questions(prompt, question_type)",
            )
            .eq("session_id", sessionId)
            .order("created_at", { ascending: true }),
        ]);

        goals = ((cats ?? []) as any[])
          .map((c) => c.medication_categories?.name)
          .filter(Boolean) as string[];

        eligibility = ((elig ?? []) as any[]).map((e) => ({
          medicine_name: e.medicines?.name ?? "—",
          result: e.result,
          reason: e.reason ?? null,
          evaluated_at: e.evaluated_at ?? null,
        }));

        const optionIds = Array.from(
          new Set(((resp ?? []) as any[]).flatMap((r) => r.answer_option_ids ?? [])),
        );
        const { data: opts } = optionIds.length
          ? await supabaseAdmin
              .from("questionnaire_question_options")
              .select("id, label, is_disqualifying")
              .in("id", optionIds)
          : { data: [] as any[] };

        const optMap = new Map((opts ?? []).map((o: any) => [o.id, o]));

        answers = ((resp ?? []) as any[]).map((r) => {
          const chosenOptions = (r.answer_option_ids ?? [])
            .map((oid: string) => optMap.get(oid))
            .filter(Boolean);

          const hasDisqualifying = chosenOptions.some((o: any) => o.is_disqualifying);
          const chosenText = chosenOptions.map((o: any) => o.label).join(", ");
          const value =
            chosenText ||
            (r.answer_text ??
              (r.answer_number != null ? String(r.answer_number) : null) ??
              (r.answer_boolean != null ? (r.answer_boolean ? "Yes" : "No") : null));

          return {
            id: r.id,
            prompt: r.questionnaire_questions?.prompt ?? "Question",
            answer: value ?? "—",
            isDisqualifying: Boolean(hasDisqualifying),
          };
        });
      }

      let heightCm = orderSession?.height_cm ?? null;
      let weightKg = orderSession?.weight_kg ?? null;

      if (!heightCm || !weightKg) {
        if (req.user_id) {
          const { data: userSess } = await supabaseAdmin
            .from("intake_sessions")
            .select("height_cm, weight_kg")
            .eq("claimed_by_user_id", req.user_id)
            .not("height_cm", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (userSess?.height_cm) {
            heightCm = heightCm ?? userSess.height_cm;
            weightKg = weightKg ?? userSess.weight_kg;
          }
        }
        const patEmail = profile?.email ?? orderSession?.email;
        if ((!heightCm || !weightKg) && patEmail) {
          const { data: emailSess } = await supabaseAdmin
            .from("intake_sessions")
            .select("height_cm, weight_kg")
            .eq("email", patEmail)
            .not("height_cm", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (emailSess?.height_cm) {
            heightCm = heightCm ?? emailSess.height_cm;
            weightKg = weightKg ?? emailSess.weight_kg;
          }
        }
      }

      // Load History: medication request events and all past consultations for this patient across the application
      const [{ data: eventsRows }, { data: pastRows }, { data: allPatientRequests }] =
        await Promise.all([
          supabaseAdmin
            .from("medication_request_events")
            .select("id, status, actor_role, note, created_at")
            .eq("request_id", req.id)
            .order("created_at", { ascending: false }),
          req.user_id
            ? supabaseAdmin
                .from("patient_consultations")
                .select(
                  "id, subscription_id, qb_appointment_id, qb_dialog_id, qb_user_id, started_at, created_at",
                )
                .eq("user_id", req.user_id)
                .order("started_at", { ascending: false })
            : Promise.resolve({ data: [] }),
          req.user_id
            ? (supabaseAdmin as any)
                .from("medication_requests")
                .select(
                  "id, subscription_id, medicine_id, provider_id, status, created_at, medicines(name)",
                )
                .eq("user_id", req.user_id)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [] }),
        ]);

      const allPatientReqs = (allPatientRequests as any[]) ?? [];
      const patientProvIds = Array.from(
        new Set(allPatientReqs.map((r: any) => r.provider_id).filter(Boolean)),
      );
      const { data: patientProvProfiles } = patientProvIds.length
        ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", patientProvIds)
        : { data: [] };
      const patientProvMap = new Map(
        (patientProvProfiles ?? []).map((p: any) => [p.id, p.full_name]),
      );

      // Build comprehensive patient consultation history across the application
      const patientConsultationHistory: PatientConsultationHistoryItem[] = (pastRows ?? []).map(
        (c: any) => {
          const rMatch = c.subscription_id
            ? allPatientReqs.find((r: any) => r.subscription_id === c.subscription_id)
            : allPatientReqs.find((r: any) => r.id === req.id);
          const isEnded = Boolean(c.ended_at);
          const durationMinutes =
            c.started_at && c.ended_at
              ? Math.max(
                  1,
                  Math.round(
                    (new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()) / 60000,
                  ),
                )
              : null;
          const provName =
            (rMatch?.provider_id ? patientProvMap.get(rMatch.provider_id) : null) ||
            (c.id === consultationRecordId ? (provRow?.full_name ?? null) : null);

          return {
            id: c.id,
            appointmentId: c.qb_appointment_id,
            requestId: rMatch?.id || (c.id === consultationRecordId ? req.id : null),
            startedAt: c.started_at,
            endedAt: c.ended_at,
            medicineName:
              rMatch?.medicines?.name ||
              (c.id === consultationRecordId ? (medRow?.name ?? null) : null),
            providerName: provName,
            status: isEnded ? "completed" : "in_progress",
            durationMinutes,
          };
        },
      );

      // Fetch JotForm Intake filled data (patient intake form responses)
      let jotformAnswers: Array<{ label: string; value: string }> = [];
      let jotformSubmittedAt: string | null = null;
      try {
        const { checkJotformSubmission, fetchJotformSubmissionAnswers } =
          await import("@/lib/consultations/jotform");
        const jotCheck = await checkJotformSubmission({
          qbUserId: patientQbUserId,
          email: patientSource?.email,
          fullName,
          dob,
          phone: patientSource?.phone,
          subscriptionId: req.subscription_id,
          appointmentId,
        });
        if (jotCheck.submitted && jotCheck.submissionId) {
          jotformSubmittedAt = jotCheck.submittedAt;
          jotformAnswers = await fetchJotformSubmissionAnswers(jotCheck.submissionId);
        }
      } catch (jfErr) {
        console.warn("[consultations] jotform answers error:", jfErr);
      }

      // Check whether visit is ended in DB, QuickBlox, or events history
      const completedEvent = (eventsRows ?? []).find(
        (e: any) => typeof e.note === "string" && /consultation (completed|ended)/i.test(e.note),
      );
      if (!consultationEndedAt) {
        if (apptDetail?.date_end) {
          consultationEndedAt = apptDetail.date_end;
        } else if (completedEvent) {
          consultationEndedAt = completedEvent.created_at;
        }
      }
      const isConsultationEnded = Boolean(
        consultationEndedAt ||
        (apptDetail ? !isAppointmentOpen(apptDetail) : false) ||
        Boolean(completedEvent),
      );

      // Ensure the assigned provider and active reviewer session are added to the dialog room
      if (qbDialogId) {
        const uids = new Set<number>();
        if (targetProviderQbId) uids.add(targetProviderQbId);
        if (session?.userId) uids.add(session.userId);
        for (const uid of uids) {
          void addProviderToDialogOccupants({
            dialogId: qbDialogId,
            qbProviderId: uid,
          }).catch(() => {});
        }
      }

      // Role-based scoping for Live Queue & Waiting Room:
      // - Admin: Access to all clinic live queue & waiting room items across all providers and unassigned patients
      // - Provider: Strictly limited to queue items assigned to this provider by admin
      const isClinicalOnly = role === "provider";
      const assignedPatientIdList = isClinicalOnly
        ? await assignedPatientIds(supabaseAdmin, context.userId)
        : null;

      let qConsultsQuery = supabaseAdmin
        .from("patient_consultations")
        .select(
          "id, qb_appointment_id, qb_dialog_id, qb_user_id, user_id, subscription_id, started_at, created_at",
        )
        .order("started_at", { ascending: false })
        .limit(300);

      if (isClinicalOnly) {
        if (assignedPatientIdList && assignedPatientIdList.length > 0) {
          qConsultsQuery = qConsultsQuery.in("user_id", assignedPatientIdList);
        } else {
          qConsultsQuery = qConsultsQuery.in("user_id", ["00000000-0000-0000-0000-000000000000"]);
        }
      }

      const { data: qConsults } = await qConsultsQuery;

      // Filter providerAppts from QuickBlox if provider: only keep appointments that belong to assigned patients
      const allowedClientIds = new Set<number>(
        (qConsults ?? []).map((c: any) => c.qb_user_id).filter(Boolean),
      );
      const allowedApptIds = new Set<string>(
        (qConsults ?? []).map((c: any) => c.qb_appointment_id).filter(Boolean),
      );
      const allowedDialogIds = new Set<string>(
        (qConsults ?? []).map((c: any) => c.qb_dialog_id).filter(Boolean),
      );

      const scopedProviderAppts = isClinicalOnly
        ? providerAppts.filter((a) => {
            if (a._id === appointmentId) return true;
            if (a.client_id && allowedClientIds.has(a.client_id)) return true;
            if (a._id && allowedApptIds.has(a._id)) return true;
            if (a.dialog_id && allowedDialogIds.has(a.dialog_id)) return true;
            return false;
          })
        : providerAppts;

      // Merge: ensure all relevant appointments from Supabase are in the queue
      const queueApptsMap = new Map<string, QbAppointment>();
      for (const a of scopedProviderAppts) {
        if (a._id) queueApptsMap.set(a._id, a);
      }
      for (const c of qConsults ?? []) {
        if (c.qb_appointment_id && !queueApptsMap.has(c.qb_appointment_id)) {
          queueApptsMap.set(c.qb_appointment_id, {
            _id: c.qb_appointment_id,
            client_id: c.qb_user_id,
            dialog_id: c.qb_dialog_id,
            created_at: c.started_at
              ? Math.floor(new Date(c.started_at).getTime() / 1000)
              : undefined,
            date_end: null,
          });
        }
      }

      const allQueueAppts = Array.from(queueApptsMap.values());

      const qUserIds = [...new Set((qConsults ?? []).map((c: any) => c.user_id).filter(Boolean))];
      const qSubIds = [
        ...new Set((qConsults ?? []).map((c: any) => c.subscription_id).filter(Boolean)),
      ];

      const [{ data: qProfiles }, { data: qRequests }, { data: qIntakes }] = await Promise.all([
        qUserIds.length
          ? supabaseAdmin.from("profiles").select("id, full_name, email").in("id", qUserIds)
          : Promise.resolve({ data: [] }),
        qUserIds.length || qSubIds.length
          ? (supabaseAdmin as any)
              .from("medication_requests")
              .select("id, user_id, subscription_id, medicine_id, provider_id, medicines(name)")
              .or(
                [
                  qUserIds.length ? `user_id.in.(${qUserIds.join(",")})` : null,
                  qSubIds.length ? `subscription_id.in.(${qSubIds.join(",")})` : null,
                ]
                  .filter(Boolean)
                  .join(","),
              )
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [] }),
        qUserIds.length
          ? supabaseAdmin
              .from("intake_sessions")
              .select("claimed_by_user_id, full_name, email")
              .in("claimed_by_user_id", qUserIds)
          : Promise.resolve({ data: [] }),
      ]);

      const qReqList = (qRequests as any[]) ?? [];
      const qProvIds = Array.from(new Set(qReqList.map((r: any) => r.provider_id).filter(Boolean)));
      const { data: qProvProfiles } = qProvIds.length
        ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", qProvIds)
        : { data: [] };
      const qProvNameMap = new Map((qProvProfiles ?? []).map((p: any) => [p.id, p.full_name]));

      const qProfileMap = new Map((qProfiles ?? []).map((p: any) => [p.id, p]));
      const qIntakeMap = new Map((qIntakes ?? []).map((i: any) => [i.claimed_by_user_id, i]));
      const consultByAppt = new Map<string, any>();
      const consultByDialog = new Map<string, any>();
      const consultByClient = new Map<number, any>();
      for (const c of qConsults ?? []) {
        if (c.qb_appointment_id) consultByAppt.set(c.qb_appointment_id, c);
        if (c.qb_dialog_id) consultByDialog.set(c.qb_dialog_id, c);
        if (c.qb_user_id) consultByClient.set(c.qb_user_id, c);
      }

      // Resolve any client names from QuickBlox users directly if unmapped or missing full_name
      const missingClientIds = allQueueAppts
        .map((a) => {
          const cMatch =
            consultByAppt.get(a._id) ||
            (a.dialog_id ? consultByDialog.get(a.dialog_id) : null) ||
            consultByClient.get(a.client_id ?? 0);
          const uid = cMatch?.user_id;
          const prof = uid ? qProfileMap.get(uid) : null;
          const intakeProf = uid ? qIntakeMap.get(uid) : null;
          const hasDbName = Boolean(prof?.full_name?.trim() || intakeProf?.full_name?.trim());
          if (!hasDbName && a.client_id) return a.client_id;
          return a.client_id ?? null;
        })
        .filter((cid): cid is number => Boolean(cid));

      const qbClientNameMap = new Map<number, string>();
      const qbClientEmailMap = new Map<number, string>();
      if (missingClientIds.length > 0 && reviewerSession.token) {
        try {
          const uniqueClientIds = Array.from(new Set(missingClientIds));
          await Promise.allSettled(
            uniqueClientIds.map(async (cid) => {
              try {
                const res = await fetch(`${qbConfig.apiUrl}/users/${cid}.json`, {
                  headers: { "QB-Token": reviewerSession.token },
                  cache: "no-store",
                });
                if (res.ok) {
                  const uJson: any = await res.json();
                  const resolvedName =
                    uJson?.full_name?.trim() ||
                    uJson?.user?.full_name?.trim() ||
                    uJson?.data?.full_name?.trim() ||
                    uJson?.login?.trim() ||
                    uJson?.user?.login?.trim();
                  if (resolvedName) {
                    qbClientNameMap.set(cid, resolvedName);
                  }
                  const resolvedEmail =
                    uJson?.email?.trim() ||
                    uJson?.user?.email?.trim() ||
                    uJson?.data?.email?.trim();
                  if (resolvedEmail) {
                    qbClientEmailMap.set(cid, resolvedEmail);
                  }
                }
              } catch {}
            }),
          );
        } catch {}
      }

      const liveQueue: LiveQueueItem[] = allQueueAppts.map((a) => {
        const isCurrent = a._id === appointmentId;
        const cMatch =
          consultByAppt.get(a._id) ||
          (a.dialog_id ? consultByDialog.get(a.dialog_id) : null) ||
          consultByClient.get(a.client_id ?? 0);
        const uid = cMatch?.user_id;
        const prof = uid ? qProfileMap.get(uid) : null;
        const intakeProf = uid ? qIntakeMap.get(uid) : null;

        const reqMatch = cMatch?.subscription_id
          ? qReqList.find((r: any) => r.subscription_id === cMatch.subscription_id)
          : qReqList.find((r: any) => r.user_id === uid);

        const patientQueueName =
          (a.client_id ? qbClientNameMap.get(a.client_id) : null) ||
          prof?.full_name?.trim() ||
          intakeProf?.full_name?.trim() ||
          (isCurrent ? fullName : `Patient #${a.client_id}`);
        const medQueueName =
          reqMatch?.medicines?.name || (isCurrent ? (medRow?.name ?? null) : null);
        const provAssignedId = isCurrent ? req.provider_id : reqMatch?.provider_id;
        const provAssignedName = isCurrent
          ? provRow?.full_name
          : reqMatch?.provider_id
            ? qProvNameMap.get(reqMatch.provider_id)
            : null;

        return {
          appointmentId: a._id,
          clientId: a.client_id ?? 0,
          dialogId: a.dialog_id ?? null,
          patientName: patientQueueName,
          patientEmail:
            role === "admin"
              ? (prof?.email ??
                intakeProf?.email ??
                (a.client_id ? qbClientEmailMap.get(a.client_id) : null) ??
                null)
              : null,
          medicineName: medQueueName,
          description:
            a.description || (medQueueName ? `${medQueueName} consultation` : "Consultation"),
          createdAt: a.created_at ? a.created_at * 1000 : Date.now(),
          updatedAt: a.updated_at ? a.updated_at * 1000 : Date.now(),
          dateEnd: a.date_end ?? null,
          isEnded: Boolean(a.date_end),
          priority: a.priority ?? 0,
          requestId: isCurrent ? req.id : (reqMatch?.id ?? null),
          isActiveCurrent: isCurrent,
          providerId: provAssignedId ?? null,
          providerName: provAssignedName ?? null,
          isAssigned: Boolean(provAssignedId),
        };
      });

      // Sort liveQueue: current item first, then open/in-queue items (newest first), then ended items
      liveQueue.sort((x, y) => {
        if (x.isActiveCurrent) return -1;
        if (y.isActiveCurrent) return 1;
        if (!x.isEnded && y.isEnded) return -1;
        if (x.isEnded && !y.isEnded) return 1;
        return y.createdAt - x.createdAt;
      });

      let chatPassword = "";
      if (role === "provider") {
        try {
          chatPassword = qbPasswordForProvider(context.userId);
        } catch {
          chatPassword = session.token;
        }
      } else {
        chatPassword = qbConfig.providerPassword || session.token;
      }

      const externalUrl = appointmentId
        ? buildProviderAppointmentUrl({ token: session.token, appointmentId })
        : "";
      const embedUrl = appointmentId ? `/appointment/${appointmentId}?token=${session.token}` : "";

      const adminQbUserId = qbConfig.providerId ?? 142814409;
      const userDirectory: Record<
        number,
        { name: string; role: "admin" | "provider" | "patient" }
      > = {};
      if (adminQbUserId) {
        userDirectory[adminQbUserId] = { name: "Admin", role: "admin" };
      }
      if (targetProviderQbId && targetProviderQbId !== adminQbUserId) {
        userDirectory[targetProviderQbId] = {
          name: provRow?.full_name || "Doctor",
          role: "provider",
        };
      }
      if (session.userId && !userDirectory[session.userId]) {
        userDirectory[session.userId] = {
          name: role === "admin" ? "Admin" : provRow?.full_name || "Doctor",
          role: role === "admin" ? "admin" : "provider",
        };
      }
      if (patientQbUserId) {
        userDirectory[patientQbUserId] = { name: fullName, role: "patient" };
      }
      for (const qItem of liveQueue) {
        if (qItem.clientId && !userDirectory[qItem.clientId]) {
          userDirectory[qItem.clientId] = { name: qItem.patientName, role: "patient" };
        }
      }

      return {
        ok: true,
        data: {
          request: {
            id: req.id,
            status: req.status,
            requires_consultation: Boolean(req.requires_consultation),
            created_at: req.created_at,
            medicine_id: req.medicine_id,
            package_id: req.package_id,
            variant_id: req.variant_id,
          },
          patient: {
            id: req.user_id ?? sessionId ?? "",
            name: fullName,
            email: role === "admin" ? (patientSource?.email ?? null) : null,
            is_guest: !profile && Boolean(orderSession),
            dob,
            age: ageFromDob(dob),
            sex: patientSource?.sex ?? null,
            state_code: patientSource?.state_code ?? null,
            height_cm: heightCm,
            weight_kg: weightKg,
            bmi: bmiFrom(heightCm, weightKg),
            phone: patientSource?.phone ?? null,
          },
          goals,
          answers,
          eligibility,
          jotformAnswers,
          jotformSubmittedAt,
          patientConsultationHistory,
          totalPatientConsultations: patientConsultationHistory.length,
          events: (eventsRows ?? []).map((e: any) => ({
            id: e.id,
            status: e.status,
            actor_role: e.actor_role,
            note: e.note,
            created_at: e.created_at,
          })),
          pastConsultations: (pastRows ?? []).map((c: any) => ({
            id: c.id,
            appointmentId: c.qb_appointment_id,
            startedAt: c.started_at,
            endedAt: c.ended_at,
          })),
          medicine: medRow ? { id: medRow.id, name: medRow.name } : null,
          package: pkgRow
            ? {
                id: pkgRow.id,
                name: pkgRow.name,
                price: pkgRow.price != null ? Number(pkgRow.price) : null,
                duration_months:
                  pkgRow.duration_months != null ? Number(pkgRow.duration_months) : null,
              }
            : null,
          provider: provRow
            ? {
                id: provRow.id,
                full_name: provRow.full_name,
                email: role === "admin" ? provRow.email : null,
              }
            : null,
          consultation: {
            id: consultationRecordId,
            appointmentId,
            qbUserId: patientQbUserId,
            dialogId: qbDialogId,
            dialogJid: qbDialogId ? `${qbConfig.appId}_${qbDialogId}@muc.chat.quickblox.com` : null,
            startedAt: consultationStartedAt,
            endedAt: consultationEndedAt,
            isEnded: isConsultationEnded,
            embedUrl,
            externalUrl,
          },
          quickblox: {
            appId: qbConfig.appId,
            authKey: qbConfig.authKey,
            authSecret: qbConfig.authSecret,
            accountKey: qbConfig.accountKey,
            providerSession: {
              token: session.token,
              userId: session.userId,
              password: chatPassword,
            },
            patientQbUserId,
            adminQbUserId,
            userDirectory,
          },
          liveQueue,
        },
      };
    },
  );

export const saveConsultationClinicalNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        note: z.string().min(1, "Note cannot be empty"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; message?: string }> => {
    const role = await assertReviewer(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req, error } = await supabaseAdmin
      .from("medication_requests")
      .select("id, status, provider_id")
      .eq("id", data.requestId)
      .maybeSingle();

    if (error || !req) return { ok: false, message: "Request not found" };
    if (role === "provider" && req.provider_id && req.provider_id !== context.userId) {
      return { ok: false, message: "Forbidden: You are not assigned to this request." };
    }

    const { error: insErr } = await supabaseAdmin.from("medication_request_events").insert({
      request_id: req.id,
      status: req.status,
      actor_role: role,
      created_by: context.userId,
      note: `[Clinical Note] ${data.note.trim()}`,
    });

    // Also persist into medication_request_notes so it matches the request page Clinical Notes
    await supabaseAdmin.from("medication_request_notes").insert({
      request_id: req.id,
      author_id: context.userId,
      author_role: role,
      body: data.note.trim(),
    });

    if (insErr) return { ok: false, message: insErr.message };
    return { ok: true };
  });

export const finishConsultationAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        conclusion: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; message: string }> => {
    const role = await assertReviewer(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req, error: reqErr } = await supabaseAdmin
      .from("medication_requests")
      .select("id, user_id, provider_id, subscription_id, status")
      .eq("id", data.requestId)
      .maybeSingle();

    if (reqErr) return { ok: false, message: reqErr.message };
    if (!req) return { ok: false, message: "Medication request not found." };
    if (role === "provider" && req.provider_id && req.provider_id !== context.userId) {
      return { ok: false, message: "Forbidden: You are not assigned to this request." };
    }

    // Resolve assigned provider's session so QuickBlox authorization succeeds without 403
    let providerSession: QuickbloxProviderSession | null = null;
    if (req.provider_id) {
      try {
        const { sessionForBodyIncProvider } = await import("@/lib/consultations/provider-agent");
        providerSession = await sessionForBodyIncProvider(supabaseAdmin, req.provider_id);
      } catch (provErr) {
        console.warn("[finishConsultationAppointment] provider session failed:", provErr);
      }
    }
    if (!providerSession) {
      providerSession = await reviewerQuickbloxSession(role, context.userId, supabaseAdmin);
    }

    let consultationRows: any[] = [];
    if (req.subscription_id || req.user_id) {
      let q = supabaseAdmin
        .from("patient_consultations")
        .select("id, qb_appointment_id, qb_user_id, qb_dialog_id, started_at, subscription_id")
        .order("started_at", { ascending: false });
      if (req.subscription_id) {
        q = q.eq("subscription_id", req.subscription_id);
      } else if (req.user_id) {
        q = q.eq("user_id", req.user_id);
      }
      const { data: rows } = await q;
      consultationRows = rows ?? [];
    }

    const targetConsultRow =
      consultationRows.find((r) =>
        req.subscription_id ? r.subscription_id === req.subscription_id : true,
      ) || consultationRows[0];

    const patientQbUserId = targetConsultRow?.qb_user_id ?? consultationRows[0]?.qb_user_id ?? null;
    const directApptId = targetConsultRow?.qb_appointment_id ?? null;
    const directDialogId = targetConsultRow?.qb_dialog_id ?? null;
    const consultationRecordId = targetConsultRow?.id ?? null;

    // Collect all appointments to conclude in QuickBlox
    const appointmentsToEnd = new Set<string>();
    if (directApptId) {
      appointmentsToEnd.add(directApptId);
    }
    for (const r of consultationRows) {
      if (r.qb_appointment_id) {
        appointmentsToEnd.add(r.qb_appointment_id);
      }
    }

    try {
      if (providerSession?.token) {
        const myAppts = await listProviderAppointments(providerSession.token);
        const openMatches = myAppts.filter(
          (a) =>
            (!a.date_end || a.date_end === "") &&
            ((directApptId && a._id === directApptId) ||
              (directDialogId && a.dialog_id === directDialogId) ||
              (patientQbUserId && a.client_id === patientQbUserId)),
        );
        for (const appt of openMatches) {
          appointmentsToEnd.add(appt._id);
        }
      }
    } catch (e) {
      console.warn("[finishConsultationAppointment] listProviderAppointments error:", e);
    }

    const conclusionText = data.conclusion?.trim() || "Consultation completed";
    for (const apptId of appointmentsToEnd) {
      try {
        await endQuickbloxAppointment({
          appointmentId: apptId,
          token: providerSession?.token,
          qbProviderId: providerSession?.userId,
          conclusion: conclusionText,
        });
      } catch (qbErr) {
        console.warn(`[consultations] endQuickbloxAppointment failed for ${apptId}:`, qbErr);
      }
    }

    const now = new Date().toISOString();

    if (consultationRecordId) {
      try {
        const updatePayload: Record<string, unknown> = {
          updated_at: now,
          ...(directApptId ? { qb_appointment_id: directApptId } : {}),
          ...(directDialogId ? { qb_dialog_id: directDialogId } : {}),
        };
        const withEnded = await supabaseAdmin
          .from("patient_consultations")
          .update({ ...updatePayload, ended_at: now })
          .eq("id", consultationRecordId);
        if (withEnded.error && missingEndedAtColumn(withEnded.error)) {
          await supabaseAdmin
            .from("patient_consultations")
            .update(updatePayload as any)
            .eq("id", consultationRecordId);
        }
      } catch (dbErr) {
        console.warn("[consultations] update patient_consultations error:", dbErr);
      }
    } else if (req.user_id && req.subscription_id && directApptId) {
      try {
        await supabaseAdmin.from("patient_consultations").insert({
          user_id: req.user_id,
          subscription_id: req.subscription_id,
          qb_appointment_id: directApptId,
          qb_dialog_id: directDialogId,
          qb_user_id: patientQbUserId ?? 0,
        });
      } catch (insErr) {
        console.warn("[consultations] insert patient_consultations error:", insErr);
      }
    }

    await supabaseAdmin.from("medication_request_events").insert({
      request_id: data.requestId,
      status: req.status,
      actor_role: role,
      created_by: context.userId,
      note: `Consultation completed${data.conclusion?.trim() ? `: ${data.conclusion.trim()}` : ""}`,
    });

    if (data.conclusion?.trim()) {
      await supabaseAdmin.from("medication_request_notes").insert({
        request_id: data.requestId,
        author_id: context.userId,
        author_role: role,
        body: `[Consultation Conclusion] ${data.conclusion.trim()}`,
      });
    }

    return { ok: true, message: "Consultation appointment completed successfully." };
  });
