import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { providerFormSchema, createProviderFormSchema } from "./providers.schema";
import { assertAdmin } from "@/lib/admin-guard";

const PROFILE_KEYS = ["full_name", "phone", "avatar_url"] as const;
type ProfileKey = (typeof PROFILE_KEYS)[number];

function splitProviderPayload<T extends Record<string, any>>(input: T) {
  const profile: Record<string, any> = {};
  const provider: Record<string, any> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if ((PROFILE_KEYS as readonly string[]).includes(k)) profile[k as ProfileKey] = v;
    else provider[k] = v;
  }
  if (Array.isArray(provider.license_states)) {
    provider.practice_states = provider.license_states;
  }
  return { profile, provider };
}

const PROVIDER_PORTAL_URL = "https://provider.bodyinc.com";

/** First-login and invite links must open the practitioner portal, never the admin origin. */
function providerSetPasswordUrl(): { redirectTo: string; portalUrl: string } {
  const configured = process.env.PROVIDER_APP_URL || process.env.PROVIDER_PORTAL_URL;
  const portalUrl = (configured || PROVIDER_PORTAL_URL).trim().replace(/\/$/, "");
  return { redirectTo: `${portalUrl}/reset-password`, portalUrl };
}

const listInput = z
  .object({
    search: z.string().trim().max(120).optional(),
    status: z.enum(["all", "active", "inactive"]).default("all"),
  })
  .default({ status: "all" });

export const listProviders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    let query = context.supabase
      .from("provider_directory")
      .select(
        "id, full_name, email, phone, avatar_url, specialty, credentials, is_active, created_at",
      )
      .order("created_at", { ascending: false });

    if (data.status === "active") query = query.eq("is_active", true);
    if (data.status === "inactive") query = query.eq("is_active", false);

    if (data.search) {
      const s = `%${data.search}%`;
      query = query.or(`full_name.ilike.${s},email.ilike.${s},specialty.ilike.${s}`);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r: any) => r.id).filter(Boolean) as string[];
    let licenseRows: { id: string; license_states: string[] | null; qb_user_id?: number | null }[] =
      [];
    if (ids.length > 0) {
      const licenseSelect = await context.supabase
        .from("providers")
        .select("id, license_states, qb_user_id")
        .in("id", ids);
      if (licenseSelect.error && /qb_user_id/i.test(licenseSelect.error.message)) {
        const fallback = await context.supabase
          .from("providers")
          .select("id, license_states")
          .in("id", ids);
        if (fallback.error) throw new Error(fallback.error.message);
        licenseRows = fallback.data ?? [];
      } else if (licenseSelect.error) {
        throw new Error(licenseSelect.error.message);
      } else {
        licenseRows = licenseSelect.data ?? [];
      }
    }
    let unavailableIds = new Set<string>();
    if (ids.length > 0) {
      const avail = await context.supabase
        .from("providers")
        .select("id, is_unavailable")
        .in("id", ids);
      if (avail.error && !/is_unavailable/i.test(avail.error.message)) {
        throw new Error(avail.error.message);
      }
      if (!avail.error) {
        unavailableIds = new Set(
          (avail.data ?? [])
            .filter((p: { is_unavailable?: boolean }) => p.is_unavailable)
            .map((p: { id: string }) => p.id),
        );
      }
    }
    const licenseMap = new Map(
      (licenseRows ?? []).map((p: { id: string; license_states: string[] | null }) => [
        p.id,
        ((p.license_states ?? []) as string[]).map((s) => String(s).toUpperCase()),
      ]),
    );
    const qbMap = new Map(
      (licenseRows ?? []).map((p: { id: string; qb_user_id?: number | null }) => [
        p.id,
        p.qb_user_id ?? null,
      ]),
    );

    const { data: def } = await context.supabase
      .from("providers")
      .select("id")
      .eq("is_default", true)
      .maybeSingle();
    const defaultId = (def as { id?: string } | null)?.id ?? null;
    return (rows ?? []).map((r: any) => ({
      ...r,
      is_default: r.id === defaultId,
      license_states: licenseMap.get(r.id) ?? [],
      is_unavailable: unavailableIds.has(r.id),
      qb_user_id: qbMap.get(r.id) ?? null,
    }));
  });

// Admin: mark one provider as the default (used when no consultation is needed, or when no
// provider covers the patient's state). Only one provider can be the default at a time.
export const setDefaultProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("providers").update({ is_default: false }).eq("is_default", true);
    const { error } = await supabaseAdmin
      .from("providers")
      .update({ is_default: true })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: provider, error } = await context.supabase
      .from("providers")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!provider) throw new Error("Provider not found");
    const { data: profile, error: profileErr } = await context.supabase
      .from("profiles")
      .select("full_name, email, phone, avatar_url")
      .eq("id", data.id)
      .maybeSingle();
    if (profileErr) throw new Error(profileErr.message);
    return { ...(provider as any), ...((profile as any) ?? {}) };
  });

const createInput = createProviderFormSchema.extend({
  redirect_to: z.string().url(),
});

export const createProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => createInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { redirect_to: _adminOrigin, email, ...rest } = data;
    const { profile: profileFields, provider: providerFields } = splitProviderPayload(rest);

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: profileFields.full_name },
    });
    if (createErr || !created.user) {
      throw new Error(createErr?.message ?? "Could not create user");
    }
    const userId = created.user.id;

    // Upsert profile (trigger may have already inserted a base row)
    const { error: profileErr } = await supabaseAdmin
      .from("profiles")
      .upsert(
        { id: userId, email, full_name: profileFields.full_name ?? "", ...profileFields } as any,
        { onConflict: "id" },
      );
    if (profileErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(profileErr.message);
    }

    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "provider" });
    if (roleErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(roleErr.message);
    }

    const { error: insertErr } = await supabaseAdmin
      .from("providers")
      .insert({ id: userId, ...providerFields });
    if (insertErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(insertErr.message);
    }

    let quickblox: { ok: true; created: boolean } | { ok: false; message: string } = {
      ok: false,
      message: "QuickBlox agent was not created.",
    };
    try {
      const { provisionBodyIncProviderAgent } = await import("@/lib/consultations/provider-agent");
      const agent = await provisionBodyIncProviderAgent(supabaseAdmin, userId);
      quickblox = { ok: true, created: agent.created };
    } catch (error) {
      quickblox = {
        ok: false,
        message: error instanceof Error ? error.message : "QuickBlox agent was not created.",
      };
    }

    const { sendThemedRecoveryEmail } = await import("@/lib/email/send-recovery.server");
    const { redirectTo, portalUrl } = providerSetPasswordUrl();
    const sent = await sendThemedRecoveryEmail({
      supabaseAdmin,
      email,
      redirectTo,
      fullName: (profileFields.full_name as string | undefined) ?? null,
      kind: "invite",
      portalUrl,
    });
    if (!sent.ok) {
      // Provider exists; surface warning but don't roll back
      return { id: userId, invite_sent: false, warning: sent.message, quickblox };
    }
    return { id: userId, invite_sent: true, quickblox };
  });

const updateInput = providerFormSchema.partial().extend({
  id: z.string().uuid(),
});

export const updateProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => updateInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { id, email, ...rest } = data;
    const { profile: profileFields, provider: providerFields } = splitProviderPayload(rest);

    if (Object.keys(profileFields).length > 0) {
      const { error } = await context.supabase
        .from("profiles")
        .update(profileFields as any)
        .eq("id", id);
      if (error) throw new Error(error.message);
    }

    if (email) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(id, { email });
      if (authErr) throw new Error(authErr.message);
      // Trigger on auth.users will sync profiles.email
    }

    if (Object.keys(providerFields).length > 0) {
      const { error } = await context.supabase
        .from("providers")
        .update(providerFields as any)
        .eq("id", id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), redirect_to: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: row, error } = await context.supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !row?.email) throw new Error("Provider not found");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendThemedRecoveryEmail } = await import("@/lib/email/send-recovery.server");
    const { redirectTo, portalUrl } = providerSetPasswordUrl();
    const sent = await sendThemedRecoveryEmail({
      supabaseAdmin,
      email: row.email,
      redirectTo,
      fullName: (row as { full_name?: string | null }).full_name ?? null,
      kind: "invite",
      portalUrl,
    });
    if (!sent.ok) throw new Error(sent.message);
    return { ok: true };
  });

export const enableQuickbloxAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { provisionBodyIncProviderAgent } = await import("@/lib/consultations/provider-agent");
    return provisionBodyIncProviderAgent(supabaseAdmin, data.id);
  });

export const setProviderActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updErr } = await supabaseAdmin
      .from("providers")
      .update({ is_active: data.is_active })
      .eq("id", data.id);
    if (updErr) throw new Error(updErr.message);
    // Ban / unban the auth user so login is actually blocked
    await supabaseAdmin.auth.admin.updateUserById(data.id, {
      ban_duration: data.is_active ? "none" : "876000h",
    });
    return { ok: true };
  });

export const deleteProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { authUserBackup, backupThen, fetchMatching, newBackupId } = await import(
      "@/lib/data-backup.server"
    );
    const db = supabaseAdmin as any;
    const [authUserRes, profileRes, providerRows, roles, credentials] = await Promise.all([
      supabaseAdmin.auth.admin.getUserById(data.id),
      db.from("profiles").select("*").eq("id", data.id).maybeSingle(),
      fetchMatching(db, "providers", "id", [data.id]),
      fetchMatching(db, "user_roles", "user_id", [data.id]),
      fetchMatching(db, "provider_life_file_credentials", "provider_id", [data.id]),
    ]);
    if (profileRes.error) throw new Error(profileRes.error.message);
    const person = profileRes.data as { full_name?: string | null; email?: string | null } | null;
    await backupThen(
      db,
      {
        wipeId: newBackupId(),
        group: "provider",
        wipedBy: context.userId,
        label: person?.full_name?.trim() || person?.email || "Provider",
        batches: [
          { table: "auth.users", rows: authUserRes.data.user ? [authUserBackup(authUserRes.data.user)] : [] },
          { table: "profiles", rows: profileRes.data ? [profileRes.data] : [] },
          { table: "user_roles", rows: roles },
          { table: "providers", rows: providerRows },
          { table: "provider_life_file_credentials", rows: credentials },
        ],
      },
      async () => {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(data.id);
        if (error) throw new Error(error.message);
      },
    );
    return { ok: true };
  });
