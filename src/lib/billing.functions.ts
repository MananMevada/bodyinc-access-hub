import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";

// The confirmation_secret API flow does not store a payment_intent on our payments row
// nor embed one on the invoice directly — it lives under invoice.payments[].payment.
async function resolvePaymentIntentForPayment(stripe: any, payment: any): Promise<string | null> {
  if (payment.stripe_payment_intent_id) return payment.stripe_payment_intent_id;
  if (!payment.stripe_invoice_id) return null;
  try {
    const inv = await stripe.invoices.retrieve(payment.stripe_invoice_id, { expand: ["payments"] });
    for (const entry of inv?.payments?.data ?? []) {
      const pi = entry?.payment?.payment_intent;
      const piId = typeof pi === "string" ? pi : pi?.id;
      if (piId) return piId;
    }
  } catch {
    // fall through
  }
  return null;
}

function invoiceUrls(rawEvent: any): { invoiceUrl: string | null; invoicePdfUrl: string | null } {
  if (!rawEvent || typeof rawEvent !== "object") {
    return { invoiceUrl: null, invoicePdfUrl: null };
  }
  return {
    invoiceUrl:
      typeof rawEvent.hosted_invoice_url === "string" ? rawEvent.hosted_invoice_url : null,
    invoicePdfUrl: typeof rawEvent.invoice_pdf === "string" ? rawEvent.invoice_pdf : null,
  };
}

const listInput = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.string().trim().max(40).optional(),
  })
  .default({});

export const listSubscriptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("subscriptions")
      .select(
        "id, user_id, stripe_subscription_id, package_id, medicine_id, status, current_period_end, cancel_at_period_end, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(300);

    if (data.status && data.status !== "all") {
      q = q.eq("status", data.status);
    } else {
      q = q.not("status", "in", "(incomplete,incomplete_expired)");
    }

    const { data: subs, error } = await q;
    if (error) throw new Error(error.message);
    const rows = subs ?? [];

    const userIds = Array.from(new Set(rows.map((r: any) => r.user_id).filter(Boolean)));
    const pkgIds = Array.from(new Set(rows.map((r: any) => r.package_id).filter(Boolean)));
    const medIds = Array.from(new Set(rows.map((r: any) => r.medicine_id).filter(Boolean)));
    const subKeys = rows.map((r: any) => r.id);

    const [{ data: profiles }, { data: pkgs }, { data: meds }, { data: feedback }] =
      await Promise.all([
        userIds.length
          ? supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
          : Promise.resolve({ data: [] as any[] }),
        pkgIds.length
          ? supabaseAdmin.from("packages").select("id, name, price").in("id", pkgIds)
          : Promise.resolve({ data: [] as any[] }),
        medIds.length
          ? supabaseAdmin.from("medicines").select("id, name").in("id", medIds)
          : Promise.resolve({ data: [] as any[] }),
        subKeys.length
          ? supabaseAdmin
              .from("subscription_cancellation_feedback")
              .select("subscription_id, reasons, other_text")
              .in("subscription_id", subKeys)
          : Promise.resolve({ data: [] as any[] }),
      ]);

    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const pkgMap = new Map((pkgs ?? []).map((p: any) => [p.id, p]));
    const medMap = new Map((meds ?? []).map((m: any) => [m.id, m]));
    const fbMap = new Map((feedback ?? []).map((f: any) => [f.subscription_id, f]));

    let result = rows.map((r: any) => {
      const p = pMap.get(r.user_id) as any;
      const pkg = pkgMap.get(r.package_id) as any;
      const med = medMap.get(r.medicine_id) as any;
      const fb = fbMap.get(r.id) as any;
      return {
        id: r.id,
        customer_name: p?.full_name ?? null,
        customer_email: p?.email ?? null,
        plan_name: [med?.name, pkg?.name].filter(Boolean).join(" — ") || "—",
        amount: pkg?.price != null ? Number(pkg.price) : null,
        status: r.status,
        current_period_end: r.current_period_end,
        cancel_at_period_end: r.cancel_at_period_end,
        cancellation_reasons: fb?.reasons ?? null,
        cancellation_note: fb?.other_text ?? null,
        created_at: r.created_at,
      };
    });

    if (data.search) {
      const s = data.search.toLowerCase();
      result = result.filter(
        (r: any) =>
          (r.customer_name ?? "").toLowerCase().includes(s) ||
          (r.customer_email ?? "").toLowerCase().includes(s) ||
          (r.plan_name ?? "").toLowerCase().includes(s),
      );
    }
    return result;
  });

export const listRefundablePayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("payments")
      .select(
        "id, user_id, amount_cents, currency, status, created_at, stripe_invoice_id, stripe_payment_intent_id, raw_event, plan_id",
      )
      .in("status", ["succeeded", "paid"] as any)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    const payments = rows ?? [];

    const userIds = Array.from(new Set(payments.map((r: any) => r.user_id).filter(Boolean)));
    const planIds = Array.from(new Set(payments.map((r: any) => r.plan_id).filter(Boolean)));

    const [{ data: profiles }, { data: packages }] = await Promise.all([
      userIds.length
        ? supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),
      planIds.length
        ? supabaseAdmin.from("packages").select("id, name, medicines(name)").in("id", planIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const pkgMap = new Map((packages ?? []).map((p: any) => [p.id, p]));

    let result = payments.map((r: any) => {
      const p = pMap.get(r.user_id) as any;
      const pkg = r.plan_id ? (pkgMap.get(r.plan_id) as any) : null;
      const medicineName = pkg?.medicines?.name ?? null;
      const { invoiceUrl, invoicePdfUrl } = invoiceUrls(r.raw_event);
      return {
        id: r.id,
        customer_name: p?.full_name ?? null,
        customer_email: p?.email ?? null,
        description:
          [medicineName, pkg?.name].filter(Boolean).join(" — ") || "Subscription payment",
        amount: Number(r.amount_cents) / 100,
        currency: r.currency ?? "usd",
        status: r.status,
        invoice_url: invoiceUrl,
        invoice_pdf_url: invoicePdfUrl,
        created_at: r.created_at,
      };
    });

    if (data.search) {
      const s = data.search.toLowerCase();
      result = result.filter(
        (r: any) =>
          (r.customer_name ?? "").toLowerCase().includes(s) ||
          (r.customer_email ?? "").toLowerCase().includes(s) ||
          (r.description ?? "").toLowerCase().includes(s) ||
          String(r.id).toLowerCase().includes(s),
      );
    }
    return result;
  });

async function processAdminRefund(params: {
  supabaseAdmin: any;
  stripe: any;
  adminUserId: string;
  paymentId: string;
  reason?: string;
}): Promise<{ ok: true; stripe_refund_id: string; email_sent: boolean }> {
  const { supabaseAdmin, stripe, adminUserId, paymentId } = params;

  const { data: payment, error } = await supabaseAdmin
    .from("payments")
    .select(
      "id, user_id, amount_cents, currency, status, stripe_payment_intent_id, stripe_invoice_id, stripe_subscription_id",
    )
    .eq("id", paymentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!payment) throw new Error("Payment not found.");
  if (!["succeeded", "paid"].includes(payment.status)) {
    throw new Error("Only paid payments can be refunded.");
  }

  const { data: existing } = await supabaseAdmin
    .from("refund_requests")
    .select("id, status")
    .eq("payment_id", payment.id)
    .eq("status", "approved")
    .maybeSingle();
  if (existing) throw new Error("This payment has already been refunded.");

  const paymentIntentId = await resolvePaymentIntentForPayment(stripe, payment);
  if (!paymentIntentId) {
    throw new Error(
      "Could not resolve the Stripe charge for this payment; refund it from the Stripe dashboard.",
    );
  }

  const refund = await stripe.refunds.create({ payment_intent: paymentIntentId });

  if (!payment.stripe_payment_intent_id) {
    await supabaseAdmin
      .from("payments")
      .update({ stripe_payment_intent_id: paymentIntentId })
      .eq("id", payment.id);
  }

  let subscriptionId: string | null = null;
  if (payment.stripe_subscription_id) {
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("stripe_subscription_id", payment.stripe_subscription_id)
      .maybeSingle();
    subscriptionId = sub?.id ?? null;
  }

  const reason = params.reason?.trim() || "Admin-issued refund";
  const now = new Date().toISOString();

  await supabaseAdmin
    .from("refund_requests")
    .update({
      status: "approved",
      stripe_refund_id: refund.id,
      reviewed_by: adminUserId,
      reviewed_at: now,
      admin_note: reason,
    })
    .eq("payment_id", payment.id)
    .eq("status", "pending");

  const { data: alreadyApproved } = await supabaseAdmin
    .from("refund_requests")
    .select("id")
    .eq("payment_id", payment.id)
    .eq("status", "approved")
    .maybeSingle();

  if (!alreadyApproved) {
    const { error: insertError } = await supabaseAdmin.from("refund_requests").insert({
      user_id: payment.user_id,
      payment_id: payment.id,
      subscription_id: subscriptionId,
      amount_cents: payment.amount_cents,
      reason,
      status: "approved",
      admin_note: reason,
      stripe_refund_id: refund.id,
      reviewed_by: adminUserId,
      reviewed_at: now,
    });
    if (insertError) throw new Error(insertError.message);
  }

  await supabaseAdmin.from("payments").update({ status: "refunded" }).eq("id", payment.id);

  const { notifyUserById } = await import("@/lib/email.notifications");
  const email_sent = await notifyUserById({
    supabaseAdmin,
    userId: payment.user_id,
    template: "patient_refund_approved",
    params: {
      AMOUNT: ((payment.amount_cents ?? 0) / 100).toFixed(2),
      AMOUNT_CENTS: payment.amount_cents ?? 0,
      REFUND_ID: refund.id,
      PORTAL_URL: process.env.PATIENT_PORTAL_URL?.replace(/\/$/, "") ?? "",
    },
  });

  return { ok: true, stripe_refund_id: refund.id, email_sent };
}

export const issueAdminRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        paymentId: z.string().uuid(),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getStripe } = await import("@/integrations/stripe/client.server");
    return processAdminRefund({
      supabaseAdmin,
      stripe: getStripe(),
      adminUserId: context.userId,
      paymentId: data.paymentId,
      reason: data.reason,
    });
  });

// ---------------------------------------------------------------------------
// Refund history — paginated, filterable, read-only audit view of every refund
// processed by admins (plus automatic order-rejection refunds).
// ---------------------------------------------------------------------------

const refundHistoryInput = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.string().trim().max(40).optional(),
    days: z.number().int().min(1).max(3650).optional(),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .default({ page: 1, limit: 25 });

export const listRefundHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => refundHistoryInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { uuidPrefixRange } = await import("@/lib/format");

    const from = (data.page - 1) * data.limit;

    const since = data.days ? new Date(Date.now() - data.days * 86400000).toISOString() : null;
    const range = data.search ? uuidPrefixRange(data.search) : null;
    const idMatchOnly = Boolean(range);

    let q = supabaseAdmin
      .from("refund_requests")
      .select(
        "id, user_id, payment_id, amount_cents, reason, status, admin_note, stripe_refund_id, reviewed_by, reviewed_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(1000);

    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (since) q = q.gte("created_at", since);
    if (range) q = q.gte("id", range.lo).lte("id", range.hi);

    // Refunds issued directly when an order is rejected never create a refund_requests
    // row, so they are read from medication_requests and merged into the same history.
    let dq = supabaseAdmin
      .from("medication_requests")
      .select(
        "id, user_id, payment_id, stripe_refund_id, decision_by, decision_at, decision_note, updated_at",
      )
      .not("stripe_refund_id", "is", null)
      .order("decision_at", { ascending: false })
      .limit(1000);

    if (since) dq = dq.gte("decision_at", since);
    if (range) dq = dq.gte("id", range.lo).lte("id", range.hi);

    const [reqRes, directRes] = await Promise.all([q, dq]);
    if (reqRes.error) throw new Error(reqRes.error.message);
    if (directRes.error) throw new Error(directRes.error.message);

    const requests = reqRes.data ?? [];
    // Direct refunds are always completed refunds, so they only belong to "approved".
    const direct =
      data.status && data.status !== "all" && data.status !== "approved"
        ? []
        : (directRes.data ?? []);

    const userIds = Array.from(
      new Set(
        [
          ...requests.flatMap((r: any) => [r.user_id, r.reviewed_by]),
          ...direct.flatMap((r: any) => [r.user_id, r.decision_by]),
        ].filter(Boolean) as string[],
      ),
    );
    const payIds = Array.from(
      new Set([...requests, ...direct].map((r: any) => r.payment_id).filter(Boolean) as string[]),
    );

    const [{ data: profiles }, { data: payments }] = await Promise.all([
      userIds.length
        ? supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),
      payIds.length
        ? supabaseAdmin
            .from("payments")
            .select("id, stripe_invoice_id, raw_event, amount_cents")
            .in("id", payIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const payMap = new Map((payments ?? []).map((p: any) => [p.id, p]));

    let result = requests.map((r: any) => {
      const p = pMap.get(r.user_id) as any;
      const reviewer = r.reviewed_by ? (pMap.get(r.reviewed_by) as any) : null;
      const pay = payMap.get(r.payment_id) as any;
      const { invoiceUrl, invoicePdfUrl } = invoiceUrls(pay?.raw_event);
      return {
        id: r.id,
        customer_name: p?.full_name ?? null,
        customer_email: p?.email ?? null,
        amount: Number(r.amount_cents) / 100,
        reason: r.reason,
        status: r.status,
        admin_note: r.admin_note,
        stripe_refund_id: r.stripe_refund_id,
        reviewed_by_name: reviewer?.full_name ?? reviewer?.email ?? null,
        reviewed_at: r.reviewed_at,
        invoice_url: invoiceUrl,
        invoice_pdf_url: invoicePdfUrl,
        created_at: r.created_at,
      };
    });

    result = result.concat(
      direct.map((r: any) => {
        const p = pMap.get(r.user_id) as any;
        const reviewer = r.decision_by ? (pMap.get(r.decision_by) as any) : null;
        const pay = payMap.get(r.payment_id) as any;
        const { invoiceUrl, invoicePdfUrl } = invoiceUrls(pay?.raw_event);
        return {
          id: r.id,
          customer_name: p?.full_name ?? null,
          customer_email: p?.email ?? null,
          amount: Number(pay?.amount_cents ?? 0) / 100,
          reason: "Order rejected — automatic refund",
          status: "approved",
          admin_note: r.decision_note ?? null,
          stripe_refund_id: r.stripe_refund_id,
          reviewed_by_name: reviewer?.full_name ?? reviewer?.email ?? null,
          reviewed_at: r.decision_at ?? r.updated_at,
          invoice_url: invoiceUrl,
          invoice_pdf_url: invoicePdfUrl,
          created_at: r.decision_at ?? r.updated_at,
        };
      }),
    );

    result.sort(
      (a: any, b: any) =>
        new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
    );

    // Name / email / reason search is applied after the join (those live on other tables).
    if (data.search && !idMatchOnly) {
      const s = data.search.toLowerCase();
      result = result.filter(
        (r: any) =>
          (r.customer_name ?? "").toLowerCase().includes(s) ||
          (r.customer_email ?? "").toLowerCase().includes(s) ||
          (r.reason ?? "").toLowerCase().includes(s) ||
          (r.stripe_refund_id ?? "").toLowerCase().includes(s),
      );
    }

    const total = result.length;
    return {
      data: result.slice(from, from + data.limit),
      total,
      page: data.page,
      page_size: data.limit,
      total_pages: total ? Math.ceil(total / data.limit) : 0,
    };
  });
