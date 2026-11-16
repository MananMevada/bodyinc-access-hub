import { useState } from "react";
import { useFieldArray, Controller } from "react-hook-form";
import type {
  Control,
  UseFormRegister,
  UseFormGetValues,
  UseFormSetValue,
  FieldErrors,
} from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Layers, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDeleteDialog } from "@/components/admin/confirm-delete-dialog";
import { MedicinePackagesEditor } from "@/components/admin/medicine-packages-editor";
import { RequiredMark } from "@/components/admin/required-mark";
import type { MedicineFormValues } from "@/lib/medicines.schema";
import {
  CardDivider,
  medicineCardTitle,
  medicineInput,
} from "@/components/admin/medicine-form-styles";
import { listLifeFilePharmacies } from "@/lib/lifefile-pharmacies.functions";

type Props = {
  control: Control<MedicineFormValues>;
  register: UseFormRegister<MedicineFormValues>;
  getValues: UseFormGetValues<MedicineFormValues>;
  setValue: UseFormSetValue<MedicineFormValues>;
  errors: FieldErrors<MedicineFormValues>;
  submitting?: boolean;
};

function usePharmacies() {
  const list = useServerFn(listLifeFilePharmacies);
  return useQuery({
    queryKey: ["life-file-pharmacies"],
    queryFn: () => list({}),
    staleTime: 60_000,
  });
}

function LifeFileRoutingFields({
  register,
  control,
  pharmacyField,
  productField,
  pharmacyError,
  productError,
  submitting,
}: {
  register: UseFormRegister<MedicineFormValues>;
  control: Control<MedicineFormValues>;
  pharmacyField: "life_file_pharmacy_id" | `variants.${number}.life_file_pharmacy_id`;
  productField: "lf_product_id" | `variants.${number}.lf_product_id`;
  pharmacyError?: string;
  productError?: string;
  submitting?: boolean;
}) {
  const pharmaciesQ = usePharmacies();
  const pharmacies = (pharmaciesQ.data ?? []).filter((p: any) => p.is_active !== false);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1">
        <Label className="text-[12px] font-medium text-[#3B4759]/70">LifeFile pharmacy</Label>
        <Controller
          control={control}
          name={pharmacyField}
          render={({ field }) => (
            <Select
              value={field.value || ""}
              onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}
              disabled={submitting || pharmaciesQ.isLoading}
            >
              <SelectTrigger className={medicineInput}>
                <SelectValue
                  placeholder={
                    pharmaciesQ.isLoading
                      ? "Loading…"
                      : pharmacies.length === 0
                        ? "Add a pharmacy first"
                        : "Select pharmacy"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {pharmacies.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {pharmacyError && <p className="text-xs text-destructive">{pharmacyError}</p>}
        <p className="text-[12px] font-normal text-[#3B4759]/60">
          Orders for this SKU route to this pharmacy.
        </p>
      </div>
      <div className="min-w-0 space-y-1">
        <Label className="text-[12px] font-medium text-[#3B4759]/70">Life File product ID</Label>
        <Input
          {...register(productField)}
          inputMode="numeric"
          placeholder="e.g. 201539236"
          disabled={submitting}
          className={medicineInput}
        />
        {productError && <p className="text-xs text-destructive">{productError}</p>}
        <p className="text-[12px] font-normal text-[#3B4759]/60">
          Product/NFI ID from that pharmacy&apos;s catalog.
        </p>
      </div>
    </div>
  );
}

export function MedicinePricingSection({
  control,
  register,
  getValues,
  setValue,
  errors,
  submitting,
}: Props) {
  const variantsArray = useFieldArray({ control, name: "variants" });
  const hasVariants = variantsArray.fields.length > 0;
  const [variantToRemove, setVariantToRemove] = useState<number | null>(null);

  function addFirstVariant() {
    const current = getValues("packages") ?? [];
    const medLfId = getValues("lf_product_id") ?? "";
    const medPharmacy = getValues("life_file_pharmacy_id") ?? "";
    variantsArray.append({
      name: "",
      is_active: true,
      lf_product_id: medLfId,
      life_file_pharmacy_id: medPharmacy,
      packages: current,
    } as any);
    setValue("packages", []);
    if (medLfId) setValue("lf_product_id", "");
    if (medPharmacy) setValue("life_file_pharmacy_id", undefined);
  }

  if (!hasVariants) {
    return (
      <div className="space-y-4">
        <LifeFileRoutingFields
          register={register}
          control={control}
          pharmacyField="life_file_pharmacy_id"
          productField="lf_product_id"
          pharmacyError={errors.life_file_pharmacy_id?.message}
          productError={errors.lf_product_id?.message}
          submitting={submitting}
        />
        <MedicinePackagesEditor
          control={control}
          register={register}
          setValue={setValue}
          name="packages"
          packageErrors={errors.packages}
          submitting={submitting}
        />
        <button
          type="button"
          disabled={submitting}
          onClick={addFirstVariant}
          className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#152A51] transition-colors hover:text-[#152A51]/70 disabled:opacity-50"
        >
          <Layers className="h-4 w-4" /> Add variants (e.g. dosages)
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-5">
      <div className="space-y-2">
        <h3 className={medicineCardTitle}>Variants</h3>
        <p className="text-[16px] font-normal text-[#3B4759]/70">
          Dose or strength options (e.g. 2mg/0.5ml, 4mg/0.5ml). Each variant needs its own LifeFile
          pharmacy + product ID and packages (up to 2). Patients pick a variant in the shop.
        </p>
        <CardDivider />
      </div>

      {variantsArray.fields.map((field, vIndex) => (
        <div
          key={field.id}
          className="min-w-0 space-y-4 rounded-[14px] border border-[#E8EEED] bg-white p-4 sm:p-5"
        >
          <div className="grid grid-cols-1 items-start gap-3 min-[480px]:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="min-w-0 space-y-1">
              <Label className="text-[16px] font-medium text-[#152A51]">
                Variant name
                <RequiredMark />
              </Label>
              <Input
                {...register(`variants.${vIndex}.name`)}
                placeholder="e.g. 2mg/0.5ml (2mL Vial)"
                disabled={submitting}
                className={`${medicineInput} ${
                  errors.variants?.[vIndex]?.name?.message ? "!border-red-500" : ""
                }`}
              />
              {errors.variants?.[vIndex]?.name?.message && (
                <p className="text-xs text-destructive">
                  {errors.variants[vIndex]!.name!.message}
                </p>
              )}
            </div>
            <Controller
              control={control}
              name={`variants.${vIndex}.is_active`}
              render={({ field: sw }) => (
                <div className="flex flex-col items-center gap-1.5 pt-6">
                  <Switch
                    checked={sw.value ?? true}
                    onCheckedChange={sw.onChange}
                    disabled={submitting}
                  />
                  <span className="text-[11px] font-semibold text-[#3B4759]/70">Active</span>
                </div>
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-0 h-[45px] w-[45px] rounded-[14px] text-[#3B4759]/60 hover:bg-destructive/5 hover:text-destructive min-[480px]:mt-6"
              disabled={submitting}
              onClick={() => setVariantToRemove(vIndex)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <LifeFileRoutingFields
            register={register}
            control={control}
            pharmacyField={`variants.${vIndex}.life_file_pharmacy_id`}
            productField={`variants.${vIndex}.lf_product_id`}
            pharmacyError={errors.variants?.[vIndex]?.life_file_pharmacy_id?.message}
            productError={errors.variants?.[vIndex]?.lf_product_id?.message}
            submitting={submitting}
          />

          <MedicinePackagesEditor
            control={control}
            register={register}
            setValue={setValue}
            name={`variants.${vIndex}.packages`}
            packageErrors={errors.variants?.[vIndex]?.packages}
            submitting={submitting}
            embedded
          />
        </div>
      ))}

      <button
        type="button"
        disabled={submitting}
        onClick={() =>
          variantsArray.append({
            name: "",
            is_active: true,
            lf_product_id: "",
            life_file_pharmacy_id: undefined,
            packages: [],
          } as any)
        }
        className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#152A51] transition-colors hover:text-[#152A51]/70 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> Add variant
      </button>
      <ConfirmDeleteDialog
        open={variantToRemove !== null}
        title="Remove this variant?"
        description="This variant and its packages will be removed when you save the medicine."
        confirmLabel="Remove"
        onCancel={() => setVariantToRemove(null)}
        onConfirm={() => {
          if (variantToRemove !== null) variantsArray.remove(variantToRemove);
          setVariantToRemove(null);
        }}
      />
    </div>
  );
}
