import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

// RLS scopes every read/write below to the signed-in recipient.
export const listMyNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("notifications")
      .select("id, type, title, body, link, entity_id, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    const items = (data ?? []) as AppNotification[];
    return { items, unread: items.filter((n) => !n.read_at).length };
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid().optional(), all: z.boolean().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    if (!data.all) {
      if (!data.id) return { ok: true };
      q = q.eq("id", data.id);
    }
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });
