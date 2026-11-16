import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";

const promoBase = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Promo code is required")
    .max(60)
    .regex(/^[A-Za-z0-9_-]+$/, "Code may only contain letters, numbers, dashes, and underscores"),
  discount_type: z.enum(["percent", "amount"]),
  percent_off: z.number().min(0).max(100).nullable().optional(),
  amount_off_cents: z.number().int().min(0).nullable().optional(),
  is_active: z.boolean().default(true),
  auto_apply: z.boolean().default(false),
  max_redemptions: z.number().int().min(1).nullable().optional(),
  redeem_by: z.string().trim().min(1).nullable().optional(),
});

type PromoBaseValues = z.infer<typeof promoBase>;

// A percent promo needs a positive percent_off, an amount promo a positive amount_off_cents —
// otherwise you can save a code that silently discounts nothing.
function hasPositiveDiscount<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine((d: PromoBaseValues) => d.discount_type !== "percent" || (d.percent_off ?? 0) > 0, {
      message: "Percent off must be greater than 0",
      path: ["percent_off"],
    })
    .refine((d: PromoBaseValues) => d.discount_type !== "amount" || (d.amount_off_cents ?? 0) > 0, {
      message: "Amount off must be greater than 0",
      path: ["amount_off_cents"],
    });
}

const promoInput = hasPositiveDiscount(promoBase);
const promoUpdateInput = hasPositiveDiscount(promoBase.extend({ id: z.string().uuid() }));

function toRow(data: PromoBaseValues) {
  return {
    code: data.code.trim().toUpperCase(),
    discount_type: data.discount_type,
    percent_off: data.discount_type === "percent" ? (data.percent_off ?? 0) : null,
    amount_off_cents: data.discount_type === "amount" ? (data.amount_off_cents ?? 0) : null,
    currency: "usd",
    is_active: data.is_active,
    auto_apply: data.auto_apply,
    max_redemptions: data.max_redemptions ?? null,
    redeem_by: data.redeem_by || null,
  };
}

export const listPromos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("promo_codes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getPromo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: promo, error } = await supabaseAdmin
      .from("promo_codes")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!promo) throw new Error("Promo not found");
    return promo;
  });

export const createPromo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => promoInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin
      .from("promo_codes")
      .insert(toRow(data))
      .select("id")
      .single();
    if (error) {
      throw new Error(
        /duplicate|unique/i.test(error.message)
          ? "A promo code with that name already exists."
          : error.message,
      );
    }
    return { id: created.id };
  });

export const updatePromo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => promoUpdateInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...rest } = data;
    const { error } = await supabaseAdmin.from("promo_codes").update(toRow(rest)).eq("id", id);
    if (error) {
      throw new Error(
        /duplicate|unique/i.test(error.message)
          ? "A promo code with that name already exists."
          : error.message,
      );
    }
    return { id };
  });

export const setPromoActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("promo_codes")
      .update({ is_active: data.is_active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePromo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { backupThen, fetchMatching, newBackupId } = await import("@/lib/data-backup.server");
    const db = supabaseAdmin as any;
    const rows = await fetchMatching(db, "promo_codes", "id", [data.id]);
    await backupThen(
      db,
      {
        wipeId: newBackupId(),
        group: "promo",
        wipedBy: context.userId,
        label: rows[0]?.code?.trim() || "Promo code",
        batches: [{ table: "promo_codes", rows }],
      },
      async () => {
        const { error } = await supabaseAdmin.from("promo_codes").delete().eq("id", data.id);
        if (error) throw new Error(error.message);
      },
    );
    return { ok: true };
  });
