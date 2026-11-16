import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PushItem = {
  orderId?: string;
  orderReferenceId?: string;
  referenceId?: string;
  foreignRxNumber?: string;
  trackingNumber?: string;
  shipCarrier?: string;
  rxStatus?: string;
  rxNumber?: string;
};

type RequestRow = {
  id: string;
  status: string;
  user_id: string | null;
  medicine_id: string | null;
  tracking_number: string | null;
};

export type DataPushResult = {
  received: number;
  updated: number;
  duplicates: number;
  ignored: number;
};

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function readBasicAuth(header: string | null): { username: string; password: string } | null {
  if (!header || !header.toLowerCase().startsWith("basic ")) return null;
  let decoded = "";
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return null;
  }
  const splitAt = decoded.indexOf(":");
  if (splitAt < 0) return null;
  return { username: decoded.slice(0, splitAt), password: decoded.slice(splitAt + 1) };
}

export function dataPushAuthFailure(header: string | null): "missing-config" | "unauthorized" | null {
  const username = process.env.LIFEFILE_DATA_PUSH_USERNAME?.trim() ?? "";
  const password = process.env.LIFEFILE_DATA_PUSH_PASSWORD?.trim() ?? "";
  if (!username || !password) return "missing-config";
  const parsed = readBasicAuth(header);
  if (!parsed || !safeEqual(parsed.username, username) || !safeEqual(parsed.password, password)) {
    return "unauthorized";
  }
  return null;
}

function trackingFrom(row: Record<string, unknown>): string {
  const direct = [
    row.trackingNumber,
    row.tracking_number,
    row.tracking,
    row.TrackingNumber,
    row.shipTrackingNumber,
  ];
  for (const value of direct) {
    const parsed = text(value);
    if (parsed) return parsed;
  }
  const shipping = row.shipping;
  if (shipping && typeof shipping === "object" && !Array.isArray(shipping)) {
    return trackingFrom(shipping as Record<string, unknown>);
  }
  return "";
}

function asItem(value: unknown): PushItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return {
    orderId: text(row.orderId),
    orderReferenceId: text(row.orderReferenceId),
    referenceId: text(row.referenceId),
    foreignRxNumber: text(row.foreignRxNumber),
    trackingNumber: trackingFrom(row),
    shipCarrier: text(row.shipCarrier),
    rxStatus: text(row.rxStatus),
    rxNumber: text(row.rxNumber),
  };
}

export function parseDataPushBody(body: unknown): PushItem[] {
  const rows = Array.isArray(body) ? body : [body];
  return rows.map(asItem).filter((item): item is PushItem => item != null);
}

function classify(item: PushItem, triggerName: string | null): "shipped" | "delivered" | "other" {
  const label = `${item.rxStatus ?? ""} ${triggerName ?? ""}`.toLowerCase();
  if (label.includes("deliver")) return "delivered";
  if (label.includes("ship") || item.trackingNumber) return "shipped";
  return "other";
}

function nextStatus(current: string, incoming: "shipped" | "delivered" | "other"): string | null {
  if (current === "cancelled" || current === "rejected") return null;
  if (incoming === "delivered") return current === "delivered" ? null : "delivered";
  if (incoming === "shipped") {
    if (current === "delivered" || current === "dispatched") return null;
    return "dispatched";
  }
  return null;
}

async function findRequest(
  supabaseAdmin: SupabaseClient,
  item: PushItem,
): Promise<RequestRow | null> {
  const reference = item.orderReferenceId || item.referenceId || "";
  const foreign = item.foreignRxNumber || "";
  const ids = [reference, foreign].filter((value) => UUID_RE.test(value));
  for (const id of ids) {
    const { data, error } = await supabaseAdmin
      .from("medication_requests")
      .select("id, status, user_id, medicine_id, tracking_number")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as RequestRow;
  }

  if (!item.orderId) return null;
  const { data, error } = await supabaseAdmin
    .from("medication_requests")
    .select("id, status, user_id, medicine_id, tracking_number")
    .eq("life_file_order_id", item.orderId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return (row as RequestRow | undefined) ?? null;
}

async function alreadyProcessed(
  supabaseAdmin: SupabaseClient,
  requestId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("medication_request_events")
    .select("id")
    .eq("request_id", requestId)
    .ilike("note", `%push:${idempotencyKey}%`)
    .limit(1);
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}

export async function applyLifeFileDataPush(
  supabaseAdmin: SupabaseClient,
  items: PushItem[],
  meta: { idempotencyKey: string | null; triggerName: string | null },
): Promise<DataPushResult> {
  const result: DataPushResult = { received: items.length, updated: 0, duplicates: 0, ignored: 0 };

  for (const [index, item] of items.entries()) {
    const request = await findRequest(supabaseAdmin, item);
    if (!request) {
      console.warn("[lifefile-push] no matching order", {
        orderId: item.orderId,
        orderReferenceId: item.orderReferenceId || item.referenceId,
        foreignRxNumber: item.foreignRxNumber,
      });
      result.ignored += 1;
      continue;
    }

    if (item.orderId) {
      await supabaseAdmin
        .from("medication_requests")
        .update({
          life_file_order_id: item.orderId,
          life_file_status: "submitted",
          life_file_error: null,
          life_file_submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.id)
        .is("life_file_order_id", null);
    }

    const tracking = item.trackingNumber || null;
    const trackingChanged = Boolean(tracking && tracking !== request.tracking_number);
    if (trackingChanged && tracking) {
      const { error } = await supabaseAdmin
        .from("medication_requests")
        .update({ tracking_number: tracking, updated_at: new Date().toISOString() })
        .eq("id", request.id);
      if (error) throw new Error(error.message);
      request.tracking_number = tracking;
    }

    const pushKey = meta.idempotencyKey ? `${meta.idempotencyKey}:${index}` : "";
    if (pushKey && (await alreadyProcessed(supabaseAdmin, request.id, pushKey))) {
      result.duplicates += 1;
      if (trackingChanged) result.updated += 1;
      continue;
    }

    const incoming = classify(item, meta.triggerName);
    const status = nextStatus(request.status, incoming);
    const update: { updated_at: string; status?: string } = {
      updated_at: new Date().toISOString(),
    };
    if (status) update.status = status;

    if (status) {
      const { error } = await supabaseAdmin
        .from("medication_requests")
        .update(update)
        .eq("id", request.id);
      if (error) throw new Error(error.message);
    }

    const noteParts = [
      `LifeFile ${item.rxStatus || meta.triggerName || "update"}.`,
      item.rxNumber ? `Rx ${item.rxNumber}.` : "",
      item.shipCarrier ? `Carrier ${item.shipCarrier}.` : "",
      tracking ? `Tracking ${tracking}.` : "",
      pushKey ? `push:${pushKey}` : "",
    ].filter(Boolean);

    const { error: eventError } = await supabaseAdmin.from("medication_request_events").insert({
      request_id: request.id,
      status: status ?? request.status,
      actor_role: "system",
      created_by: null,
      note: noteParts.join(" "),
    });
    if (eventError) throw new Error(eventError.message);

    if (status === "dispatched" || status === "delivered") {
      const { notifyPatientRequestEvent } = await import("@/lib/email.notifications");
      await notifyPatientRequestEvent({
        supabaseAdmin,
        request: { ...request, tracking_number: tracking ?? request.tracking_number },
        template: status === "delivered" ? "patient_delivered" : "patient_shipped",
        extraParams: { TRACKING_NUMBER: tracking ?? request.tracking_number ?? "" },
      });
    }

    result.updated += 1;
  }

  return result;
}
