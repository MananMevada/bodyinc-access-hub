import { FormActionBar } from "@/components/admin/form-action-bar";
import { FieldError, RequiredMark } from "@/components/admin/required-mark";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  adminLabel,
  adminInput,
  adminInputError,
  adminSelect,
  adminSectionTitle,
  adminSectionSubtitle,
  adminCard,
  adminBtnPrimary,
  adminBtnSecondary,
} from "@/lib/admin-ui";

export type PromoFormValues = {
  code: string;
  discount_type: "percent" | "amount";
  percent_off: number;
  amount_off: number;
  is_active: boolean;
  auto_apply: boolean;
  max_redemptions: string;
  redeem_by: string;
};

const EMPTY: PromoFormValues = {
  code: "",
  discount_type: "amount",
  percent_off: 10,
  amount_off: 20,
  is_active: true,
  auto_apply: false,
  max_redemptions: "",
  redeem_by: "",
};

const fieldShell = "min-w-0 w-full";
const inputFull = `${adminInput} w-full min-w-0 max-w-full`;
const selectFull = `${adminSelect} w-full min-w-0 max-w-full`;

export function PromoForm({
  mode,
  defaultValues,
  submitting,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  defaultValues?: Partial<PromoFormValues>;
  submitting?: boolean;
  onSubmit: (values: PromoFormValues) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<PromoFormValues>({ ...EMPTY, ...defaultValues });
  const [errors, setErrors] = useState<Partial<Record<"code" | "discount", string>>>({});
  const set = (patch: Partial<PromoFormValues>) => setV((p) => ({ ...p, ...patch }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const next: Partial<Record<"code" | "discount", string>> = {};
        if (!v.code.trim()) next.code = "Please enter a promo code.";
        else if (!/^[A-Za-z0-9_-]+$/.test(v.code.trim())) {
          next.code = "Use only letters, numbers, dashes, and underscores.";
        }
        if (v.discount_type === "amount" && !(Number(v.amount_off) > 0)) {
          next.discount = "Please enter an amount greater than 0.";
        }
        if (
          v.discount_type === "percent" &&
          !(Number(v.percent_off) > 0 && Number(v.percent_off) <= 100)
        ) {
          next.discount = "Please enter a percent between 1 and 100.";
        }
        setErrors(next);
        if (Object.keys(next).length) return;
        onSubmit(v);
      }}
      className="m-0 w-full min-w-0 max-w-full space-y-5 overflow-x-hidden p-0 font-['DM_Sans',sans-serif] sm:space-y-6"
      noValidate
    >
      <Card className={`${adminCard} w-full min-w-0 max-w-full`}>
        <CardHeader className="space-y-2 p-4 sm:p-6">
          <CardTitle className={`${adminSectionTitle} break-words`}>
            {mode === "create" ? "New promo code" : "Edit promo code"}
          </CardTitle>
          <CardDescription className={`${adminSectionSubtitle} break-words`}>
            Discount applied at checkout. Auto-apply promos are the first-time welcome discount
            applied automatically during onboarding.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 p-4 pt-0 sm:space-y-6 sm:p-6 sm:pt-0">
          <Field label="Code" required error={errors.code}>
            <Input
              value={v.code}
              onChange={(e) => {
                set({ code: e.target.value.toUpperCase() });
                setErrors((prev) => ({ ...prev, code: undefined }));
              }}
              placeholder="e.g. WELCOME20"
              disabled={submitting}
              className={`${inputFull} ${errors.code ? adminInputError : ""}`}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
            <Field label="Discount type" required>
              <Select
                value={v.discount_type}
                onValueChange={(x) => set({ discount_type: x as PromoFormValues["discount_type"] })}
                disabled={submitting}
              >
                <SelectTrigger className={selectFull}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[6px] border-[#D5DEDD]">
                  <SelectItem value="amount" className="text-[#3B4759]">
                    Fixed amount ($)
                  </SelectItem>
                  <SelectItem value="percent" className="text-[#3B4759]">
                    Percent (%)
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {v.discount_type === "amount" ? (
              <Field label="Amount off ($)" required error={errors.discount}>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={v.amount_off}
                  onChange={(e) => {
                    set({ amount_off: Number(e.target.value) });
                    setErrors((prev) => ({ ...prev, discount: undefined }));
                  }}
                  disabled={submitting}
                  className={`${inputFull} ${errors.discount ? adminInputError : ""}`}
                />
              </Field>
            ) : (
              <Field label="Percent off (%)" required error={errors.discount}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={v.percent_off}
                  onChange={(e) => {
                    set({ percent_off: Number(e.target.value) });
                    setErrors((prev) => ({ ...prev, discount: undefined }));
                  }}
                  disabled={submitting}
                  className={`${inputFull} ${errors.discount ? adminInputError : ""}`}
                />
              </Field>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
            <Field label="Max redemptions (blank = unlimited)">
              <Input
                type="number"
                min={1}
                value={v.max_redemptions}
                onChange={(e) => set({ max_redemptions: e.target.value })}
                disabled={submitting}
                className={inputFull}
              />
            </Field>
            <Field label="Expires on (blank = never)">
              <Input
                type="date"
                value={v.redeem_by}
                onChange={(e) => set({ redeem_by: e.target.value })}
                disabled={submitting}
                className={inputFull}
              />
            </Field>
          </div>

          <Toggle
            label="Active"
            desc="Available at checkout."
            checked={v.is_active}
            onChange={(x) => set({ is_active: x })}
          />
          <Toggle
            label="Auto-apply (welcome / first-time)"
            desc="Applied automatically during onboarding without the patient entering a code."
            checked={v.auto_apply}
            onChange={(x) => set({ auto_apply: x })}
          />
        </CardContent>
      </Card>

      <FormActionBar
        submitting={submitting}
        submitLabel={mode === "create" ? "Create promo" : "Save changes"}
        onCancel={onCancel}
      />
    </form>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={`${fieldShell} space-y-2`}>
      <Label className={`${adminLabel} break-words`}>
        {label}
        {required ? <RequiredMark /> : null}
      </Label>
      {children}
      <FieldError message={error} />
    </div>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[10px] border border-[#D5DEDD] bg-[#F8FBFA] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="break-words text-[16px] font-medium text-[#3B4759]">{label}</p>
        <p className="mt-1 break-words text-[13px] font-normal text-[#3B4759]/80 sm:text-[14px]">
          {desc}
        </p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        className="shrink-0 self-start data-[state=checked]:bg-[#6A9B9C] sm:self-auto"
      />
    </div>
  );
}
