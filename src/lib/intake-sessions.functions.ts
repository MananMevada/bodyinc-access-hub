import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";

const listInput = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.string().trim().max(40).optional(),
    claimed: z.enum(["all", "claimed", "unclaimed"]).default("all"),
  })
  .default({ claimed: "all" });

export const listIntakeSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("intake_sessions")
      .select(
        "id, full_name, email, phone, state_code, sex, dob, status, selected_plan_id, claimed_by_user_id, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status && data.status !== "all") q = q.eq("status", data.status as any);
    if (data.claimed === "claimed") q = q.not("claimed_by_user_id", "is", null);
    if (data.claimed === "unclaimed") q = q.is("claimed_by_user_id", null);
    if (data.search) {
      const s = `%${data.search}%`;
      q = q.or(`full_name.ilike.${s},email.ilike.${s},phone.ilike.${s}`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const planIds = Array.from(
      new Set((rows ?? []).map((r: any) => r.selected_plan_id).filter(Boolean)),
    );
    const { data: pkgs } = planIds.length
      ? await supabaseAdmin.from("packages").select("id, name").in("id", planIds)
      : { data: [] as any[] };
    const pkgMap = new Map((pkgs ?? []).map((p: any) => [p.id, p.name]));

    return (rows ?? []).map((r: any) => ({
      ...r,
      plan_name: r.selected_plan_id ? (pkgMap.get(r.selected_plan_id) ?? null) : null,
    }));
  });

export const getIntakeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: session, error } = await supabaseAdmin
      .from("intake_sessions")
      .select("*")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session) throw new Error("Session not found");

    const [
      { data: cats },
      { data: elig },
      { data: meds },
      { data: resp },
      { data: pkg },
      { data: pay },
    ] = await Promise.all([
      supabaseAdmin
        .from("intake_session_categories")
        .select("category_id, medication_categories(name, slug)")
        .eq("session_id", session.id),
      supabaseAdmin
        .from("intake_session_eligibility_results")
        .select("id, medicine_id, result, reason, evaluated_at, medicines(name)")
        .eq("session_id", session.id),
      supabaseAdmin
        .from("intake_session_medicines")
        .select("medicine_id, category_id, medicines(name, from_price_cents)")
        .eq("session_id", session.id),
      supabaseAdmin
        .from("intake_session_questionnaire_responses")
        .select(
          "id, question_id, medicine_id, answer_text, answer_number, answer_boolean, answer_option_ids, created_at, questionnaire_questions(prompt, question_type)",
        )
        .eq("session_id", session.id),
      session.selected_plan_id
        ? supabaseAdmin
            .from("packages")
            .select("id, name, price, duration_months")
            .eq("id", session.selected_plan_id)
            .maybeSingle()
        : Promise.resolve({ data: null as any }),
      supabaseAdmin
        .from("payments")
        .select("id, amount_cents, currency, status, stripe_payment_intent_id, created_at")
        .eq("session_id", session.id),
    ]);

    // Load options for any answered options
    const optionIds = Array.from(
      new Set(
        (resp ?? [])
          .flatMap((r: any) => (Array.isArray(r.answer_option_ids) ? r.answer_option_ids : []))
          .filter(Boolean),
      ),
    );
    const { data: options } = optionIds.length
      ? await supabaseAdmin
          .from("questionnaire_question_options")
          .select("id, label, value, is_disqualifying")
          .in("id", optionIds)
      : { data: [] as any[] };
    const optMap = new Map((options ?? []).map((o: any) => [o.id, o]));

    const responses = (resp ?? []).map((r: any) => ({
      id: r.id,
      question_id: r.question_id,
      medicine_id: r.medicine_id,
      prompt: r.questionnaire_questions?.prompt ?? "(unknown question)",
      question_type: r.questionnaire_questions?.question_type ?? null,
      answer_text: r.answer_text,
      answer_number: r.answer_number,
      answer_boolean: r.answer_boolean,
      selected_options: (r.answer_option_ids ?? [])
        .map((id: string) => optMap.get(id))
        .filter(Boolean),
      created_at: r.created_at,
    }));

    return {
      session,
      categories: (cats ?? []).map((c: any) => ({
        category_id: c.category_id,
        name: c.medication_categories?.name ?? null,
        slug: c.medication_categories?.slug ?? null,
      })),
      eligibility: (elig ?? []).map((e: any) => ({
        id: e.id,
        medicine_id: e.medicine_id,
        medicine_name: e.medicines?.name ?? null,
        result: e.result,
        reason: e.reason,
        evaluated_at: e.evaluated_at,
      })),
      recommended_medicines: (meds ?? []).map((m: any) => ({
        medicine_id: m.medicine_id,
        category_id: m.category_id,
        name: m.medicines?.name ?? null,
        from_price_cents: m.medicines?.from_price_cents ?? null,
      })),
      responses,
      selected_plan: pkg ?? null,
      payments: pay ?? [],
    };
  });
