import { toastError } from "@/lib/toast-message";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useState, lazy, Suspense } from "react";
import { toast } from "sonner";
import { FormSkeleton } from "@/components/admin/form-skeleton";
import { MedicineFormPageHeader } from "@/components/admin/medicine-form";
import { medicineQueryOptions, medicinesQueryKey } from "@/lib/query-options/medicines";
import {
  updateMedicine,
  type StoredMedicine,
  type StoredMedicinePackage,
} from "@/lib/medicines.store";
import { syncMedicineToStripe } from "@/lib/medicines.functions";
import {
  archiveStripeObjects,
  syncPackagesToStripe,
  syncUnpricedPackages,
} from "@/lib/packages.functions";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { computeMedicineFromPriceCents, type MedicineFormValues } from "@/lib/medicines.schema";

const MedicineForm = lazy(() =>
  import("@/components/admin/medicine-form").then((m) => ({ default: m.MedicineForm })),
);
const MedicinePreview = lazy(() =>
  import("@/components/admin/medicine-preview").then((m) => ({ default: m.MedicinePreview })),
);

export const Route = createFileRoute("/_authenticated/admin/medicines/$medicineId")({
  head: () => ({
    meta: [
      { title: "Edit medicine · Body Inc Admin" },
      { name: "description", content: "Edit medicine — Admin area of the Body Inc portal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EditMedicinePage,
});

function normalizeBullets(info: unknown): MedicineFormValues["important_info"] {
  if (!Array.isArray(info)) return [];
  return info.map((item) => {
    if (typeof item === "string") return { text: item };
    if (item && typeof item === "object" && "text" in item) {
      return { text: String((item as { text: unknown }).text ?? "") };
    }
    return { text: "" };
  });
}

function packageToForm(p: StoredMedicinePackage) {
  return {
    id: p.id,
    name: p.name,
    duration_months: p.duration_months,
    original_price: p.original_price,
    price: p.price,
    is_most_popular: p.is_most_popular,
    is_active: p.is_active,
    features: p.features.map((text) => ({ text })),
    clinical_note: p.clinical_note ?? "",
  };
}

function toFormValues(m: StoredMedicine): MedicineFormValues {
  return {
    name: m.name,
    short_description: m.short_description,
    long_description: m.long_description ?? "",
    image_url: m.image_url ?? "",
    packages: m.packages.map(packageToForm),
    variants: m.variants.map((v) => ({
      id: v.id,
      name: v.name,
      is_active: v.is_active,
      lf_product_id: v.lf_product_id != null ? String(v.lf_product_id) : "",
      life_file_pharmacy_id: v.life_file_pharmacy_id ?? undefined,
      packages: v.packages.map(packageToForm),
    })),
    status: m.status,
    important_info: normalizeBullets(m.important_info),
    notice_text: m.notice_text ?? "",
    sort_order: m.sort_order,
    requires_questionnaire: m.requires_questionnaire,
    requires_consultation: m.requires_consultation,
    requires_followup: m.requires_followup,
    show_to_providers: m.show_to_providers,
    lf_product_id: m.lf_product_id != null ? String(m.lf_product_id) : "",
    life_file_pharmacy_id: m.life_file_pharmacy_id ?? undefined,
    category_ids: m.category_ids,
  };
}

export default function EditMedicinePage() {
  const { medicineId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const medicineQuery = useQuery(medicineQueryOptions(medicineId));
  const syncMedicine = useServerFn(syncMedicineToStripe);
  const syncPackages = useServerFn(syncPackagesToStripe);
  const syncPrices = useServerFn(syncUnpricedPackages);
  const archiveStripe = useServerFn(archiveStripeObjects);

  const syncMut = useMutation({
    mutationFn: () => syncPrices({ data: { medicineId } }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: medicinesQueryKey });
      qc.invalidateQueries({ queryKey: ["medicine", medicineId] });
      if (result.failed.length === 0) {
        toast.success(
          `${result.synced} plan${result.synced === 1 ? "" : "s"} synced to Stripe and can now be purchased`,
        );
      } else {
        toast.warning(
          `${result.synced} of ${result.total} synced. Failed: ${result.failed
            .map((f) => `${f.name} (${f.error})`)
            .join("; ")}`,
          { duration: 15000 },
        );
      }
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const [previewValues, setPreviewValues] = useState<MedicineFormValues | null>(null);
  const handlePreviewChange = useCallback((values: MedicineFormValues) => {
    setPreviewValues(values);
  }, []);

  const mutation = useMutation({
    mutationFn: async (values: MedicineFormValues) => {
      const { syncTargets, orphanedPriceIds, orphanedProductIds, needsProductSync } =
        await updateMedicine(medicineId, values);
      if (needsProductSync) {
        try {
          await syncMedicine({ data: { medicineId } });
        } catch {
          // Product sync is best-effort; package sync will also ensure the product exists.
        }
      }
      // Plans/variants removed by this save leave live Stripe objects behind — deactivate them so
      // they cannot back a new subscription. Existing subscribers are unaffected.
      if (orphanedPriceIds.length > 0 || orphanedProductIds.length > 0) {
        try {
          await archiveStripe({
            data: { priceIds: orphanedPriceIds, productIds: orphanedProductIds },
          });
        } catch {
          // Non-fatal: the rows are already gone and the stale Stripe objects are unreachable
          // from the catalogue, so a failure here cannot sell anything by accident.
        }
      }
      if (syncTargets.length === 0) return { failedSyncs: [] as string[] };
      const { failed } = await syncPackages({ data: { packages: syncTargets } });
      return { failedSyncs: failed };
    },
    onSuccess: ({ failedSyncs }) => {
      qc.invalidateQueries({ queryKey: medicinesQueryKey });
      qc.invalidateQueries({ queryKey: ["medicine", medicineId] });
      if (failedSyncs.length > 0) {
        toast.warning(
          `Saved, but ${failedSyncs.length} plan${failedSyncs.length > 1 ? "s" : ""} could not sync to Stripe and cannot be purchased yet: ${failedSyncs.join(", ")}. Re-save to retry.`,
          { duration: 12000 },
        );
      } else {
        toast.success("Medicine updated.");
      }
      navigate({ to: "/admin/medicines" });
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  if (medicineQuery.isLoading && !medicineQuery.data) {
    return <p className="text-sm text-muted-foreground p-6">Loading…</p>;
  }

  const medicine = medicineQuery.data;
  if (!medicine) {
    return (
      <p className="text-sm text-destructive p-6">
        Medicine not found.{" "}
        <button
          type="button"
          className="underline"
          onClick={() => navigate({ to: "/admin/medicines" })}
        >
          Back to list
        </button>
      </p>
    );
  }

  const formDefaults = toFormValues(medicine);
  const preview = previewValues ?? formDefaults;
  const unsyncedCount = [
    ...medicine.packages,
    ...medicine.variants.flatMap((v) => v.packages),
  ].filter((p) => !p.stripe_price_id).length;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1440px] overflow-x-hidden">
      <div className="space-y-6">
        <MedicineFormPageHeader mode="edit" />

        {unsyncedCount > 0 && (
          <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-[14px] font-bold text-amber-900">
                  {unsyncedCount} plan{unsyncedCount === 1 ? "" : "s"} have no Stripe price
                </p>
                <p className="text-[13px] font-medium text-amber-800">
                  Patients cannot buy them until they are synced.
                </p>
              </div>
            </div>
            <Button
              type="button"
              onClick={() => syncMut.mutate()}
              disabled={syncMut.isPending}
              className="h-11 shrink-0 rounded-lg bg-amber-600 px-6 text-[14px] font-semibold text-white shadow-sm hover:bg-amber-700"
            >
              {syncMut.isPending ? "Syncing…" : "Sync to Stripe"}
            </Button>
          </div>
        )}

        <div className="flex w-full min-w-0 flex-col items-start gap-6 lg:flex-row lg:gap-4">
          <div className="min-w-0 flex-1">
            <Suspense fallback={<FormSkeleton />}>
              <MedicineForm
                key={medicineId}
                mode="edit"
                showPageHeader={false}
                defaultValues={formDefaults}
                submitting={mutation.isPending}
                onSubmit={(values) => mutation.mutate(values)}
                onCancel={() => navigate({ to: "/admin/medicines" })}
                onValuesChange={handlePreviewChange}
              />
            </Suspense>
          </div>

          <div className="w-full min-w-0 shrink-0 lg:sticky lg:top-4 lg:w-[491px] lg:max-w-[491px]">
            <Suspense fallback={<FormSkeleton />}>
              <MedicinePreview
                name={preview.name}
                short_description={preview.short_description}
                long_description={preview.long_description}
                image_url={preview.image_url}
                from_price_cents={computeMedicineFromPriceCents(preview)}
                important_info={preview.important_info}
                notice_text={preview.notice_text}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
