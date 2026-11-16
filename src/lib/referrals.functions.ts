import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";

const listInput = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.enum(["all", "pending", "converted"]).default("all"),
  })
  .default({ status: "all" });

export const listReferrals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("referrals")
      .select(
        "id, referrer_user_id, referred_user_id, code, status, reward_cents, stripe_balance_txn_id, created_at, converted_at",
      )
      .order("created_at", { ascending: false })
      .limit(300);
    if (data.status !== "all") q = q.eq("status", data.status);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const refs = rows ?? [];

    const userIds = Array.from(
      new Set(refs.flatMap((r: any) => [r.referrer_user_id, r.referred_user_id]).filter(Boolean)),
    );
    const { data: profiles } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
      : { data: [] as any[] };
    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    let result = refs.map((r: any) => {
      const referrer = pMap.get(r.referrer_user_id) as any;
      const referred = r.referred_user_id ? (pMap.get(r.referred_user_id) as any) : null;
      return {
        id: r.id,
        code: r.code,
        status: r.status,
        reward_cents: r.reward_cents,
        rewarded: !!r.stripe_balance_txn_id,
        created_at: r.created_at,
        converted_at: r.converted_at,
        referrer_user_id: r.referrer_user_id,
        referrer_name: referrer?.full_name ?? null,
        referrer_email: referrer?.email ?? null,
        referred_name: referred?.full_name ?? null,
        referred_email: referred?.email ?? "(account deleted)",
      };
    });

    if (data.search) {
      const s = data.search.toLowerCase();
      result = result.filter(
        (r: any) =>
          (r.referrer_name ?? "").toLowerCase().includes(s) ||
          (r.referrer_email ?? "").toLowerCase().includes(s) ||
          (r.referred_name ?? "").toLowerCase().includes(s) ||
          (r.referred_email ?? "").toLowerCase().includes(s) ||
          (r.code ?? "").toLowerCase().includes(s),
      );
    }

    const converted = result.filter((r: any) => r.status === "converted");
    return {
      rows: result,
      stats: {
        total: result.length,
        pending: result.filter((r: any) => r.status === "pending").length,
        converted: converted.length,
        rewarded_cents: converted.reduce((sum: number, r: any) => sum + (r.reward_cents ?? 0), 0),
      },
    };
  });

const walletHistoryInput = z.object({ userId: z.string().uuid() });

export const getPatientWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => walletHistoryInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, stripe_customer_id")
      .eq("id", data.userId)
      .maybeSingle();
    if (!profile) throw new Error("Patient not found");

    let balance_cents = 0;
    if ((profile as any).stripe_customer_id) {
      const { getStripe } = await import("@/integrations/stripe/client.server");
      const customer: any = await getStripe().customers.retrieve(
        (profile as any).stripe_customer_id,
      );
      if (!customer.deleted && (customer.balance ?? 0) < 0) balance_cents = -customer.balance;
    }

    const { data: txns } = await supabaseAdmin
      .from("wallet_transactions")
      .select("id, amount_cents, type, description, created_at")
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(50);

    return {
      user: {
        id: profile.id,
        full_name: (profile as any).full_name,
        email: (profile as any).email,
      },
      balance_cents,
      transactions: txns ?? [],
    };
  });

const adjustInput = z.object({
  userId: z.string().uuid(),
  amount_cents: z
    .number()
    .int()
    .min(-100000)
    .max(100000)
    .refine((v) => v !== 0, "Amount required"),
  note: z.string().trim().max(300).optional(),
  // Stable per-submit token so a retry/double-click can't double-credit (see migration
  // 20260720120000_wallet_idempotency).
  request_id: z.string().uuid(),
});

export const adjustPatientWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => adjustInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getStripe } = await import("@/integrations/stripe/client.server");
    const stripe = getStripe();

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, stripe_customer_id")
      .eq("id", data.userId)
      .maybeSingle();
    if (!profile) throw new Error("Patient not found");

    let customerId = (profile as any).stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: (profile as any).email ?? undefined,
        name: (profile as any).full_name ?? undefined,
        metadata: { user_id: data.userId },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", data.userId);
    }

    // Wallet credit = negative Stripe balance, so the sign flips here. The idempotency key
    // makes a repeated submit return the SAME balance transaction instead of stacking a second.
    const txn = await stripe.customers.createBalanceTransaction(
      customerId,
      {
        amount: -data.amount_cents,
        currency: "usd",
        description: data.note || "Admin wallet adjustment",
      },
      { idempotencyKey: `wallet_adjust_${data.request_id}` },
    );

    // Unique idempotency_key dedups the ledger row; a duplicate submit is a no-op (23505).
    const { error: ledgerError } = await supabaseAdmin.from("wallet_transactions").insert({
      user_id: data.userId,
      amount_cents: data.amount_cents,
      type: "admin_adjustment",
      description: data.note || "Admin wallet adjustment",
      created_by: context.userId,
      idempotency_key: data.request_id,
    } as any);
    if (ledgerError && (ledgerError as any).code !== "23505") {
      throw new Error(ledgerError.message);
    }

    return { ok: true, stripe_txn_id: txn.id };
  });
