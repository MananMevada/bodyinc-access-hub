import { useState } from "react";
import { ConfirmDeleteDialog } from "@/components/admin/confirm-delete-dialog";
import { RequiredMark } from "@/components/admin/required-mark";
import {
  useFieldArray,
  Controller,
  type Control,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MAX_PACKAGES_PER_MEDICINE, type MedicineFormValues } from "@/lib/medicines.schema";
import { medicineInput, medicineTextarea } from "@/components/admin/medicine-form-styles";

type Props = {
  control: Control<MedicineFormValues>;
  register: UseFormRegister<MedicineFormValues>;
  setValue: UseFormSetValue<MedicineFormValues>;
  name: string;
  packageErrors?: any;
  submitting?: boolean;
  embedded?: boolean;
};

export function MedicinePackagesEditor({
  control,
  register,
  setValue,
  name,
  packageErrors,
  submitting,
  embedded,
}: Props) {
  const { fields, append, remove } = useFieldArray({ control, name: name as any });
  const atMax = fields.length >= MAX_PACKAGES_PER_MEDICINE;

  const body = (
    <div className="w-full min-w-0 max-w-full space-y-4">
      {fields.length === 0 && (
        <p className="py-1 text-sm font-medium text-[#3B4759]/70">
          No packages yet. Add at least one so this {embedded ? "variant" : "medicine"} has a price
          and can be purchased.
        </p>
      )}

      {fields.length > 0 && (
        <div className="hidden min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 px-1 text-[12px] font-medium text-[#3B4759]/70 md:grid">
          <span>
            Duration (months)
            <RequiredMark />
          </span>
          <span>
            Original price ($)
            <RequiredMark />
          </span>
          <span>
            Sale price ($)
            <RequiredMark />
          </span>
          <span className="w-11" />
        </div>
      )}

      {fields.map((field, index) => (
        <PackageRow
          key={field.id}
          control={control}
          register={register}
          setValue={setValue}
          name={name}
          packageCount={fields.length}
          rowErrors={packageErrors?.[index]}
          index={index}
          submitting={submitting}
          onRemove={() => remove(index)}
        />
      ))}

      <button
        type="button"
        disabled={submitting || atMax}
        onClick={() =>
          append({
            duration_months: fields.length === 0 ? 1 : 3,
            original_price: 0,
            price: 0,
            is_most_popular: false,
            is_active: true,
            features: [],
            clinical_note: "",
          } as any)
        }
        className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#152A51] transition-colors hover:text-[#152A51]/70 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> Add package
      </button>
      {atMax && (
        <p className="text-[12px] font-medium text-[#3B4759]/60">
          Maximum of {MAX_PACKAGES_PER_MEDICINE} packages reached.
        </p>
      )}
    </div>
  );

  if (embedded) return body;

  return (
    <Card className="w-full min-w-0 max-w-full overflow-hidden rounded-[24px] border border-[#E8EEED] bg-white shadow-none">
      <CardHeader className="border-b border-[#E8EEED] bg-white p-4 sm:p-6">
        <CardTitle className="text-[22px] font-medium leading-[34px] tracking-[-0.3px] text-[#152A51]">
          Pricing packages
        </CardTitle>
        <CardDescription className="text-[16px] font-normal text-[#3B4759]/70">
          Duration-based plans patients can buy — up to {MAX_PACKAGES_PER_MEDICINE} per medicine.
          The lowest per-month price is shown as the medicine&apos;s &ldquo;from&rdquo; price.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 p-4 sm:p-6">{body}</CardContent>
    </Card>
  );
}

function PackageRow({
  control,
  register,
  setValue,
  name,
  packageCount,
  rowErrors,
  index,
  submitting,
  onRemove,
}: {
  control: Control<MedicineFormValues>;
  register: UseFormRegister<MedicineFormValues>;
  setValue: UseFormSetValue<MedicineFormValues>;
  name: string;
  packageCount: number;
  rowErrors?: any;
  index: number;
  submitting?: boolean;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmPackage, setConfirmPackage] = useState(false);
  const [featureToRemove, setFeatureToRemove] = useState<number | null>(null);
  const { fields, append, remove } = useFieldArray({
    control,
    name: `${name}.${index}.features` as any,
  });

  return (
    <div className="min-w-0 space-y-3">
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-1">
          <Label className="text-[12px] font-medium text-[#152A51] md:hidden">
            Duration (months)
            <RequiredMark />
          </Label>
          <Input
            type="number"
            min={1}
            step={1}
            {...register(`${name}.${index}.duration_months` as any)}
            disabled={submitting}
            className={medicineInput}
          />
          {rowErrors?.duration_months?.message && (
            <p className="text-xs text-destructive">{rowErrors.duration_months.message}</p>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <Label className="text-[12px] font-medium text-[#3B4759]/70 md:hidden">
            Original price ($)
            <RequiredMark />
          </Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            {...register(`${name}.${index}.original_price` as any)}
            disabled={submitting}
            className={medicineInput}
          />
          {rowErrors?.original_price?.message && (
            <p className="text-xs text-destructive">{rowErrors.original_price.message}</p>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <Label className="text-[12px] font-medium text-[#3B4759]/70 md:hidden">
            Sale price ($)
            <RequiredMark />
          </Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            {...register(`${name}.${index}.price` as any)}
            disabled={submitting}
            className={medicineInput}
          />
          {rowErrors?.price?.message && (
            <p className="text-xs text-destructive">{rowErrors.price.message}</p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-[45px] w-[45px] shrink-0 justify-self-end rounded-[14px] text-[#3B4759]/60 hover:bg-destructive/5 hover:text-destructive"
          disabled={submitting}
          onClick={() => setConfirmPackage(true)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid min-w-0 grid-cols-1 items-center gap-x-4 gap-y-3 md:grid-cols-[minmax(0,1fr)_auto] md:flex md:flex-wrap md:gap-x-6">
        <Controller
          control={control}
          name={`${name}.${index}.is_most_popular` as any}
          render={({ field }) => (
            <div className="flex min-w-0 items-center gap-2.5">
              <Switch
                checked={!!field.value}
                onCheckedChange={(checked) => {
                  if (checked) {
                    for (let i = 0; i < packageCount; i++) {
                      if (i !== index) {
                        setValue(`${name}.${i}.is_most_popular` as any, false, {
                          shouldDirty: true,
                        });
                      }
                    }
                  }
                  field.onChange(checked);
                }}
                disabled={submitting}
              />
              <span className="text-[14px] font-normal text-[#152A51]">Most popular</span>
            </div>
          )}
        />
        <Controller
          control={control}
          name={`${name}.${index}.is_active` as any}
          render={({ field }) => (
            <div className="flex min-w-0 items-center gap-2.5">
              <Switch
                checked={field.value ?? true}
                onCheckedChange={field.onChange}
                disabled={submitting}
              />
              <span className="text-[14px] font-normal text-[#152A51]">Active</span>
            </div>
          )}
        />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="col-span-1 flex min-w-0 items-center justify-start gap-1 text-[14px] font-medium text-[#152A51] transition-colors hover:text-[#152A51]/70 md:col-span-1 md:ml-auto md:justify-end"
        >
          Features &amp; clinical note
          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-[#E8EEED] pt-3">
          <div className="space-y-2">
            <Label className="text-[12px] font-medium text-[#3B4759]/70">Included features</Label>
            {fields.map((f, fi) => (
              <div key={f.id} className="flex min-w-0 items-center gap-2.5">
                <Input
                  {...register(`${name}.${index}.features.${fi}.text` as any)}
                  placeholder={`Feature ${fi + 1}`}
                  disabled={submitting}
                  className={medicineInput}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-[45px] w-[45px] shrink-0 rounded-[14px] text-[#3B4759]/60 hover:bg-destructive/5 hover:text-destructive"
                  disabled={submitting}
                  onClick={() => setFeatureToRemove(fi)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <button
              type="button"
              disabled={submitting}
              onClick={() => append({ text: "" } as any)}
              className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#152A51] transition-colors hover:text-[#152A51]/70 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Add feature
            </button>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-medium text-[#3B4759]/70">Clinical note</Label>
            <Textarea
              {...register(`${name}.${index}.clinical_note` as any)}
              rows={2}
              placeholder="Optional disclaimer shown with this plan"
              disabled={submitting}
              className={medicineTextarea}
            />
          </div>
        </div>
      )}
      <ConfirmDeleteDialog
        open={confirmPackage}
        title="Remove this package?"
        description="This pricing plan will be removed when you save the medicine."
        confirmLabel="Remove"
        onCancel={() => setConfirmPackage(false)}
        onConfirm={() => {
          setConfirmPackage(false);
          onRemove();
        }}
      />
      <ConfirmDeleteDialog
        open={featureToRemove !== null}
        title="Remove this feature?"
        description="This feature will be removed when you save the medicine."
        confirmLabel="Remove"
        onCancel={() => setFeatureToRemove(null)}
        onConfirm={() => {
          if (featureToRemove !== null) remove(featureToRemove);
          setFeatureToRemove(null);
        }}
      />
    </div>
  );
}
