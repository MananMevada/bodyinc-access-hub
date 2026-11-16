import { createFileRoute } from "@tanstack/react-router";

// Stripe calls this when a Checkout Session is paid, and when a renewal card is declined.
// Subscribe the endpoint to checkout.session.completed, checkout.session.async_payment_succeeded,
// and invoice.payment_failed.
export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret) {
          console.error("[stripe] STRIPE_WEBHOOK_SECRET is not set.");
          return Response.json({ ok: false, error: "Webhook is not configured." }, { status: 500 });
        }
        const signature = request.headers.get("stripe-signature");
        if (!signature) {
          return Response.json({ ok: false, error: "Missing signature." }, { status: 400 });
        }

        const payload = await request.text();
        let event;
        try {
          const { getStripe } = await import("@/integrations/stripe/client.server");
          event = getStripe().webhooks.constructEvent(payload, signature, secret);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invalid signature.";
          console.error("[stripe] webhook signature failed:", message);
          return Response.json({ ok: false, error: "Invalid signature." }, { status: 400 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          if (event.type === "invoice.payment_failed") {
            const { notifyRenewalCardFailed } = await import("@/lib/email.notifications");
            const invoice = event.data.object as {
              id?: string | null;
              subscription?: unknown;
              billing_reason?: string | null;
              parent?: { subscription_details?: { subscription?: unknown } };
            };
            const nested = invoice.parent?.subscription_details?.subscription;
            await notifyRenewalCardFailed(supabaseAdmin, {
              id: invoice.id,
              billing_reason: invoice.billing_reason,
              subscription: invoice.subscription ?? nested,
            });
            return Response.json({ ok: true });
          }

          const {
            isAdditionalPaymentStripeEvent,
            lookupFromStripeEvent,
            confirmAdditionalPaymentAndDispatch,
          } = await import("@/lib/additional-payment-dispatch.server");
          if (!isAdditionalPaymentStripeEvent(event)) {
            return Response.json({ ok: true, ignored: true });
          }
          const lookup = lookupFromStripeEvent(event);
          if (!lookup) return Response.json({ ok: true, ignored: true });

          const result = await confirmAdditionalPaymentAndDispatch(supabaseAdmin, lookup);
          if (result.reason === "not_found") {
            return Response.json({ ok: true, ignored: true });
          }
          if (result.retry) {
            return Response.json(
              { ok: false, error: result.reason ?? "Pharmacy dispatch failed." },
              { status: 500 },
            );
          }
          return Response.json({
            ok: result.ok,
            dispatched: result.dispatched,
            alreadyDispatched: result.alreadyDispatched ?? false,
            lifeFileOrderId: result.lifeFileOrderId ?? null,
          });
        } catch (error) {
          console.error("[stripe] additional payment webhook failed:", error);
          return Response.json({ ok: false, error: "Dispatch failed." }, { status: 500 });
        }
      },
    },
  },
});
