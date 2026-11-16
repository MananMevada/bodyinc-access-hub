/**
 * Brevo transactional email delivery.
 * Templates live in-repo (`src/lib/email.templates.ts`); Brevo only sends the rendered HTML.
 * Safe to import only from server handlers — never from client bundles.
 *
 * Missing API key / sender → skip quietly (log warning).
 * Network/API failures → log and return; callers must not fail clinical actions.
 *
 * Preferred: BREVO_API_KEY (xkeysib-…). SMTP fallback uses smtp-relay.brevo.com with
 * BREVO_SMTP_LOGIN (xxx@smtp-brevo.com, not the host) + BREVO_SMTP_KEY.
 */

import {
  renderEmailTemplate,
  type EmailParams,
  type EmailTemplateKey,
  type RenderedEmail,
} from "@/lib/email.templates";

export type { EmailTemplateKey };

export type EmailRecipient = { email: string; name?: string | null };

export type SendTransactionalEmailInput = {
  to: EmailRecipient | EmailRecipient[];
  cc?: EmailRecipient | EmailRecipient[];
  template?: EmailTemplateKey;
  params?: EmailParams;
  subject?: string;
  html?: string;
  text?: string;
};

export type SendTransactionalEmailResult =
  | { ok: true; messageId: string | null }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string };

const BREVO_SMTP_HOST = "smtp-relay.brevo.com";
const BREVO_SMTP_PORT = 587;

function isSmtpKey(value: string): boolean {
  return value.startsWith("xsmtpsib-");
}

function restApiKey(): string | null {
  const key = process.env.BREVO_API_KEY?.trim();
  if (!key) return null;
  if (isSmtpKey(key)) {
    console.error(
      "[brevo] BREVO_API_KEY is an SMTP key (xsmtpsib-). Use a REST API key (xkeysib-) from Brevo → SMTP & API → API keys.",
    );
    return null;
  }
  return key;
}

function smtpAuth(): { user: string; pass: string } | null {
  const login = process.env.BREVO_SMTP_LOGIN?.trim();
  const pass = process.env.BREVO_SMTP_KEY?.trim();
  if (!login || !pass) return null;
  if (login === BREVO_SMTP_HOST || /smtp-relay\.brevo\.com/i.test(login)) {
    console.error(
      "[brevo] BREVO_SMTP_LOGIN is the relay host, not the SMTP login. Use the Login value from Brevo → SMTP & API → SMTP (looks like xxx@smtp-brevo.com).",
    );
    return null;
  }
  return { user: login, pass };
}

let transporter: any = null;
let transporterAuth: string | null = null;

async function getTransporter(login: string, key: string) {
  // @ts-ignore
  const nodemailer = (await import("nodemailer")).default;
  const auth = `${login}:${key}`;
  if (!transporter || transporterAuth !== auth) {
    transporter = nodemailer.createTransport({
      host: BREVO_SMTP_HOST,
      port: BREVO_SMTP_PORT,
      secure: false,
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      auth: { user: login, pass: key },
      family: 4,
    });
    transporterAuth = auth;
  }
  return transporter;
}

function parseFromAddress(from: string): { email: string; name?: string } {
  const trimmed = from.trim();
  const match = trimmed.match(/^(?:"([^"]*)"|([^<]*?))\s*<([^>]+)>$/);
  if (match) {
    const name = (match[1] ?? match[2] ?? "").trim();
    const email = match[3].trim();
    return name ? { email, name } : { email };
  }
  return { email: trimmed };
}

function sender(): { email: string; name?: string } | null {
  const dedicated = process.env.BREVO_SENDER_EMAIL?.trim();
  if (dedicated) {
    const name = process.env.BREVO_SENDER_NAME?.trim();
    return name ? { email: dedicated, name } : { email: dedicated };
  }
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) return null;
  const parsed = parseFromAddress(from);
  if (!parsed.email) return null;
  if (!parsed.name && process.env.BREVO_SENDER_NAME?.trim()) {
    return { email: parsed.email, name: process.env.BREVO_SENDER_NAME.trim() };
  }
  return parsed;
}

function labelOf(input: SendTransactionalEmailInput): string {
  return input.template ?? input.subject ?? "email";
}

function renderContent(input: SendTransactionalEmailInput): RenderedEmail | { error: string } {
  if (input.subject && input.html) {
    return { subject: input.subject, html: input.html, text: input.text ?? "" };
  }
  if (input.template) {
    try {
      return renderEmailTemplate(input.template, input.params ?? {});
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return { error };
    }
  }
  return { error: "no template or html content" };
}

export async function sendTransactionalEmail(
  input: SendTransactionalEmailInput,
): Promise<SendTransactionalEmailResult> {
  const apiKey = restApiKey();
  const smtp = smtpAuth();
  if (!apiKey && !smtp) {
    return {
      ok: false,
      skipped: true,
      reason: "BREVO_API_KEY not set (or SMTP fallback missing BREVO_SMTP_LOGIN + BREVO_SMTP_KEY)",
    };
  }

  const from = sender();
  if (!from) {
    return { ok: false, skipped: true, reason: "BREVO_SENDER_EMAIL or EMAIL_FROM not set" };
  }

  const recipients = (Array.isArray(input.to) ? input.to : [input.to])
    .map((r) => ({
      email: r.email.trim(),
      ...(r.name?.trim() ? { name: r.name.trim() } : {}),
    }))
    .filter((r) => r.email.length > 0);

  if (recipients.length === 0) {
    return { ok: false, skipped: true, reason: "no recipient email" };
  }

  const toEmails = new Set(recipients.map((r) => r.email.toLowerCase()));
  const cc = (Array.isArray(input.cc) ? input.cc : input.cc ? [input.cc] : [])
    .map((r) => ({
      email: r.email.trim(),
      ...(r.name?.trim() ? { name: r.name.trim() } : {}),
    }))
    .filter((r) => r.email.length > 0 && !toEmails.has(r.email.toLowerCase()));

  const rendered = renderContent(input);
  if ("error" in rendered) {
    console.error(`[brevo] render ${labelOf(input)} failed:`, rendered.error);
    return { ok: false, skipped: false, error: rendered.error };
  }

  if (apiKey) {
    try {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify({
          sender: from,
          to: recipients,
          ...(cc.length > 0 ? { cc } : {}),
          subject: rendered.subject,
          htmlContent: rendered.html,
          ...(rendered.text ? { textContent: rendered.text } : {}),
        }),
      });

      if (res.ok) {
        const json = (await res.json().catch(() => null)) as { messageId?: string } | null;
        return { ok: true, messageId: json?.messageId ?? null };
      }

      const text = await res.text().catch(() => "");
      const error = `Brevo ${res.status}: ${text.slice(0, 400)}`;
      console.error(`[brevo] ${labelOf(input)} REST failed:`, error);
      if (smtp) {
        console.warn(`[brevo] ${labelOf(input)} falling back to SMTP`);
      } else {
        return { ok: false, skipped: false, error };
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[brevo] ${labelOf(input)} request error:`, error);
      if (smtp) {
        console.warn(`[brevo] ${labelOf(input)} falling back to SMTP`);
      } else {
        return { ok: false, skipped: false, error };
      }
    }
  }

  if (!smtp) {
    return { ok: false, skipped: true, reason: "SMTP fallback not configured" };
  }

  try {
    const fromHeader = from.name ? `"${from.name}" <${from.email}>` : from.email;
    // Do not CID-attach the logo. Gmail shows unused (and even referenced) CID images
    // as a separate paperclip file, split from the message body.
    const info = await (await getTransporter(smtp.user, smtp.pass)).sendMail({
      from: fromHeader,
      to: recipients.map((r) => (r.name ? `"${r.name}" <${r.email}>` : r.email)),
      ...(cc.length > 0
        ? { cc: cc.map((r) => (r.name ? `"${r.name}" <${r.email}>` : r.email)) }
        : {}),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text || undefined,
    });
    return { ok: true, messageId: info.messageId ?? null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[brevo] ${labelOf(input)} SMTP error:`, error);
    return { ok: false, skipped: false, error };
  }
}

/** Fire-and-forget wrapper — never throws. */
export function queueTransactionalEmail(input: SendTransactionalEmailInput): void {
  void sendTransactionalEmail(input).then((result) => {
    if (!result.ok && result.skipped) {
      console.warn(`[brevo] skipped ${labelOf(input)}: ${result.reason}`);
    }
  });
}
