import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const provided = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const secrets = [process.env.CRON_SECRET, process.env.INTERNAL_API_SECRET].filter(
    (value): value is string => Boolean(value),
  );
  if (!secrets.length || !provided) return false;
  const given = Buffer.from(provided);
  return secrets.some((secret) => {
    const expected = Buffer.from(secret);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// Daily patient and provider reminders. Vercel cron calls this, and provider page loads do too.
export const Route = createFileRoute("/api/internal/reminders")({
  server: {
    handlers: {
      GET: ({ request }) => run(request),
      POST: ({ request }) => run(request),
    },
  },
});

async function run(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET && !process.env.INTERNAL_API_SECRET) {
    return Response.json({ ok: false, error: "Endpoint is not configured." }, { status: 503 });
  }
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendScheduledReminders } = await import("@/lib/email-reminders.server");
    await sendScheduledReminders(supabaseAdmin, { force: true });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[email] reminder run failed:", error);
    return Response.json({ ok: false, error: "Reminder run failed." }, { status: 500 });
  }
}
