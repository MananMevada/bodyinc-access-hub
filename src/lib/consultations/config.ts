function env(name: string) {
  return (process.env[name] ?? "").trim();
}

export function getQuickbloxConfig() {
  let apiUrl = (env("QUICKBLOX_API_URL") || "https://api.quickblox.com").replace(/\/$/, "");
  if (apiUrl.includes("api-bodyinc.quickblox.com")) {
    apiUrl = "https://api.quickblox.com";
  }

  let providerAppUrl = (
    env("QUICKBLOX_PROVIDER_APP_URL") || "https://provider.quickblox.com"
  ).replace(/\/$/, "");
  if (providerAppUrl.includes("provider-bodyinc.quickblox.com")) {
    providerAppUrl = "https://provider.quickblox.com";
  }

  const providerEmail = env("QUICKBLOX_PROVIDER_EMAIL") || "admin@quickblox.com";
  const providerPassword = env("QUICKBLOX_PROVIDER_PASSWORD") || "Password2026";
  const apiKey = env("QUICKBLOX_API_KEY");
  const userSecret =
    env("QUICKBLOX_USER_SECRET") || "qwe12rty34uio56p5asd67fgh7jklz8xcv5bnm8";
  const providerIdRaw = env("QUICKBLOX_PROVIDER_ID") || "142814409";
  const providerId = providerIdRaw ? Number(providerIdRaw) : 142814409;

  const appIdRaw =
    env("QUICKBLOX_APP_ID") ||
    env("VITE_QUICKBLOX_APP_ID") ||
    "108471";
  const appId = Number(appIdRaw) || 108471;
  const authKey =
    env("QUICKBLOX_AUTH_KEY") ||
    env("VITE_QUICKBLOX_AUTH_KEY") ||
    "ak_xjJy9Tuv9jDgdEw";
  const authSecret =
    env("QUICKBLOX_AUTH_SECRET") ||
    env("VITE_QUICKBLOX_AUTH_SECRET") ||
    "as_S6-E5A6Dwz-T2qb";
  const accountKey =
    env("QUICKBLOX_ACCOUNT_KEY") ||
    env("VITE_QUICKBLOX_ACCOUNT_KEY") ||
    "ack_UzqY8uy_UqMnkY3wyMpQ";

  return {
    apiUrl,
    providerAppUrl,
    providerEmail,
    providerPassword,
    apiKey,
    userSecret,
    providerId: Number.isFinite(providerId) ? providerId : 142814409,
    appId,
    authKey,
    authSecret,
    accountKey,
  };
}

export function isQuickbloxConfigured() {
  const cfg = getQuickbloxConfig();
  const hasAppAuth = Boolean(cfg.appId && cfg.authKey && cfg.authSecret && cfg.accountKey);
  const hasProviderAuth = Boolean((cfg.providerEmail && cfg.providerPassword) || cfg.providerId);
  return Boolean(hasAppAuth && cfg.userSecret && hasProviderAuth);
}

export function canProvisionQuickbloxAgents() {
  return isQuickbloxConfigured() && Boolean(getQuickbloxConfig().userSecret);
}
