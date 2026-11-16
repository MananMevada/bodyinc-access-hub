import { toast } from "sonner";
import { capitalizeMessage } from "@/lib/text-normalize";

const FALLBACK = "Something went wrong. Please try again.";

const FIELD_LABELS: Record<string, string> = {
  practice_id: "Practice ID",
  api_username: "Username",
  api_password: "Password",
  pharmacy_id: "Pharmacy",
  api_base_url: "API URL",
  provider_life_file_id: "Provider LifeFile ID",
  npi: "NPI",
  full_name: "Full name",
  email: "Email",
  name: "Name",
  slug: "Slug",
  code: "Promo code",
  percent_off: "Percent off",
  amount_off_cents: "Amount off",
  short_description: "Short description",
  vendor_id: "Vendor ID",
  location_id: "Location ID",
  api_network_id: "API Network ID",
  prompt: "Question",
  medicine_a_id: "Medicine A",
  medicine_b_id: "Medicine B",
  phone: "Phone",
  zip: "ZIP code",
  postal_code: "ZIP code",
  dea: "DEA",
  duration_months: "Duration",
  original_price: "Original price",
  price: "Sale price",
  lf_product_id: "Life File product ID",
  street_address: "Street address",
  city: "City",
  state_code: "State",
  state: "State",
};

type IssueLike = {
  message?: unknown;
  path?: Array<string | number>;
  code?: string;
};

function fieldLabel(path?: Array<string | number>): string | null {
  if (!path?.length) return null;
  const key = [...path].reverse().find((part) => typeof part === "string");
  if (typeof key !== "string" || !key) return null;
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function sentence(value: string): string {
  const message = capitalizeMessage(value, FALLBACK);
  return /[.!?…]$/.test(message) ? message : `${message}.`;
}

/** Turn a Zod / database message into something a non-technical person can act on. */
function humanizeIssue(issue: IssueLike): string {
  const raw = typeof issue.message === "string" ? issue.message.trim() : "";
  const label = fieldLabel(issue.path);
  const lower = raw.toLowerCase();

  if (
    !raw ||
    lower === "required" ||
    lower === "invalid input" ||
    /string must contain at least 1 character/.test(lower) ||
    /expected string, received/.test(lower) ||
    /expected number, received nan/.test(lower)
  ) {
    return sentence(label ? `Please fill in ${label}` : "Please fill in all required fields");
  }

  if (/invalid uuid|invalid_type/.test(lower) && label) {
    return sentence(`Please choose a ${label}`);
  }
  if (/invalid email/.test(lower)) {
    return sentence("Please enter a valid email address");
  }
  if (/invalid url/.test(lower)) {
    return sentence(label ? `Please enter a valid ${label}` : "Please enter a valid web address");
  }
  if (/string must contain at most/.test(lower)) {
    return sentence(label ? `${label} is too long` : "That value is too long");
  }
  if (/number must be greater than 0|too small/.test(lower)) {
    return sentence(label ? `Please enter a ${label} greater than 0` : "Please enter a number greater than 0");
  }
  if (/expected number|received nan|invalid input syntax for type (integer|numeric)/.test(lower)) {
    return sentence(label ? `Please enter a valid number for ${label}` : "Please enter a valid number");
  }

  return sentence(raw);
}

function messagesFromParsed(parsed: unknown): string[] | null {
  if (Array.isArray(parsed)) {
    const messages = parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => humanizeIssue(item as IssueLike));
    return messages.length ? messages : null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as {
    issues?: unknown;
    message?: unknown;
    path?: Array<string | number>;
    fieldErrors?: Record<string, unknown>;
  };

  if (Array.isArray(obj.issues)) return messagesFromParsed(obj.issues);

  if (obj.fieldErrors && typeof obj.fieldErrors === "object") {
    const messages: string[] = [];
    for (const [key, value] of Object.entries(obj.fieldErrors)) {
      const list = Array.isArray(value) ? value : [value];
      for (const item of list) {
        if (typeof item === "string" && item.trim()) {
          messages.push(humanizeIssue({ message: item, path: [key] }));
        }
      }
    }
    return messages.length ? messages : null;
  }

  if (typeof obj.message === "string") {
    const nested = messagesFromUnknown(obj.message);
    if (nested?.length) return nested;
    if (obj.message.trim() && !obj.message.trim().startsWith("[") && !obj.message.trim().startsWith("{")) {
      return [humanizeIssue({ message: obj.message, path: obj.path })];
    }
  }

  return null;
}

function tryParseMessages(raw: string): string[] | null {
  try {
    return messagesFromParsed(JSON.parse(raw));
  } catch {
    return null;
  }
}

function messagesFromUnknown(raw: string): string[] | null {
  const trimmed = raw.trim();
  const direct = tryParseMessages(trimmed);
  if (direct?.length) return direct;

  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) {
    const sliced = tryParseMessages(trimmed.slice(start, end + 1));
    if (sliced?.length) return sliced;
  }
  return null;
}

function humanizeDatabase(raw: string): string | null {
  const nullColumn = raw.match(/null value in column "([^"]+)"/i);
  if (nullColumn) {
    const label = fieldLabel([nullColumn[1]]) ?? "that field";
    return sentence(`Please fill in ${label}`);
  }
  if (/duplicate key|unique constraint/i.test(raw)) {
    return sentence("That record already exists. Try a different value");
  }
  if (/invalid input syntax for type uuid/i.test(raw)) {
    return sentence("Please choose a valid option and try again");
  }
  if (/invalid input syntax for type (integer|numeric|bigint)/i.test(raw)) {
    return sentence("Please enter a valid number");
  }
  if (/foreign key|violates foreign key/i.test(raw)) {
    return sentence("This item is still used somewhere else, so it cannot be removed");
  }
  if (/permission denied|row-level security|jwt/i.test(raw)) {
    return sentence("You do not have permission to do that");
  }
  if (
    /column .* does not exist|could not find the .* column|schema cache/i.test(raw) &&
    /api_username|api_password|practice_id/i.test(raw)
  ) {
    return sentence(
      "LifeFile pharmacy logins are not ready yet. Apply the latest database update, then try again",
    );
  }
  return null;
}

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/** Normalize any thrown value into a capitalized, sentence-ended toast message. */
export function toastError(error: unknown, fallback = FALLBACK): string {
  if (error && typeof error === "object" && "issues" in error) {
    const fromIssues = messagesFromParsed(error);
    if (fromIssues?.length) return uniqueJoin(fromIssues);
  }

  const raw = rawMessage(error).trim();
  const fromJson = raw ? messagesFromUnknown(raw) : null;
  if (fromJson?.length) return uniqueJoin(fromJson);

  const fromDatabase = raw ? humanizeDatabase(raw) : null;
  if (fromDatabase) return fromDatabase;

  if (!raw || raw.startsWith("[") || raw.startsWith("{") || /at\s+\w+\s+\(/.test(raw)) {
    return fallback;
  }

  return sentence(raw);
}

function uniqueJoin(messages: string[]): string {
  const unique = [...new Set(messages.map((message) => message.trim()).filter(Boolean))];
  return unique.slice(0, 3).join(" ");
}

/** Shown when the clinical action succeeded but Brevo did not accept the patient email. */
export const PATIENT_EMAIL_NOT_SENT =
  "The patient email did not send. They can still pay or check status in the portal; the daily backup will retry.";

export function toastActionWithEmail(okMessage: string, _emailSent?: boolean): void {
  toast.success(okMessage);
}
