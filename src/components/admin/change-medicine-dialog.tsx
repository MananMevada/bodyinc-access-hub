import { toastError } from "@/lib/toast-message";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listMedicinesForChange } from "@/lib/medicines.functions";
import { changeSubscriptionMedicine } from "@/lib/orders.functions";
import type { StoredMedicinePackage } from "@/lib/medicines.store";
import { formatDate, formatDollars } from "@/lib/format";

function planLabel(p: StoredMedicinePackage) {
  const dur = p.duration_months === 1 ? "Monthly" : `${p.duration_months}-Month`;
  return `${dur} — ${formatDollars(p.price)}${p.duration_months > 1 ? ` (every ${p.duration_months} mo)` : "/mo"}`;
}

function perMonth(price: number, durationMonths: number) {
  const d = Math.max(1, Number(durationMonths) || 1);
  return price / d;
}

export type ChangeMedicineCurrent = {
  medicineName: string | null;
  variantName: string | null;
  planName: string | null;
  price: number | null;
  durationMonths: number | null;
  renewsAt: string | null;
};

export function ChangeMedicineDialog({
  orderId,
  open,
  onOpenChange,
  onChanged,
  current,
}: {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  current: ChangeMedicineCurrent;
}) {
  const loadMedicines = useServerFn(listMedicinesForChange);
  const medicinesQ = useQuery({
    queryKey: ["medicines-for-change"],
    queryFn: () => loadMedicines({ data: {} }),
    enabled: open,
  });
  const change = useServerFn(changeSubscriptionMedicine);

  const [search, setSearch] = useState("");
  const [medicineId, setMedicineId] = useState<string>("");
  const [variantId, setVariantId] = useState<string>("");
  const [packageId, setPackageId] = useState<string>("");

  useEffect(() => {
    if (open) {
      setSearch("");
      setMedicineId("");
      setVariantId("");
      setPackageId("");
    }
  }, [open]);

  const medicines = useMemo(
    () => (medicinesQ.data ?? []).filter((m) => m.is_active || m.show_to_providers),
    [medicinesQ.data],
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return medicines;
    return medicines.filter((m) => m.name.toLowerCase().includes(s));
  }, [medicines, search]);

  const medicine = medicines.find((m) => m.id === medicineId) ?? null;
  const hiddenFromPatients = Boolean(medicine && !medicine.is_active);
  const hasVariants = (medicine?.variants.length ?? 0) > 0;
  const activeVariants = useMemo(
    () => (medicine?.variants ?? []).filter((v) => v.is_active || hiddenFromPatients),
    [medicine, hiddenFromPatients],
  );
  const variant = hasVariants ? (activeVariants.find((v) => v.id === variantId) ?? null) : null;

  const rawPlans = hasVariants ? (variant?.packages ?? []) : (medicine?.packages ?? []);
  const packages = useMemo(() => {
    return rawPlans.filter((p) => p.stripe_price_id && (p.is_active || hiddenFromPatients));
  }, [rawPlans, hiddenFromPatients]);

  // Auto-select the only variant / package when there is just one.
  useEffect(() => {
    if (!medicine) return;
    if (hasVariants && !variantId && activeVariants.length === 1) {
      setVariantId(activeVariants[0].id);
    }
  }, [medicine, hasVariants, variantId, activeVariants]);

  useEffect(() => {
    if (!medicine) return;
    if ((!hasVariants || variantId) && !packageId && packages.length === 1) {
      setPackageId(packages[0].id);
    }
  }, [medicine, hasVariants, variantId, packageId, packages]);

  function selectMedicine(id: string) {
    setMedicineId(id);
    setVariantId("");
    setPackageId("");
  }

  const selectedPkg = packages.find((p) => p.id === packageId) ?? null;
  const currentPerMo =
    current.price != null && current.durationMonths
      ? perMonth(current.price, current.durationMonths)
      : null;
  const newPerMo = selectedPkg ? perMonth(selectedPkg.price, selectedPkg.duration_months) : null;
  const diffPerMo = currentPerMo != null && newPerMo != null ? newPerMo - currentPerMo : null;

  const mutation = useMutation({
    mutationFn: () => change({ data: { orderId, packageId } }),
    onSuccess: () => {
      toast.success("Medicine changed. The new plan applies from the next billing cycle.");
      onChanged();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const canSubmit = !!selectedPkg && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Change medicine</DialogTitle>
          <DialogDescription>
            Switch this subscription to a different medicine and plan. The new price applies from
            the next billing cycle — the patient isn&apos;t charged now.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Current plan */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Current plan
            </div>
            <div className="rounded-lg border bg-muted/30 p-4 space-y-1.5 text-sm">
              <div className="font-semibold text-foreground">
                {current.medicineName ?? "—"}
                {current.variantName ? (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    · {current.variantName}
                  </span>
                ) : null}
              </div>
              <div className="text-muted-foreground">{current.planName ?? "—"}</div>
              <div className="text-lg font-bold text-foreground">
                {current.price != null ? formatDollars(current.price) : "—"}
                {current.durationMonths ? (
                  <span className="text-xs font-medium text-muted-foreground">
                    {current.durationMonths === 1 ? " /mo" : ` / ${current.durationMonths} mo`}
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground pt-1">
                Renews {formatDate(current.renewsAt)}
              </div>
            </div>
          </div>

          {/* New plan */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              New plan
            </div>

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
                  const fromPrice = m.from_price_cents != null ? m.from_price_cents / 100 : null;
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
                        <div className="font-medium truncate">
                          {m.name}
                          {!m.is_active ? " (hidden from patients)" : ""}
                        </div>
                        {fromPrice != null ? (
                          <div className="text-xs text-muted-foreground">
                            from {formatDollars(fromPrice)}/mo
                          </div>
                        ) : null}
                      </div>
                      {selected ? <Check className="h-4 w-4 text-primary shrink-0" /> : null}
                    </button>
                  );
                })
              )}
            </div>

            {hasVariants ? (
              <div className="space-y-1">
                <Label className="text-xs">Variant</Label>
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

        {/* Difference */}
        {selectedPkg ? (
          <div className="rounded-lg border bg-muted/20 p-3 text-sm space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Difference
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">New price</span>
              <span className="font-medium">
                {formatDollars(selectedPkg.price)}
                <span className="text-xs text-muted-foreground">
                  {selectedPkg.duration_months === 1
                    ? " /mo"
                    : ` / ${selectedPkg.duration_months} mo`}
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Current price</span>
              <span className="font-medium">
                {current.price != null ? formatDollars(current.price) : "—"}
                {current.durationMonths ? (
                  <span className="text-xs text-muted-foreground">
                    {current.durationMonths === 1 ? " /mo" : ` / ${current.durationMonths} mo`}
                  </span>
                ) : null}
              </span>
            </div>
            {diffPerMo != null ? (
              <div className="flex items-center justify-between pt-1 border-t mt-1">
                <span className="font-semibold">Change (per month)</span>
                <span
                  className={`font-bold ${
                    diffPerMo > 0
                      ? "text-destructive"
                      : diffPerMo < 0
                        ? "text-emerald-600"
                        : "text-foreground"
                  }`}
                >
                  {diffPerMo > 0 ? "+" : diffPerMo < 0 ? "−" : ""}
                  {formatDollars(Math.abs(diffPerMo))}/mo
                </span>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground pt-1">
              Applies from the next billing cycle. No charge now.
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
