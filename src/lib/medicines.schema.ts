import { z } from "zod";

import { sentenceCase, titleCaseName } from "@/lib/text-normalize";

export const MEDICINE_STATUSES = ["active", "inactive", "draft"] as const;
export type MedicineStatus = (typeof MEDICINE_STATUSES)[number];

export const MEDICINE_STATUS_LABELS: Record<MedicineStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  draft: "Draft",
};

export const MAX_PACKAGES_PER_MEDICINE = 2;

const MAX_PACKAGE_PRICE = 100_000;
const MAX_PACKAGE_DURATION_MONTHS = 24;

export const medicinePackageSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z
      .string()
      .trim()
      .max(120)
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? titleCaseName(v) : undefined)),
    duration_months: z.coerce
      .number()
      .int()
      .min(1, "Duration must be at least 1 month")
      .max(
        MAX_PACKAGE_DURATION_MONTHS,
        `Duration must be ${MAX_PACKAGE_DURATION_MONTHS} months or fewer`,
      ),
    original_price: z.coerce
      .number()
      .min(0, "Original price must be 0 or greater")
      .max(MAX_PACKAGE_PRICE, "Original price is too large"),
    price: z.coerce
      .number()
      .min(0, "Sale price must be 0 or greater")
      .max(MAX_PACKAGE_PRICE, "Sale price is too large"),
    is_most_popular: z.boolean().default(false),
    is_active: z.boolean().default(true),
    features: z
      .array(
        z.object({
          text: z
            .string()
            .trim()
            .min(1, "Feature cannot be empty")
            .max(300)
            .transform((v) => sentenceCase(v)),
        }),
      )
      .default([]),
    clinical_note: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? sentenceCase(v) : undefined)),
  })
  .refine((p) => p.price <= p.original_price, {
    message: "Sale price cannot exceed the original price",
    path: ["price"],
  });

export type MedicinePackageValues = z.input<typeof medicinePackageSchema>;

const lfProductIdField = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .refine((v) => !v || /^\d{1,18}$/.test(v), {
    message: "Enter a valid Life File product ID",
  });

export const medicineVariantSchema = z.object({
  id: z.string().uuid().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Variant name is required")
    .max(120)
    .transform((v) => titleCaseName(v)),
  is_active: z.boolean().default(true),
  lf_product_id: lfProductIdField,
  life_file_pharmacy_id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : undefined)),
  packages: z
    .array(medicinePackageSchema)
    .max(
      MAX_PACKAGES_PER_MEDICINE,
      `A variant can have at most ${MAX_PACKAGES_PER_MEDICINE} packages`,
    )
    .default([]),
});

export type MedicineVariantValues = z.input<typeof medicineVariantSchema>;

export const medicineFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Medicine name is required")
    .max(120)
    .transform((v) => titleCaseName(v)),
  short_description: z
    .string()
    .trim()
    .min(1, "Short description is required")
    .max(500)
    .transform((v) => sentenceCase(v)),
  long_description: z
    .string()
    .trim()
    .max(3000)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? sentenceCase(v) : undefined)),
  image_url: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || /^https?:\/\/.+/i.test(v), {
      message: "Upload an image or provide a valid URL",
    })
    .transform((v) => (v ? v : undefined)),
  packages: z
    .array(medicinePackageSchema)
    .max(
      MAX_PACKAGES_PER_MEDICINE,
      `A medicine can have at most ${MAX_PACKAGES_PER_MEDICINE} packages`,
    )
    .default([]),
  variants: z.array(medicineVariantSchema).default([]),
  status: z.enum(MEDICINE_STATUSES).default("draft"),
  important_info: z
    .array(
      z.object({
        text: z
          .string()
          .trim()
          .min(1, "Bullet cannot be empty")
          .max(500)
          .transform((v) => sentenceCase(v)),
      }),
    )
    .default([]),
  notice_text: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? sentenceCase(v) : undefined)),
  lf_product_id: lfProductIdField,
  life_file_pharmacy_id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : undefined)),
  sort_order: z.coerce.number().int().min(0).default(0),
  requires_questionnaire: z.boolean().default(false),
  requires_consultation: z.boolean().default(false),
  requires_followup: z.boolean().default(false),
  show_to_providers: z.boolean().default(false),
  category_ids: z.array(z.string().uuid()).default([]),
});

export type MedicineFormValues = z.input<typeof medicineFormSchema>;

type PricedPackage = { price: number; duration_months: number; is_active?: boolean };

// Lowest effective per-month rate (in cents) across a medicine's active packages.
export function computeFromPriceCents(packages: PricedPackage[]): number | null {
  const rates = packages
    .filter((p) => p.is_active !== false && Number(p.duration_months) > 0)
    .map((p) => Math.round((Number(p.price) / Number(p.duration_months)) * 100))
    .filter((c) => Number.isFinite(c));
  return rates.length > 0 ? Math.min(...rates) : null;
}

export function formatFromPrice(fromPriceCents: number | null | undefined): string {
  if (fromPriceCents == null) return "Pricing coming soon";
  const dollars = fromPriceCents / 100;
  const label = Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
  return `From ${label}/mo`;
}

// Cheapest per-month rate across a medicine's pricing — its own packages plus the packages of
// any active variant. Mirrors the DB from_price_cents rollup for the live admin preview.
export function computeMedicineFromPriceCents(values: {
  packages?: MedicinePackageValues[];
  variants?: { is_active?: boolean; packages?: MedicinePackageValues[] }[];
}): number | null {
  const all: PricedPackage[] = [
    ...(values.packages ?? []),
    ...(values.variants ?? [])
      .filter((v) => v.is_active !== false)
      .flatMap((v) => v.packages ?? []),
  ].map((p) => ({
    price: Number(p.price),
    duration_months: Number(p.duration_months),
    is_active: p.is_active,
  }));
  return computeFromPriceCents(all);
}
