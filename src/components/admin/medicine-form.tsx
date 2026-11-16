"use client";

import { ConfirmDeleteDialog } from "@/components/admin/confirm-delete-dialog";
import { FormActionBar } from "@/components/admin/form-action-bar";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFieldArray, useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2, Upload, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { uploadMedicineImage } from "@/lib/medicine-image-upload";
import { MedicinePricingSection } from "@/components/admin/medicine-pricing-section";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery } from "@tanstack/react-query";
import { categoriesQueryOptions } from "@/lib/query-options/categories";
import {
  medicineFormSchema,
  MEDICINE_STATUSES,
  MEDICINE_STATUS_LABELS,
  type MedicineFormValues,
  type MedicineStatus,
} from "@/lib/medicines.schema";
import {
  CardDivider,
  MedicineField,
  MedicineFormPageHeader,
  MedicineProductImage,
  medicineCard,
  medicineCardTitle,
  medicineCheckbox,
  medicineInput,
  medicineOptionWhite,
  medicineShortTextarea,
  medicineTextarea,
  medicineToggleCard,
} from "@/components/admin/medicine-form-styles";

export { MedicineFormPageHeader };

export type MedicineFormProps = {
  defaultValues?: Partial<MedicineFormValues>;
  mode: "create" | "edit";
  submitting?: boolean;
  onSubmit: (values: MedicineFormValues) => void | Promise<void>;
  onCancel?: () => void;
  onValuesChange?: (values: MedicineFormValues) => void;
  showPageHeader?: boolean;
};

const EMPTY: MedicineFormValues = {
  name: "",
  short_description: "",
  long_description: "",
  image_url: "",
  packages: [],
  variants: [],
  status: "draft",
  important_info: [],
  notice_text: "",
  lf_product_id: "",
  life_file_pharmacy_id: undefined,
  sort_order: 0,
  requires_questionnaire: false,
  requires_consultation: false,
  requires_followup: false,
  show_to_providers: false,
  category_ids: [],
};

export function MedicineForm({
  defaultValues,
  mode,
  submitting,
  onSubmit,
  onCancel,
  onValuesChange,
  showPageHeader = true,
}: MedicineFormProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [bulletToRemove, setBulletToRemove] = useState<number | null>(null);

  const form = useForm<MedicineFormValues>({
    resolver: zodResolver(medicineFormSchema) as any,
    defaultValues: { ...EMPTY, ...defaultValues },
  });

  const { register, handleSubmit, watch, setValue, control, formState } = form;
  const errors = formState.errors;
  const status = watch("status");
  const imageUrl = watch("image_url");
  const categoriesQ = useQuery(categoriesQueryOptions());

  const { fields, append, remove } = useFieldArray({
    control,
    name: "important_info",
  });

  useEffect(() => {
    if (!onValuesChange) return;
    const subscription = watch((formValues) => {
      onValuesChange(formValues as MedicineFormValues);
    });
    return () => subscription.unsubscribe();
  }, [watch, onValuesChange]);

  async function handleImageSelect(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const url = await uploadMedicineImage(file);
      setValue("image_url", url, { shouldValidate: true });
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleImageSelect(file);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void handleImageSelect(file);
  }

  const toggleItems: {
    id: string;
    name: keyof Pick<
      MedicineFormValues,
      "requires_questionnaire" | "requires_consultation" | "requires_followup" | "show_to_providers"
    >;
    label: string;
  }[] = [
    {
      id: "req-qq",
      name: "requires_questionnaire",
      label: "Requires questionnaire before checkout",
    },
    {
      id: "req-consult",
      name: "requires_consultation",
      label: "Requires provider consultation & approval",
    },
    {
      id: "req-followup",
      name: "requires_followup",
      label: "Requires follow-up approval each cycle",
    },
    {
      id: "show-providers",
      name: "show_to_providers",
      label: "Show to providers when changing a patient's medicine",
    },
  ];

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="m-0 w-full min-w-0 max-w-full space-y-5 p-0 font-['DM_Sans',sans-serif] sm:space-y-6"
      noValidate
    >
      <div className="w-full min-w-0 max-w-full space-y-5 sm:space-y-6">
        {showPageHeader && <MedicineFormPageHeader mode={mode} />}

        {/* Product Details card */}
        <Card className={`w-full min-w-0 max-w-full p-4 sm:p-6 ${medicineCard}`}>
          <div className="mb-5 space-y-4 sm:mb-6">
            <h2 className={medicineCardTitle}>Product Details</h2>
            <CardDivider />
          </div>

          <div className="grid w-full min-w-0 grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
            {/* Product image — 200×201 square */}
            <div
              className="flex w-full max-w-[200px] flex-col gap-3"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
            >
              <Label className="text-[16px] font-medium text-[#152A51]">Product image</Label>

              {imageUrl ? (
                <MedicineProductImage src={imageUrl} alt="Medicine preview" size="form" />
              ) : (
                <div className="flex h-[201px] w-[200px] items-center justify-center rounded-[21px] bg-[#E8EEED]">
                  <ImageIcon className="h-10 w-10 text-[#3B4759]/40" />
                </div>
              )}

              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={onFileChange}
                disabled={submitting || uploading}
              />

              <div className="flex w-[200px] flex-col items-center gap-2">
                <Button
                  type="button"
                  disabled={submitting || uploading}
                  onClick={() => fileRef.current?.click()}
                  className="flex h-[45px] w-full items-center justify-center gap-2 rounded-full bg-[#6A9B9C] px-6 text-[14px] font-semibold text-white transition-colors hover:bg-[#5B8788]"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {uploading ? "Uploading…" : imageUrl ? "Replace image" : "Upload image"}
                </Button>

                <span className="text-center text-[12px] font-normal text-[#3B4759]/70">
                  JPG, PNG, or WebP · Max 5MB
                </span>
              </div>

              {(errors.image_url?.message || uploadError) && (
                <p className="text-xs text-destructive">
                  {errors.image_url?.message ?? uploadError}
                </p>
              )}
            </div>

            {/* Fields column — minmax(0,1fr) keeps all inputs the same width */}
            <div className="flex w-full min-w-0 flex-col gap-4">
              <MedicineField label="Medicine Name" error={errors.name?.message} required>
                <Input
                  {...register("name")}
                  placeholder="e.g. GLP-1 Compound"
                  disabled={submitting}
                  className={medicineInput}
                />
              </MedicineField>

              <MedicineField label="Short description" error={errors.short_description?.message} required>
                <Textarea
                  {...register("short_description")}
                  rows={2}
                  placeholder="Shown on the medication card"
                  disabled={submitting}
                  className={medicineShortTextarea}
                />
              </MedicineField>

              <MedicineField label="Long description" error={errors.long_description?.message}>
                <Textarea
                  {...register("long_description")}
                  rows={5}
                  placeholder="Full description in the Learn More modal"
                  disabled={submitting}
                  className={medicineTextarea}
                />
              </MedicineField>

              <MedicineField label="Status" error={errors.status?.message}>
                <Select
                  value={status}
                  onValueChange={(v) => setValue("status", v as MedicineStatus)}
                  disabled={submitting}
                >
                  <SelectTrigger className={`${medicineInput} font-normal`}>
                    <SelectValue placeholder="Select a status" />
                  </SelectTrigger>
                  <SelectContent className="font-['DM_Sans',sans-serif]">
                    {MEDICINE_STATUSES.map((s) => (
                      <SelectItem
                        key={s}
                        value={s}
                        className="text-[16px] font-normal text-[#152A51]"
                      >
                        {MEDICINE_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </MedicineField>

              {/* Toggle cards — one per row */}
              <div className="space-y-3 pt-1">
                {toggleItems.map((item) => (
                  <Controller
                    key={item.id}
                    control={control}
                    name={item.name}
                    render={({ field }) => (
                      <div className={medicineToggleCard}>
                        <Switch
                          id={item.id}
                          checked={!!field.value}
                          onCheckedChange={field.onChange}
                          disabled={submitting}
                        />
                        <Label
                          htmlFor={item.id}
                          className="min-w-0 flex-1 cursor-pointer select-none text-[14px] font-normal leading-snug text-[#152A51]"
                        >
                          {item.label}
                        </Label>
                      </div>
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Categories card */}
        <Card className={`w-full min-w-0 max-w-full overflow-hidden p-4 sm:p-6 ${medicineCard}`}>
          <div className="mb-5 space-y-2 sm:mb-6">
            <h2 className={medicineCardTitle}>Categories</h2>
            <p className="text-[16px] font-normal text-[#3B4759]/70">
              Assign this medicine to one or more goal categories.
            </p>
            <CardDivider />
          </div>

          <Controller
            control={control}
            name="category_ids"
            render={({ field }) => (
              <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
                {(categoriesQ.data ?? []).length === 0 && (
                  <p className="col-span-full py-1 text-sm font-medium text-muted-foreground">
                    No categories yet. Create one under Categories first.
                  </p>
                )}
                {(categoriesQ.data ?? []).map((c) => {
                  const checked = (field.value ?? []).includes(c.id);
                  return (
                    <label key={c.id} className={medicineOptionWhite}>
                      <Checkbox
                        checked={checked}
                        className={medicineCheckbox}
                        onCheckedChange={(v) => {
                          const set = new Set(field.value ?? []);
                          if (v) set.add(c.id);
                          else set.delete(c.id);
                          field.onChange(Array.from(set));
                        }}
                      />
                      <span className="truncate">{c.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          />
        </Card>

        <Card className={`w-full min-w-0 max-w-full overflow-hidden p-4 sm:p-6 ${medicineCard}`}>
          <MedicinePricingSection
            control={control}
            register={register}
            getValues={form.getValues}
            setValue={setValue}
            errors={errors}
            submitting={submitting}
          />
        </Card>

        {/* Important Info */}
        <Card className={`w-full min-w-0 max-w-full overflow-hidden p-4 sm:p-6 ${medicineCard}`}>
          <div className="mb-5 space-y-2 sm:mb-6">
            <h2 className={medicineCardTitle}>Important information</h2>
            <p className="text-[16px] font-normal text-[#3B4759]/70">
              Bullet points shown in the Learn More modal.
            </p>
            <CardDivider />
          </div>

          <div className="space-y-3">
            {fields.map((field, index) => (
              <div key={field.id} className="flex min-w-0 items-center gap-3">
                <Input
                  {...register(`important_info.${index}.text`)}
                  placeholder={`Bullet ${index + 1}`}
                  disabled={submitting}
                  className={medicineInput}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-[45px] w-[45px] shrink-0 rounded-[14px] text-[#3B4759]/60 hover:bg-destructive/5 hover:text-destructive"
                  disabled={submitting}
                  onClick={() => {
                    const text = form.getValues(`important_info.${index}.text`);
                    if (!text?.trim()) {
                      remove(index);
                      return;
                    }
                    setBulletToRemove(index);
                  }}
                >
                  <Trash2 className="h-5 w-5" />
                </Button>
              </div>
            ))}
            <button
              type="button"
              disabled={submitting}
              onClick={() => append({ text: "" })}
              className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#152A51] transition-colors hover:text-[#152A51]/70 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Add bullet
            </button>
          </div>
        </Card>

        {/* Notice */}
        <Card className={`w-full min-w-0 max-w-full overflow-hidden p-4 sm:p-6 ${medicineCard}`}>
          <div className="mb-5 space-y-2 sm:mb-6">
            <h2 className={medicineCardTitle}>Notice</h2>
            <p className="text-[16px] font-normal text-[#3B4759]/70">
              Optional footer disclaimer in the modal.
            </p>
            <CardDivider />
          </div>

          <Textarea
            {...register("notice_text")}
            rows={2}
            placeholder="e.g. Individual results may vary…"
            disabled={submitting}
            className={medicineTextarea}
          />
        </Card>

        <FormActionBar
          submitting={submitting || uploading}
          submitLabel={mode === "create" ? "Create medicine" : "Save changes"}
          onCancel={onCancel}
          barClassName="sticky bottom-0 z-30 -mx-4 mt-4 flex flex-col-reverse gap-3 border-t border-[#E8EEED] bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80 sm:-mx-6 sm:flex-row sm:items-center sm:justify-end sm:px-6"
          secondaryClassName="h-[45px] w-full min-w-0 rounded-[14px] border border-[#E8EEED] bg-white px-6 text-[14px] font-medium text-[#152A51] shadow-none hover:bg-[#F2F7F6] sm:w-auto sm:min-w-[120px]"
          primaryClassName="h-[45px] w-full min-w-0 rounded-[14px] border border-[#E3E084]/40 bg-[#E3E084] px-6 text-[14px] font-semibold text-[#152A51] shadow-none hover:bg-[#D6D26A] sm:w-auto sm:min-w-[140px]"
        />
      </div>
      <ConfirmDeleteDialog
        open={bulletToRemove !== null}
        title="Remove this bullet?"
        description="This information will be removed from the medicine when you save."
        confirmLabel="Remove"
        onCancel={() => setBulletToRemove(null)}
        onConfirm={() => {
          if (bulletToRemove !== null) remove(bulletToRemove);
          setBulletToRemove(null);
        }}
      />
    </form>
  );
}
