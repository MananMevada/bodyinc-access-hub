import { EMAIL_THEME, emailButton, emailLayout, emailSoftPanel } from "./layout";

export type VerificationEmailPurpose = "login" | "change_email" | "reset";

export function verificationCodeEmail(params: {
  code: string;
  fullName?: string | null;
  purpose?: VerificationEmailPurpose;
}): {
  subject: string;
  html: string;
} {
  const first = (params.fullName ?? "").trim().split(/\s+/)[0] || "";
  const hello = first ? `Hello ${first},` : "Hello,";
  const code = params.code.trim();
  const isChange = params.purpose === "change_email";
  const isReset = params.purpose === "reset";
  const instruction = isChange
    ? "Enter the verification code below to confirm this email address for your Body Inc account."
    : isReset
      ? "Enter this code on the practitioner portal to choose a new password. Do not click a link in any other email."
      : "Enter the verification code below to securely log in. This code helps us confirm your identity and protect your account.";

  const body = [
    `<p>${hello}</p>`,
    `<p>${instruction}</p>`,
    emailSoftPanel(
      `<p style="margin:0;text-align:center;font-size:28px;font-weight:600;letter-spacing:0.28em;line-height:1.4;color:${EMAIL_THEME.navy};">${code}</p>`,
      "center",
    ),
    `<p>This code will expire in <strong>10 minutes</strong>.</p>`,
    `<p style="color:${EMAIL_THEME.navyFaint};font-size:12px;">If you didn't request this code, you can ignore this email.</p>`,
  ].join("");

  return {
    subject: isChange
      ? "Confirm your Body Inc email"
      : isReset
        ? "Your Body Inc password reset code"
        : "Your Body Inc verification code",
    html: emailLayout(
      isChange ? "Confirm your email" : isReset ? "Reset your password" : "Verification Code",
      body,
    ),
  };
}

export function providerInviteEmail(params: {
  resetUrl: string;
  fullName?: string | null;
  portalUrl?: string;
}): {
  subject: string;
  html: string;
} {
  const first = (params.fullName ?? "").trim().split(/\s+/)[0] || "";
  const hello = first ? `Hello ${first},` : "Hello,";
  const portal = params.portalUrl || "https://provider.bodyinc.com";
  const body = [
    `<p>${hello}</p>`,
    `<p>An administrator added you as a practitioner on Body Inc. Your account is ready, and you do not have a password yet.</p>`,
    `<p>Click the button below to choose a password. After you save it, you will be signed in to the practitioner portal.</p>`,
    emailButton("Set your password", params.resetUrl),
    `<p>The next time you sign in, go to <a href="${portal}">${portal}</a> and use this email address with the password you just chose.</p>`,
    `<p>This link expires in about <strong>1 hour</strong>. If it expires, ask an administrator to resend your invite, or use Forgot password on the practitioner sign-in page.</p>`,
  ].join("");

  return {
    subject: "Set up your Body Inc practitioner account",
    html: emailLayout("Welcome to Body Inc", body),
  };
}

export function signInLinkEmail(params: { signInUrl: string; fullName?: string | null }): {
  subject: string;
  html: string;
} {
  const first = (params.fullName ?? "").trim().split(/\s+/)[0] || "";
  const hello = first ? `Hello ${first},` : "Hello,";
  const body = [
    `<p>${hello}</p>`,
    `<p>Use the button below to sign in to your Body Inc practitioner account. This link expires in about <strong>1 hour</strong>.</p>`,
    emailButton("Sign in", params.signInUrl),
    `<p style="color:${EMAIL_THEME.navyFaint};font-size:12px;">If you didn't try to sign in, you can ignore this email.</p>`,
  ].join("");

  return {
    subject: "Sign in to Body Inc",
    html: emailLayout("Sign in", body),
  };
}

export function passwordChangedEmail(params: { fullName?: string | null; portalUrl?: string }): {
  subject: string;
  html: string;
} {
  const first = (params.fullName ?? "").trim().split(/\s+/)[0] || "";
  const hello = first ? `Hello ${first},` : "Hello,";
  const portal = params.portalUrl || "https://provider.bodyinc.com";
  const body = [
    `<p>${hello}</p>`,
    `<p>The password for your Body Inc practitioner account was just changed.</p>`,
    `<p>You can sign in with this email address and your new password.</p>`,
    emailButton("Sign in", portal),
    `<p style="color:${EMAIL_THEME.navyFaint};font-size:12px;">If you did not make this change, reset your password from the sign-in page or contact your administrator.</p>`,
  ].join("");

  return {
    subject: "Your Body Inc password was changed",
    html: emailLayout("Password updated", body),
  };
}

export function passwordResetEmail(params: { resetUrl: string; fullName?: string | null }): {
  subject: string;
  html: string;
} {
  const first = (params.fullName ?? "").trim().split(/\s+/)[0] || "";
  const hello = first ? `Hello ${first},` : "Hello,";
  const body = [
    `<p>${hello}</p>`,
    `<p>We received a request to reset the password for your Body Inc account.</p>`,
    `<p>Click the button below to choose a new password. This link expires in about <strong>1 hour</strong>.</p>`,
    emailButton("Reset password", params.resetUrl),
    `<p style="color:${EMAIL_THEME.navyFaint};font-size:12px;">If you didn't ask to reset your password, you can ignore this email. Your password will stay the same.</p>`,
  ].join("");

  return {
    subject: "Reset your Body Inc password",
    html: emailLayout("Reset your password", body),
  };
}
