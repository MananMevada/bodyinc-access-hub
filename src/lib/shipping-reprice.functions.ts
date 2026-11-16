import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";

// Reconcile one Stripe page per request so no single call risks a serverless timeout; the
// client loops with the returned cursor until `done`. active + trialing + past_due only.
const SYNC_STATUSES: Array<"active" | "trialing" | "past_due"> = ["active", "trialing", "past_due"];
const BATCH_SIZE = 50;

type Counts = {
  scanned: number;
  updated: number;
  added: number;
  removed: number;
  skipped: number;
  errors: number;
};

const ZERO: Counts = { scanned: 0, updated: 0, added: 0, removed: 0, skipped: 0, errors: 0 };

const countsSchema = z.object({
  scanned: z.number().int().min(0),
  updated: z.number().int().min(0),
  added: z.number().int().min(0),
  removed: z.number().int().min(0),
  skipped: z.number().int().min(0),
  errors: z.number().int().min(0),
});

const batchInput = z
  .object({
    statusIndex: z.number().int().min(0).default(0),
    startingAfter: z.string().nullable().default(null),
    totals: countsSchema.default(ZERO),
  })
  .default({ statusIndex: 0, startingAfter: null, totals: ZERO });

type ShippingItemPrice = {
  id: string;
  currency: string;
  lookup_key: string | null;
  metadata: Record<string, string> | null;
  recurring: { interval: string; interval_count: number } | null;
};

function isShippingPrice(price: ShippingItemPrice): boolean {
  return (
    price.metadata?.kind === "shipping" || (price.lookup_key?.startsWith("bi_shipping_") ?? false)
  );
}

export const syncShippingBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => batchInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getStripe } = await import("@/integrations/stripe/client.server");
    const stripe = getStripe();

    const { data: rows, error } = await supabaseAdmin
      .from("platform_settings")
      .select("key, value")
      .in("key", ["shipping_fee_cents", "shipping_fee_enabled"]);
    if (error) throw new Error(error.message);
    const map = new Map((rows ?? []).map((r) => [r.key, r.value]));
    const shippingEnabled = map.get("shipping_fee_enabled") === true;
    const shippingCents = Number(map.get("shipping_fee_cents") ?? 0);
    const targetCents = shippingEnabled ? shippingCents : 0;

    const totals: Counts = { ...ZERO, ...data.totals };

    // Phases: statusIndex 0..N-1 walk the regular subscription list (one page each);
    // statusIndex === N is a final sweep of test-clock subscriptions, which Stripe hides
    // from subscriptions.list() (matters for test-mode verification; no-op in live mode).
    if (data.statusIndex > SYNC_STATUSES.length) {
      return { done: true, statusIndex: data.statusIndex, startingAfter: null, totals };
    }

    const priceCache = new Map<string, string>();
    async function shippingPriceId(
      currency: string,
      interval: string,
      intervalCount: number,
    ): Promise<string> {
      const lookupKey = `bi_shipping_${currency}_${interval}_${intervalCount}_${targetCents}`;
      const cached = priceCache.get(lookupKey);
      if (cached) return cached;
      const existing = await stripe.prices.list({
        lookup_keys: [lookupKey],
        active: true,
        limit: 1,
      });
      const id =
        existing.data[0]?.id ??
        (
          await stripe.prices.create({
            currency,
            unit_amount: targetCents,
            recurring: {
              interval: interval as "day" | "week" | "month" | "year",
              interval_count: intervalCount,
            },
            lookup_key: lookupKey,
            product_data: { name: "Shipping" },
            metadata: { kind: "shipping" },
          })
        ).id;
      priceCache.set(lookupKey, id);
      return id;
    }

    async function reconcileSub(sub: {
      id: string;
      items: { data: Array<{ id: string; price: unknown }> };
    }): Promise<void> {
      totals.scanned += 1;
      try {
        const items = sub.items.data;
        const shippingItems = items.filter((it) => isShippingPrice(it.price as ShippingItemPrice));
        const planPrice = items.find((it) => !isShippingPrice(it.price as ShippingItemPrice))
          ?.price as ShippingItemPrice | undefined;

        // Collapse any accidental duplicate shipping items to a single one.
        for (const extra of shippingItems.slice(1)) {
          await stripe.subscriptionItems.del(extra.id, { proration_behavior: "none" });
        }
        const primary = shippingItems[0];

        if (targetCents <= 0) {
          if (primary) {
            await stripe.subscriptionItems.del(primary.id, { proration_behavior: "none" });
            totals.removed += 1;
          } else {
            totals.skipped += 1;
          }
          return;
        }

        if (!planPrice?.recurring) {
          totals.skipped += 1;
          return;
        }

        const targetPriceId = await shippingPriceId(
          planPrice.currency,
          planPrice.recurring.interval,
          planPrice.recurring.interval_count,
        );

        if (primary) {
          const currentPriceId = (primary.price as ShippingItemPrice).id;
          if (currentPriceId === targetPriceId && shippingItems.length === 1) {
            totals.skipped += 1;
          } else {
            await stripe.subscriptionItems.update(primary.id, {
              price: targetPriceId,
              proration_behavior: "none",
            });
            totals.updated += 1;
          }
        } else {
          await stripe.subscriptionItems.create({
            subscription: sub.id,
            price: targetPriceId,
            proration_behavior: "none",
          });
          totals.added += 1;
        }
      } catch (e) {
        console.error(`[shipping-reprice] failed for ${sub.id}:`, e);
        totals.errors += 1;
      }
    }

    if (data.statusIndex < SYNC_STATUSES.length) {
      const page = await stripe.subscriptions.list({
        status: SYNC_STATUSES[data.statusIndex],
        limit: BATCH_SIZE,
        starting_after: data.startingAfter ?? undefined,
      });
      for (const sub of page.data) await reconcileSub(sub);

      if (page.has_more && page.data.length > 0) {
        return {
          done: false,
          statusIndex: data.statusIndex,
          startingAfter: page.data[page.data.length - 1].id,
          totals,
        };
      }
      // Advance to the next status (or, after the last one, to the test-clock phase).
      return { done: false, statusIndex: data.statusIndex + 1, startingAfter: null, totals };
    }

    // Final phase: test-clock subscriptions. Wrapped because test-clock APIs are test-mode
    // only — in live mode this throws and is simply skipped (there are no test clocks).
    try {
      for await (const clock of stripe.testHelpers.testClocks.list({ limit: 100 })) {
        for await (const cust of stripe.customers.list({ test_clock: clock.id, limit: 100 })) {
          for await (const sub of stripe.subscriptions.list({
            customer: cust.id,
            status: "all",
            limit: 100,
          })) {
            if (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due") {
              await reconcileSub(sub);
            }
          }
        }
      }
    } catch (e) {
      console.log(
        "[shipping-reprice] test-clock sweep skipped:",
        e instanceof Error ? e.message : e,
      );
    }

    await supabaseAdmin.from("admin_activity_log").insert({
      admin_user_id: context.userId,
      action: "shipping.reprice",
      entity: "subscriptions",
      entity_id: null,
      before: null,
      after: { target_cents: targetCents, enabled: shippingEnabled, ...totals },
    });

    return { done: true, statusIndex: data.statusIndex + 1, startingAfter: null, totals };
  });
