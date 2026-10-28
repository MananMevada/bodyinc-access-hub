import { createHmac } from "node:crypto";
import { canProvisionQuickbloxAgents, getQuickbloxConfig } from "./config";

export type QbAppointment = {
  _id: string;
  client_id?: number;
  provider_id?: number;
  dialog_id?: string | null;
  description?: string;
  date_end?: string | null;
  created_at?: number;
  updated_at?: number;
  priority?: number;
};

export type QuickbloxProviderSession = {
  token: string;
  userId: number;
};

export type QbClientSession = {
  token: string;
  userId: number;
};

const SESSION_TTL_MS = 90 * 60 * 1000;
let ownerSessionCache: (QuickbloxProviderSession & { expiresAt: number }) | null = null;
const agentSessionCache = new Map<string, QuickbloxProviderSession & { expiresAt: number }>();
const clientSessionCache = new Map<string, QbClientSession & { expiresAt: number }>();

function sessionCacheKey(portalUserId: string, subscriptionId: string) {
  return `${portalUserId}:${subscriptionId}`;
}

export function qbPasswordForProvider(userId: string) {
  const { userSecret } = getQuickbloxConfig();
  if (!userSecret) throw new Error("QUICKBLOX_USER_SECRET is not configured.");
  const digest = createHmac("sha256", userSecret).update(`provider:${userId}`).digest("base64url");
  return `Bi.${digest.slice(0, 24)}!`;
}

function normalizeFullName(name: string, fallback = "Provider") {
  const trimmed = name.trim() || fallback;
  if (trimmed.length >= 3) return trimmed.slice(0, 60);
  return `${trimmed} ${fallback === "Provider" ? "MD" : "PT"}`.slice(0, 60);
}

export function qbPasswordForPlan(userId: string, subscriptionId: string) {
  const { userSecret } = getQuickbloxConfig();
  if (!userSecret) throw new Error("QUICKBLOX_USER_SECRET is not configured.");
  const digest = createHmac("sha256", userSecret)
    .update(`${userId}:${subscriptionId}`)
    .digest("base64url");
  return `Bi.${digest.slice(0, 24)}!`;
}

export function qbClientEmail(userId: string, subscriptionId: string) {
  const { userSecret } = getQuickbloxConfig();
  if (!userSecret) throw new Error("QUICKBLOX_USER_SECRET is not configured.");
  const digest = createHmac("sha256", userSecret)
    .update(`${userId}:${subscriptionId}`)
    .digest("hex")
    .slice(0, 20);
  return `qb.${digest}@patients.bodyinc.com`;
}

export function qbClientLogin(userId: string, subscriptionId: string) {
  const { userSecret } = getQuickbloxConfig();
  const digest = createHmac("sha256", userSecret)
    .update(`${userId}:${subscriptionId}`)
    .digest("hex")
    .slice(0, 16);
  return `pt_${digest}`;
}

/**
 * Creates an application or user session via direct QuickBlox REST API (POST /session.json).
 * This uses HMAC-SHA1 signature and avoids importing client SDKs on the server.
 */
export async function createQbRestSession(userCreds?: { email?: string; password?: string }): Promise<{
  token: string;
  userId?: number;
}> {
  const cfg = getQuickbloxConfig();
  const nonce = Math.floor(Math.random() * 1000000000);
  const timestamp = Math.floor(Date.now() / 1000);

  const message: Record<string, unknown> = {
    application_id: cfg.appId,
    auth_key: cfg.authKey,
    nonce,
    timestamp,
  };

  if (userCreds?.email && userCreds?.password) {
    message.user = { email: userCreds.email, password: userCreds.password };
  }

  const sortedParams = Object.keys(message)
    .map((key) => {
      const val = message[key];
      if (typeof val === "object" && val !== null) {
        const sub = val as Record<string, string>;
        return Object.keys(sub)
          .map((subKey) => `${key}[${subKey}]=${sub[subKey]}`)
          .sort()
          .join("&");
      }
      return `${key}=${val}`;
    })
    .sort()
    .join("&");

  const signature = createHmac("sha1", cfg.authSecret).update(sortedParams).digest("hex");
  message.signature = signature;

  const res = await fetch(`${cfg.apiUrl}/session.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "QuickBlox-REST-API-Version": "0.1.1",
    },
    body: JSON.stringify(message),
    cache: "no-store",
  });

  const json = (await res.json()) as {
    session?: { token: string; user_id?: number };
    errors?: unknown;
  };

  if (!res.ok || !json?.session?.token) {
    const errorMsg = Array.isArray(json?.errors)
      ? json.errors.join(", ")
      : typeof json?.errors === "object"
        ? JSON.stringify(json.errors)
        : res.statusText;
    throw new Error(`QuickBlox session failed: ${errorMsg}`);
  }

  return {
    token: json.session.token,
    userId: json.session.user_id ? Number(json.session.user_id) : undefined,
  };
}

/**
 * Registers a user in QuickBlox via native REST API (POST /users.json).
 */
export async function createQbRestUser(params: {
  appToken: string;
  login: string;
  email: string;
  password: string;
  fullName: string;
  tags?: string;
}): Promise<number | null> {
  const cfg = getQuickbloxConfig();
  try {
    const res = await fetch(`${cfg.apiUrl}/users.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "QB-Token": params.appToken,
      },
      body: JSON.stringify({
        user: {
          login: params.login,
          email: params.email,
          password: params.password,
          full_name: params.fullName || "User",
          tag_list: params.tags || "consultation",
        },
      }),
      cache: "no-store",
    });

    const json = (await res.json()) as { user?: { id: number }; errors?: unknown };
    if (res.status === 201 && json?.user?.id) {
      return json.user.id;
    }
  } catch (err) {
    console.warn("[consultations] createQbRestUser notice:", err);
  }
  return null;
}

export async function getOwnerProviderAuth(): Promise<QuickbloxProviderSession> {
  const cfg = getQuickbloxConfig();
  const now = Date.now();
  if (ownerSessionCache && ownerSessionCache.token && ownerSessionCache.expiresAt > now) {
    return ownerSessionCache;
  }

  const session = await createQbRestSession({
    email: cfg.providerEmail,
    password: cfg.providerPassword,
  });

  ownerSessionCache = {
    token: session.token,
    userId: session.userId ?? cfg.providerId ?? 142814409,
    expiresAt: now + SESSION_TTL_MS,
  };
  return ownerSessionCache;
}

/** @deprecated use getOwnerProviderAuth */
export async function getProviderAuth() {
  return getOwnerProviderAuth();
}

function cacheAgentSession(email: string, session: QuickbloxProviderSession) {
  agentSessionCache.set(email, { ...session, expiresAt: Date.now() + SESSION_TTL_MS });
}

export async function loginQuickbloxProviderAgent(params: { email: string; userId: string }) {
  const email = params.email.trim().toLowerCase();
  const cfg = getQuickbloxConfig();

  // If this email is clinic owner/admin, use owner credentials directly
  if (cfg.providerEmail && email === cfg.providerEmail.trim().toLowerCase()) {
    return getOwnerProviderAuth();
  }

  const cached = agentSessionCache.get(email);
  if (cached && cached.token && cached.expiresAt > Date.now()) {
    return { token: cached.token, userId: cached.userId };
  }

  const password = qbPasswordForProvider(params.userId);
  try {
    const userSession = await createQbRestSession({ email, password });
    if (userSession.token && userSession.userId) {
      const sess = { token: userSession.token, userId: userSession.userId };
      cacheAgentSession(email, sess);
      return sess;
    }
  } catch (err) {
    console.warn("[consultations] provider login failed, using clinic admin session:", err);
  }

  return getOwnerProviderAuth();
}

export async function ensureQuickbloxProviderAgent(params: {
  userId: string;
  email: string;
  fullName: string;
  profession?: string | null;
  phone?: string | null;
  language?: string | null;
}): Promise<{ userId: number; created: boolean }> {
  if (!canProvisionQuickbloxAgents()) {
    throw new Error("QuickBlox agent provisioning is not configured.");
  }

  const email = params.email.trim().toLowerCase();
  const cfg = getQuickbloxConfig();

  // 1. If clinic owner, return owner session
  if (cfg.providerEmail && email === cfg.providerEmail.trim().toLowerCase()) {
    const owner = await getOwnerProviderAuth();
    return { userId: owner.userId, created: false };
  }

  // 2. Check memory cache
  const cached = agentSessionCache.get(email);
  if (cached && cached.token && cached.expiresAt > Date.now()) {
    return { userId: cached.userId, created: false };
  }

  const password = qbPasswordForProvider(params.userId);
  const fullName = normalizeFullName(params.fullName);

  // 3. Try login first
  try {
    const userSession = await createQbRestSession({ email, password });
    if (userSession.token && userSession.userId) {
      cacheAgentSession(email, { token: userSession.token, userId: userSession.userId });
      return { userId: userSession.userId, created: false };
    }
  } catch {
    // User does not exist yet
  }

  // 4. Register provider user
  try {
    const appSession = await createQbRestSession();
    const login = `dr_${createHmac("sha256", cfg.userSecret).update(params.userId).digest("hex").slice(0, 16)}`;
    const createdId = await createQbRestUser({
      appToken: appSession.token,
      login,
      email,
      password,
      fullName,
      tags: "provider, doctor",
    });

    if (createdId) {
      const finalSession = await createQbRestSession({ email, password });
      if (finalSession.token && finalSession.userId) {
        cacheAgentSession(email, { token: finalSession.token, userId: finalSession.userId });
        return { userId: finalSession.userId, created: true };
      }
    }
  } catch (err) {
    console.warn("[consultations] ensureQuickbloxProviderAgent error:", err);
  }

  const owner = await getOwnerProviderAuth();
  return { userId: owner.userId, created: false };
}

export async function addProviderToDialogOccupants(params: {
  dialogId: string;
  qbProviderId: number;
}): Promise<boolean> {
  if (!params.dialogId || !params.qbProviderId) return false;
  const cfg = getQuickbloxConfig();
  try {
    const owner = await getOwnerProviderAuth();
    const res = await fetch(`${cfg.apiUrl}/chat/Dialog/${params.dialogId}.json`, {
      method: "PUT",
      headers: {
        "QB-Token": owner.token,
        "Content-Type": "application/json",
        "QuickBlox-REST-API-Version": "0.1.1",
      },
      body: JSON.stringify({
        push_all: {
          occupants_ids: [params.qbProviderId],
        },
      }),
      cache: "no-store",
    });

    if (res.ok) return true;
    const text = await res.text();
    // QuickBlox returns 400 with "Users are already present in occupants_ids" if already added
    if (/already present/i.test(text)) return true;
    console.warn("[consultations] addProviderToDialogOccupants failed:", res.status, text);
    return false;
  } catch (error) {
    console.warn("[consultations] addProviderToDialogOccupants exception:", error);
    return false;
  }
}

export async function ensureDialogOccupants(params: {
  dialogId: string;
  occupantsIds: number[];
}): Promise<boolean> {
  if (!params.dialogId || !params.occupantsIds.length) return false;
  const cfg = getQuickbloxConfig();
  try {
    const owner = await getOwnerProviderAuth();
    const res = await fetch(`${cfg.apiUrl}/chat/Dialog/${params.dialogId}.json`, {
      method: "PUT",
      headers: {
        "QB-Token": owner.token,
        "Content-Type": "application/json",
        "QuickBlox-REST-API-Version": "0.1.1",
      },
      body: JSON.stringify({
        push_all: {
          occupants_ids: params.occupantsIds,
        },
      }),
      cache: "no-store",
    });
    if (res.ok) return true;
    const text = await res.text();
    if (/already present/i.test(text)) return true;
    return false;
  } catch (error) {
    console.warn("[consultations] ensureDialogOccupants exception:", error);
    return false;
  }
}

export async function sendChatMessageToDialog(params: {
  dialogId: string;
  message: string;
}): Promise<boolean> {
  if (!params.dialogId || !params.message) return false;
  const cfg = getQuickbloxConfig();
  try {
    const owner = await getOwnerProviderAuth();
    const res = await fetch(`${cfg.apiUrl}/chat/Message.json`, {
      method: "POST",
      headers: {
        "QB-Token": owner.token,
        "Content-Type": "application/json",
        "QuickBlox-REST-API-Version": "0.1.1",
      },
      body: JSON.stringify({
        chat_dialog_id: params.dialogId,
        message: params.message,
        send_to_chat: 1,
      }),
      cache: "no-store",
    });
    return res.ok;
  } catch (error) {
    console.warn("[consultations] sendChatMessageToDialog exception:", error);
    return false;
  }
}

export async function reassignAppointmentToProvider(params: {
  appointmentId: string;
  qbProviderId: number;
  currentProviderToken?: string;
  dialogId?: string | null;
}): Promise<{ dialogId: string | null }> {
  const dialogId = params.dialogId || params.appointmentId;
  if (dialogId && params.qbProviderId) {
    try {
      await addProviderToDialogOccupants({
        dialogId,
        qbProviderId: params.qbProviderId,
      });
    } catch {}
  }
  return { dialogId: dialogId ?? null };
}

export async function claimAppointmentForSession(params: {
  appointmentId: string;
  qbProviderId: number;
  token: string;
  dialogId?: string | null;
}): Promise<{ dialogId: string | null }> {
  const dialogId = params.dialogId || params.appointmentId;
  if (dialogId && params.qbProviderId) {
    try {
      await addProviderToDialogOccupants({
        dialogId,
        qbProviderId: params.qbProviderId,
      });
    } catch (err) {
      console.warn("[consultations] claimAppointmentForSession notice:", err);
    }
  }
  return { dialogId: dialogId ?? null };
}

export async function endQuickbloxAppointment(params: {
  appointmentId: string;
  token?: string;
  qbProviderId?: number;
  conclusion?: string;
  language?: string;
}) {
  const conclusion = params.conclusion?.trim() || "Consultation completed";
  try {
    await sendChatMessageToDialog({
      dialogId: params.appointmentId,
      message: `[System]: ${conclusion}`,
    });
  } catch {
    // Non-fatal
  }
}

export function isAppointmentOpen(appointment: QbAppointment) {
  return appointment.date_end == null || appointment.date_end === "";
}

export async function listProviderAppointments(token?: string): Promise<QbAppointment[]> {
  const cfg = getQuickbloxConfig();
  let authToken = token;
  if (!authToken) {
    try {
      const owner = await getOwnerProviderAuth();
      authToken = owner.token;
    } catch {
      return [];
    }
  }

  try {
    const res = await fetch(`${cfg.apiUrl}/chat/Dialog.json?limit=100`, {
      headers: { "QB-Token": authToken },
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as { items?: any[] };
      const providerId = cfg.providerId || 142814409;
      return (json.items ?? []).map((d) => ({
        _id: d._id,
        dialog_id: d._id,
        client_id: d.occupants_ids?.find((id: number) => id !== providerId) || d.user_id,
        provider_id: providerId,
        description: d.name,
        created_at: d.created_at ? Math.floor(new Date(d.created_at).getTime() / 1000) : undefined,
        updated_at: d.updated_at ? Math.floor(new Date(d.updated_at).getTime() / 1000) : undefined,
        date_end: null,
      }));
    }
  } catch (err) {
    console.warn("[consultations] listProviderAppointments error:", err);
  }
  return [];
}

export async function listAllAppointments() {
  return listProviderAppointments();
}

export async function getAppointmentById(appointmentId: string, token?: string): Promise<QbAppointment | null> {
  if (!appointmentId) return null;
  const cfg = getQuickbloxConfig();
  let authToken = token;
  if (!authToken) {
    try {
      const owner = await getOwnerProviderAuth();
      authToken = owner.token;
    } catch {
      // fallback
    }
  }

  if (authToken) {
    try {
      const res = await fetch(`${cfg.apiUrl}/chat/Dialog/${appointmentId}.json`, {
        headers: { "QB-Token": authToken },
        cache: "no-store",
      });
      if (res.ok) {
        const dialog = (await res.json()) as any;
        const providerId = cfg.providerId || 142814409;
        const clientId =
          dialog.occupants_ids?.find((id: number) => id !== providerId) || dialog.user_id;
        return {
          _id: dialog._id,
          dialog_id: dialog._id,
          client_id: clientId,
          provider_id: providerId,
          description: dialog.name,
          created_at: dialog.created_at
            ? Math.floor(new Date(dialog.created_at).getTime() / 1000)
            : undefined,
          updated_at: dialog.updated_at
            ? Math.floor(new Date(dialog.updated_at).getTime() / 1000)
            : undefined,
          date_end: null,
        };
      }
    } catch (err) {
      console.warn("[consultations] getAppointmentById error:", err);
    }
  }

  return {
    _id: appointmentId,
    dialog_id: appointmentId,
    client_id: undefined,
    provider_id: cfg.providerId ?? 142814409,
    description: "Medical Consultation",
    date_end: null,
  };
}

export function buildProviderAppointmentUrl(params: { token: string; appointmentId: string }) {
  const { providerAppUrl } = getQuickbloxConfig();
  const url = new URL(`${providerAppUrl}/appointment/${params.appointmentId}`);
  url.searchParams.set("token", params.token);
  return url.toString();
}

export function buildProviderInboxUrl(token: string) {
  const { providerAppUrl } = getQuickbloxConfig();
  const url = new URL(providerAppUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

/** Same HMAC identity the patient portal uses, so patient and doctor join the exact same visit. */
export async function ensurePatientQuickbloxClient(params: {
  userId: string;
  subscriptionId: string;
  fullName: string;
  dob: string;
  sex: string | null;
}): Promise<{ token: string; userId: number }> {
  const email = qbClientEmail(params.userId, params.subscriptionId);
  const password = qbPasswordForPlan(params.userId, params.subscriptionId);
  const login = qbClientLogin(params.userId, params.subscriptionId);

  const cacheKey = sessionCacheKey(params.userId, params.subscriptionId);
  const cached = clientSessionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { token: cached.token, userId: cached.userId };
  }

  // 1. Try direct login with patient credentials
  try {
    const userSession = await createQbRestSession({ email, password });
    if (userSession.token && userSession.userId) {
      clientSessionCache.set(cacheKey, {
        token: userSession.token,
        userId: userSession.userId,
        expiresAt: Date.now() + SESSION_TTL_MS,
      });
      return { token: userSession.token, userId: userSession.userId };
    }
  } catch {
    // User does not exist yet; register in QuickBlox
  }

  // 2. Create app session to register patient
  const appSession = await createQbRestSession();

  // 3. Register user
  await createQbRestUser({
    appToken: appSession.token,
    login,
    email,
    password,
    fullName: params.fullName || "Patient",
    tags: "patient, client",
  });

  // 4. Log in as patient
  const finalSession = await createQbRestSession({ email, password });
  if (!finalSession.token || !finalSession.userId) {
    throw new Error("QuickBlox patient user session creation failed.");
  }

  clientSessionCache.set(cacheKey, {
    token: finalSession.token,
    userId: finalSession.userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  return {
    token: finalSession.token,
    userId: finalSession.userId,
  };
}

export async function createPatientAppointment(params: {
  clientId: number;
  providerId: number;
  providerToken: string;
  description: string;
}): Promise<QbAppointment> {
  const cfg = getQuickbloxConfig();
  const occupants = [params.clientId];
  if (params.providerId && !occupants.includes(params.providerId)) {
    occupants.push(params.providerId);
  }

  const res = await fetch(`${cfg.apiUrl}/chat/Dialog.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "QB-Token": params.providerToken,
    },
    body: JSON.stringify({
      type: 2, // Group chat for WebRTC & chat
      name: params.description || "Medical Consultation",
      occupants_ids: occupants,
    }),
    cache: "no-store",
  });

  const json = (await res.json()) as { _id?: string; xmpp_room_jid?: string; errors?: unknown };
  if (!res.ok || !json?._id) {
    const errorMsg = Array.isArray(json?.errors)
      ? json.errors.join(", ")
      : typeof json?.errors === "object"
        ? JSON.stringify(json.errors)
        : res.statusText;
    throw new Error(`QuickBlox dialog creation failed: ${errorMsg}`);
  }

  return {
    _id: json._id,
    dialog_id: json._id,
    client_id: params.clientId,
    provider_id: params.providerId,
    description: params.description,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    date_end: null,
  };
}

export async function fetchQuickbloxUserName(userId: number): Promise<string | null> {
  if (!userId || userId <= 0) return null;
  if (userId === 142814409) return "Admin";

  const cfg = getQuickbloxConfig();
  try {
    const adminSession = await getOwnerProviderAuth();
    const res = await fetch(`${cfg.apiUrl}/users/${userId}.json`, {
      method: "GET",
      headers: {
        "QB-Token": adminSession.token,
      },
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as { user?: { full_name?: string } };
      if (json.user?.full_name?.trim()) {
        return json.user.full_name.trim();
      }
    }
  } catch {
    // Non-fatal
  }

  return userId === cfg.providerId ? "Provider" : "Healthcare Provider";
}
