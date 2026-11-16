import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";
import {
  FEEDBACK_STATUSES,
  PENDING_FEEDBACK_STATUSES,
  UNSOLVED_FEEDBACK_STATUSES,
  feedbackStatusLabel,
  isStaleAwaitingConfirmation,
  type FeedbackStatus,
} from "@/lib/feedback-status";
import { sentenceCase } from "@/lib/text-normalize";

export type FeedbackReply = {
  id: string;
  author_role: "admin" | "patient";
  body: string;
  created_at: string;
};

export type PatientFeedbackRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  category: string;
  message: string;
  page_path: string | null;
  intake_session_id: string | null;
  status: FeedbackStatus;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  replies: FeedbackReply[];
};

const ACTIVE_STATUSES = UNSOLVED_FEEDBACK_STATUSES;

const listInput = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.enum(["all", "active", ...FEEDBACK_STATUSES]).default("all"),
  })
  .default({ status: "all" });

export const listPatientFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PatientFeedbackRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await autoResolveStaleInquiries(supabaseAdmin);
    void import("@/lib/email.notifications").then(({ dispatchPendingNewFeedbackEmails }) =>
      dispatchPendingNewFeedbackEmails(supabaseAdmin),
    );

    let q = supabaseAdmin
      .from("patient_feedback")
      .select(
        "id, user_id, email, full_name, category, message, page_path, intake_session_id, status, created_at, updated_at, resolved_at, patient_feedback_replies(id, author_role, body, created_at)",
      )
      .order("updated_at", { ascending: false })
      .limit(300);

    if (data.status === "active") q = q.in("status", ACTIVE_STATUSES);
    else if (data.status !== "all") q = q.eq("status", data.status);

    if (data.search) {
      const s = `%${data.search.replace(/[,()%]/g, " ")}%`;
      q = q.or(`full_name.ilike.${s},email.ilike.${s},message.ilike.${s},page_path.ilike.${s}`);
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    return (rows ?? []).map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      email: row.email,
      full_name: row.full_name,
      category: row.category,
      message: row.message,
      page_path: row.page_path,
      intake_session_id: row.intake_session_id,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at ?? row.created_at,
      resolved_at: row.resolved_at,
      replies: ((row.patient_feedback_replies ?? []) as FeedbackReply[]).sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      ),
    }));
  });

export const countUnsolvedFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    void import("@/lib/email.notifications").then(({ dispatchPendingNewFeedbackEmails }) =>
      dispatchPendingNewFeedbackEmails(supabaseAdmin),
    );
    const { count, error } = await supabaseAdmin
      .from("patient_feedback")
      .select("id", { count: "exact", head: true })
      .in("status", PENDING_FEEDBACK_STATUSES);
    if (error) throw new Error(error.message);
    return count ?? 0;
  });

export const unsolvedFeedbackCountQueryKey = ["unsolved-feedback-count"] as const;

async function autoResolveStaleInquiries(supabaseAdmin: {
  from: (table: string) => any;
}) {
  const { data: rows } = await supabaseAdmin
    .from("patient_feedback")
    .select("id, updated_at")
    .eq("status", "awaiting_confirmation")
    .limit(300);
  const stale = (rows ?? []).filter((row: { updated_at: string }) =>
    isStaleAwaitingConfirmation(row.updated_at),
  );
  if (stale.length === 0) return;
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("patient_feedback")
    .update({ status: "resolved", updated_at: now, resolved_at: now })
    .in(
      "id",
      stale.map((row: { id: string }) => row.id),
    );
}

const updateInput = z.object({
  id: z.string().uuid(),
  status: z.enum(FEEDBACK_STATUSES),
  body: z.string().trim().max(4000).optional().or(z.literal("")),
});

export const updatePatientFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => updateInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error: loadErr } = await supabaseAdmin
      .from("patient_feedback")
      .select("id, email, full_name, message, status")
      .eq("id", data.id)
      .maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!row) throw new Error("Inquiry not found.");

    const note = sentenceCase(data.body ?? "").trim();
    if (data.status === "resolved" && row.status !== "resolved") {
      throw new Error(
        "Send a solution first (Solution sent). It is marked resolved when the patient confirms, or after 3 days with no reply.",
      );
    }

    const now = new Date().toISOString();
    const resolvedNow = data.status === "resolved" || data.status === "closed" ? now : null;

    let email_sent = false;
    const to = row.email?.trim();
    const statusChanged = row.status !== data.status;
    let replyId: string | null = null;
    if (note) {
      const { data: replyRow, error: replyErr } = await supabaseAdmin
        .from("patient_feedback_replies")
        .insert({
          feedback_id: data.id,
          author_role: "admin",
          author_user_id: context.userId ?? null,
          body: note,
        })
        .select("id")
        .maybeSingle();
      if (replyErr) throw new Error(replyErr.message);
      replyId = replyRow?.id ?? null;
    }

    const { error: updErr } = await supabaseAdmin
      .from("patient_feedback")
      .update({
        status: data.status,
        updated_at: now,
        resolved_at: data.status === "in_progress" ? null : resolvedNow,
      })
      .eq("id", data.id);
    if (updErr) throw new Error(updErr.message);

    if (to && (note || statusChanged)) {
      try {
        const claimId = replyId ?? data.id;
        const { error: claimErr } = await supabaseAdmin.from("email_reminders").insert({
          reminder_type: "patient_inquiry_update",
          target_id: claimId,
          period_key: replyId ? "" : data.status,
        });
        const alreadyClaimed = claimErr?.code === "23505";
        if (claimErr && !alreadyClaimed) {
          console.error("[feedback] inquiry email claim failed:", claimErr.message);
        }
        if (!alreadyClaimed) {
          const { sendTransactionalEmail } = await import("@/integrations/brevo/client.server");
          const portal =
            process.env.PATIENT_PORTAL_URL?.replace(/\/$/, "") ||
            process.env.APP_URL?.replace(/\/$/, "") ||
            "";
          const result = await sendTransactionalEmail({
            to: { email: to, name: row.full_name },
            template: "patient_inquiry_update",
            params: {
              FIRSTNAME: row.full_name?.split(/\s+/)[0] ?? "",
              FULLNAME: row.full_name ?? "",
              STATUS: data.status,
              STATUS_LABEL: feedbackStatusLabel(data.status).toLowerCase(),
              ORIGINAL_MESSAGE: row.message,
              ADMIN_NOTE: note,
              PORTAL_URL: portal ? `${portal}/inquiries` : "",
            },
          });
          email_sent = result.ok;
          if (!result.ok) {
            await supabaseAdmin
              .from("email_reminders")
              .delete()
              .eq("reminder_type", "patient_inquiry_update")
              .eq("target_id", claimId)
              .eq("period_key", replyId ? "" : data.status);
          }
        }
      } catch (e) {
        console.error("[feedback] patient update email failed:", e);
      }
    }

    return { ok: true as const, email_sent, emailed: Boolean(to) };
  });
