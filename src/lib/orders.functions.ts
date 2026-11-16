import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";

// A subscription is the canonical record of every purchase (onboarding + shop). "active" is
// shown as "paid"; incomplete subscriptions are unconfirmed and hidden from the default view.
function displayStatus(subStatus: string): string {
  return subStatus === "active" ? "paid" : subStatus;
}

const listInput = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.string().trim().max(40).optional(),
  })
  .default({});

export const listOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("subscriptions")
      .select(
        "id, user_id, session_id, stripe_subscription_id, package_id, medicine_id, status, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (data.status && data.status !== "all") {
      q = q.eq("status", data.status === "paid" ? "active" : data.status);
    } else {
      // Confirmed only — hide never-completed (abandoned) checkouts.
      q = q.not("status", "in", "(incomplete,incomplete_expired)");
    }

    const { data: subs, error } = await q;
    if (error) throw new Error(error.message);
    const rows = subs ?? [];

    const userIds = Array.from(new Set(rows.map((r: any) => r.user_id).filter(Boolean)));
    const pkgIds = Array.from(new Set(rows.map((r: any) => r.package_id).filter(Boolean)));
    const medIds = Array.from(new Set(rows.map((r: any) => r.medicine_id).filter(Boolean)));
    const subIds = rows.map((r: any) => r.stripe_subscription_id).filter(Boolean);
    // Guest onboarding orders (no account yet) carry the customer only on their intake session.
    const sessionIds = Array.from(
      new Set(
        rows
          .filter((r: any) => !r.user_id)
          .map((r: any) => r.session_id)
          .filter(Boolean),
      ),
    );

    const [
      { data: profiles },
      { data: pkgs },
      { data: meds },
      { data: payments },
      { data: sessions },
    ] = await Promise.all([
      userIds.length
        ? supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),
      pkgIds.length
        ? supabaseAdmin.from("packages").select("id, name").in("id", pkgIds)
        : Promise.resolve({ data: [] as any[] }),
      medIds.length
        ? supabaseAdmin.from("medicines").select("id, name").in("id", medIds)
        : Promise.resolve({ data: [] as any[] }),
      subIds.length
        ? supabaseAdmin
            .from("payments")
            .select("stripe_subscription_id, amount_cents, status, created_at")
            .in("stripe_subscription_id", subIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as any[] }),
      sessionIds.length
        ? supabaseAdmin.from("intake_sessions").select("id, full_name, email").in("id", sessionIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const pkgMap = new Map((pkgs ?? []).map((p: any) => [p.id, p]));
    const medMap = new Map((meds ?? []).map((m: any) => [m.id, m]));
    const sessMap = new Map((sessions ?? []).map((s: any) => [s.id, s]));
    const payMap = new Map<string, any>();
    for (const pay of payments ?? []) {
      // first payment per subscription = the initial charge (list amount)
      if (!payMap.has(pay.stripe_subscription_id)) payMap.set(pay.stripe_subscription_id, pay);
    }

    let result = rows.map((r: any) => {
      const p = pMap.get(r.user_id) as any;
      const sess = !p ? (sessMap.get(r.session_id) as any) : null;
      const pay = payMap.get(r.stripe_subscription_id);
      const medName = (medMap.get(r.medicine_id) as any)?.name;
      const pkgName = (pkgMap.get(r.package_id) as any)?.name;
      return {
        id: r.id,
        customer_name: p?.full_name ?? sess?.full_name ?? null,
        customer_email: p?.email ?? sess?.email ?? null,
        is_guest: !p && !!sess,
        item_name: [medName, pkgName].filter(Boolean).join(" — ") || "—",
        item_count: 1,
        amount: pay ? Number(pay.amount_cents) / 100 : null,
        status: displayStatus(r.status),
        created_at: r.created_at,
      };
    });

    if (data.search) {
      const s = data.search.toLowerCase();
      result = result.filter(
        (r: any) =>
          (r.customer_name ?? "").toLowerCase().includes(s) ||
          (r.customer_email ?? "").toLowerCase().includes(s) ||
          r.id.toLowerCase().includes(s),
      );
    }
    return result;
  });

export const getOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sub, error } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "id, user_id, session_id, stripe_subscription_id, stripe_customer_id, package_id, medicine_id, status, current_period_end, cancel_at_period_end, created_at",
      )
      .eq("id", data.orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub) throw new Error("Order not found");

    // Onboarding subscriptions are created as a guest — the account (and its profile) only exist
    // after the post-checkout OTP step, so user_id stays null until then. The customer's details
    // were captured on the intake_session at checkout, so fall back to it when there is no profile.
    const [{ data: profile }, { data: intake }, { data: payments }] = await Promise.all([
      sub.user_id
        ? supabaseAdmin
            .from("profiles")
            .select(
              "id, full_name, email, phone, street_address, city, state_code, postal_code, country",
            )
            .eq("id", sub.user_id)
            .maybeSingle()
        : Promise.resolve({ data: null as any }),
      sub.session_id
        ? supabaseAdmin
            .from("intake_sessions")
            .select("full_name, email, phone, state_code, selected_plan_id")
            .eq("id", sub.session_id)
            .maybeSingle()
        : Promise.resolve({ data: null as any }),
      supabaseAdmin
        .from("payments")
        .select("id, amount_cents, currency, status, created_at, stripe_invoice_id, raw_event")
        .eq("stripe_subscription_id", sub.stripe_subscription_id)
        .order("created_at", { ascending: false }),
    ]);

    // The subscription's own package/medicine ids can be null on bare rows; the intake session's
    // selected plan is the fallback for what the patient actually chose.
    const effectivePackageId = sub.package_id ?? (intake as any)?.selected_plan_id ?? null;

    const { data: pkg } = effectivePackageId
      ? await supabaseAdmin
          .from("packages")
          .select("name, price, duration_months, medicine_id, medicine_variants(name)")
          .eq("id", effectivePackageId)
          .maybeSingle()
      : { data: null as any };

    const effectiveMedicineId = sub.medicine_id ?? (pkg as any)?.medicine_id ?? null;
    const { data: med } = effectiveMedicineId
      ? await supabaseAdmin
          .from("medicines")
          .select("name")
          .eq("id", effectiveMedicineId)
          .maybeSingle()
      : { data: null as any };

    const customer = profile
      ? { ...profile, is_guest: false }
      : intake
        ? {
            full_name: (intake as any).full_name ?? null,
            email: (intake as any).email ?? null,
            phone: (intake as any).phone ?? null,
            state_code: (intake as any).state_code ?? null,
            street_address: null,
            city: null,
            postal_code: null,
            country: null,
            is_guest: true,
          }
        : null;

    const slimPayments = (payments ?? []).map((p: any) => ({
      id: p.id,
      amount_cents: p.amount_cents,
      currency: p.currency,
      status: p.status,
      created_at: p.created_at,
      stripe_invoice_id: p.stripe_invoice_id,
      raw_event: p.raw_event
        ? {
            hosted_invoice_url: p.raw_event.hosted_invoice_url ?? null,
            invoice_pdf: p.raw_event.invoice_pdf ?? null,
          }
        : null,
    }));

    return {
      subscription: sub,
      package: pkg ?? null,
      variant_name: (pkg as any)?.medicine_variants?.name ?? null,
      medicine: med ?? null,
      customer,
      payments: slimPayments,
      display_status: displayStatus(sub.status),
    };
  });

const CHANGEABLE_STATUSES = ["active", "trialing", "past_due"];

// Admin-only: change the medicine/variant/plan of a patient's live subscription. The new price
// applies from the NEXT billing cycle (proration_behavior: "none"); if the new plan's billing
// duration differs, the recurring shipping item is re-intervalled to match (Stripe requires all
// recurring prices on a subscription to share an interval).
export const changeSubscriptionMedicine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ orderId: z.string().uuid(), packageId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getStripe } = await import("@/integrations/stripe/client.server");
    const stripe = getStripe();

    const { data: sub, error: subErr } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "id, user_id, stripe_subscription_id, medicine_id, package_id, stripe_price_id, status",
      )
      .eq("id", data.orderId)
      .maybeSingle();
    if (subErr) throw new Error(subErr.message);
    if (!sub) throw new Error("Subscription not found.");
    if (!sub.stripe_subscription_id) throw new Error("This subscription has no Stripe record.");
    if (!CHANGEABLE_STATUSES.includes(sub.status)) {
      throw new Error(`Cannot change a ${sub.status} subscription.`);
    }

    const { data: pkg, error: pkgErr } = await supabaseAdmin
      .from("packages")
      .select(
        "id, medicine_id, variant_id, duration_months, price, stripe_price_id, is_active, medicines(name), medicine_variants(name)",
      )
      .eq("id", data.packageId)
      .maybeSingle();
    if (pkgErr) throw new Error(pkgErr.message);
    if (!pkg) throw new Error("Selected plan not found.");
    const { planIsSelectable } = await import("@/lib/medicines.functions");
    await planIsSelectable(supabaseAdmin, pkg);

    const { applyPackageChangeToSubscription } = await import("@/lib/subscription-reschedule");
    const { data: oldPkg } = sub.package_id
      ? await supabaseAdmin
          .from("packages")
          .select("price, duration_months, medicines(name), medicine_variants(name)")
          .eq("id", sub.package_id)
          .maybeSingle()
      : { data: null as any };
    const oldPrice = Number((oldPkg as any)?.price ?? 0);
    const { description, billingUpdated } = await applyPackageChangeToSubscription({
      stripe,
      supabaseAdmin,
      sub: { id: sub.id, stripe_subscription_id: sub.stripe_subscription_id },
      pkg: pkg as any,
    });
    if (!billingUpdated) {
      throw new Error(
        "This subscription is not in the current Stripe account, so the bill was not changed.",
      );
    }

    await supabaseAdmin.from("admin_activity_log").insert({
      admin_user_id: context.userId,
      action: "subscription.change_medicine",
      entity: "subscriptions",
      entity_id: sub.id,
      before: {
        medicine_id: sub.medicine_id,
        medicine_name: (oldPkg as any)?.medicines?.name ?? null,
        variant_name: (oldPkg as any)?.medicine_variants?.name ?? null,
        package_id: sub.package_id,
        duration_months: (oldPkg as any)?.duration_months ?? null,
        price: oldPrice,
      },
      after: {
        medicine_id: pkg.medicine_id,
        medicine_name: (pkg as any).medicines?.name ?? null,
        variant_name: (pkg as any).medicine_variants?.name ?? null,
        package_id: pkg.id,
        duration_months: (pkg as any).duration_months ?? null,
        price: Number((pkg as any).price ?? 0),
        delta_cents: Math.round((Number((pkg as any).price ?? 0) - oldPrice) * 100),
        cross_category: false,
        cross_category_reason: null,
        note: null,
        actor_role: "admin",
        user_id: (sub as any).user_id ?? null,
      },
    } as any);

    return { ok: true, description };
  });
