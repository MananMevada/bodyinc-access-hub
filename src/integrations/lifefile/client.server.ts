export type LifeFileConfig = {
  baseUrl: string;
  apiUsername: string;
  apiPassword: string;
  vendorId: string;
  locationId: string;
  apiNetworkId: string;
  practiceId: number;
};

function readEnv(name: string): string {
  // Bracket access so Vite does not replace this with `undefined` at bundle time.
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

/** Legacy single-account env config. Used only when no per-provider pharmacy credentials exist. */
export function getLegacyLifeFileConfig(): LifeFileConfig {
  const practiceId = Number(readEnv("LIFE_FILE_PRACTICE_ID"));
  if (!Number.isFinite(practiceId) || practiceId <= 0) {
    throw new Error("LIFE_FILE_PRACTICE_ID must be a positive number.");
  }
  return {
    baseUrl: readEnv("LIFE_FILE_API_BASE_URL"),
    apiUsername: readEnv("LIFE_FILE_API_USERNAME"),
    apiPassword: readEnv("LIFE_FILE_API_PASSWORD"),
    vendorId: readEnv("LIFE_FILE_VENDOR_ID"),
    locationId: readEnv("LIFE_FILE_LOCATION_ID"),
    apiNetworkId: readEnv("LIFE_FILE_API_NETWORK_ID"),
    practiceId,
  };
}

export function getPracticeId(): number {
  return getLegacyLifeFileConfig().practiceId;
}

/** LifeFile sometimes replies with a bounce. A normal follow-up turns a new-order send into a page read and LifeFile returns 405. Send the same way again instead. */
async function fetchLifeFile(url: string, init: RequestInit, redirectsLeft = 3): Promise<Response> {
  const response = await fetch(url, { ...init, redirect: "manual" });
  if (response.status < 300 || response.status >= 400 || redirectsLeft <= 0) return response;

  const location = response.headers.get("location");
  if (!location) return response;

  const nextUrl = new URL(location, url).toString();
  console.log("[Life File] Following bounce", { from: url, to: nextUrl, status: response.status });
  return fetchLifeFile(nextUrl, init, redirectsLeft - 1);
}

export async function lifeFileRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT";
    body?: unknown;
    config?: LifeFileConfig;
  } = {},
): Promise<T> {
  const config = options.config ?? getLegacyLifeFileConfig();
  const url = `${config.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;

  const auth = Buffer.from(`${config.apiUsername}:${config.apiPassword}`).toString("base64");
  const method = options.method ?? "GET";
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);

  console.log("[Life File] HTTP request", {
    method,
    url,
    username: config.apiUsername,
    passwordLength: config.apiPassword.length,
  });

  let response: Response;
  try {
    response = await fetchLifeFile(url, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Vendor-ID": config.vendorId,
        "X-Location-ID": config.locationId,
        "X-API-Network-ID": config.apiNetworkId,
      },
      body,
    });
  } catch (error) {
    const cause =
      error && typeof error === "object" && "cause" in error
        ? (error.cause as { code?: string; message?: string } | undefined)
        : undefined;
    const detail = cause?.code || cause?.message || (error as Error)?.message || "unknown error";
    throw new Error(
      `Could not reach Life File at ${url} (${detail}). If this is production, port 10165 may be blocked on this network.`,
    );
  }

  const text = await response.text();

  let payload: any;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Life File returned a non-JSON response (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Life File API error ${response.status}: ${payload?.message ?? text ?? "Unknown error"}`,
    );
  }

  if (payload?.type === "error") {
    throw new Error(payload.message ?? "Life File returned an error.");
  }

  return payload as T;
}
