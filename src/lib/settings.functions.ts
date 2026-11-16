import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";

export type PlatformSettings = {
  consultation_fee_cents: number;
  consultation_fee_enabled: boolean;
  shipping_fee_cents: number;
  shipping_fee_enabled: boolean;
  referral_reward_cents: number;
  referral_enabled: boolean;
  maintenance_mode: boolean;
  new_signups_enabled: boolean;
  /** Sent to LifeFile on every order. The patient's own phone is never sent. */
  lifefile_contact_phone: string;
};

const DEFAULTS: PlatformSettings = {
  consultation_fee_cents: 0,
  consultation_fee_enabled: false,
  shipping_fee_cents: 0,
  shipping_fee_enabled: false,
  referral_reward_cents: 5000,
  referral_enabled: true,
  maintenance_mode: false,
  new_signups_enabled: true,
  lifefile_contact_phone: "",
};

export function normalizeLifeFileContactPhone(value: string): string {
  const phone = value.trim();
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new Error("Enter a pharmacy contact phone with at least 10 digits.");
  }
  return phone;
}

/** Clinic number for LifeFile. Empty until an admin saves one. */
export async function readLifeFileContactPhone(supabaseAdmin: {
  from: (table: string) => any;
}): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("platform_settings")
    .select("value")
    .eq("key", "lifefile_contact_phone")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const raw = (data as { value?: unknown } | null)?.value;
  return typeof raw === "string" ? raw.trim() : "";
}

const settingsSchema = z.object({
  consultation_fee_cents: z.number().int().min(0).max(1_000_000),
  consultation_fee_enabled: z.boolean(),
  shipping_fee_cents: z.number().int().min(0).max(1_000_000),
  shipping_fee_enabled: z.boolean(),
  referral_reward_cents: z.number().int().min(0).max(1_000_000),
  referral_enabled: z.boolean(),
  maintenance_mode: z.boolean(),
  new_signups_enabled: z.boolean(),
  lifefile_contact_phone: z
    .string()
    .trim()
    .max(40)
    .refine((value) => {
      if (!value) return true;
      const digits = value.replace(/\D/g, "");
      return digits.length >= 10 && digits.length <= 15;
    }, "Enter a pharmacy contact phone with at least 10 digits."),
});

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformSettings> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin.from("platform_settings").select("key, value");
    if (error) throw new Error(error.message);

    const result = { ...DEFAULTS };
    for (const row of data ?? []) {
      if (row.key in result) {
        (result as Record<string, unknown>)[row.key] = row.value;
      }
    }
    return result;
  });

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => settingsSchema.partial().parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: readError } = await supabaseAdmin
      .from("platform_settings")
      .select("key, value");
    if (readError) throw new Error(readError.message);

    const current = { ...DEFAULTS };
    for (const row of existing ?? []) {
      if (row.key in current) (current as Record<string, unknown>)[row.key] = row.value;
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const rows: Array<{ key: string; value: unknown; updated_at: string; updated_by: string }> = [];
    const now = new Date().toISOString();

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if ((current as Record<string, unknown>)[key] === value) continue;
      before[key] = (current as Record<string, unknown>)[key];
      after[key] = value;
      rows.push({ key, value, updated_at: now, updated_by: context.userId });
    }

    if (rows.length === 0) return { ok: true, changed: 0 };

    const { error: upsertError } = await supabaseAdmin
      .from("platform_settings")
      .upsert(rows as never, { onConflict: "key" });
    if (upsertError) throw new Error(upsertError.message);

    await supabaseAdmin.from("admin_activity_log").insert({
      admin_user_id: context.userId,
      action: "settings.update",
      entity: "platform_settings",
      entity_id: null,
      before: before as Record<string, never>,
      after: after as Record<string, never>,
    });

    return { ok: true, changed: rows.length };
  });
