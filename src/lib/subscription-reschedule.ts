// Shared Stripe subscription reschedule used by both admin "change medicine" and the
// provider/admin request change-medicine flow.
//
// When the plan (or medicine) changes, the new package is applied immediately and the
// current billing/refill period end is recalculated from the current period start + the
// new package duration (e.g. 1-month → 3-month moves next bill from +1mo to +3mo).
// Money for the current cycle is handled separately (additional payment / customer credit).

export function isShippingItemPrice(price: any): boolean {
  return (
    price?.metadata?.kind === "shipping" ||
    (typeof price?.lookup_key === "string" && price.lookup_key.startsWith("bi_shipping_"))
  );
}

export type ReschedulePackage = {
  id: string;
  medicine_id: string;
  variant_id: string | null;
  duration_months: number;
  stripe_price_id: string;
  medicines?: { name?: string } | null;
  medicine_variants?: { name?: string } | null;
};

/** Add calendar months to a unix timestamp (seconds). */
export function addMonthsUnix(unixSeconds: number, months: number): number {
  const d = new Date(unixSeconds * 1000);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // Clamp overflow (e.g. Jan 31 + 1 month → Mar 3) back to last day of target month.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return Math.floor(d.getTime() / 1000);
}

export function periodEndFromDuration(params: {
  periodStartUnix: number;
  durationMonths: number;
  nowUnix?: number;
}): number {
  const { periodStartUnix, durationMonths, nowUnix = Math.floor(Date.now() / 1000) } = params;
  const months = Math.max(1, Number(durationMonths) || 1);
  const fromStart = addMonthsUnix(periodStartUnix, months);
  // If shortening would put the end in the past, start a fresh period from now.
  return fromStart > nowUnix ? fromStart : addMonthsUnix(nowUnix, months);
}

async function resolveShippingPriceId(params: {
  stripe: any;
  shippingItem: any | undefined;
  newIntervalCount: number;
}): Promise<string | null> {
  const { stripe, shippingItem, newIntervalCount } = params;
  if (!shippingItem) return null;

  const shipPrice: any = shippingItem.price;
  const currency: string = shipPrice.currency ?? "usd";
  const amountCents: number = shipPrice.unit_amount ?? 0;
  const sameInterval =
    shipPrice.recurring?.interval === "month" &&
    (shipPrice.recurring?.interval_count ?? 1) === newIntervalCount;
  if (sameInterval) return shipPrice.id as string;

  const lookupKey = `bi_shipping_${currency}_month_${newIntervalCount}_${amountCents}`;
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  if (existing.data[0]?.id) return existing.data[0].id as string;

  const created = await stripe.prices.create({
    currency,
    unit_amount: amountCents,
    recurring: { interval: "month", interval_count: newIntervalCount },
    lookup_key: lookupKey,
    product_data: { name: "Shipping" },
    metadata: { kind: "shipping" },
  });
  return created.id as string;
}

const USABLE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "unpaid", "incomplete"];

function isMissingStripeResource(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: string; message?: string };
  if (row.code === "resource_missing") return true;
  return /No such (subscription|customer|price)/i.test(row.message ?? "");
}

function customerIdOf(customer: unknown): string | null {
  if (typeof customer === "string" && customer) return customer;
  if (customer && typeof customer === "object" && "id" in customer) {
    const id = (customer as { id?: string }).id;
    return id || null;
  }
  return null;
}

async function customerExists(stripe: any, customerId: string): Promise<boolean> {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return !customer?.deleted;
  } catch (error) {
    if (isMissingStripeResource(error)) return false;
    throw error;
  }
}

/**
 * The id saved on the order can belong to another Stripe account, or to a subscription
 * that was replaced. Find the subscription this API key can actually update, and save
 * that id so the next change does not look up a dead one.
 */
async function resolveStripeSubscription(params: {
  stripe: any;
  supabaseAdmin: any;
  sub: { id: string; stripe_subscription_id: string };
}): Promise<{ subscription: any | null; customerId: string | null }> {
  const { stripe, supabaseAdmin, sub } = params;
  try {
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    return { subscription: stripeSub, customerId: customerIdOf(stripeSub.customer) };
  } catch (error) {
    if (!isMissingStripeResource(error)) throw error;
  }

  const { data: row } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id, medicine_id, package_id, stripe_customer_id")
    .eq("id", sub.id)
    .maybeSingle();
  const record = row as {
    user_id?: string | null;
    medicine_id?: string | null;
    package_id?: string | null;
    stripe_customer_id?: string | null;
  } | null;

  let email: string | null = null;
  const customerIds = new Set<string>();
  if (record?.stripe_customer_id) customerIds.add(record.stripe_customer_id);
  if (record?.user_id) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email, stripe_customer_id")
      .eq("id", record.user_id)
      .maybeSingle();
    const profileRow = profile as { email?: string | null; stripe_customer_id?: string | null } | null;
    if (profileRow?.stripe_customer_id) customerIds.add(profileRow.stripe_customer_id);
    email = profileRow?.email?.trim() || null;
  }

  const liveCustomerIds: string[] = [];
  for (const customerId of customerIds) {
    if (await customerExists(stripe, customerId)) liveCustomerIds.push(customerId);
  }
  if (!liveCustomerIds.length && email) {
    const found = await stripe.customers.list({ email, limit: 10 });
    for (const customer of found.data ?? []) {
      if (!customer.deleted && customer.id) liveCustomerIds.push(customer.id as string);
    }
  }

  type Candidate = {
    id: string;
    customerId: string;
    status: string;
    metadata: Record<string, string> | null;
  };
  const candidates: Candidate[] = [];
  for (const customerId of liveCustomerIds) {
    const listed = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
    for (const item of listed.data ?? []) {
      candidates.push({
        id: item.id,
        customerId,
        status: item.status,
        metadata: (item.metadata as Record<string, string> | null) ?? null,
      });
    }
  }

  const usable = candidates.filter((item) => USABLE_SUBSCRIPTION_STATUSES.includes(item.status));
  const byPackage = record?.package_id
    ? usable.filter((item) => item.metadata?.package_id === record.package_id)
    : [];
  const byMedicine = record?.medicine_id
    ? usable.filter((item) => item.metadata?.medicine_id === record.medicine_id)
    : [];
  const chosen =
    (byPackage.length === 1 ? byPackage[0] : null) ??
    (byMedicine.length === 1 ? byMedicine[0] : null) ??
    (usable.length === 1 ? usable[0] : null);

  if (!chosen) {
    console.warn("[stripe] no subscription in the current account", {
      subscriptionId: sub.id,
      storedStripeSubscriptionId: sub.stripe_subscription_id,
    });
    return { subscription: null, customerId: liveCustomerIds[0] ?? null };
  }

  const { error: saveError } = await supabaseAdmin
    .from("subscriptions")
    .update({
      stripe_subscription_id: chosen.id,
      stripe_customer_id: chosen.customerId,
    })
    .eq("id", sub.id);
  if (saveError) {
    console.error("[stripe] could not save the replacement subscription id", saveError.message);
  }

  const stripeSub = await stripe.subscriptions.retrieve(chosen.id);
  return { subscription: stripeSub, customerId: chosen.customerId };
}

export async function applyPackageChangeToSubscription(params: {
  stripe: any;
  supabaseAdmin: any;
  sub: { id: string; stripe_subscription_id: string };
  pkg: ReschedulePackage;
}): Promise<{
  description: string;
  currentPeriodEnd: string | null;
  billingUpdated: boolean;
  stripeCustomerId: string | null;
}> {
  const { stripe, supabaseAdmin, sub, pkg } = params;

  const medicineName = pkg.medicines?.name ?? "Treatment";
  const variantName = pkg.medicine_variants?.name ?? null;
  const planLabel =
    pkg.duration_months === 1 ? "Monthly Plan" : `${pkg.duration_months}-Month Plan`;
  const description = `${medicineName}${variantName ? ` — ${variantName}` : ""} · ${planLabel}`;
  const newIntervalCount = Math.max(1, Number(pkg.duration_months) || 1);

  const resolved = await resolveStripeSubscription({ stripe, supabaseAdmin, sub });
  if (!resolved.subscription) {
    return {
      description,
      currentPeriodEnd: null,
      billingUpdated: false,
      stripeCustomerId: resolved.customerId,
    };
  }
  const stripeSub = resolved.subscription;
  const stripeSubscriptionId = stripeSub.id as string;
  const items = stripeSub.items.data as any[];
  const shippingItem = items.find((it: any) => isShippingItemPrice(it.price));
  const planItem = items.find((it: any) => !isShippingItemPrice(it.price));
  if (!planItem) throw new Error("Could not find the plan item on this subscription.");

  const periodStartUnix: number | undefined =
    (stripeSub as any).current_period_start ?? (planItem as any)?.current_period_start;
  if (!periodStartUnix) throw new Error("Could not determine the current billing period start.");

  const newPeriodEndUnix = periodEndFromDuration({
    periodStartUnix,
    durationMonths: newIntervalCount,
  });

  const shippingPriceId = await resolveShippingPriceId({
    stripe,
    shippingItem,
    newIntervalCount,
  });

  const newMeta: Record<string, string> = {
    ...(stripeSub.metadata ?? {}),
    medicine_id: pkg.medicine_id,
    package_id: pkg.id,
    variant_id: pkg.variant_id ?? "",
    variant_name: variantName ?? "",
  };

  // Drop any deferred schedule so we can apply the new plan + period immediately.
  const existingSchedule = (stripeSub as any).schedule;
  if (existingSchedule) {
    const sid = typeof existingSchedule === "string" ? existingSchedule : existingSchedule.id;
    try {
      await stripe.subscriptionSchedules.release(sid);
    } catch {
      // Already released / not managed — proceed.
    }
  }

  // Apply the new plan immediately. A schedule with a single phase ending at the duration-based
  // period end keeps Stripe's next invoice aligned with the new refill date (without charging
  // again — proration is none; price deltas are handled via additional payment / credit).
  try {
    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: stripeSubscriptionId,
    });
    const currentPhase: any = schedule.phases[0];

    const phaseItems: Array<{ price: string; quantity: number }> = [
      { price: pkg.stripe_price_id, quantity: 1 },
    ];
    if (shippingPriceId) {
      phaseItems.push({ price: shippingPriceId, quantity: 1 });
    }

    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: "release",
      phases: [
        {
          items: phaseItems,
          start_date: currentPhase.start_date ?? periodStartUnix,
          end_date: newPeriodEndUnix,
          proration_behavior: "none",
          metadata: newMeta,
        },
      ],
    });

    await stripe.subscriptions.update(stripeSubscriptionId, {
      description,
      metadata: newMeta,
    });
  } catch (error) {
    if (!isMissingStripeResource(error)) throw error;
    console.warn("[stripe] plan change could not be written", {
      subscriptionId: sub.id,
      stripeSubscriptionId,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      description,
      currentPeriodEnd: null,
      billingUpdated: false,
      stripeCustomerId: resolved.customerId,
    };
  }

  const currentPeriodEnd = new Date(newPeriodEndUnix * 1000).toISOString();
  const { error: updErr } = await supabaseAdmin
    .from("subscriptions")
    .update({
      medicine_id: pkg.medicine_id,
      package_id: pkg.id,
      stripe_price_id: pkg.stripe_price_id,
      current_period_end: currentPeriodEnd,
    })
    .eq("id", sub.id);
  if (updErr) throw new Error(updErr.message);

  return {
    description,
    currentPeriodEnd,
    billingUpdated: true,
    stripeCustomerId: resolved.customerId,
  };
}
