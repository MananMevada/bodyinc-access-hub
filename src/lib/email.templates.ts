/**
 * In-repo transactional email templates.
 * Rendered locally, then delivered via Brevo (no Brevo dashboard templates required).
 */

import { formatBiId } from "@/lib/format";
import { emailLogoHtml } from "./email/layout";

export type EmailTemplateKey =
  | "patient_order_confirmed"
  | "patient_approved"
  | "patient_rejected"
  | "patient_additional_payment"
  | "patient_plan_consent"
  | "patient_medicine_changed"
  | "patient_prescription_ready"
  | "patient_sent_to_pharmacy"
  | "patient_shipped"
  | "patient_delivered"
  | "patient_refund_approved"
  | "patient_refund_rejected"
  | "patient_consultation_started"
  | "patient_inquiry_update"
  | "patient_provider_assigned"
  | "patient_onboarding_payment"
  | "patient_renewal_failed"
  | "patient_visit_tomorrow"
  | "provider_assigned"
  | "provider_ready_for_review"
  | "provider_patient_ready"
  | "provider_needs_attention"
  | "provider_review_waiting"
  | "provider_plan_change_expired"
  | "provider_visit_tomorrow"
  | "admin_provider_approved"
  | "admin_new_feedback";

export type EmailParams = Record<string, string | number | boolean | null | undefined>;

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

function str(params: EmailParams, key: string, fallback = ""): string {
  const v = params[key];
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(params: EmailParams): string {
  return str(params, "FIRSTNAME") || str(params, "FULLNAME").split(/\s+/)[0] || "there";
}

/** Patient Portal–compatible order label from medication_requests.id (`#BI-XXXX`). */
function orderShort(params: EmailParams): string {
  const id = str(params, "ORDER_ID");
  return id ? formatBiId(id) : "";
}

/** Admin UI tokens (`src/lib/admin-ui.ts`) — keep email chrome in lockstep with the portal. */
const THEME = {
  page: "#F8FBFA",
  card: "#ffffff",
  border: "#D5DEDD",
  header: "#3B4759",
  accent: "#6A9B9C",
  text: "#3B4759",
  muted: "#626C7A",
  footer: "#9DA3AC",
  ctaText: "#ffffff",
  mistBg: "#F8FBFA",
  clayBg: "#F8EDE8",
  clayBorder: "#E2C4B8",
} as const;

const DEFAULT_PATIENT_PORTAL = "https://patient.bodyinc.com";

/** Patient sign-in. A missing portal URL must still leave a button in the mail. */
function patientLoginUrl(): string {
  const configured = (process.env.PATIENT_PORTAL_URL || "").trim().replace(/\/$/, "");
  const base =
    configured && !/localhost|127\.0\.0\.1/i.test(configured) ? configured : DEFAULT_PATIENT_PORTAL;
  return `${base}/auth`;
}

function cta(url: string, label: string): { html: string; text: string } {
  if (!url) return { html: "", text: "" };
  return {
    html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
      <tr>
        <td bgcolor="${THEME.accent}" style="background-color:${THEME.accent};background:${THEME.accent};border-radius:8px;">
          <a href="${escapeHtml(url)}" style="display:inline-block;background-color:${THEME.accent};background:${THEME.accent};color:${THEME.ctaText};text-decoration:none;padding:13px 24px;border-radius:8px;font-weight:600;font-size:14px;line-height:1.2;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`,
    text: `\n${label}: ${url}\n`,
  };
}

function noteBox(html: string, variant: "mist" | "clay" = "mist"): string {
  const bg = variant === "clay" ? THEME.clayBg : THEME.mistBg;
  const border = variant === "clay" ? THEME.clayBorder : THEME.border;
  return `<p style="margin-top:16px;padding:14px 16px;background:${bg};border:1px solid ${border};border-radius:12px;color:${THEME.muted};">${html}</p>`;
}

function layout(opts: {
  preheader: string;
  title: string;
  hideTitle?: boolean;
  subject?: string;
  bodyHtml: string;
  bodyText: string;
}): RenderedEmail {
  const brand = "Body Inc";
  const font =
    "'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const heading = opts.hideTitle
    ? ""
    : `<tr>
            <td bgcolor="${THEME.card}" style="background-color:${THEME.card};padding:28px 28px 8px;font-size:22px;font-weight:600;letter-spacing:-0.4px;line-height:1.3;color:${THEME.text};">${escapeHtml(opts.title)}</td>
          </tr>`;
  const bodyPad = opts.hideTitle ? "28px 28px 28px" : "0 28px 28px";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(opts.subject ?? opts.title)}</title>
</head>
<body bgcolor="${THEME.page}" style="margin:0;padding:0;background-color:${THEME.page};background:${THEME.page};font-family:${font};color:${THEME.text};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${THEME.page}" style="background-color:${THEME.page};background:${THEME.page};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${THEME.card}" style="max-width:560px;background-color:${THEME.card};background:${THEME.card};border-radius:12px;overflow:hidden;border:1px solid ${THEME.border};">
          <tr>
            <td bgcolor="${THEME.card}" style="background-color:${THEME.card};background:${THEME.card};padding:20px 28px 14px;">
              ${emailLogoHtml()}
            </td>
          </tr>
          <tr>
            <td bgcolor="${THEME.header}" style="height:2px;line-height:2px;font-size:0;background-color:${THEME.header};background:${THEME.header};">&nbsp;</td>
          </tr>
          <tr>
            <td bgcolor="${THEME.accent}" style="height:4px;line-height:4px;font-size:0;background-color:${THEME.accent};background:${THEME.accent};">&nbsp;</td>
          </tr>
          ${heading}
          <tr>
            <td bgcolor="${THEME.card}" style="background-color:${THEME.card};padding:${bodyPad};font-size:14px;line-height:1.65;color:${THEME.muted};">${opts.bodyHtml}</td>
          </tr>
          <tr>
            <td bgcolor="${THEME.card}" style="background-color:${THEME.card};padding:16px 28px 24px;border-top:1px solid ${THEME.border};font-size:12px;line-height:1.5;color:${THEME.footer};">
              This email was sent by ${escapeHtml(brand)}. If you have questions, reply to this email or contact support.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = opts.hideTitle
    ? `${brand}\n\n${opts.bodyText}\n`
    : `${brand}\n\n${opts.title}\n\n${opts.bodyText}\n`;
  return { subject: opts.subject ?? opts.title, html, text };
}

type Builder = (params: EmailParams) => RenderedEmail;

const builders: Record<EmailTemplateKey, Builder> = {
  patient_order_confirmed: (p) => {
    const med = str(p, "MEDICINE_NAME", "your medication");
    const order = orderShort(p);
    const link = cta(str(p, "PORTAL_URL"), "View your order");
    return layout({
      preheader: `Your order for ${med} is confirmed.`,
      title: "Order confirmed",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>We've received your payment and created your order${order ? ` <strong>${escapeHtml(order)}</strong>` : ""} for <strong>${escapeHtml(med)}</strong>.</p>
        <p>A clinician will review your request shortly.</p>${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\nWe've received your payment and created your order${order ? ` ${order}` : ""} for ${med}.\nA clinician will review your request shortly.${link.text}`,
    });
  },

  patient_approved: (p) => {
    const med = str(p, "MEDICINE_NAME", "your medication");
    const note = str(p, "DECISION_NOTE");
    const link = cta(str(p, "PORTAL_URL"), "Open patient portal");
    return layout({
      preheader: `Your consultation for ${med} was approved.`,
      title: "Consultation approved",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>Good news — your consultation for <strong>${escapeHtml(med)}</strong> has been approved.</p>
        ${note ? noteBox(`<strong>Note:</strong> ${escapeHtml(note)}`) : ""}
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\nYour consultation for ${med} has been approved.${note ? `\nNote: ${note}` : ""}${link.text}`,
    });
  },

  patient_rejected: (p) => {
    const med = str(p, "MEDICINE_NAME", "your medication");
    const note = str(p, "DECISION_NOTE");
    const link = cta(str(p, "PORTAL_URL"), "Open patient portal");
    return layout({
      preheader: `Your order for ${med} was not approved. A refund is being processed.`,
      title: "Order not approved",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>Your order for <strong>${escapeHtml(med)}</strong> was not approved. Any payment for this order is being refunded.</p>
        ${note ? noteBox(`<strong>Reason:</strong> ${escapeHtml(note)}`, "clay") : ""}
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\nYour order for ${med} was not approved. Any payment for this order is being refunded.${note ? `\nReason: ${note}` : ""}${link.text}`,
    });
  },

  patient_additional_payment: (p) => {
    const med = str(p, "MEDICINE_NAME", "your medication");
    const amount = str(p, "AMOUNT_DUE", "0.00");
    const reminder = str(p, "IS_REMINDER") === "1";
    const finalReminder = str(p, "IS_FINAL") === "1";
    const heading = finalReminder
      ? "Last reminder: this change ends tomorrow"
      : reminder
        ? "Reminder: pay or decline this change"
        : "Pay or decline this change";
    const signIn = cta(patientLoginUrl(), "Sign in to your portal");
    const followUp = finalReminder
      ? "This is the last reminder. If you do not pay or decline by tomorrow, the change is cancelled, the previous medicine and plan are restored, and you are not charged. Your provider is notified."
      : reminder
        ? "If you do neither before the 7 days are up, the change is cancelled, the previous medicine and plan are restored, and you are not charged. Your provider is notified that the change timed out."
        : "You have 7 days. We will email you again after 24 hours, and once more the day before those 7 days end, if you have not responded. If you do neither within 7 days, the change is cancelled, the previous medicine and plan are restored, and you are not charged. Your provider is notified that the change timed out.";
    const where =
      "Sign in to your patient portal to pay this difference or decline the change. After you sign in, open Dashboard or My Meds. Pay now is on that order. You can decline the change from the same order.";
    return layout({
      preheader: finalReminder
        ? `Last reminder: pay $${amount} or decline the change to ${med} by tomorrow.`
        : reminder
          ? `Reminder: sign in to pay $${amount} or decline the change to ${med}.`
          : `Sign in to pay $${amount} or decline the change to ${med}.`,
      title: heading,
      subject: `${finalReminder ? "Last reminder: " : reminder ? "Reminder: " : ""}Pay or decline your treatment change — ${med}`,
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        ${finalReminder ? "<p>This change ends tomorrow.</p>" : reminder ? "<p>This is a reminder. You still have time to respond.</p>" : ""}
        <p>Your clinician changed your medicine to <strong>${escapeHtml(med)}</strong>. The new medicine costs <strong>$${escapeHtml(amount)}</strong> more.</p>
        <p>${where}</p>
        <p>If you pay, the updated order is sent to the pharmacy automatically.</p>
        <p>If you decline, you are not charged, the pending charge is cancelled, and the order returns to the previous medicine and plan. It goes back under review, and your provider is notified.</p>
        <p>${followUp}</p>
        ${signIn.html}`,
      bodyText: `Hi ${firstName(p)},\n\n${finalReminder ? "This change ends tomorrow.\n\n" : reminder ? "This is a reminder. You still have time to respond.\n\n" : ""}Your clinician changed your medicine to ${med}. The new medicine costs $${amount} more.\n\n${where}\n\nIf you pay, the updated order is sent to the pharmacy automatically.\n\nIf you decline, you are not charged, the pending charge is cancelled, and the order returns to the previous medicine and plan. It goes back under review, and your provider is notified.\n\n${followUp}${signIn.text}`,
    });
  },

  patient_plan_consent: (p) => {
    const med = str(p, "MEDICINE_NAME", "your medication");
    const credit = str(p, "CREDIT_AMOUNT", "0.00");
    const reminder = str(p, "IS_REMINDER") === "1";
    const finalReminder = str(p, "IS_FINAL") === "1";
    const heading = finalReminder
      ? "Last reminder: this change ends tomorrow"
      : reminder
        ? "Reminder: approve or reject this change"
        : "Approve or reject this change";
    const creditHtml =
      Number(credit) > 0
        ? `<p>If you approve, a credit of <strong>$${escapeHtml(credit)}</strong> is applied to your next bill.</p>`
        : "";
    const creditText =
      Number(credit) > 0
        ? `If you approve, a credit of $${credit} is applied to your next bill.\n\n`
        : "";
    const signIn = cta(patientLoginUrl(), "Sign in to your portal");
    const where =
      "Sign in to your patient portal to approve or reject this change. After you sign in, open Dashboard or My Meds. Approve and Reject are on that order. There is no payment.";
    const followUp = finalReminder
      ? "This is the last reminder. If you do not approve or reject by tomorrow, the change is cancelled, the previous medicine and plan are restored, and you are not charged. Your provider is notified."
      : reminder
        ? "If you do neither before the 7 days are up, the change is cancelled, the previous medicine and plan are restored, and you are not charged. Your provider is notified that the change timed out."
        : "You have 7 days. We will email you again after 24 hours, and once more the day before those 7 days end, if you have not responded. If you do neither within 7 days, the change is cancelled, the previous medicine and plan are restored, and you are not charged. Your provider is notified that the change timed out.";
    return layout({
      preheader: finalReminder
        ? `Last reminder: approve or reject the change to ${med} by tomorrow.`
        : reminder
          ? `Reminder: approve or reject the change to ${med}.`
          : `Please approve or reject the change to ${med}.`,
      title: heading,
      subject: `${finalReminder ? "Last reminder: " : reminder ? "Reminder: " : ""}Approve or reject your treatment change — ${med}`,
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        ${finalReminder ? "<p>This change ends tomorrow.</p>" : reminder ? "<p>This is a reminder. You still have time to respond.</p>" : ""}
        <p>Your clinician changed your medicine to <strong>${escapeHtml(med)}</strong>. Nothing extra is due. There is no payment.</p>
        ${creditHtml}
        <p>${where}</p>
        <p>If you approve, the updated order is sent to the pharmacy automatically.</p>
        <p>If you reject, nothing is charged, no credit is applied, and the order returns to the previous medicine and plan. It goes back under review, and your provider is notified.</p>
        <p>${followUp}</p>
        ${signIn.html}`,
      bodyText: `Hi ${firstName(p)},\n\n${finalReminder ? "This change ends tomorrow.\n\n" : reminder ? "This is a reminder. You still have time to respond.\n\n" : ""}Your clinician changed your medicine to ${med}. Nothing extra is due. There is no payment.\n\n${creditText}${where}\n\nIf you approve, the updated order is sent to the pharmacy automatically.\n\nIf you reject, nothing is charged, no credit is applied, and the order returns to the previous medicine and plan. It goes back under review, and your provider is notified.\n\n${followUp}${signIn.text}`,
    });
  },

  patient_medicine_changed: (p) => {
    const med = str(p, "MEDICINE_NAME", "your medication");
    const credit = str(p, "CREDIT_AMOUNT", "0.00");
    const creditNote =
      Number(credit) > 0 ? ` A credit of $${credit} will apply on your next billing cycle.` : "";
    const link = cta(str(p, "PORTAL_URL"), "Open patient portal");
    return layout({
      preheader: `Your treatment was updated to ${med}.`,
      title: "Treatment updated",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>Your order has been updated to <strong>${escapeHtml(med)}</strong>.${creditNote ? ` A credit of <strong>$${escapeHtml(credit)}</strong> will apply on your next billing cycle.` : ""}</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\nYour order has been updated to ${med}.${creditNote}${link.text}`,
    });
  },

  patient_prescription_ready: (p) => {
    const med = str(p, "MEDICINE_NAME", "your medication");
    const link = cta(str(p, "PORTAL_URL"), "View prescription");
    return layout({
      preheader: `Your prescription for ${med} is ready.`,
      title: "Prescription ready",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>Your prescription for <strong>${escapeHtml(med)}</strong> has been generated and will move to fulfillment next.</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\nYour prescription for ${med} has been generated and will move to fulfillment next.${link.text}`,
    });
  },

  patient_sent_to_pharmacy: (p) => {
    const med = str(p, "MEDICINE_NAME", "your medication");
    return layout({
      preheader: `Your prescription for ${med} was created and sent to the pharmacy.`,
      title: "Prescription sent to pharmacy",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>Your prescription for <strong>${escapeHtml(med)}</strong> has been created and sent to the pharmacy for fulfillment.</p>`,
      bodyText: `Hi ${firstName(p)},\n\nYour prescription for ${med} has been created and sent to the pharmacy for fulfillment.`,
    });
  },

  patient_shipped: (p) => {
    const med = str(p, "MEDICINE_NAME", "your medication");
    const tracking = str(p, "TRACKING_NUMBER");
    return layout({
      preheader: tracking
        ? `Your ${med} order shipped. Tracking: ${tracking}`
        : `Your ${med} order has shipped.`,
      title: "Order shipped",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>Your order for <strong>${escapeHtml(med)}</strong> is on the way.</p>
        ${tracking ? `<p><strong>Tracking number:</strong> ${escapeHtml(tracking)}</p>` : ""}`,
      bodyText: `Hi ${firstName(p)},\n\nYour order for ${med} is on the way.${tracking ? `\nTracking number: ${tracking}` : ""}`,
    });
  },

  patient_delivered: (p) => {
    const med = str(p, "MEDICINE_NAME", "your medication");
    return layout({
      preheader: `Your ${med} order was delivered.`,
      title: "Order delivered",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>Your order for <strong>${escapeHtml(med)}</strong> has been marked as delivered. If anything looks off, reply to this email or contact support.</p>`,
      bodyText: `Hi ${firstName(p)},\n\nYour order for ${med} has been marked as delivered. If anything looks off, reply to this email or contact support.`,
    });
  },

  patient_refund_approved: (p) => {
    const amount = str(p, "AMOUNT", "0.00");
    const link = cta(str(p, "PORTAL_URL"), "Open patient portal");
    return layout({
      preheader: `Your refund of $${amount} was approved.`,
      title: "Refund approved",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>Your refund of <strong>$${escapeHtml(amount)}</strong> has been approved and is being processed back to your original payment method.</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\nYour refund of $${amount} has been approved and is being processed back to your original payment method.${link.text}`,
    });
  },

  patient_refund_rejected: (p) => {
    const amount = str(p, "AMOUNT", "0.00");
    const note = str(p, "ADMIN_NOTE");
    const link = cta(str(p, "PORTAL_URL"), "Open patient portal");
    return layout({
      preheader: `Your refund request for $${amount} was not approved.`,
      title: "Refund request update",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>Your refund request for <strong>$${escapeHtml(amount)}</strong> was not approved.</p>
        ${note ? noteBox(`<strong>Reason:</strong> ${escapeHtml(note)}`, "clay") : ""}
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\nYour refund request for $${amount} was not approved.${note ? `\nReason: ${note}` : ""}${link.text}`,
    });
  },

  patient_consultation_started: (p) => {
    const med = str(p, "MEDICINE_NAME", "your medication");
    const link = cta(str(p, "PORTAL_URL"), "Join consultation");
    return layout({
      preheader: `Your provider started a consultation for ${med}.`,
      title: "Consultation started",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>Your provider started a consultation for <strong>${escapeHtml(med)}</strong>. Open the patient portal to join the visit.</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\nYour provider started a consultation for ${med}. Open the patient portal to join the visit.${link.text}`,
    });
  },

  patient_inquiry_update: (p) => {
    const name = escapeHtml(firstName(p));
    const status = str(p, "STATUS") || str(p, "STATUS_LABEL");
    const original = str(p, "ORIGINAL_MESSAGE");
    const note = str(p, "ADMIN_NOTE");
    const link = cta(str(p, "PORTAL_URL"), "View your inquiries");
    const originalHtml = original
      ? noteBox(`<strong>Your message:</strong><br/>${escapeHtml(original)}`)
      : "";
    const noteHtml = note
      ? noteBox(`<strong>From the Body Inc team:</strong><br/>${escapeHtml(note)}`)
      : "";

    const copy: Record<string, { subject: string; preheader: string; html: string; text: string }> =
      {
        needs_info: {
          subject: "A quick follow-up on your inquiry",
          preheader: "We need a little more from you to keep going.",
          html: `<p>Hi ${name},</p>
        <p>We have an update on your inquiry — we need a little more information from you before we can continue.</p>
        <p>Use the button below to read the note and send a reply.</p>`,
          text: `Hi ${firstName(p)},\n\nWe have an update on your inquiry — we need a little more information from you before we can continue.\n\nUse the link below to read the note and send a reply.`,
        },
        awaiting_confirmation: {
          subject: "Please check if this solves your inquiry",
          preheader: "We sent a reply — let us know if it helped.",
          html: `<p>Hi ${name},</p>
        <p>We've sent a reply on your inquiry. Please take a look and let us know if that solves it.</p>
        <p>If we don't hear back in 3 days, we'll mark it as resolved. You can still reopen it anytime from your portal.</p>`,
          text: `Hi ${firstName(p)},\n\nWe've sent a reply on your inquiry. Please take a look and let us know if that solves it.\n\nIf we don't hear back in 3 days, we'll mark it as resolved. You can still reopen it anytime from your portal.`,
        },
        resolved: {
          subject: "Your inquiry has been resolved",
          preheader: "We've looked into your inquiry and it's all sorted.",
          html: `<p>Hi ${name},</p>
        <p>Good news — we've looked into your inquiry and it's been resolved.</p>
        <p>You can read the details below, or open the link to view it in your portal.</p>`,
          text: `Hi ${firstName(p)},\n\nGood news — we've looked into your inquiry and it's been resolved.\n\nYou can read the details below, or open the link to view it in your portal.`,
        },
        in_progress: {
          subject: "We're looking into your inquiry",
          preheader: "A quick update on the inquiry you sent us.",
          html: `<p>Hi ${name},</p>
        <p>Just a quick note that we're looking into your inquiry.</p>
        <p>You can follow along anytime using the button below.</p>`,
          text: `Hi ${firstName(p)},\n\nJust a quick note that we're looking into your inquiry.\n\nYou can follow along anytime using the link below.`,
        },
        closed: {
          subject: "Update on your inquiry",
          preheader: "We've closed this inquiry.",
          html: `<p>Hi ${name},</p>
        <p>We've closed this inquiry. If anything else comes up, you can send a new one from your portal.</p>`,
          text: `Hi ${firstName(p)},\n\nWe've closed this inquiry. If anything else comes up, you can send a new one from your portal.`,
        },
        open: {
          subject: "Update on your inquiry",
          preheader: "There's an update on your inquiry.",
          html: `<p>Hi ${name},</p>
        <p>There's an update on your inquiry. Use the button below to view it.</p>`,
          text: `Hi ${firstName(p)},\n\nThere's an update on your inquiry. Use the link below to view it.`,
        },
      };

    const picked =
      copy[status] ??
      ({
        subject: "Update on your inquiry",
        preheader: "There's an update on your inquiry.",
        html: `<p>Hi ${name},</p>
        <p>There's an update on your inquiry. Use the button below to view it.</p>`,
        text: `Hi ${firstName(p)},\n\nThere's an update on your inquiry. Use the link below to view it.`,
      } satisfies (typeof copy)[string]);

    return layout({
      preheader: picked.preheader,
      title: picked.subject,
      hideTitle: true,
      subject: picked.subject,
      bodyHtml: `${picked.html}${originalHtml}${noteHtml}${link.html}`,
      bodyText: `${picked.text}${original ? `\n\nYour message:\n${original}` : ""}${note ? `\n\nFrom the Body Inc team:\n${note}` : ""}${link.text}`,
    });
  },

  patient_provider_assigned: (p) => {
    const med = str(p, "MEDICINE_NAME", "your medication");
    const order = orderShort(p);
    const link = cta(str(p, "PORTAL_URL"), "Open consultations");
    return layout({
      preheader: `A practitioner has been assigned to your ${med} request and is ready to consult.`,
      title: "Practitioner assigned — prescription under review",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>A licensed practitioner has been assigned to your <strong>${escapeHtml(med)}</strong> request${order ? ` (order <strong>${escapeHtml(order)}</strong>)` : ""} and is ready to consult. Your prescription is now under review.</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\nA licensed practitioner has been assigned to your ${med} request${order ? ` (order ${order})` : ""} and is ready to consult. Your prescription is now under review.${link.text}`,
    });
  },

  provider_assigned: (p) => {
    const med = str(p, "MEDICINE_NAME", "a treatment");
    const order = orderShort(p);
    const patient = str(p, "PATIENT_NAME", "A patient");
    const link = cta(str(p, "REQUEST_URL"), "Open My Requests");
    return layout({
      preheader: `${patient} was assigned to you.`,
      title: "A patient was assigned to you",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p><strong>${escapeHtml(patient)}</strong> was assigned to you.</p>
        <p>Medicine: <strong>${escapeHtml(med)}</strong>${order ? `. Order <strong>${escapeHtml(order)}</strong>` : ""}.</p>
        <p>This patient is in My Requests. Open that list to review them.</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\n${patient} was assigned to you.\nMedicine: ${med}${order ? `. Order ${order}` : ""}.\nThis patient is in My Requests. Open that list to review them.${link.text}`,
    });
  },

  provider_ready_for_review: (p) => {
    const med = str(p, "MEDICINE_NAME", "a treatment");
    const order = orderShort(p);
    const patient = str(p, "PATIENT_NAME", "A patient");
    const link = cta(str(p, "REQUEST_URL"), "Open My Requests");
    return layout({
      preheader: `${patient} is assigned to you and ready for review.`,
      title: "A patient is ready for your review",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p><strong>${escapeHtml(patient)}</strong> is assigned to you and is ready for your review.</p>
        <p>Medicine: <strong>${escapeHtml(med)}</strong>${order ? `. Order <strong>${escapeHtml(order)}</strong>` : ""}.</p>
        <p>This patient is in My Requests. Review the intake form there, and join the consultation if this order needs one.</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\n${patient} is assigned to you and is ready for your review.\nMedicine: ${med}${order ? `. Order ${order}` : ""}.\nThis patient is in My Requests. Review the intake form there, and join the consultation if this order needs one.${link.text}`,
    });
  },

  provider_patient_ready: (p) => {
    const med = str(p, "MEDICINE_NAME", "a treatment");
    const order = orderShort(p);
    const patient = str(p, "PATIENT_NAME", "A patient");
    const fromShop = str(p, "ORDER_SOURCE") === "shop";
    const arrived = fromShop
      ? "placed a shop order and is waiting for a provider."
      : "finished signup and is waiting for a provider.";
    const link = cta(str(p, "REQUEST_URL"), "Open this order");
    return layout({
      preheader: `${patient} is ready to be claimed.`,
      title: fromShop ? "A shop order is ready to claim" : "A new patient is ready to claim",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p><strong>${escapeHtml(patient)}</strong> ${arrived}</p>
        <p>Medicine: <strong>${escapeHtml(med)}</strong>${order ? `. Order <strong>${escapeHtml(order)}</strong>` : ""}.</p>
        <p>If you are licensed in this patient's state, open this order in the Unassigned queue and claim this patient. The first provider to claim it is assigned.</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\n${patient} ${arrived}\nMedicine: ${med}${order ? `. Order ${order}` : ""}.\nIf you are licensed in this patient's state, open this order in the Unassigned queue and claim this patient. The first provider to claim it is assigned.${link.text}`,
    });
  },

  provider_needs_attention: (p) => {
    const med = str(p, "MEDICINE_NAME", "a treatment");
    const order = orderShort(p);
    const link = cta(str(p, "REQUEST_URL"), "Open order");
    return layout({
      preheader: `Order for ${med} is waiting on an additional payment.`,
      title: "Order needs attention",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>Order${order ? ` <strong>${escapeHtml(order)}</strong>` : ""} for <strong>${escapeHtml(med)}</strong> is waiting on the patient's additional payment. It is sent to the pharmacy after that payment succeeds.</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\nOrder${order ? ` ${order}` : ""} for ${med} is waiting on the patient's additional payment. It is sent to the pharmacy after that payment succeeds.${link.text}`,
    });
  },

  patient_onboarding_payment: (p) => {
    const later = str(p, "IS_LATER") === "1";
    const link = cta(patientLoginUrl(), "Finish signup");
    const heading = later ? "Your signup is still waiting on payment" : "Finish your signup";
    return layout({
      preheader: later
        ? "Your Body Inc signup is still waiting on payment."
        : "Your Body Inc signup is waiting on payment.",
      title: heading,
      subject: later ? "Your signup is still waiting on payment" : "Finish your Body Inc signup",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>${later ? "You started signup a few days ago, and payment is still pending." : "You started signup, and payment is still pending."}</p>
        <p>Finish payment to continue. If you have already paid, you can ignore this email.</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\n${later ? "You started signup a few days ago, and payment is still pending." : "You started signup, and payment is still pending."}\n\nFinish payment to continue. If you have already paid, you can ignore this email.${link.text}`,
    });
  },

  patient_renewal_failed: (p) => {
    const med = str(p, "MEDICINE_NAME", "your medication");
    const link = cta(patientLoginUrl(), "Update your card");
    return layout({
      preheader: `The renewal payment for ${med} did not go through.`,
      title: "Your renewal payment did not go through",
      subject: `Your renewal payment did not go through — ${med}`,
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>We tried to renew <strong>${escapeHtml(med)}</strong>, and the card on file was declined. Your subscription is past due.</p>
        <p>Update your card in the patient portal so the renewal can go through. Your plan does not renew until that payment succeeds.</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\nWe tried to renew ${med}, and the card on file was declined. Your subscription is past due.\n\nUpdate your card in the patient portal so the renewal can go through. Your plan does not renew until that payment succeeds.${link.text}`,
    });
  },

  patient_visit_tomorrow: (p) => {
    const when = str(p, "VISIT_TIME", "tomorrow");
    const med = str(p, "MEDICINE_NAME", "your treatment");
    const link = cta(patientLoginUrl(), "Open your portal");
    return layout({
      preheader: `Your visit is tomorrow, ${when}.`,
      title: "Your visit is tomorrow",
      subject: "Your visit is tomorrow",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>This is a reminder that your visit for <strong>${escapeHtml(med)}</strong> is tomorrow, <strong>${escapeHtml(when)}</strong>.</p>
        <p>Sign in to the patient portal at that time to join.</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\nThis is a reminder that your visit for ${med} is tomorrow, ${when}.\n\nSign in to the patient portal at that time to join.${link.text}`,
    });
  },

  provider_review_waiting: (p) => {
    const patient = str(p, "PATIENT_NAME", "A patient");
    const med = str(p, "MEDICINE_NAME", "a treatment");
    const order = orderShort(p);
    const link = cta(str(p, "REQUEST_URL"), "Open this case");
    return layout({
      preheader: `${patient} has been waiting about a day and the case is still unopened.`,
      title: "A patient is still waiting for review",
      subject: `${patient} is still waiting for review`,
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p><strong>${escapeHtml(patient)}</strong> has been waiting in review for about a day, and this case is still unopened.</p>
        <p>Medicine: <strong>${escapeHtml(med)}</strong>${order ? `. Order <strong>${escapeHtml(order)}</strong>` : ""}.</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\n${patient} has been waiting in review for about a day, and this case is still unopened.\nMedicine: ${med}${order ? `. Order ${order}` : ""}.${link.text}`,
    });
  },

  provider_plan_change_expired: (p) => {
    const patient = str(p, "PATIENT_NAME", "A patient");
    const med = str(p, "MEDICINE_NAME", "the previous medicine");
    const order = orderShort(p);
    const link = cta(str(p, "REQUEST_URL"), "Open this order");
    return layout({
      preheader: `${patient} did not answer the medicine change. The order is back under review.`,
      title: "A medicine change expired",
      subject: `Medicine change expired — ${patient}`,
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p><strong>${escapeHtml(patient)}</strong> did not respond within 7 days. The medicine change expired, the previous medicine and plan were restored, and the patient was not charged.</p>
        <p>The order${order ? ` <strong>${escapeHtml(order)}</strong>` : ""} is back under review for <strong>${escapeHtml(med)}</strong>.</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\n${patient} did not respond within 7 days. The medicine change expired, the previous medicine and plan were restored, and the patient was not charged.\n\nThe order${order ? ` ${order}` : ""} is back under review for ${med}.${link.text}`,
    });
  },

  provider_visit_tomorrow: (p) => {
    const patient = str(p, "PATIENT_NAME", "A patient");
    const when = str(p, "VISIT_TIME", "tomorrow");
    const med = str(p, "MEDICINE_NAME", "a treatment");
    const link = cta(str(p, "REQUEST_URL"), "Open this visit");
    return layout({
      preheader: `You have a visit with ${patient} tomorrow.`,
      title: "You have a visit tomorrow",
      subject: `Visit tomorrow with ${patient}`,
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p>You have a scheduled visit with <strong>${escapeHtml(patient)}</strong> tomorrow, <strong>${escapeHtml(when)}</strong>.</p>
        <p>Medicine: <strong>${escapeHtml(med)}</strong>.</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\nYou have a scheduled visit with ${patient} tomorrow, ${when}.\nMedicine: ${med}.${link.text}`,
    });
  },

  admin_provider_approved: (p) => {
    const med = str(p, "MEDICINE_NAME", "a treatment");
    const order = orderShort(p);
    const provider = str(p, "PROVIDER_NAME", "A provider");
    const patient = str(p, "PATIENT_NAME", "a patient");
    const link = cta(str(p, "REQUEST_URL"), "Send to pharmacy");
    return layout({
      preheader: `${provider} approved ${med} — ready to send to pharmacy.`,
      title: "Provider approved an order",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p><strong>${escapeHtml(provider)}</strong> approved order${order ? ` <strong>${escapeHtml(order)}</strong>` : ""} for <strong>${escapeHtml(patient)}</strong> — <strong>${escapeHtml(med)}</strong>.</p>
        <p>You can now send this order to the pharmacy (LifeFile).</p>
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\n${provider} approved order${order ? ` ${order}` : ""} for ${patient} — ${med}.\nYou can now send this order to the pharmacy (LifeFile).${link.text}`,
    });
  },

  admin_new_feedback: (p) => {
    const patient = str(p, "PATIENT_NAME", "A patient");
    const email = str(p, "PATIENT_EMAIL");
    const category = str(p, "CATEGORY", "inquiry");
    const message = str(p, "MESSAGE");
    const who = email ? `${patient} (${email})` : patient;
    const link = cta(str(p, "FEEDBACK_URL"), "Open feedback");
    const messageHtml = message
      ? noteBox(`<strong>Message:</strong><br/>${escapeHtml(message)}`)
      : "";
    return layout({
      preheader: `${patient} sent new ${category} feedback.`,
      title: "New patient feedback",
      bodyHtml: `<p>Hi ${escapeHtml(firstName(p))},</p>
        <p><strong>${escapeHtml(who)}</strong> submitted new ${escapeHtml(category)} feedback.</p>
        ${messageHtml}
        ${link.html}`,
      bodyText: `Hi ${firstName(p)},\n\n${who} submitted new ${category} feedback.${message ? `\n\nMessage:\n${message}` : ""}${link.text}`,
    });
  },
};

export function renderEmailTemplate(
  key: EmailTemplateKey,
  params: EmailParams = {},
): RenderedEmail {
  const build = builders[key];
  if (!build) throw new Error(`Unknown email template: ${key}`);
  return build(params);
}
