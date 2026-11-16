import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const bodySchema = z
  .object({
    additionalPaymentId: z.string().uuid().optional(),
    requestId: z.string().uuid().optional(),
    stripePaymentIntentId: z.string().trim().min(1).max(200).optional(),
    stripeCheckoutSessionId: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (body) =>
      Boolean(
        body.additionalPaymentId ||
          body.requestId ||
          body.stripePaymentIntentId ||
          body.stripeCheckoutSessionId,
      ),
    { message: "Provide a payment or request id." },
  );

function authorized(request: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Patient portal calls this after its own checkout succeeds, if it does not use
// the Stripe Checkout session created by this app.
export const Route = createFileRoute("/api/internal/additional-payment-paid")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!process.env.INTERNAL_API_SECRET) {
          return Response.json({ ok: false, error: "Endpoint is not configured." }, { status: 503 });
        }
        if (!authorized(request)) {
          return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
        }

        let parsed: z.infer<typeof bodySchema>;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch {
          return Response.json({ ok: false, error: "Invalid payload." }, { status: 400 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { confirmAdditionalPaymentAndDispatch } = await import(
            "@/lib/additional-payment-dispatch.server"
          );
          const result = await confirmAdditionalPaymentAndDispatch(supabaseAdmin, {
            additionalPaymentId: parsed.additionalPaymentId,
            requestId: parsed.requestId,
            paymentIntentId: parsed.stripePaymentIntentId,
            checkoutSessionId: parsed.stripeCheckoutSessionId,
          });
          if (result.reason === "not_found") {
            return Response.json({ ok: false, error: "Additional payment not found." }, { status: 404 });
          }
          if (result.retry) {
            return Response.json(
              { ok: false, dispatched: false, error: result.reason ?? "Pharmacy dispatch failed." },
              { status: 500 },
            );
          }
          return Response.json({
            ok: result.ok,
            dispatched: result.dispatched,
            alreadyDispatched: result.alreadyDispatched ?? false,
            lifeFileOrderId: result.lifeFileOrderId ?? null,
            reason: result.reason ?? null,
          });
        } catch (error) {
          console.error("[additional-payment] internal confirm failed:", error);
          return Response.json({ ok: false, error: "Dispatch failed." }, { status: 500 });
        }
      },
    },
  },
});
