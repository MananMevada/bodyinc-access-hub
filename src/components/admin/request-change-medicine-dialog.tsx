import { sentenceCase } from "@/lib/text-normalize";
import { toastError, toastActionWithEmail } from "@/lib/toast-message";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listMedicinesForChange } from "@/lib/medicines.functions";
import { categoriesQueryOptions } from "@/lib/query-options/categories";
import { changeRequestMedicine } from "@/lib/requests.functions";
import type { StoredMedicinePackage } from "@/lib/medicines.store";
import { formatDollars } from "@/lib/format";

function planLabel(p: StoredMedicinePackage) {
  const dur = p.duration_months === 1 ? "Monthly" : `${p.duration_months}-Month`;
  return `${dur} — ${formatDollars(p.price)}${p.duration_months > 1 ? ` (every ${p.duration_months} mo)` : "/mo"}`;
}

export type RequestChangeCurrent = {
  medicineName: string | null;
  planName: string | null;
  price: number | null;
};

// Change the medicine on a medication order under review. A higher price waits for the
// difference payment, then the prescription is sent to the pharmacy. The same or a lower
// price is sent immediately, and a lower price is credited on the next bill.
export function RequestChangeMedicineDialog({
  requestId,
  open,
  onOpenChange,
  onChanged,
  current,
  currentMedicineId,
  currentVariantId,
  currentPackageId,
  hideFinancial = false,
}: {
  requestId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  current: RequestChangeCurrent;
  currentMedicineId?: string | null;
  currentVariantId?: string | null;
  currentPackageId?: string | null;
  hideFinancial?: boolean;
}) {
  const loadMedicines = useServerFn(listMedicinesForChange);
  const medicinesQ = useQuery({
    queryKey: ["medicines-for-change", currentMedicineId ?? null],
    queryFn: () => loadMedicines({ data: { currentMedicineId: currentMedicineId ?? undefined } }),
    enabled: open,
  });
  const categoriesQ = useQuery(categoriesQueryOptions());
  const change = useServerFn(changeRequestMedicine);

  const [search, setSearch] = useState("");
  const [medicineId, setMedicineId] = useState<string>("");
  const [variantId, setVariantId] = useState<string>("");
  const [packageId, setPackageId] = useState<string>("");
  const [allowOtherCategory, setAllowOtherCategory] = useState(false);
  const [categoryReason, setCategoryReason] = useState("");

  // Open on the order's current selection so the variant/dose and plan can be changed without
  // switching medicine.
  useEffect(() => {
    if (open) {
      setSearch("");
      setMedicineId(currentMedicineId ?? "");
      setVariantId(currentVariantId ?? "");
      setPackageId(currentPackageId ?? "");
      setAllowOtherCategory(false);
      setCategoryReason("");
    }
  }, [open, currentMedicineId, currentVariantId, currentPackageId]);

  const medicines = useMemo(
    () =>
      (medicinesQ.data ?? []).filter(
        (m) => m.is_active || m.show_to_providers || m.id === currentMedicineId,
      ),
    [medicinesQ.data, currentMedicineId],
  );

  // Same-category first: practitioners switch within a treatment category by default, and must
  // opt in (with a clinical reason) to move a patient to a different category.
  const currentCategoryIds = useMemo(() => {
    const m = medicines.find((x) => x.id === currentMedicineId);
    return new Set(m?.category_ids ?? []);
  }, [medicines, currentMedicineId]);

  const inSameCategory = (m: { id: string; category_ids: string[] }) =>
    currentCategoryIds.size === 0 || m.category_ids.some((c) => currentCategoryIds.has(c));

  const categoryNames = useMemo(() => {
    const map = new Map((categoriesQ.data ?? []).map((c) => [c.id, c.name] as const));
    return Array.from(currentCategoryIds)
      .map((id) => map.get(id))
      .filter(Boolean) as string[];
  }, [categoriesQ.data, currentCategoryIds]);

  // The current medicine stays in the list (pinned first) so a practitioner can keep the medicine
  // and change only its variant/dose or plan.
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return medicines
      .filter((m) => allowOtherCategory || inSameCategory(m))
      .filter((m) => !s || m.name.toLowerCase().includes(s))
      .sort((a, b) => (a.id === currentMedicineId ? -1 : b.id === currentMedicineId ? 1 : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medicines, search, allowOtherCategory, currentCategoryIds, currentMedicineId]);

  const medicine = medicines.find((m) => m.id === medicineId) ?? null;
  const hiddenFromPatients = Boolean(medicine && !medicine.is_active);
  const hasVariants = (medicine?.variants.length ?? 0) > 0;
  const activeVariants = useMemo(() => {
    const list = (medicine?.variants ?? []).filter((v) => v.is_active || hiddenFromPatients);
    // A since-deactivated variant must still be listed while it is the order's current one,
    // otherwise its plans are unreachable and the dialog looks empty.
    if (medicine && medicine.id === currentMedicineId && currentVariantId) {
      const cur = medicine.variants.find((v) => v.id === currentVariantId);
      if (cur && !list.some((v) => v.id === cur.id)) return [cur, ...list];
    }
    return list;
  }, [medicine, currentMedicineId, currentVariantId, hiddenFromPatients]);
  const variant = hasVariants ? (activeVariants.find((v) => v.id === variantId) ?? null) : null;

  const rawPlans = hasVariants ? (variant?.packages ?? []) : (medicine?.packages ?? []);
  const packages = useMemo(() => {
    return rawPlans.filter(
      (p) =>
        (p.stripe_price_id && (p.is_active || hiddenFromPatients)) || p.id === currentPackageId,
    );
  }, [rawPlans, hiddenFromPatients, currentPackageId]);

  useEffect(() => {
    if (!medicine) return;
    if (hasVariants && !variantId && activeVariants.length === 1)
      setVariantId(activeVariants[0].id);
  }, [medicine, hasVariants, variantId, activeVariants]);

  useEffect(() => {
    if (!medicine) return;
    if ((!hasVariants || variantId) && !packageId && packages.length === 1) {
      setPackageId(packages[0].id);
    }
  }, [medicine, hasVariants, variantId, packageId, packages]);

  function selectMedicine(id: string) {
    setMedicineId(id);
    setVariantId(id === currentMedicineId ? (currentVariantId ?? "") : "");
    setPackageId(id === currentMedicineId ? (currentPackageId ?? "") : "");
  }

  const selectedPkg = packages.find((p) => p.id === packageId) ?? null;
  const currentPlanPrice = useMemo(() => {
    if (current.price != null) return current.price;
    if (!currentPackageId) return null;
    for (const item of medicines) {
      const direct = item.packages.find((p) => p.id === currentPackageId);
      if (direct) return direct.price;
      for (const itemVariant of item.variants) {
        const match = itemVariant.packages.find((p) => p.id === currentPackageId);
        if (match) return match.price;
      }
    }
    return null;
  }, [current.price, currentPackageId, medicines]);
  const diff =
    selectedPkg && currentPlanPrice != null ? selectedPkg.price - currentPlanPrice : null;

  const isCrossCategory = !!medicine && currentCategoryIds.size > 0 && !inSameCategory(medicine);
  const reasonMissing =
    (hideFinancial || isCrossCategory) && categoryReason.trim().length < 10;
  const isUnchanged = !!selectedPkg && !!currentPackageId && selectedPkg.id === currentPackageId;

  const currentVariantName = useMemo(() => {
    if (!currentMedicineId || !currentVariantId) return null;
    const m = medicines.find((x) => x.id === currentMedicineId);
    return m?.variants.find((v) => v.id === currentVariantId)?.name ?? null;
  }, [medicines, currentMedicineId, currentVariantId]);

  const mutation = useMutation({
    mutationFn: () =>
      change({
        data: {
          requestId,
          packageId,
          note: hideFinancial ? sentenceCase(categoryReason) : undefined,
          crossCategoryReason: isCrossCategory ? sentenceCase(categoryReason) : undefined,
        },
      }),
    onSuccess: (res: any) => {
      toastActionWithEmail(
        res?.status === "awaiting_additional_payment"
          ? Number(res?.delta_cents) > 0
            ? "Order updated. The patient was asked to pay the difference. The prescription is sent to the pharmacy after they pay."
            : "Order updated. The patient was asked to approve or reject this change. It is sent to the pharmacy only after they approve."
          : res?.pharmacy_error
            ? "Order updated. The pharmacy send did not go through, so it stays at Prescription approved."
            : res?.status === "sent_to_pharmacy"
              ? "Order updated. The prescription was sent to the pharmacy."
              : "Order updated and approved.",
        res?.email_sent,
      );
      onChanged();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const canSubmit = !!selectedPkg && !isUnchanged && !mutation.isPending && !reasonMissing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change medicine</DialogTitle>
          <DialogDescription>
            {hideFinancial
              ? "Switch this order to a different medicine, or keep the same medicine and change its variant or plan. A higher price waits for the patient to pay or decline. The same or a lower price waits for the patient to approve or reject. The pharmacy send happens only after they pay or approve."
              : "Switch this order to a different medicine, or keep the same medicine and change its variant or plan. A higher price is sent to the pharmacy after the patient pays the difference. The same or a lower price is sent now, and a lower price is credited on the next bill."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Current
            </div>
            <div className="rounded-lg border bg-muted/30 p-4 space-y-1.5 text-sm">
              <div className="font-semibold text-foreground">{current.medicineName ?? "—"}</div>
              {currentVariantName ? (
                <div className="text-muted-foreground">{currentVariantName}</div>
              ) : null}
              <div className="text-muted-foreground">{current.planName ?? "—"}</div>
              <div className="text-lg font-bold text-foreground">
                {currentPlanPrice != null ? formatDollars(currentPlanPrice) : "—"}
              </div>
              {categoryNames.length > 0 ? (
                <div className="flex flex-wrap gap-1 pt-1">
                  {categoryNames.map((n) => (
                    <Badge key={n} variant="secondary" className="text-[11px]">
                      {n}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              New selection
            </div>

            {currentCategoryIds.size > 0 ? (
              <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <Label htmlFor="allow-other-cat" className="text-xs font-normal leading-snug">
                  Show medicines from other categories
                </Label>
                <Switch
                  id="allow-other-cat"
                  checked={allowOtherCategory}
                  onCheckedChange={(v) => {
                    setAllowOtherCategory(v);
                    setMedicineId("");
                    setVariantId("");
                    setPackageId("");
                  }}
                />
              </div>
            ) : null}

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search medicines…"
                className="pl-8 h-9"
                disabled={medicinesQ.isLoading}
              />
            </div>

            <div className="rounded-lg border max-h-56 overflow-y-auto divide-y">
              {medicinesQ.isLoading ? (
                <div className="p-3 text-sm text-muted-foreground">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">No medicines match.</div>
              ) : (
                filtered.map((m) => {
                  const selected = m.id === medicineId;
                  const other = !inSameCategory(m);
                  const isCurrent = m.id === currentMedicineId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => selectMedicine(m.id)}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm transition-colors ${
                        selected ? "bg-primary/10" : "hover:bg-muted/50"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium truncate">{m.name}</span>
                          {isCurrent ? (
                            <Badge variant="secondary" className="text-[10px]">
                              Current
                            </Badge>
                          ) : null}
                          {!m.is_active ? (
                            <Badge variant="secondary" className="text-[10px]">
                              Hidden from patients
                            </Badge>
                          ) : null}
                        </div>
                        {other ? (
                          <div className="text-[11px] text-muted-foreground">Other category</div>
                        ) : null}
                      </div>
                      {selected ? <Check className="h-4 w-4 text-primary shrink-0" /> : null}
                    </button>
                  );
                })
              )}
            </div>

            {hideFinancial || isCrossCategory ? (
              <div className="space-y-1 rounded-md border border-[#B8684B]/40 bg-[#B8684B]/5 p-3">
                <Label className="text-xs font-semibold text-[#8F4A33]">
                  {isCrossCategory
                    ? "Clinical reason for changing treatment category"
                    : "Clinical reason for this change"}
                </Label>
                <Textarea
                  value={categoryReason}
                  onChange={(e) => setCategoryReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder={
                    isCrossCategory
                      ? "Explain why this patient should move to a different treatment category…"
                      : "Why is this medicine or plan changing?"
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  Required (min. 10 characters). This is recorded on the order timeline and notes.
                </p>
              </div>
            ) : null}

            {hasVariants ? (
              <div className="space-y-1">
                <Label className="text-xs">Variant / dose</Label>
                <Select
                  value={variantId}
                  onValueChange={(v) => {
                    setVariantId(v);
                    setPackageId("");
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select a variant" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeVariants.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                        {v.id === currentVariantId ? " (current)" : ""}
                        {!v.is_active ? " (hidden from patients)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {medicine && (!hasVariants || variantId) ? (
              <div className="space-y-1">
                <Label className="text-xs">Plan</Label>
                {packages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {rawPlans.some((p) => !p.stripe_price_id)
                      ? "This plan is not synced to Stripe yet. Open the medicine, save it, and try again."
                      : "No purchasable plan for this selection."}
                  </p>
                ) : (
                  <Select value={packageId} onValueChange={setPackageId}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select a plan" />
                    </SelectTrigger>
                    <SelectContent>
                      {packages.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {planLabel(p)}
                          {p.id === currentPackageId ? " (current)" : ""}
                          {!p.is_active ? " (hidden from patients)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {isUnchanged ? (
          <p className="text-xs text-muted-foreground">
            This is the order's current variant and plan. Pick a different variant/dose or plan to
            change it.
          </p>
        ) : null}

        {selectedPkg && !isUnchanged && diff != null ? (
          <div className="rounded-lg border bg-muted/20 p-3 text-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Current price</span>
              <span className="font-medium">
                {currentPlanPrice != null ? formatDollars(currentPlanPrice) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-semibold">New price</span>
              <span
                className={`text-lg font-bold ${
                  diff > 0 ? "text-destructive" : diff < 0 ? "text-emerald-600" : "text-foreground"
                }`}
              >
                {formatDollars(selectedPkg.price)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                {diff > 0 ? "Additional payment" : diff < 0 ? "Credit on next refill" : "Difference"}
              </span>
              <span
                className={`font-bold ${
                  diff > 0 ? "text-destructive" : diff < 0 ? "text-emerald-600" : "text-foreground"
                }`}
              >
                {diff > 0 ? "+" : diff < 0 ? "−" : ""}
                {formatDollars(Math.abs(diff))}
              </span>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              {diff > 0
                ? hideFinancial
                  ? "The patient pays this difference or declines it. After payment, the prescription is sent to the pharmacy. If they decline, or do neither within 7 days, the previous medicine and plan are restored and they are not charged."
                  : "The patient pays this difference. After that payment, the prescription is sent to the pharmacy."
                : diff < 0
                  ? hideFinancial
                    ? "The patient approves or rejects this change. Approval sends it to the pharmacy and credits this amount on the next bill. A rejection, or no response within 7 days, restores the previous medicine and plan. Nothing is charged."
                    : "Nothing else is asked of the patient. The prescription is sent to the pharmacy now, and this credit applies to the next bill."
                  : hideFinancial
                    ? "The patient approves or rejects this change. Approval sends it to the pharmacy. A rejection, or no response within 7 days, restores the previous medicine and plan."
                    : "No price change. The prescription is sent to the pharmacy now."}
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Changing…" : "Confirm change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
