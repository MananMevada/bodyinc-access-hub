/**
 * Shared admin UI class tokens — matched to Categories + Medicines Figma.
 * Prefer these (or the `.admin-*` CSS classes in styles.css) on every admin page.
 */

export const adminLabel =
  "admin-label text-[16px] font-medium text-[#3B4759] leading-[100%] tracking-normal";

export const adminInput =
  "admin-input h-[44px] sm:h-[53px] px-4 py-[14px] !rounded-[6px] border border-[#D5DEDD] bg-white text-[#3B4759] placeholder:text-[#3B4759]/40 focus-visible:ring-1 focus-visible:ring-[#3B4759] text-[16px] font-normal leading-[100%] tracking-normal shadow-none";

/** Red outline for a required field that was left blank or filled incorrectly. */
export const adminInputError =
  "!border-red-500 focus-visible:!border-red-500 focus-visible:!ring-red-400";

export const adminTextarea =
  "admin-textarea min-h-[80px] sm:min-h-[90px] px-4 py-[14px] !rounded-[6px] border border-[#D5DEDD] bg-white text-[#3B4759] placeholder:text-[#3B4759]/40 focus-visible:ring-1 focus-visible:ring-[#3B4759] text-[16px] font-normal leading-[140%] tracking-normal resize-none shadow-none";

export const adminSelect =
  "admin-select h-[44px] sm:h-[53px] w-full !rounded-[6px] border border-[#D5DEDD] bg-white px-4 text-[16px] font-normal leading-normal text-[#3B4759] shadow-none [&>span]:line-clamp-none [&>span]:overflow-visible";

export const adminSectionTitle =
  "admin-section-title text-[20px] font-semibold text-[#3B4759] leading-[100%] tracking-normal";

export const adminSectionSubtitle =
  "admin-section-subtitle text-[16px] font-normal text-[#3B4759]/80 leading-[100%] tracking-normal";

export const adminPageTitle =
  "admin-page-title text-[28px] sm:text-[32px] font-semibold text-[#3B4759] leading-[100%] tracking-normal";

export const adminPageSubtitle =
  "admin-page-subtitle text-[18px] sm:text-[20px] font-normal text-[#3B4759]/80 leading-[100%] tracking-normal";

export const adminCard =
  "admin-card w-full min-w-0 overflow-hidden rounded-xl border border-[#D5DEDD] bg-white shadow-none";

export const adminCardPad = "admin-card-pad p-4 sm:p-6";

export const adminBtnPrimary =
  "admin-btn-primary h-11 sm:h-[53px] rounded-[8px] bg-[#6A9B9C] hover:bg-[#5B8788] px-6 text-[14px] font-semibold text-white shadow-none";

export const adminBtnSecondary =
  "admin-btn-secondary h-11 sm:h-[53px] rounded-[8px] border border-[#D5DEDD] bg-white hover:bg-[#F2F7F6] px-6 text-[14px] font-semibold text-[#3B4759] shadow-none";

/** Same height and radius for Add / Edit / Delete sitting in a list row. */
const adminBtnCompactBase =
  "h-10 rounded-[8px] px-4 text-[14px] font-semibold leading-none shadow-none";

export const adminBtnCompactPrimary = `${adminBtnCompactBase} bg-[#6A9B9C] text-white hover:bg-[#5B8788]`;

export const adminBtnCompactSecondary = `${adminBtnCompactBase} border border-[#D5DEDD] bg-white text-[#3B4759] hover:bg-[#F2F7F6]`;

export const adminBtnCompactDanger = `${adminBtnCompactBase} border border-[#E7CFC3] bg-white text-[#8F4A33] hover:bg-[#FBF1EC]`;
