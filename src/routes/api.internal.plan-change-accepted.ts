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

// Patient portal calls this when the patient approves a medicine change that has no extra charge.
export const Route = createFileRoute("/api/internal/plan-change-accepted")({
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
          const { data: req } = await supabaseAdmin
            .from("medication_requests")
            .select("id, status, plan_change_delta_cents")
            .eq("id", parsed.requestId)
            .maybeSingle();
          if (!req) {
            return Response.json({ ok: false, error: "Order not found." }, { status: 404 });
          }
          if (req.status !== "awaiting_additional_payment") {
            return Response.json({ ok: true, already: true, status: req.status });
          }
          if (Number(req.plan_change_delta_cents ?? 0) > 0) {
            return Response.json(
              { ok: false, error: "This change needs the additional payment." },
              { status: 409 },
            );
          }

          const { confirmPlanChange } = await import("@/lib/plan-change.server");
          const result = await confirmPlanChange(supabaseAdmin, parsed.requestId, "patient");
          return Response.json({
            ok: result.ok !== false,
            status: result.status,
            lifeFileOrderId: result.lifeFileOrderId ?? null,
            error: result.error ?? null,
          });
        } catch (error) {
          console.error("[plan-change] internal accept failed:", error);
          return Response.json({ ok: false, error: "Accept failed." }, { status: 500 });
        }
      },
    },
  },
});