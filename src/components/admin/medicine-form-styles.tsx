import type { ReactNode } from "react";
import { RequiredMark } from "@/components/admin/required-mark";

const pageTitle =
  "text-[24px] font-medium leading-[37px] tracking-[-0.5px] text-[#152A51] sm:text-[28px]";

/** Product image: square frame, full product visible, bottom-anchored */
export function MedicineProductImage({
  src,
  alt = "",
  size = "form",
  className = "",
}: {
  src: string;
  alt?: string;
  size?: "form" | "preview" | "modal";
  className?: string;
}) {
  const frame =
    size === "preview"
      ? "h-[72px] w-[72px] rounded-[14px] px-1.5 pt-1.5"
      : size === "modal"
        ? "mx-auto h-[200px] w-[200px] rounded-[21px] px-3 pt-3"
        : "h-[201px] w-[200px] rounded-[21px] px-3 pt-3";

  return (
    <div
      className={`flex shrink-0 items-end justify-center overflow-hidden bg-[#E8EEED] ${frame} ${className}`.trim()}
    >
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full object-contain object-bottom"
        draggable={false}
      />
    </div>
  );
}

export function MedicineFormPageHeader({ mode }: { mode: "create" | "edit" }) {
  const heading = mode === "create" ? "Add medicine" : "Edit medicine";

  return (
    <div className="space-y-2 font-['DM_Sans']">
      <h1 className={pageTitle}>{heading}</h1>
      <p className="text-[15px] font-normal leading-snug text-[#3B4759]/70 sm:text-[16px]">
        Product image and details shown to patients.
      </p>
    </div>
  );
}

/** Figma input: 45px height, 14px radius, #E8EEED fill */
export const medicineInput =
  "h-[45px] w-full rounded-[14px] border border-[#E8EEED] bg-[#E8EEED] px-4 py-3 text-[16px] font-normal text-[#152A51] shadow-none placeholder:text-[#3B4759]/40 focus-visible:border-[#D5DEDD] focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-[#152A51]/15";

export const medicineTextarea =
  "min-h-[120px] w-full rounded-[14px] border border-[#E8EEED] bg-[#E8EEED] px-4 py-3 text-[16px] font-normal leading-[140%] text-[#152A51] shadow-none placeholder:text-[#3B4759]/40 focus-visible:border-[#D5DEDD] focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-[#152A51]/15 overflow-y-auto resize-y";

/** Short description: multi-line so longer copy is fully visible while editing */
export const medicineShortTextarea =
  "min-h-[72px] w-full rounded-[14px] border border-[#E8EEED] bg-[#E8EEED] px-4 py-3 text-[16px] font-normal leading-[140%] text-[#152A51] shadow-none placeholder:text-[#3B4759]/40 focus-visible:border-[#D5DEDD] focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-[#152A51]/15 overflow-y-auto resize-none";

export const medicineCard = "rounded-[24px] border border-[#E8EEED] bg-white shadow-none";

export const medicineCardTitle =
  "text-[22px] font-medium leading-[34px] tracking-[-0.3px] text-[#152A51]";

export const medicineOptionWhite =
  "flex h-[45px] min-w-0 cursor-pointer items-center gap-3 rounded-[14px] border border-[#E8EEED] bg-white px-3 text-[14px] font-medium text-[#152A51] transition-colors hover:bg-[#FAFAFA]";

export const medicineCheckbox =
  "h-4 w-4 shrink-0 rounded border-[#D5DEDD] data-[state=checked]:border-[#6A9B9C] data-[state=checked]:bg-[#6A9B9C]";

export const medicineToggleCard =
  "flex min-h-[45px] items-center gap-3 rounded-[14px] border border-[#E8EEED] bg-white px-4 py-3";

export function CardDivider() {
  return <div className="h-px w-full bg-[#E8EEED]" />;
}

export function MedicineField({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`min-w-0 space-y-2 ${
        error
          ? "[&_button[role=combobox]]:!border-red-500 [&_input]:!border-red-500 [&_textarea]:!border-red-500"
          : ""
      }`}
    >
      <label className="block text-[16px] font-medium text-[#152A51]">
        {label}
        {required ? <RequiredMark /> : null}
      </label>
      {children}
      {hint && !error ? (
        <p className="text-[12px] font-normal leading-snug text-[#3B4759]/70">{hint}</p>
      ) : null}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
