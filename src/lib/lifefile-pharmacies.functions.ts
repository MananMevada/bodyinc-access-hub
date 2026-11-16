import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";

const practiceIdSchema = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+$/.test(v) && Number(v) > 0, "Practice ID must be a positive number");

const pharmacySchema = z.object({
  name: z.string().trim().min(1, "Pharmacy name is required").max(120),
  api_base_url: z
    .string()
    .trim()
    .min(1, "API URL is required")
    .max(500)
    .refine((v) => /^https?:\/\//i.test(v), "Enter a valid URL starting with https://"),
  api_username: z.string().trim().min(1, "Username is required").max(200),
  vendor_id: z.string().trim().min(1, "Vendor ID is required").max(120),
  location_id: z.string().trim().min(1, "Location ID is required").max(120),
  api_network_id: z.string().trim().min(1, "API Network ID is required").max(120),
  practice_id: practiceIdSchema,
  is_active: z.boolean().default(true),
});

export const listLifeFilePharmacies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("life_file_pharmacies")
      .select(
        "id, name, api_base_url, api_username, api_password, vendor_id, location_id, api_network_id, practice_id, is_active, created_at, updated_at",
      )
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(({ api_password, ...row }) => ({
      ...row,
      has_password: Boolean(api_password),
    }));
  });

export const createLifeFilePharmacy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    pharmacySchema
      .extend({ api_password: z.string().min(1, "Password is required").max(200) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("life_file_pharmacies")
      .insert({
        name: data.name,
        api_base_url: data.api_base_url,
        api_username: data.api_username,
        api_password: data.api_password,
        vendor_id: data.vendor_id || null,
        location_id: data.location_id || null,
        api_network_id: data.api_network_id || null,
        practice_id: Number(data.practice_id),
        is_active: data.is_active,
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, id: row?.id };
  });

export const updateLifeFilePharmacy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    pharmacySchema
      .extend({
        id: z.string().uuid(),
        api_password: z.string().min(1, "Password is required").max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, api_password, ...rest } = data;
    const patch: {
      name: string;
      api_base_url: string;
      api_username: string;
      api_password: string;
      vendor_id: string | null;
      location_id: string | null;
      api_network_id: string | null;
      practice_id: number;
      is_active: boolean;
      updated_at: string;
    } = {
      name: rest.name,
      api_base_url: rest.api_base_url,
      api_username: rest.api_username,
      api_password,
      vendor_id: rest.vendor_id || null,
      location_id: rest.location_id || null,
      api_network_id: rest.api_network_id || null,
      practice_id: Number(rest.practice_id),
      is_active: rest.is_active,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin.from("life_file_pharmacies").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteLifeFilePharmacy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { backupThen, fetchMatching, newBackupId } = await import("@/lib/data-backup.server");
    const db = supabaseAdmin as any;
    const rows = await fetchMatching(db, "life_file_pharmacies", "id", [data.id]);
    await backupThen(
      db,
      {
        wipeId: newBackupId(),
        group: "lifefile",
        wipedBy: context.userId,
        label: rows[0]?.name?.trim() || "LifeFile pharmacy",
        batches: [{ table: "life_file_pharmacies", rows }],
      },
      async () => {
        const { error } = await supabaseAdmin.from("life_file_pharmacies").delete().eq("id", data.id);
        if (error) {
          if (/foreign key|restrict/i.test(error.message)) {
            throw new Error(
              "Cannot delete this pharmacy while medicines or provider credentials still reference it. Deactivate it instead.",
            );
          }
          throw new Error(error.message);
        }
      },
    );
    return { ok: true };
  });

const credentialSchema = z.object({
  provider_id: z.string().uuid(),
  pharmacy_id: z.string().uuid(),
  api_base_url: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || /^https?:\/\//i.test(v), "Enter a valid URL starting with https://"),
  api_username: z.string().trim().min(1, "Username is required").max(200),
  api_password: z.string().min(1, "Password is required").max(200),
  provider_life_file_id: z.string().trim().max(120).optional().or(z.literal("")),
  practice_id: z
    .union([z.string().trim(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d+$/.test(v) && Number(v) > 0, "Practice ID must be a positive number"),
  npi: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || /^\d{10}$/.test(v), "NPI must be 10 digits"),
  is_active: z.boolean().default(true),
});

export const listProviderLifeFileCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ providerId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: rows, error } = await context.supabase
      .from("provider_life_file_credentials")
      .select(
        "id, provider_id, pharmacy_id, api_base_url, api_username, provider_life_file_id, practice_id, npi, is_active, updated_at, life_file_pharmacies(id, name)",
      )
      .eq("provider_id", data.providerId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      ...r,
      pharmacy_name: Array.isArray(r.life_file_pharmacies)
        ? r.life_file_pharmacies[0]?.name
        : r.life_file_pharmacies?.name,
      // Never return the password to the client.
      api_password: undefined,
      has_password: true,
    }));
  });

export const upsertProviderLifeFileCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    credentialSchema
      .extend({
        id: z.string().uuid().optional(),
        /** When editing, leave blank to keep the existing password. */
        api_password: z.string().max(200).optional().or(z.literal("")),
      })
      .superRefine((val, ctx) => {
        if (!val.id && !val.api_password?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Password is required",
            path: ["api_password"],
          });
        }
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const payload: {
      provider_id: string;
      pharmacy_id: string;
      api_base_url: string | null;
      api_username: string;
      api_password?: string;
      provider_life_file_id: string | null;
      practice_id: number;
      npi: string | null;
      is_active: boolean;
      updated_at: string;
    } = {
      provider_id: data.provider_id,
      pharmacy_id: data.pharmacy_id,
      api_base_url: data.api_base_url || null,
      api_username: data.api_username,
      provider_life_file_id: data.provider_life_file_id || null,
      practice_id: Number(data.practice_id),
      npi: data.npi || null,
      is_active: data.is_active,
      updated_at: new Date().toISOString(),
    };
    if (data.api_password?.trim()) {
      payload.api_password = data.api_password.trim();
    }

    if (data.id) {
      const { error } = await supabaseAdmin
        .from("provider_life_file_credentials")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }

    if (!payload.api_password) {
      throw new Error("Password is required");
    }

    const { data: row, error } = await supabaseAdmin
      .from("provider_life_file_credentials")
      .insert({ ...payload, api_password: payload.api_password })
      .select("id")
      .maybeSingle();
    if (error) {
      if (/unique|duplicate/i.test(error.message)) {
        throw new Error("This provider already has LifeFile credentials for that pharmacy.");
      }
      throw new Error(error.message);
    }
    return { ok: true, id: row?.id };
  });

export const deleteProviderLifeFileCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { backupThen, fetchMatching, newBackupId } = await import("@/lib/data-backup.server");
    const db = supabaseAdmin as any;
    const rows = await fetchMatching(db, "provider_life_file_credentials", "id", [data.id]);
    await backupThen(
      db,
      {
        wipeId: newBackupId(),
        group: "lifefile",
        wipedBy: context.userId,
        label: "LifeFile provider login",
        batches: [{ table: "provider_life_file_credentials", rows }],
      },
      async () => {
        const { error } = await supabaseAdmin
          .from("provider_life_file_credentials")
          .delete()
          .eq("id", data.id);
        if (error) throw new Error(error.message);
      },
    );
    return { ok: true };
  });
