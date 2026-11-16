import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const bodySchema = z.object({
  requestId: z.string().uuid(),
});

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

// Patient portal calls this when the patient declines an additional payment.
// Payment itself still uses /api/internal/additional-payment-paid.
export const Route = createFileRoute("/api/internal/additional-payment-declined")({
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
          const { data: paid } = await supabaseAdmin
            .from("additional_payments")
            .select("id")
            .eq("request_id", parsed.requestId)
            .eq("status", "paid")
            .limit(1)
            .maybeSingle();
          if (paid) {
            return Response.json(
              { ok: false, error: "This difference was already paid." },
              { status: 409 },
            );
          }

          const { declinePlanChange } = await import("@/lib/plan-change.server");
          const result = await declinePlanChange(supabaseAdmin, parsed.requestId, "declined");
          return Response.json({
            ok: true,
            status: result.status,
            already: "already" in result ? Boolean(result.already) : false,
          });
        } catch (error) {
          console.error("[additional-payment] internal decline failed:", error);
          return Response.json({ ok: false, error: "Decline failed." }, { status: 500 });
        }
      },
    },
  },
});
