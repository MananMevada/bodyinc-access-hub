import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin, assertReviewer } from "@/lib/admin-guard";
import { toStoredMedicine, type StoredMedicine } from "@/lib/medicines.store";
import { archiveInStripe, BILLING_SUBSCRIPTION_STATUSES } from "@/lib/stripe-objects";

const syncInput = z.object({ medicineId: z.string().uuid() });

const CHANGE_MEDICINE_COLUMNS =
  "id, name, short_description, long_description, image_url, from_price_cents, status, important_info, notice_text, sort_order, is_active, requires_questionnaire, requires_consultation, requires_followup, show_to_providers, lf_product_id, created_at, updated_at, medication_category_medicines(category_id), packages(id, name, duration_months, original_price, price, is_most_popular, is_active, features, clinical_note, sort_order, stripe_price_id, variant_id), medicine_variants(id, name, is_active, lf_product_id, from_price_cents, sort_order)";

// The provider catalog hides doses on a medicine that is off the patient shop.
// Change-medicine still needs those doses when the medicine is marked for providers.
export const listMedicinesForChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ currentMedicineId: z.string().uuid().optional() })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<StoredMedicine[]> => {
    await assertReviewer(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("medicines")
      .select(CHANGE_MEDICINE_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return ((rows ?? []) as any[])
      .filter(
        (row) =>
          row.is_active ||
          row.show_to_providers ||
          row.id === data.currentMedicineId,
      )
      .map((row) => toStoredMedicine(row));
  });

export async function planIsSelectable(
  supabaseAdmin: any,
  pkg: { is_active?: boolean | null; medicine_id?: string | null; stripe_price_id?: string | null },
): Promise<void> {
  if (!pkg.stripe_price_id) {
    throw new Error(
      "This plan isn't synced to Stripe yet. Open the medicine and save it, then retry.",
    );
  }
  if (pkg.is_active) return;
  const { data: med } = pkg.medicine_id
    ? await supabaseAdmin
        .from("medicines")
        .select("is_active, show_to_providers")
        .eq("id", pkg.medicine_id)
        .maybeSingle()
    : { data: null };
  if (med && med.is_active === false && med.show_to_providers) return;
  throw new Error("Selected plan is inactive.");
}
const deleteInput = z.object({ medicineId: z.string().uuid() });

export type MedicineDeletionImpact = {
  billingSubscriptions: number;
  totalSubscriptions: number;
  shopOrderRefs: number;
  packages: number;
  blocked: boolean;
};

async function measureDeletionImpact(
  supabaseAdmin: any,
  medicineId: string,
): Promise<MedicineDeletionImpact> {
  const countOf = async (table: string, apply: (q: any) => any) => {
    const { count } = await apply(
      supabaseAdmin.from(table).select("id", { count: "exact", head: true }),
    );
    return count ?? 0;
  };

  const [billingSubscriptions, totalSubscriptions, orders, orderItems, packages] =
    await Promise.all([
      countOf("subscriptions", (q) =>
        q.eq("medicine_id", medicineId).in("status", BILLING_SUBSCRIPTION_STATUSES),
      ),
      countOf("subscriptions", (q) => q.eq("medicine_id", medicineId)),
      countOf("shop_checkout_orders", (q) => q.eq("medicine_id", medicineId)),
      countOf("shop_checkout_order_items", (q) => q.eq("medicine_id", medicineId)),
      countOf("packages", (q) => q.eq("medicine_id", medicineId)),
    ]);

  const shopOrderRefs = orders + orderItems;
  return {
    billingSubscriptions,
    totalSubscriptions,
    shopOrderRefs,
    packages,
    blocked: billingSubscriptions > 0 || shopOrderRefs > 0,
  };
}

// Read-only: lets the confirmation dialog state the consequences before the admin commits,
// rather than the delete failing (or silently orphaning a subscription) after they click.
export const getMedicineDeletionImpact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => deleteInput.parse(input))
  .handler(async ({ data, context }): Promise<MedicineDeletionImpact> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return measureDeletionImpact(supabaseAdmin, data.medicineId);
  });

// Deleting a medicine never cancels its Stripe subscriptions — Stripe keeps billing on its own
// schedule — and subscriptions.medicine_id is ON DELETE SET NULL, so the record survives with no
// idea what it was for. Refuse rather than create that orphan. Shop order FKs have no ON DELETE
// clause, so Postgres would reject those anyway; catching it here gives a usable message.
export const deleteMedicineSafely = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => deleteInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getStripe } = await import("@/integrations/stripe/client.server");

    // Re-measured server-side: the dialog's numbers are a display, never the authority.
    const impact = await measureDeletionImpact(supabaseAdmin, data.medicineId);

    if (impact.billingSubscriptions > 0) {
      throw new Error(
        `${impact.billingSubscriptions} patient${impact.billingSubscriptions === 1 ? " is" : "s are"} still being billed for this medicine. Deleting it will NOT stop those charges, and the subscription records would lose all record of what they are for. Cancel or migrate them in Stripe first, or set this medicine inactive instead.`,
      );
    }
    if (impact.shopOrderRefs > 0) {
      throw new Error(
        `This medicine appears on ${impact.shopOrderRefs} shop order${impact.shopOrderRefs === 1 ? "" : "s"} and cannot be deleted without destroying that order history. Set it inactive instead.`,
      );
    }

    const { backupThen, fetchMatching, newBackupId } = await import("@/lib/data-backup.server");
    const db = supabaseAdmin as any;
    const [medicineRows, packages, variants, links, questionnaireLinks] = await Promise.all([
      fetchMatching(db, "medicines", "id", [data.medicineId]),
      fetchMatching(db, "packages", "medicine_id", [data.medicineId]),
      fetchMatching(db, "medicine_variants", "medicine_id", [data.medicineId]),
      fetchMatching(db, "medication_category_medicines", "medicine_id", [data.medicineId]),
      fetchMatching(db, "questionnaire_medicines", "medicine_id", [data.medicineId]),
    ]);
    const medicine = medicineRows[0] as { name?: string; stripe_product_id?: string | null } | undefined;

    let archiveResult: { archived: number; failed: { id: string; error: string }[] } = {
      archived: 0,
      failed: [],
    };
    await backupThen(
      db,
      {
        wipeId: newBackupId(),
        group: "catalog",
        wipedBy: context.userId,
        label: medicine?.name?.trim() || "Medicine",
        batches: [
          { table: "medicines", rows: medicineRows },
          { table: "medicine_variants", rows: variants },
          { table: "packages", rows: packages },
          { table: "medication_category_medicines", rows: links },
          { table: "questionnaire_medicines", rows: questionnaireLinks },
        ],
      },
      async () => {
        archiveResult = await archiveInStripe(
          getStripe(),
          packages.map((p: { stripe_price_id?: string | null }) => p.stripe_price_id).filter(Boolean) as string[],
          [
            ...variants.map((v: { stripe_product_id?: string | null }) => v.stripe_product_id),
            medicine?.stripe_product_id,
          ].filter(Boolean) as string[],
        );
        const { error } = await supabaseAdmin.from("medicines").delete().eq("id", data.medicineId);
        if (error) throw new Error(error.message);
      },
    );

    return {
      ok: true as const,
      archived: archiveResult.archived,
      archiveFailed: archiveResult.failed,
    };
  });

// Creates or updates the Stripe Product that a medicine maps to, storing its id.
export const syncMedicineToStripe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => syncInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getStripe } = await import("@/integrations/stripe/client.server");
    const stripe = getStripe();

    const { data: medicine, error } = await supabaseAdmin
      .from("medicines")
      .select("id, name, short_description, stripe_product_id")
      .eq("id", data.medicineId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!medicine) throw new Error("Medicine not found.");

    if (medicine.stripe_product_id) {
      try {
        const existing = await stripe.products.retrieve(medicine.stripe_product_id);
        if (!existing.deleted) {
          await stripe.products.update(medicine.stripe_product_id, {
            name: medicine.name,
            description: medicine.short_description || undefined,
          });
          return { ok: true, stripe_product_id: medicine.stripe_product_id };
        }
      } catch {
        // Product IDs from a previous Stripe account 404; create a new one below.
      }
    }

    const product = await stripe.products.create({
      name: medicine.name,
      description: medicine.short_description || undefined,
      metadata: { medicine_id: medicine.id },
    });
    await supabaseAdmin
      .from("medicines")
      .update({ stripe_product_id: product.id })
      .eq("id", medicine.id);

    return { ok: true, stripe_product_id: product.id };
  });
