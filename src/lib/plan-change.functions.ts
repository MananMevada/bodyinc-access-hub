import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const tokenSchema = z.object({ token: z.string().trim().min(16).max(128) });

export const getPlanChange = createServerFn({ method: "POST" })
  .validator((input: unknown) => tokenSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { declinePlanChange, loadPlanChangeByToken } = await import("@/lib/plan-change.server");
    const row = await loadPlanChangeByToken(supabaseAdmin, data.token);
    if (!row) return { found: false as const };
    if (row.open && row.deadline && new Date(row.deadline).getTime() <= Date.now()) {
      const { data: req } = await supabaseAdmin
        .from("medication_requests")
        .select("id")
        .eq("plan_change_token", data.token)
        .maybeSingle();
      if (req?.id) await declinePlanChange(supabaseAdmin, req.id, "timeout");
      return {
        found: true as const,
        open: false,
        medicine_name: row.medicine_name,
        amount_cents: 0,
        deadline: row.deadline,
        pay_url: null,
        message: "This plan change timed out. The previous plan was restored.",
      };
    }
    const portalBase = process.env.PATIENT_PORTAL_URL?.replace(/\/$/, "") ?? "";
    return {
      found: true as const,
      open: row.open,
      medicine_name: row.medicine_name,
      amount_cents: row.delta_cents > 0 ? row.delta_cents : 0,
      deadline: row.deadline,
      pay_url:
        row.open && row.delta_cents > 0 && portalBase && row.request_id
          ? `${portalBase}/orders/${row.request_id}/pay`
          : null,
      message: row.open ? null : "This plan change has already been answered.",
    };
  });

export const respondToPlanChange = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    tokenSchema
      .extend({ decision: z.enum(["confirm", "decline"]) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { confirmPlanChange, declinePlanChange } = await import("@/lib/plan-change.server");
    const { data: req } = await supabaseAdmin
      .from("medication_requests")
      .select("id, status, plan_change_delta_cents")
      .eq("plan_change_token", data.token)
      .maybeSingle();
    if (!req || req.status !== "awaiting_additional_payment") {
      throw new Error("This link is no longer active.");
    }
    if (data.decision === "decline") {
      await declinePlanChange(supabaseAdmin, req.id, "declined");
      return { ok: true, payUrl: null as string | null };
    }

    const delta = Number(req.plan_change_delta_cents ?? 0);
    if (delta > 0) {
      const portalBase = process.env.PATIENT_PORTAL_URL?.replace(/\/$/, "") ?? "";
      if (portalBase) return { ok: true, payUrl: `${portalBase}/orders/${req.id}/pay` };
      throw new Error("Open My Meds in the patient portal to pay the difference.");
    }

    await confirmPlanChange(supabaseAdmin, req.id, "patient");
    return { ok: true, payUrl: null as string | null };
  });
