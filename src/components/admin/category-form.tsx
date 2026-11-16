import { useEffect, useRef, useState, type ReactNode } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, X } from "lucide-react";
import { toast } from "sonner";
import { uploadCategoryImage } from "@/lib/category-image-upload";
import {
  categoryFormSchema,
  BMI_BANDS,
  BMI_BAND_LABELS,
  SEX_VALUES,
  SEX_LABELS,
  type CategoryFormValues,
} from "@/lib/categories.schema";
import { StateMultiSelect } from "@/components/admin/state-multi-select";
import { ConfirmDeleteDialog } from "@/components/admin/confirm-delete-dialog";
import { FormActionBar } from "@/components/admin/form-action-bar";
import { RequiredMark } from "@/components/admin/required-mark";
import { adminLabel } from "@/lib/admin-ui";
import { Switch } from "../ui/switch";

const EMPTY: CategoryFormValues = {
  slug: "",
  name: "",
  tagline: "",
  image_url: "",
  sort_order: 0,
  is_active: true,
  eligibility_rules: {
    bmi_bands: [],
    sex: [],
    min_age: null,
    max_age: null,
    blocked_state_codes: [],
  },
};

/** Figma input: 45px height, 14px radius, #E8EEED fill */
const categoryInput =
  "h-[45px] w-full rounded-[14px] border border-[#E8EEED] bg-[#E8EEED] px-4 py-3 text-[16px] font-normal text-[#152A51] shadow-none placeholder:text-[#3B4759]/40 focus-visible:border-[#D5DEDD] focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-[#152A51]/15";

const categoryToggleRow =
  "flex h-[45px] items-center rounded-[14px] border border-[#E8EEED] bg-[#E8EEED] px-4";

/** White checkbox row — BMI & Sex (Figma) */
const categoryOptionWhite =
  "flex h-[45px] min-w-0 cursor-pointer items-center gap-2 rounded-[14px] border border-[#E8EEED] bg-white px-3 text-[13px] font-medium text-[#152A51] transition-colors hover:bg-[#FAFAFA] sm:gap-3 sm:text-[14px]";

const categoryCheckbox =
  "h-4 w-4 shrink-0 rounded border-[#D5DEDD] data-[state=checked]:border-[#6A9B9C] data-[state=checked]:bg-[#6A9B9C]";

const categoryCard = "rounded-[24px] border border-[#E8EEED] bg-white shadow-none";

const cardSectionTitle =
  "text-[22px] font-medium leading-[34px] tracking-[-0.3px] text-[#152A51]";

const pageTitle =
  "text-[24px] font-medium leading-[37px] tracking-[-0.5px] text-[#152A51] sm:text-[28px]";

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`min-w-0 space-y-2 ${
        error ? "[&_input]:!border-red-500 [&_textarea]:!border-red-500" : ""
      }`}
    >
      <Label className={`${adminLabel} block text-[#152A51]`}>
        {label}
        {required ? <RequiredMark /> : null}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function CardDivider() {
  return <div className="h-px w-full bg-[#E8EEED]" />;
}

export type CategoryFormProps = {
  defaultValues?: Partial<CategoryFormValues>;
  mode: "create" | "edit";
  submitting?: boolean;
  onSubmit: (values: CategoryFormValues) => void | Promise<void>;
  onCancel?: () => void;
};

export function CategoryForm({
  defaultValues,
  mode,
  submitting,
  onSubmit,
  onCancel,
}: CategoryFormProps) {
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema) as any,
    defaultValues: { ...EMPTY, ...defaultValues },
  });
  const { register, handleSubmit, control, watch, setValue, formState } = form;
  const errors = formState.errors as any;

  const initialRules = defaultValues?.eligibility_rules;
  const hasInitialRules =
    !!initialRules &&
    ((initialRules.bmi_bands?.length ?? 0) > 0 ||
      (initialRules.sex?.length ?? 0) > 0 ||
      initialRules.min_age != null ||
      initialRules.max_age != null ||
      (initialRules.blocked_state_codes?.length ?? 0) > 0);
  const [showEligibility, setShowEligibility] = useState<boolean>(hasInitialRules);
  const [confirmRemoveImage, setConfirmRemoveImage] = useState(false);

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageUrl = watch("image_url");

  const nameVal = watch("name");
  const slugVal = watch("slug");
  useEffect(() => {
    if (mode === "create" && nameVal && !slugVal) {
      setValue(
        "slug",
        String(nameVal)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
      );
    }
  }, [nameVal, slugVal, mode, setValue]);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const url = await uploadCategoryImage(file);
      setValue("image_url", url, { shouldDirty: true });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const submit = handleSubmit((values) => {
    if (!showEligibility) {
      values.eligibility_rules = {
        bmi_bands: [],
        sex: [],
        min_age: null,
        max_age: null,
        blocked_state_codes: [],
      };
    }
    return onSubmit(values);
  });

  const pageHeading = mode === "create" ? "New category" : "Edit category";

  return (
    <div className="admin-page-shell space-y-5 sm:space-y-6 font-['DM_Sans']">
      {/* Clean Figma header — title + one subtitle line only */}
      <div className="space-y-2">
        <h1 className={pageTitle}>{pageHeading}</h1>
        <p className="text-[15px] font-normal leading-snug text-[#3B4759]/70 sm:text-[16px]">
          Categories are the goals patients pick during intake.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-5 sm:space-y-6" noValidate>
        {/* Card 1 — Category Details */}
        <Card className={categoryCard}>
          <CardContent className="space-y-5 p-4 sm:space-y-6 sm:p-6">
            <div className="space-y-4">
              <h2 className={cardSectionTitle}>Category Details</h2>
              <CardDivider />
            </div>

            {/* Row 1: Name, Slug, Tagline — one line on desktop */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:gap-6">
              <Field label="Name" error={errors.name?.message} required>
                <Input
                  {...register("name")}
                  placeholder="e.g. Weight Loss"
                  disabled={submitting}
                  className={categoryInput}
                />
              </Field>
              <Field label="Slug" error={errors.slug?.message} required>
                <Input
                  {...register("slug")}
                  placeholder="e.g. weight-loss"
                  disabled={submitting}
                  className={categoryInput}
                />
              </Field>
              <Field label="Tagline" error={errors.tagline?.message}>
                <Input
                  {...register("tagline")}
                  placeholder="Short one-liner shown on the card"
                  disabled={submitting}
                  className={categoryInput}
                />
              </Field>
            </div>

            {/* Row 2: Category image — plain white */}
            <Field label="Category image" error={errors.image_url?.message}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
              {imageUrl ? (
                <div className="flex flex-wrap items-center gap-4 rounded-[14px] border border-[#E8EEED] bg-white p-3">
                  <img
                    src={imageUrl}
                    alt=""
                    className="h-20 w-20 rounded-[14px] object-cover border border-[#E8EEED]"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={submitting || uploading}
                      className="h-[45px] rounded-[14px] border-[#E8EEED] bg-white text-[#152A51] shadow-none hover:bg-[#F2F7F6]"
                    >
                      {uploading ? "Uploading…" : "Replace"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setConfirmRemoveImage(true)}
                      disabled={submitting || uploading}
                      className="h-[45px] rounded-[14px] text-destructive hover:bg-red-50"
                    >
                      <X className="mr-1 h-4 w-4" /> Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={submitting || uploading}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-[#E8EEED] bg-white p-8 text-[#3B4759]/60 transition-colors hover:bg-[#FAFAFA]"
                >
                  <Upload className="h-6 w-6" />
                  <span className="text-[14px] font-medium">
                    {uploading ? "Uploading…" : "Click to upload category image"}
                  </span>
                  <span className="text-[12px] text-[#3B4759]/50">JPG, PNG or WebP • max 5MB</span>
                </button>
              )}
            </Field>

            {/* Row 3: Sort order + Active */}
            <div className="grid items-end gap-5 sm:grid-cols-2 sm:gap-6">
              <Field label="Sort order" error={errors.sort_order?.message}>
                <Input
                  type="number"
                  min={0}
                  {...register("sort_order")}
                  disabled={submitting}
                  className={categoryInput}
                />
              </Field>
              <div className="space-y-2">
                <Label className={`${adminLabel} block text-[#152A51]`}>Active</Label>
                <div className={categoryToggleRow}>
                  <Controller
                    control={control}
                    name="is_active"
                    render={({ field }) => (
                      <div className="flex w-full items-center justify-between">
                        <Label
                          htmlFor="cat-active"
                          className="cursor-pointer select-none text-[14px] font-medium text-[#152A51]"
                        >
                          Active
                        </Label>
                        <Switch
                          id="cat-active"
                          checked={!!field.value}
                          onCheckedChange={field.onChange}
                          disabled={submitting}
                        />
                      </div>
                    )}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Add eligibility rules banner */}
        <div className="flex min-h-[90px] flex-col gap-4 rounded-[24px] border border-[#E8EEED] bg-[#E8EEED] p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[16px] font-medium text-[#152A51]">Add eligibility rules</p>
            <p className="mt-1 text-[13px] font-normal text-[#3B4759]/70">
              Restrict who can pick this category based on BMI, sex, age, or state.
            </p>
          </div>
          <Switch
            id="eligibility-toggle"
            checked={showEligibility}
            onCheckedChange={setShowEligibility}
            disabled={submitting}
          />
        </div>

        {/* Card 2 — Eligibility rules */}
        {showEligibility && (
          <Card className={categoryCard}>
            <CardContent className="space-y-5 p-4 sm:space-y-6 sm:p-6">
              <div className="space-y-1">
                <h2 className={cardSectionTitle}>Eligibility rules</h2>
                <p className="text-[13px] font-normal text-[#3B4759]/70">
                  Patients must match every enabled group. Leave a group empty to skip that check.
                </p>
              </div>

              {/* BMI bands — 4 options in one row on desktop, white boxes */}
              <Controller
                control={control}
                name="eligibility_rules.bmi_bands"
                render={({ field }) => (
                  <div className="space-y-2">
                    <Label className={`${adminLabel} block text-[#152A51]`}>BMI bands</Label>
                    <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
                      {BMI_BANDS.map((b) => {
                        const checked = (field.value ?? []).includes(b);
                        return (
                          <label key={b} className={categoryOptionWhite}>
                            <Checkbox
                              checked={checked}
                              className={categoryCheckbox}
                              onCheckedChange={(v) => {
                                const set = new Set(field.value ?? []);
                                if (v) set.add(b);
                                else set.delete(b);
                                field.onChange(Array.from(set));
                              }}
                            />
                            <span className="truncate">{BMI_BAND_LABELS[b]}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              />

              {/* Sex + Min/Max age — one row on desktop */}
              <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:gap-6">
                <Controller
                  control={control}
                  name="eligibility_rules.sex"
                  render={({ field }) => (
                    <div className="min-w-0 flex-1 space-y-2">
                      <Label className={`${adminLabel} block text-[#152A51]`}>Sex</Label>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {SEX_VALUES.map((s) => {
                          const checked = (field.value ?? []).includes(s);
                          return (
                            <label key={s} className={categoryOptionWhite}>
                              <Checkbox
                                checked={checked}
                                className={categoryCheckbox}
                                onCheckedChange={(v) => {
                                  const set = new Set(field.value ?? []);
                                  if (v) set.add(s);
                                  else set.delete(s);
                                  field.onChange(Array.from(set));
                                }}
                              />
                              <span className="truncate">{SEX_LABELS[s]}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                />

                <div className="grid shrink-0 grid-cols-1 gap-5 sm:grid-cols-2 xl:w-[280px]">
                  <Field label="Minimum age" error={errors.eligibility_rules?.min_age?.message}>
                    <Input
                      type="number"
                      min={0}
                      max={120}
                      {...register("eligibility_rules.min_age")}
                      disabled={submitting}
                      className={categoryInput}
                    />
                  </Field>
                  <Field label="Maximum age" error={errors.eligibility_rules?.max_age?.message}>
                    <Input
                      type="number"
                      min={0}
                      max={120}
                      {...register("eligibility_rules.max_age")}
                      disabled={submitting}
                      className={categoryInput}
                    />
                  </Field>
                </div>
              </div>

              <Controller
                control={control}
                name="eligibility_rules.blocked_state_codes"
                render={({ field }) => (
                  <div className="space-y-2 border-t border-[#E8EEED] pt-6">
                    <div className="space-y-1">
                      <Label className={`${adminLabel} block text-[#152A51]`}>Blocked states</Label>
                      <p className="text-[13px] font-normal text-[#3B4759]/70">
                        Patients in these states cannot select this category. Leave empty to allow
                        every state — unlike the groups above, this one excludes rather than
                        includes.
                      </p>
                    </div>
                    <StateMultiSelect
                      selected={(field.value ?? []) as string[]}
                      placeholder="Select a state to block"
                      triggerClassName={`${categoryInput} font-normal`}
                      onToggle={(s) => {
                        const set = new Set((field.value ?? []) as string[]);
                        if (set.has(s)) set.delete(s);
                        else set.add(s);
                        field.onChange(Array.from(set));
                      }}
                      onSetSelected={(states) => field.onChange(states)}
                    />
                  </div>
                )}
              />
            </CardContent>
          </Card>
        )}

        <FormActionBar
          submitting={submitting || uploading}
          submitLabel={mode === "create" ? "Create category" : "Save changes"}
          onCancel={onCancel}
          barClassName="sticky bottom-0 z-30 -mx-4 mt-4 flex flex-col-reverse gap-3 border-t border-[#E8EEED] bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80 sm:-mx-6 sm:flex-row sm:items-center sm:justify-end sm:px-6"
          secondaryClassName="h-[45px] w-full min-w-0 rounded-[14px] border border-[#E8EEED] bg-white px-6 text-[14px] font-medium text-[#152A51] shadow-none hover:bg-[#F2F7F6] sm:w-auto sm:min-w-[120px]"
          primaryClassName="h-[45px] w-full min-w-0 rounded-[14px] border border-[#E3E084]/40 bg-[#E3E084] px-6 text-[14px] font-semibold text-[#152A51] shadow-none hover:bg-[#D6D26A] sm:w-auto sm:min-w-[140px]"
        />
      </form>
      <ConfirmDeleteDialog
        open={confirmRemoveImage}
        title="Remove this image?"
        description="The category image will be cleared when you save."
        confirmLabel="Remove"
        onCancel={() => setConfirmRemoveImage(false)}
        onConfirm={() => {
          setValue("image_url", "", { shouldDirty: true });
          setConfirmRemoveImage(false);
        }}
      />
    </div>
  );
}
