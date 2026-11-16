// Shared display formatters. These used to be copy-pasted (with subtle drift) into a
// dozen admin/practitioner screens; keep new call sites pointed here so money and dates
// render identically across the product.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Format a dollar amount. Nullish is treated as zero. */
export function formatDollars(value: number | string | null | undefined): string {
  return usd.format(Number(value ?? 0));
}

/** Format a dollar amount, rendering an em dash when there is no value at all. */
export function formatDollarsOrDash(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return usd.format(Number(value));
}

/** Format an integer cent amount (Stripe-style) as dollars. */
export function formatCents(cents: number | null | undefined): string {
  return usd.format(Number(cents ?? 0) / 100);
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
};

/** MM/DD/YYYY — calendar date only. */
export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", DATE_FORMAT);
}

/** MM/DD/YYYY, HH:MM AM/PM — compact date and time. */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    ...DATE_FORMAT,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** MM/DD/YYYY with full time, including seconds. */
export function formatDateTimeFull(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    ...DATE_FORMAT,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Whole years between a date of birth and today. */

/**
 * Patient Portal–compatible short ID: strip hyphens, uppercase, first 4 hex → "#BI-A1B2".
 * Display-only — full UUIDs remain in URLs and API calls.
 */
export function formatBiId(uuid: string): string {
  const compact = uuid.replace(/-/g, "").toUpperCase();
  return `#BI-${compact.slice(0, 4)}`;
}

/** Null-safe display wrapper around {@link formatBiId}. */
export function formatRecordId(id?: string | null): string {
  if (!id) return "—";
  return formatBiId(id);
}

/** Strip a "#BI-"/"BI-"/"#" prefix so users can paste a displayed ID into search. */
export function normalizeIdSearch(value: string): string {
  return value.trim().replace(/^#/, "").replace(/^BI-/i, "");
}

/**
 * Turn a hex ID fragment (e.g. "9a3f", from a displayed "#BI-9A3F") into an
 * inclusive uuid range so a database can match it with gte/lte — PostgREST
 * cannot run `ilike` against a uuid column.
 */
export function uuidPrefixRange(value: string): { lo: string; hi: string } | null {
  const hex = normalizeIdSearch(value).replace(/-/g, "").toLowerCase();
  if (!hex || hex.length > 32 || !/^[0-9a-f]+$/.test(hex)) return null;
  const pad = (fill: string) => {
    const full = (hex + fill.repeat(32)).slice(0, 32);
    return `${full.slice(0, 8)}-${full.slice(8, 12)}-${full.slice(12, 16)}-${full.slice(16, 20)}-${full.slice(20)}`;
  };
  return { lo: pad("0"), hi: pad("f") };
}

export function ageFromDob(dob: unknown): number | null {
  if (!dob) return null;
  const d = new Date(String(dob));
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

/** BMI to one decimal, or null when height/weight are missing. */
export function bmiFrom(heightCm: unknown, weightKg: unknown): number | null {
  const h = Number(heightCm ?? 0);
  const w = Number(weightKg ?? 0);
  if (!h || !w) return null;
  return Number((w / ((h / 100) * (h / 100))).toFixed(1));
}
