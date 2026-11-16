import { createFileRoute } from "@tanstack/react-router";

// LifeFile calls this when a prescription ships. Basic auth is the username and
// password we give them. Tracking is saved on the matching order.
export const Route = createFileRoute("/api/lifefile/data-push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { applyLifeFileDataPush, dataPushAuthFailure, parseDataPushBody } = await import(
          "@/integrations/lifefile/data-push.server"
        );
        const authFailure = dataPushAuthFailure(request.headers.get("authorization"));
        if (authFailure === "missing-config") {
          console.error("[lifefile-push] LIFEFILE_DATA_PUSH_USERNAME or PASSWORD is not set.");
          return Response.json({ ok: false, error: "Data push is not configured." }, { status: 429 });
        }
        if (authFailure === "unauthorized") {
          return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
        }

        const items = parseDataPushBody(body);
        if (items.length === 0) {
          return Response.json({ ok: false, error: "Empty payload." }, { status: 400 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const result = await applyLifeFileDataPush(supabaseAdmin, items, {
            idempotencyKey: request.headers.get("idempotency-key"),
            triggerName: request.headers.get("x-lf-datapush-trigger-name"),
          });
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("[lifefile-push] failed:", error);
          return Response.json({ ok: false, error: "Temporary failure." }, { status: 429 });
        }
      },
    },
  },
});
