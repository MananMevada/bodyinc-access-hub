import { supabase } from "@/integrations/supabase/client";
import type { MedicineFormValues, MedicineStatus } from "./medicines.schema";

export type StoredMedicinePackage = {
  id: string;
  name: string;
  duration_months: number;
  original_price: number;
  price: number;
  is_most_popular: boolean;
  is_active: boolean;
  features: string[];
  clinical_note?: string | null;
  sort_order: number;
  // Null means no Stripe price exists, so patients cannot buy this plan.
  stripe_price_id: string | null;
};

export type StoredMedicineVariant = {
  id: string;
  name: string;
  is_active: boolean;
  lf_product_id: number | null;
  life_file_pharmacy_id: string | null;
  from_price_cents: number | null;
  sort_order: number;
  packages: StoredMedicinePackage[];
};

export type StoredMedicine = {
  id: string;
  name: string;
  short_description: string;
  long_description?: string | null;
  image_url?: string | null;
  from_price_cents: number | null;
  status: MedicineStatus;
  important_info: string[];
  notice_text?: string | null;
  sort_order: number;
  is_active: boolean;
  requires_questionnaire: boolean;
  requires_consultation: boolean;
  requires_followup: boolean;
  show_to_providers: boolean;
  lf_product_id: number | null;
  life_file_pharmacy_id: string | null;
  category_ids: string[];
  packages: StoredMedicinePackage[];
  variants: StoredMedicineVariant[];
  created_at: string;
  updated_at: string;
};

export type ListMedicinesInput = {
  search?: string;
  status?: "all" | MedicineStatus;
};

export function formatMedicineLifeFileSummary(m: StoredMedicine): string {
  if (m.variants.length > 0) {
    const ids = m.variants
      .map((v) => v.lf_product_id)
      .filter((id): id is number => id != null && id > 0);
    if (ids.length === 0) return "—";
    if (ids.length === m.variants.length) {
      return ids.length === 1 ? String(ids[0]) : `${ids.length} variants set`;
    }
    return `${ids.length}/${m.variants.length} set`;
  }
  return m.lf_product_id != null ? String(m.lf_product_id) : "—";
}

function packageRowToStored(row: any): StoredMedicinePackage {
  const feat = Array.isArray(row.features) ? row.features : [];
  return {
    id: row.id,
    name: row.name,
    duration_months: Number(row.duration_months),
    original_price: Number(row.original_price),
    price: Number(row.price),
    is_most_popular: !!row.is_most_popular,
    is_active: row.is_active !== false,
    features: feat
      .map((v: unknown) =>
        typeof v === "string"
          ? v
          : typeof v === "object" && v && "text" in v
            ? String((v as any).text ?? "")
            : "",
      )
      .filter(Boolean),
    clinical_note: row.clinical_note,
    sort_order: Number(row.sort_order ?? 0),
    stripe_price_id: row.stripe_price_id ?? null,
  };
}

function sortPackages(rows: any[]): StoredMedicinePackage[] {
  return rows
    .map(packageRowToStored)
    .sort((a, b) => a.duration_months - b.duration_months || a.sort_order - b.sort_order);
}

function parseLfProductId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function lfProductIdFromForm(values: MedicineFormValues): number | null {
  return parseLfProductId(values.lf_product_id);
}

function lfProductIdWriteError(
  error: { code?: string; message: string },
  scope: "medicine" | "variant",
): Error {
  if (error.code === "23505" && /lf_product_id/i.test(error.message)) {
    return new Error(
      scope === "variant"
        ? "That Life File product ID is already used on another variant."
        : "That Life File product ID is already used on another medicine.",
    );
  }
  return new Error(error.message);
}

export function toStoredMedicine(row: any, pharmacyByKey?: Map<string, string>): StoredMedicine {
  return rowToStored(row, pharmacyByKey);
}

function rowToStored(row: any, pharmacyByKey?: Map<string, string>): StoredMedicine {
  const info = Array.isArray(row.important_info) ? row.important_info : [];
  const cats = Array.isArray(row.medication_category_medicines)
    ? row.medication_category_medicines.map((r: any) => String(r.category_id))
    : [];
  const allPackages = Array.isArray(row.packages) ? row.packages : [];
  // Medicine-level packages are those not tied to a variant.
  const pkgs = sortPackages(allPackages.filter((p: any) => !p.variant_id));
  const variants: StoredMedicineVariant[] = (
    Array.isArray(row.medicine_variants) ? row.medicine_variants : []
  )
    .map((v: any) => ({
      id: v.id,
      name: v.name,
      is_active: v.is_active !== false,
      lf_product_id: parseLfProductId(v.lf_product_id),
      life_file_pharmacy_id: pharmacyByKey?.get(`v:${v.id}`) ?? null,
      from_price_cents: v.from_price_cents == null ? null : Number(v.from_price_cents),
      sort_order: Number(v.sort_order ?? 0),
      packages: sortPackages(allPackages.filter((p: any) => p.variant_id === v.id)),
    }))
    .sort((a: StoredMedicineVariant, b: StoredMedicineVariant) => a.sort_order - b.sort_order);
  return {
    id: row.id,
    name: row.name,
    short_description: row.short_description,
    long_description: row.long_description,
    image_url: row.image_url,
    from_price_cents: row.from_price_cents == null ? null : Number(row.from_price_cents),
    status: row.status,
    important_info: info
      .map((v: unknown) =>
        typeof v === "string"
          ? v
          : typeof v === "object" && v && "text" in v
            ? String((v as any).text ?? "")
            : "",
      )
      .filter(Boolean),
    notice_text: row.notice_text,
    sort_order: row.sort_order,
    is_active: row.is_active,
    requires_questionnaire: !!row.requires_questionnaire,
    requires_consultation: !!row.requires_consultation,
    requires_followup: !!row.requires_followup,
    show_to_providers: !!row.show_to_providers,
    lf_product_id: parseLfProductId(row.lf_product_id),
    life_file_pharmacy_id: pharmacyByKey?.get(`m:${row.id}`) ?? null,
    category_ids: cats,
    packages: pkgs,
    variants,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function loadPharmacyMap(medicineIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (medicineIds.length === 0) return map;
  const { data, error } = await supabase
    .from("medicine_life_file_products")
    .select("medicine_id, variant_id, pharmacy_id")
    .in("medicine_id", medicineIds)
    .eq("is_active", true);
  if (error) {
    // Table may not exist until migration is applied.
    if (/medicine_life_file_products|does not exist|schema cache/i.test(error.message)) {
      return map;
    }
    throw new Error(error.message);
  }
  for (const row of data ?? []) {
    const key = row.variant_id ? `v:${row.variant_id}` : `m:${row.medicine_id}`;
    // Prefer first active mapping (SKU should have one pharmacy for routing).
    if (!map.has(key)) map.set(key, String(row.pharmacy_id));
  }
  return map;
}

export async function syncMedicineLifeFileProducts(
  medicineId: string,
  values: MedicineFormValues,
  variantIdsByIndex: string[],
): Promise<void> {
  const variants = values.variants ?? [];
  const rows: {
    medicine_id: string;
    variant_id: string | null;
    pharmacy_id: string;
    lf_product_id: number;
    is_active: boolean;
  }[] = [];

  if (variants.length === 0) {
    const pharmacyId = values.life_file_pharmacy_id;
    const productId = parseLfProductId(values.lf_product_id);
    if (pharmacyId && productId) {
      rows.push({
        medicine_id: medicineId,
        variant_id: null,
        pharmacy_id: pharmacyId,
        lf_product_id: productId,
        is_active: true,
      });
    }
  } else {
    variants.forEach((v, i) => {
      const pharmacyId = v.life_file_pharmacy_id;
      const productId = parseLfProductId(v.lf_product_id);
      const variantId = variantIdsByIndex[i];
      if (pharmacyId && productId && variantId) {
        rows.push({
          medicine_id: medicineId,
          variant_id: variantId,
          pharmacy_id: pharmacyId,
          lf_product_id: productId,
          is_active: v.is_active !== false,
        });
      }
    });
  }

  const { error: delError } = await supabase
    .from("medicine_life_file_products")
    .delete()
    .eq("medicine_id", medicineId);
  if (delError) {
    if (/medicine_life_file_products|does not exist|schema cache/i.test(delError.message)) {
      return;
    }
    throw new Error(delError.message);
  }

  if (rows.length === 0) return;

  const { error } = await supabase.from("medicine_life_file_products").insert(rows as any);
  if (error) {
    if (error.code === "23505" && /lf_product_id|pharmacy/i.test(error.message)) {
      throw new Error(
        "That Life File product ID is already used for this pharmacy on another medicine.",
      );
    }
    throw new Error(error.message);
  }
}

function fromForm(values: MedicineFormValues) {
  const hasVariants = (values.variants ?? []).length > 0;
  return {
    name: values.name,
    short_description: values.short_description,
    long_description: values.long_description ?? null,
    image_url: values.image_url ?? null,
    status: values.status ?? "draft",
    important_info: (values.important_info ?? []).map((b) => b.text.trim()).filter(Boolean),
    notice_text: values.notice_text ?? null,
    sort_order: values.sort_order ?? 0,
    requires_questionnaire: !!values.requires_questionnaire,
    requires_consultation: !!values.requires_consultation,
    requires_followup: !!values.requires_followup,
    show_to_providers: !!values.show_to_providers,
    lf_product_id: hasVariants ? null : lfProductIdFromForm(values),
  };
}

function defaultPackageName(durationMonths: number) {
  return durationMonths === 1 ? "Monthly Plan" : `${durationMonths}-Month Plan`;
}

function packageFromForm(
  medicineId: string,
  variantId: string | null,
  pkg: NonNullable<MedicineFormValues["packages"]>[number],
  index: number,
) {
  const duration = Number(pkg.duration_months) || 1;
  return {
    medicine_id: medicineId,
    variant_id: variantId,
    name: (pkg.name && pkg.name.trim()) || defaultPackageName(duration),
    duration_months: duration,
    original_price: Number(pkg.original_price) || 0,
    price: Number(pkg.price) || 0,
    is_most_popular: !!pkg.is_most_popular,
    is_active: pkg.is_active ?? true,
    features: (pkg.features ?? []).map((f) => f.text.trim()).filter(Boolean),
    clinical_note: pkg.clinical_note ?? null,
    sort_order: index,
  };
}

// Reconciles a medicine's variants and packages to match the submitted form. Works by id so a
// package keeps its row (and its order/subscription history + Stripe price) even when it moves
// between the medicine-level bucket and a variant — it is UPDATEd (reparented), never
// deleted-and-recreated. Only genuinely removed rows are deleted. Returns package ids to sync.
// The name rides along so a failed Stripe sync can name the plan the admin needs to retry.
export type PackageSyncTarget = { id: string; name: string };

export type PricingReconcileResult = {
  syncTargets: PackageSyncTarget[];
  // Stripe objects left behind by rows this save deleted; the caller archives them.
  orphanedPriceIds: string[];
  orphanedProductIds: string[];
  needsProductSync: boolean;
};

export async function reconcileMedicinePricing(
  medicineId: string,
  values: MedicineFormValues,
): Promise<PricingReconcileResult> {
  const variants = values.variants ?? [];

  // 1. Reconcile variant rows; map each form variant to its persisted id. Deleting a variant
  //    cascade-deletes its packages (intended — the variant's plans go with it).
  const { data: existingVariantRows, error: vErr } = await supabase
    .from("medicine_variants")
    .select("id, name, stripe_product_id")
    .eq("medicine_id", medicineId);
  if (vErr) throw new Error(vErr.message);
  const existingVariantIds = new Set((existingVariantRows ?? []).map((r: any) => String(r.id)));
  const existingVariantNameById = new Map(
    (existingVariantRows ?? []).map((r: any) => [String(r.id), String(r.name ?? "")]),
  );
  const renamedVariantIds = new Set(
    variants
      .filter(
        (v) =>
          v.id &&
          existingVariantNameById.has(v.id) &&
          existingVariantNameById.get(v.id) !== v.name.trim(),
      )
      .map((v) => v.id as string),
  );
  const keptVariantIds = new Set(variants.map((v) => v.id).filter((id): id is string => !!id));
  const variantsToDelete = [...existingVariantIds].filter((id) => !keptVariantIds.has(id));

  // Stripe ids of everything about to be removed. Collected before the deletes because packages
  // cascade off variants — afterwards there is no row left to find the Stripe object by.
  const orphanedPriceIds: string[] = [];
  const orphanedProductIds: string[] = [];

  if (variantsToDelete.length > 0) {
    const { data: doomedVariantPkgs } = await supabase
      .from("packages")
      .select("stripe_price_id")
      .in("variant_id", variantsToDelete);
    orphanedPriceIds.push(
      ...(doomedVariantPkgs ?? []).map((p: any) => p.stripe_price_id).filter(Boolean),
    );
    orphanedProductIds.push(
      ...(existingVariantRows ?? [])
        .filter((v: any) => variantsToDelete.includes(String(v.id)))
        .map((v: any) => v.stripe_product_id)
        .filter(Boolean),
    );

    const { error } = await supabase.from("medicine_variants").delete().in("id", variantsToDelete);
    if (error) throw new Error(error.message);
  }

  const variantIdByIndex: string[] = new Array(variants.length);
  await Promise.all(
    variants.map(async (v, i) => {
      const payload = {
        medicine_id: medicineId,
        name: v.name.trim(),
        is_active: v.is_active ?? true,
        sort_order: i,
        lf_product_id: parseLfProductId(v.lf_product_id),
      };
      if (v.id && existingVariantIds.has(v.id)) {
        const { error } = await supabase
          .from("medicine_variants")
          .update(payload as any)
          .eq("id", v.id);
        if (error) throw lfProductIdWriteError(error, "variant");
        variantIdByIndex[i] = v.id;
      } else {
        const { data, error } = await supabase
          .from("medicine_variants")
          .insert(payload as any)
          .select("id")
          .single();
        if (error) throw lfProductIdWriteError(error, "variant");
        variantIdByIndex[i] = data.id;
      }
    }),
  );

  // 2. Flatten the desired packages with their target variant (null = medicine-level).
  const desired: {
    pkg: NonNullable<MedicineFormValues["packages"]>[number];
    variantId: string | null;
    sort: number;
  }[] = [];
  if (variants.length > 0) {
    variants.forEach((v, i) =>
      (v.packages ?? []).forEach((pkg, j) =>
        desired.push({ pkg, variantId: variantIdByIndex[i], sort: j }),
      ),
    );
  } else {
    (values.packages ?? []).forEach((pkg, j) => desired.push({ pkg, variantId: null, sort: j }));
  }

  // 3. Id-based package reconcile across the whole medicine.
  const { data: existingPkgRows, error: pErr } = await supabase
    .from("packages")
    .select("id, stripe_price_id, price, duration_months, variant_id")
    .eq("medicine_id", medicineId);
  if (pErr) throw new Error(pErr.message);
  const existingPkgIds = new Set((existingPkgRows ?? []).map((r: any) => String(r.id)));
  const existingPkgById = new Map((existingPkgRows ?? []).map((r: any) => [String(r.id), r]));
  const keptPkgIds = new Set(desired.map((d) => d.pkg.id).filter((id): id is string => !!id));
  const pkgsToDelete = [...existingPkgIds].filter((id) => !keptPkgIds.has(id));
  if (pkgsToDelete.length > 0) {
    orphanedPriceIds.push(
      ...(existingPkgRows ?? [])
        .filter((p: any) => pkgsToDelete.includes(String(p.id)))
        .map((p: any) => p.stripe_price_id)
        .filter(Boolean),
    );

    const { error } = await supabase.from("packages").delete().in("id", pkgsToDelete);
    if (error) throw new Error(error.message);
  }

  const written = await Promise.all(
    desired.map(async (d) => {
      const payload = packageFromForm(medicineId, d.variantId, d.pkg, d.sort);
      const label = d.pkg.name ?? "Unnamed plan";
      if (d.pkg.id && existingPkgIds.has(d.pkg.id)) {
        const { error } = await supabase
          .from("packages")
          .update(payload as any)
          .eq("id", d.pkg.id);
        if (error) throw new Error(error.message);
        return { id: d.pkg.id, name: label, payload, existing: existingPkgById.get(d.pkg.id) };
      }
      const { data, error } = await supabase
        .from("packages")
        .insert(payload as any)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: data.id, name: label, payload, existing: null as any };
    }),
  );

  const syncTargets: PackageSyncTarget[] = [];
  for (const row of written) {
    if (!row.existing || !row.existing.stripe_price_id) {
      syncTargets.push({ id: row.id, name: row.name });
      continue;
    }
    const priceChanged = Number(row.existing.price) !== Number(row.payload.price);
    const durationChanged =
      Number(row.existing.duration_months) !== Number(row.payload.duration_months);
    const variantChanged =
      String(row.existing.variant_id ?? "") !== String(row.payload.variant_id ?? "");
    const variantRenamed = !!(
      row.payload.variant_id && renamedVariantIds.has(String(row.payload.variant_id))
    );
    if (priceChanged || durationChanged || variantChanged || variantRenamed) {
      syncTargets.push({ id: row.id, name: row.name });
    }
  }
  return { syncTargets, orphanedPriceIds, orphanedProductIds, needsProductSync: false };
}

async function syncMedicineCategories(medicineId: string, categoryIds: string[]) {
  await supabase.from("medication_category_medicines").delete().eq("medicine_id", medicineId);
  if (categoryIds.length > 0) {
    const rows = categoryIds.map((cid, i) => ({
      medicine_id: medicineId,
      category_id: cid,
      sort_order: i,
    }));
    const { error } = await supabase.from("medication_category_medicines").insert(rows as any);
    if (error) throw new Error(error.message);
  }
}

export async function listMedicines(input: ListMedicinesInput = {}): Promise<StoredMedicine[]> {
  let query = supabase
    .from("medicines")
    .select(
      "id, name, short_description, long_description, image_url, from_price_cents, status, important_info, notice_text, sort_order, is_active, requires_questionnaire, requires_consultation, requires_followup, show_to_providers, lf_product_id, created_at, updated_at, medication_category_medicines(category_id), packages(id, name, duration_months, original_price, price, is_most_popular, is_active, features, clinical_note, sort_order, stripe_price_id, variant_id), medicine_variants(id, name, is_active, lf_product_id, from_price_cents, sort_order)",
    )
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (input.status && input.status !== "all") {
    query = query.eq("status", input.status);
  }
  if (input.search) {
    const s = `%${input.search}%`;
    query = query.or(`name.ilike.${s},short_description.ilike.${s},long_description.ilike.${s}`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const pharmacyMap = await loadPharmacyMap((data ?? []).map((r: any) => String(r.id)));
  return (data ?? []).map((row) => rowToStored(row, pharmacyMap));
}

export async function listActiveMedicines(): Promise<StoredMedicine[]> {
  const rows = await listMedicines();
  return rows.filter((m) => m.is_active);
}

export async function getMedicine(id: string): Promise<StoredMedicine | null> {
  const { data, error } = await supabase
    .from("medicines")
    .select(
      "id, name, short_description, long_description, image_url, from_price_cents, status, important_info, notice_text, sort_order, is_active, requires_questionnaire, requires_consultation, requires_followup, show_to_providers, lf_product_id, stripe_product_id, created_at, updated_at, medication_category_medicines(category_id), packages(id, name, duration_months, original_price, price, is_most_popular, is_active, features, clinical_note, sort_order, stripe_price_id, variant_id), medicine_variants(id, name, is_active, lf_product_id, from_price_cents, sort_order, stripe_product_id)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const pharmacyMap = await loadPharmacyMap([id]);
  return rowToStored(data, pharmacyMap);
}

export async function createMedicine(
  values: MedicineFormValues,
): Promise<{ id: string } & PricingReconcileResult> {
  const payload = fromForm(values);
  const { data, error } = await supabase
    .from("medicines")
    .insert(payload as any)
    .select("id")
    .single();
  if (error) throw lfProductIdWriteError(error, "medicine");
  await syncMedicineCategories(data.id, values.category_ids ?? []);
  const pricing = await reconcileMedicinePricing(data.id, values);
  const { data: variantRows } = await supabase
    .from("medicine_variants")
    .select("id")
    .eq("medicine_id", data.id)
    .order("sort_order", { ascending: true });
  await syncMedicineLifeFileProducts(
    data.id,
    values,
    (variantRows ?? []).map((r: any) => String(r.id)),
  );
  return { id: data.id, ...pricing, needsProductSync: true };
}

export async function updateMedicine(
  id: string,
  values: MedicineFormValues,
): Promise<{ id: string } & PricingReconcileResult> {
  const payload = fromForm(values);
  const { data: current, error: readErr } = await supabase
    .from("medicines")
    .select("name, short_description")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  const { error } = await supabase
    .from("medicines")
    .update(payload as any)
    .eq("id", id);
  if (error) throw lfProductIdWriteError(error, "medicine");
  await supabase
    .from("medication_requests")
    .update({ requires_consultation: !!values.requires_consultation })
    .eq("medicine_id", id)
    .in("status", [
      "payment_completed",
      "provider_assigned",
      "pending_review",
      "awaiting_additional_payment",
      "approved",
      "prescribed",
    ]);
  await syncMedicineCategories(id, values.category_ids ?? []);
  const pricing = await reconcileMedicinePricing(id, values);
  const { data: variantRows } = await supabase
    .from("medicine_variants")
    .select("id")
    .eq("medicine_id", id)
    .order("sort_order", { ascending: true });
  await syncMedicineLifeFileProducts(
    id,
    values,
    (variantRows ?? []).map((r: any) => String(r.id)),
  );
  const needsProductSync =
    !current ||
    current.name !== payload.name ||
    (current.short_description ?? "") !== (payload.short_description ?? "");
  return { id, ...pricing, needsProductSync };
}

export async function setMedicineActive(id: string, status: MedicineStatus): Promise<{ ok: true }> {
  const { error } = await supabase.from("medicines").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}
