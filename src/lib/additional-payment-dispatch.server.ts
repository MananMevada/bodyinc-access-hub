// After a medicine change to a more expensive plan, the patient pays the difference.
// Payment then prescribes the order and sends it to the pharmacy. No one has to approve it again.
//
// Confirmation arrives from:
// - Stripe `checkout.session.completed` (checkout created here, linked in the patient email)
// - POST /api/internal/additional-payment-paid (patient portal, after its own checkout)
// - finishing the consultation, when the difference was already paid

import type Stripe from "stripe";

const ADDITIONAL_PAYMENT_KIND = "additional_payment";
const SENT_STATUSES = new Set(["sent_to_pharmacy", "dispatched", "delivered"]);
const PERMANENT_DISPATCH_ERROR =
  /no assigned provider|no patient|patient profile not found|provider record not found|provider profile not found|npi is required|prescription not found/i;

export type AdditionalPaymentLookup = {
  additionalPaymentId?: string | null;
  requestId?: string | null;
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
};

export type AdditionalPaymentDispatchResult = {
  ok: boolean;
  dispatched: boolean;
  alreadyDispatched?: boolean;
  retry?: boolean;
  lifeFileOrderId?: string | null;
  reason?: string;
};

type PaymentRow = {
  id: string;
  request_id: string;
  status: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

type RequestRow = {
  id: string;
  status: string;
  provider_id: string | null;
  user_id: string | null;
  medicine_id: string | null;
  variant_id: string | null;
  package_id: string | null;
  subscription_id: string | null;
  requires_consultation: boolean | null;
  life_file_order_id: string | null;
  life_file_status: string | null;
};

function returnBase(): string {
  return (
    process.env.PATIENT_PORTAL_URL?.replace(/\/$/, "") ||
    process.env.APP_URL?.replace(/\/$/, "") ||
    ""
  );
}

/** Hosted Stripe Checkout for the price difference. Null when no return URL is configured. */
export async function createAdditionalPaymentCheckout(opts: {
  paymentId: string;
  requestId: string;
  amountCents: number;
  medicineLabel: string;
  customerId?: string | null;
  customerEmail?: string | null;
}): Promise<{ id: string; url: string } | null> {
  const base = returnBase();
  if (!base || opts.amountCents <= 0) return null;

  const { getStripe } = await import("@/integrations/stripe/client.server");
  const stripe = getStripe();
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    client_reference_id: opts.paymentId,
    metadata: {
      kind: ADDITIONAL_PAYMENT_KIND,
      additional_payment_id: opts.paymentId,
      request_id: opts.requestId,
    },
    payment_intent_data: {
      metadata: {
        kind: ADDITIONAL_PAYMENT_KIND,
        additional_payment_id: opts.paymentId,
        request_id: opts.requestId,
      },
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: opts.amountCents,
          product_data: {
            name: `Additional payment — ${opts.medicineLabel}`.slice(0, 120),
            description: "Price difference after your clinician updated your treatment.",
          },
        },
      },
    ],
    success_url: `${base}/orders/${opts.requestId}/pay?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/orders/${opts.requestId}/pay?payment=cancelled`,
  };
  if (opts.customerId) params.customer = opts.customerId;
  else if (opts.customerEmail) params.customer_email = opts.customerEmail;

  const session = await stripe.checkout.sessions.create(params, {
    idempotencyKey: `additional-payment-${opts.paymentId}`,
  });
  if (!session.url) return null;
  return { id: session.id, url: session.url };
}

async function loadPayment(
  supabaseAdmin: any,
  lookup: AdditionalPaymentLookup,
): Promise<PaymentRow | null> {
  if (lookup.checkoutSessionId) {
    const { data } = await supabaseAdmin
      .from("additional_payments")
      .select("id, request_id, status, stripe_checkout_session_id, stripe_payment_intent_id")
      .eq("stripe_checkout_session_id", lookup.checkoutSessionId)
      .maybeSingle();
    if (data) return data as PaymentRow;
  }
  if (lookup.additionalPaymentId) {
    const { data } = await supabaseAdmin
      .from("additional_payments")
      .select("id, request_id, status, stripe_checkout_session_id, stripe_payment_intent_id")
      .eq("id", lookup.additionalPaymentId)
      .maybeSingle();
    if (data) return data as PaymentRow;
  }
  if (lookup.paymentIntentId) {
    const { data } = await supabaseAdmin
      .from("additional_payments")
      .select("id, request_id, status, stripe_checkout_session_id, stripe_payment_intent_id")
      .eq("stripe_payment_intent_id", lookup.paymentIntentId)
      .maybeSingle();
    if (data) return data as PaymentRow;
  }
  if (lookup.requestId) {
    const { data } = await supabaseAdmin
      .from("additional_payments")
      .select("id, request_id, status, stripe_checkout_session_id, stripe_payment_intent_id")
      .eq("request_id", lookup.requestId)
      .in("status", ["pending", "paid"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as PaymentRow;
  }
  return null;
}

async function logSystemEvent(
  supabaseAdmin: any,
  requestId: string,
  status: string,
  note: string,
): Promise<void> {
  await supabaseAdmin.from("medication_request_events").insert({
    request_id: requestId,
    status,
    actor_role: "system",
    created_by: null,
    note,
  });
}

async function syncPrescriptionSnapshot(supabaseAdmin: any, req: RequestRow): Promise<void> {
  let medicineName = "Medication";
  if (req.medicine_id) {
    const { data: med } = await supabaseAdmin
      .from("medicines")
      .select("name")
      .eq("id", req.medicine_id)
      .maybeSingle();
    medicineName = (med as { name?: string } | null)?.name?.trim() || medicineName;
  }
  await supabaseAdmin
    .from("prescriptions")
    .update({
      medicine_id: req.medicine_id,
      variant_id: req.variant_id,
      package_id: req.package_id,
      medicine_name: medicineName,
      updated_at: new Date().toISOString(),
    })
    .eq("request_id", req.id)
    .neq("status", "voided");
}

/**
 * Mark the difference paid (if it is still pending) and send the updated order to LifeFile.
 * Safe to call more than once.
 */
export async function confirmAdditionalPaymentAndDispatch(
  supabaseAdmin: any,
  lookup: AdditionalPaymentLookup,
): Promise<AdditionalPaymentDispatchResult> {
  const payment = await loadPayment(supabaseAdmin, lookup);
  if (!payment) return { ok: false, dispatched: false, reason: "not_found" };
  if (payment.status === "cancelled" || payment.status === "failed") {
    return { ok: true, dispatched: false, reason: payment.status };
  }
  if (
    lookup.checkoutSessionId &&
    payment.stripe_checkout_session_id &&
    payment.stripe_checkout_session_id !== lookup.checkoutSessionId
  ) {
    return { ok: false, dispatched: false, reason: "checkout_mismatch" };
  }

  const now = new Date().toISOString();
  let justPaid = false;
  if (payment.status === "pending") {
    const patch: Record<string, string> = { status: "paid", paid_at: now, updated_at: now };
    if (lookup.paymentIntentId) patch.stripe_payment_intent_id = lookup.paymentIntentId;
    if (lookup.checkoutSessionId) patch.stripe_checkout_session_id = lookup.checkoutSessionId;
    const { data: marked, error } = await supabaseAdmin
      .from("additional_payments")
      .update(patch)
      .eq("id", payment.id)
      .eq("status", "pending")
      .select("id");
    if (error) throw new Error(error.message);
    justPaid = Array.isArray(marked) && marked.length > 0;
  } else if (lookup.paymentIntentId && !payment.stripe_payment_intent_id) {
    await supabaseAdmin
      .from("additional_payments")
      .update({
        stripe_payment_intent_id: lookup.paymentIntentId,
        updated_at: now,
      })
      .eq("id", payment.id);
  }
  if (justPaid) {
    await logSystemEvent(
      supabaseAdmin,
      payment.request_id,
      "additional_payment_paid",
      "Additional payment received.",
    );
  }

  const { data: req, error: reqErr } = await supabaseAdmin
    .from("medication_requests")
    .select(
      "id, status, provider_id, user_id, medicine_id, variant_id, package_id, subscription_id, requires_consultation, life_file_order_id, life_file_status, plan_change_token",
    )
    .eq("id", payment.request_id)
    .maybeSingle();
  if (reqErr) throw new Error(reqErr.message);
  if (!req) return { ok: false, dispatched: false, reason: "request_not_found" };
  const request = req as RequestRow;

  if (SENT_STATUSES.has(request.status) || request.life_file_order_id) {
    if (request.status === "awaiting_additional_payment") {
      await supabaseAdmin
        .from("medication_requests")
        .update({ status: "sent_to_pharmacy", updated_at: now })
        .eq("id", request.id);
    }
    return {
      ok: true,
      dispatched: true,
      alreadyDispatched: true,
      lifeFileOrderId: request.life_file_order_id,
    };
  }

  if (request.status === "rejected" || request.status === "cancelled") {
    return { ok: true, dispatched: false, reason: request.status };
  }

  const planChangeToken = (request as { plan_change_token?: string | null }).plan_change_token;
  if (planChangeToken) {
    const { confirmPlanChange } = await import("@/lib/plan-change.server");
    const confirmed = await confirmPlanChange(supabaseAdmin, request.id, "payment");
    return {
      ok: confirmed.ok !== false,
      dispatched: Boolean(confirmed.lifeFileOrderId),
      lifeFileOrderId: confirmed.lifeFileOrderId,
      retry: confirmed.retry,
      reason: confirmed.error ?? undefined,
    };
  }

  const providerId = request.provider_id;
  if (!providerId) {
    if (request.status === "awaiting_additional_payment" || request.status === "pending_review") {
      await supabaseAdmin
        .from("medication_requests")
        .update({ status: "approved", updated_at: now })
        .eq("id", request.id);
    }
    await logSystemEvent(
      supabaseAdmin,
      request.id,
      "approved",
      "Additional payment received. Automatic pharmacy dispatch needs an assigned provider.",
    );
    return {
      ok: false,
      dispatched: false,
      retry: false,
      reason: "This request has no assigned provider.",
    };
  }

  if (request.status === "pending_review") {
    return { ok: true, dispatched: false, reason: "returned_to_decision" };
  }

  await syncPrescriptionSnapshot(supabaseAdmin, request);

  const { fulfillApprovedRequest } = await import("@/lib/requests.functions");
  try {
    const sent = await fulfillApprovedRequest(
      supabaseAdmin,
      { ...request, provider_id: providerId },
      { role: "system", userId: null },
    );
    return { ok: true, dispatched: true, lifeFileOrderId: sent.lifeFileOrderId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pharmacy dispatch failed.";
    const { lifeFileSendBlocked } = await import("@/integrations/lifefile/submit.server");
    const blocked = lifeFileSendBlocked(message);
    if (blocked === "in_flight") {
      return { ok: true, dispatched: false, retry: true, reason: message };
    }
    if (blocked === "sent") {
      const { data: fresh } = await supabaseAdmin
        .from("medication_requests")
        .select("life_file_order_id, status")
        .eq("id", request.id)
        .maybeSingle();
      const freshStatus = (fresh as { status?: string } | null)?.status;
      if (freshStatus && !SENT_STATUSES.has(freshStatus)) {
        await supabaseAdmin
          .from("medication_requests")
          .update({ status: "sent_to_pharmacy", updated_at: now })
          .eq("id", request.id)
          .eq("status", freshStatus);
      }
      return {
        ok: true,
        dispatched: true,
        alreadyDispatched: true,
        lifeFileOrderId:
          (fresh as { life_file_order_id?: string | null } | null)?.life_file_order_id ?? null,
      };
    }

    console.error("[additional-payment] pharmacy dispatch failed:", error);
    if (request.status === "awaiting_additional_payment" || request.status === "pending_review") {
      await supabaseAdmin
        .from("medication_requests")
        .update({ status: "approved", updated_at: now })
        .eq("id", request.id);
    }
    await logSystemEvent(
      supabaseAdmin,
      request.id,
      "approved",
      `Additional payment received. Automatic pharmacy dispatch failed: ${message}`.slice(0, 500),
    );
    return {
      ok: false,
      dispatched: false,
      retry: !PERMANENT_DISPATCH_ERROR.test(message),
      reason: message,
    };
  }
}

/** Called when a consultation ends, in case the difference was paid first. */
export async function dispatchPaidAdditionalPaymentForRequest(
  supabaseAdmin: any,
  requestId: string,
): Promise<AdditionalPaymentDispatchResult> {
  const { data } = await supabaseAdmin
    .from("additional_payments")
    .select("id")
    .eq("request_id", requestId)
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.id) return { ok: true, dispatched: false, reason: "no_paid_payment" };
  return confirmAdditionalPaymentAndDispatch(supabaseAdmin, { additionalPaymentId: data.id });
}

export function isAdditionalPaymentStripeEvent(event: Stripe.Event): boolean {
  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return false;
  }
  const session = event.data.object as Stripe.Checkout.Session;
  return (
    session.metadata?.kind === ADDITIONAL_PAYMENT_KIND ||
    Boolean(session.metadata?.additional_payment_id)
  );
}

export function lookupFromStripeEvent(event: Stripe.Event): AdditionalPaymentLookup | null {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status && session.payment_status !== "paid") return null;
    const paymentIntent = session.payment_intent;
    const paymentIntentId = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id;
    return {
      additionalPaymentId: session.metadata?.additional_payment_id ?? null,
      requestId: session.metadata?.request_id ?? null,
      checkoutSessionId: session.id,
      paymentIntentId: paymentIntentId ?? null,
    };
  }
  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object as Stripe.PaymentIntent;
    return {
      additionalPaymentId: intent.metadata?.additional_payment_id ?? null,
      requestId: intent.metadata?.request_id ?? null,
      paymentIntentId: intent.id,
    };
  }
  return null;
}
