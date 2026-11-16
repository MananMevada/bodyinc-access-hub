import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const ALLOWED_ROLES = ["admin", "provider"] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

const PORTAL_URLS: Record<string, string> = {
  admin: "https://admin.bodyinc.com",
  patient: "https://patient.bodyinc.com",
  provider: "https://provider.bodyinc.com",
};

function normalizeOrigin(url: string): string {
  return url.trim().replace(/\/$/, "");
}

/**
 * Password-reset links must land on the correct portal host.
 * Never fall back to APP_URL for providers — that env is often the patient site.
 */
function portalAppUrl(role: "admin" | "provider", clientOrigin?: string): string {
  const providerOrigins = [
    PORTAL_URLS.provider,
    process.env.PROVIDER_APP_URL,
    process.env.PROVIDER_PORTAL_URL,
  ]
    .filter(Boolean)
    .map((u) => normalizeOrigin(String(u)));

  const adminOrigins = [PORTAL_URLS.admin, process.env.ADMIN_APP_URL]
    .filter(Boolean)
    .map((u) => normalizeOrigin(String(u)));

  if (clientOrigin) {
    const origin = normalizeOrigin(clientOrigin);
    if (role === "provider" && providerOrigins.includes(origin)) return origin;
    if (role === "admin" && adminOrigins.includes(origin)) return origin;
  }

  if (role === "provider") {
    return providerOrigins[0] || PORTAL_URLS.provider;
  }
  return adminOrigins[0] || PORTAL_URLS.admin;
}

const credentialsSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
});

const loginOtpSchema = z.object({
  email: z.string().trim().email().max(255),
  /** Browser origin of the sign-in page so any leftover magic-link hop stays on this portal. */
  origin: z
    .string()
    .url()
    .optional()
    .transform((v) => (v ? normalizeOrigin(v) : undefined)),
});

const passwordResetSchema = z.object({
  email: z.string().trim().email().max(255),
  /** Browser origin of the forgot-password page, e.g. https://provider.bodyinc.com */
  origin: z
    .string()
    .url()
    .optional()
    .transform((v) => (v ? normalizeOrigin(v) : undefined)),
});

const verifyOtpSchema = z.object({
  email: z.string().trim().email().max(255),
  token: z
    .string()
    .trim()
    .regex(/^\d{6,8}$/u, "Enter the code from the email"),
});

function serverSupabase() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export type SignInResult =
  | {
      ok: true;
      role: AllowedRole;
      session: {
        access_token: string;
        refresh_token: string;
      };
    }
  | {
      ok: false;
      error: "invalid_credentials" | "invalid_code" | "wrong_portal" | "no_access";
      message: string;
      actualRole?: string;
      redirectUrl?: string;
    };

function buildRoleResult(
  role: string | null,
  session: { access_token: string; refresh_token: string },
): SignInResult {
  if (role && (ALLOWED_ROLES as readonly string[]).includes(role)) {
    return { ok: true, role: role as AllowedRole, session };
  }
  if (!role) {
    return {
      ok: false,
      error: "no_access",
      message: "Your account does not have portal access. Please contact your administrator.",
    };
  }
  const redirectUrl = PORTAL_URLS[role];
  const label = role === "patient" ? "patient" : role;
  return {
    ok: false,
    error: "wrong_portal",
    actualRole: role,
    redirectUrl,
    message: redirectUrl
      ? `This email is registered as a ${label}. Please log in at ${redirectUrl}.`
      : `This email is registered as a ${label}. Please use the correct portal.`,
  };
}

export const signInWithPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => credentialsSchema.parse(input))
  .handler(async ({ data }): Promise<SignInResult> => {
    const supabase = serverSupabase();

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (signInError || !signInData.session || !signInData.user) {
      return {
        ok: false,
        error: "invalid_credentials",
        message: "Invalid email or password.",
      };
    }

    const { data: role, error: roleError } = await supabase.rpc("get_user_portal", {
      _user_id: signInData.user.id,
    });

    if (roleError) {
      await supabase.auth.signOut();
      return {
        ok: false,
        error: "no_access",
        message: "Could not verify your account access. Please try again.",
      };
    }

    const result = buildRoleResult(role as string | null, {
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
    });
    if (!result.ok) {
      await supabase.auth.signOut();
    }
    return result;
  });

async function roleForEmail(supabaseAdmin: any, email: string): Promise<string | null> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", email.replace(/[%_]/g, ""))
    .maybeSingle();
  if (!profile?.id) return null;
  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", profile.id)
    .maybeSingle();
  return (roleRow?.role as string | null) ?? null;
}

export type RequestPasswordResetResult =
  | { ok: true }
  | {
      ok: false;
      error: "wrong_portal" | "send_failed";
      message: string;
      actualRole?: string;
      redirectUrl?: string;
    };

export type SendLoginOtpResult =
  | { ok: true; delivery: "code" | "link" }
  | { ok: false; error: "send_failed"; message: string };

export const sendLoginOtp = createServerFn({ method: "POST" })
  .validator((input: unknown) => loginOtpSchema.parse(input))
  .handler(async ({ data }): Promise<SendLoginOtpResult> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { generateAuthLink } = await import("@/lib/email/send-recovery.server");
      const generated = await generateAuthLink({ type: "magiclink", email: data.email });
      const code = generated.emailOtp;
      if (!code) {
        console.error("[auth] sendLoginOtp missing code:", generated.error);
        return {
          ok: false,
          error: "send_failed",
          message: "Could not send a sign-in code. Please try again, or use your password.",
        };
      }

      let fullName: string | null = null;
      const userId = generated.userId;
      if (userId) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", userId)
          .maybeSingle();
        fullName = (profile as { full_name?: string | null } | null)?.full_name ?? null;
      }

      const { verificationCodeEmail } = await import("@/lib/email/auth-emails");
      const { subject, html } = verificationCodeEmail({ code, fullName, purpose: "login" });
      if (userId) {
        const { error: claimErr } = await supabaseAdmin.from("email_reminders").insert({
          reminder_type: "auth_magiclink",
          target_id: userId,
          period_key: code,
        });
        if (claimErr?.code === "23505") return { ok: true, delivery: "code" };
        if (claimErr) {
          console.error("[auth] login OTP claim failed:", claimErr.message);
        }
      }
      const { sendTransactionalEmail } = await import("@/integrations/brevo/client.server");
      const sent = await sendTransactionalEmail({
        to: { email: data.email, name: fullName },
        subject,
        html,
      });
      if (!sent.ok) {
        if (userId) {
          await supabaseAdmin
            .from("email_reminders")
            .delete()
            .eq("reminder_type", "auth_magiclink")
            .eq("target_id", userId)
            .eq("period_key", code);
        }
        console.error("[auth] sendLoginOtp email failed:", sent.skipped ? sent.reason : sent.error);
        return {
          ok: false,
          error: "send_failed",
          message: "Could not send a sign-in code. Please try again, or use your password.",
        };
      }
      return { ok: true, delivery: "code" };
    } catch (e) {
      console.error("[auth] sendLoginOtp failed:", e);
      return {
        ok: false,
        error: "send_failed",
        message: "Could not send a sign-in code. Please try again, or use your password.",
      };
    }
  });

export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator((input: unknown) => passwordResetSchema.parse(input))
  .handler(async ({ data }): Promise<RequestPasswordResetResult> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const role = await roleForEmail(supabaseAdmin, data.email);

      // Patients use a different portal — point them there.
      if (role === "patient") {
        const redirectUrl = PORTAL_URLS.patient;
        return {
          ok: false,
          error: "wrong_portal",
          message: `This email is registered as a patient. Please log in at ${redirectUrl}.`,
          actualRole: role,
          redirectUrl,
        };
      }

      // Unknown: do not reveal whether the account exists.
      if (role !== "admin" && role !== "provider") return { ok: true };

      // Email a code. Do not pass a redirect URL — Supabase treats that as a magic link,
      // and its Site URL (the patient portal) rejects or burns the practitioner link.
      const { generateAuthLink } = await import("@/lib/email/send-recovery.server");
      const generated = await generateAuthLink({ type: "recovery", email: data.email });
      const code = generated.emailOtp;
      if (!code) {
        console.error("[auth] requestPasswordReset missing code:", generated.error);
        return {
          ok: false,
          error: "send_failed",
          message: "Could not send a reset code. Please try again.",
        };
      }

      let fullName: string | null = null;
      if (generated.userId) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", generated.userId)
          .maybeSingle();
        fullName = (profile as { full_name?: string | null } | null)?.full_name ?? null;
      }

      const { verificationCodeEmail } = await import("@/lib/email/auth-emails");
      const { subject, html } = verificationCodeEmail({ code, fullName, purpose: "reset" });
      const { sendTransactionalEmail } = await import("@/integrations/brevo/client.server");
      const sent = await sendTransactionalEmail({
        to: { email: data.email, name: fullName },
        subject,
        html,
      });
      if (!sent.ok) {
        console.error("[auth] requestPasswordReset email failed:", sent.skipped ? sent.reason : sent.error);
        return {
          ok: false,
          error: "send_failed",
          message: "Could not send a reset code. Please try again.",
        };
      }
      return { ok: true };
    } catch (e) {
      console.error("[auth] requestPasswordReset failed:", e);
      return {
        ok: false,
        error: "send_failed",
        message: "Could not send a reset link. Please try again.",
      };
    }
  });

export const verifyPasswordResetOtp = createServerFn({ method: "POST" })
  .validator((input: unknown) => verifyOtpSchema.parse(input))
  .handler(async ({ data }): Promise<SignInResult> => {
    const supabase = serverSupabase();
    let verifyData: {
      session: { access_token: string; refresh_token: string } | null;
      user: { id: string } | null;
    } | null = null;
    let verifyError: { message?: string } | null = null;
    for (const type of ["recovery", "email"] as const) {
      const result = await supabase.auth.verifyOtp({
        email: data.email,
        token: data.token,
        type,
      });
      if (result.data?.session && result.data.user) {
        verifyData = result.data;
        verifyError = null;
        break;
      }
      verifyError = result.error;
    }

    if (verifyError || !verifyData?.session || !verifyData.user) {
      return {
        ok: false,
        error: "invalid_code",
        message: "Invalid or expired code. Please request a new one.",
      };
    }

    const { data: role, error: roleError } = await supabase.rpc("get_user_portal", {
      _user_id: verifyData.user.id,
    });
    if (roleError) {
      await supabase.auth.signOut();
      return {
        ok: false,
        error: "no_access",
        message: "Could not verify your account access. Please try again.",
      };
    }

    const result = buildRoleResult(role as string | null, {
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
    });
    if (!result.ok) await supabase.auth.signOut();
    return result;
  });

export const verifyLoginOtp = createServerFn({ method: "POST" })
  .validator((input: unknown) => verifyOtpSchema.parse(input))
  .handler(async ({ data }): Promise<SignInResult> => {
    const supabase = serverSupabase();

    // generateLink({ type: "magiclink" }) stores the code as a recovery token.
    // type "email" also matches that token; try both so a 6/8-digit login code
    // never falls through to the password-reset path.
    let verifyData: {
      session: { access_token: string; refresh_token: string } | null;
      user: { id: string } | null;
    } | null = null;
    let verifyError: { message?: string } | null = null;
    for (const type of ["email", "magiclink"] as const) {
      const result = await supabase.auth.verifyOtp({
        email: data.email,
        token: data.token,
        type,
      });
      if (result.data?.session && result.data.user) {
        verifyData = result.data;
        verifyError = null;
        break;
      }
      verifyError = result.error;
    }

    if (verifyError || !verifyData?.session || !verifyData.user) {
      return {
        ok: false,
        error: "invalid_code",
        message: "Invalid or expired code. Please request a new one.",
      };
    }

    const { data: role, error: roleError } = await supabase.rpc("get_user_portal", {
      _user_id: verifyData.user.id,
    });

    if (roleError) {
      await supabase.auth.signOut();
      return {
        ok: false,
        error: "no_access",
        message: "Could not verify your account access. Please try again.",
      };
    }

    const result = buildRoleResult(role as string | null, {
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
    });
    if (!result.ok) {
      await supabase.auth.signOut();
    }
    return result;
  });

export const openRecoverySession = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ reset_code: z.string().trim().min(32).max(128) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { exchangeRecoveryCode } = await import("@/lib/email/send-recovery.server");
    return exchangeRecoveryCode(supabaseAdmin, data.reset_code);
  });

export const saveNewPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ password: z.string().min(8).max(128) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name")
      .eq("id", context.userId)
      .maybeSingle();
    const email = profile?.email?.trim();
    if (!email) return { ok: true as const, email_sent: false as const };

    const { passwordChangedEmail } = await import("@/lib/email/auth-emails");
    const { subject, html } = passwordChangedEmail({
      fullName: profile?.full_name ?? null,
      portalUrl: PORTAL_URLS.provider,
    });
    const { sendTransactionalEmail } = await import("@/integrations/brevo/client.server");
    const sent = await sendTransactionalEmail({
      to: { email, name: profile?.full_name ?? null },
      subject,
      html,
    });
    return { ok: true as const, email_sent: sent.ok };
  });

export const getCurrentPortalRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ role: string | null }> => {
    const { data, error } = await context.supabase.rpc("get_user_portal", {
      _user_id: context.userId,
    });
    if (error) return { role: null };
    return { role: (data as string | null) ?? null };
  });
