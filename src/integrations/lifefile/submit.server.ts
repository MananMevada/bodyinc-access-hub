import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createLifeFileOrder,
  extractLifeFileOrderId,
} from "@/integrations/lifefile/orders.server";
import {
  getLegacyLifeFileConfig,
  type LifeFileConfig,
} from "@/integrations/lifefile/client.server";

export type LifeFileSubmitResult = {
  lifeFileOrderId: string;
  pharmacyId: string | null;
  pharmacyName: string | null;
};

export const LIFE_FILE_ALREADY_SENT_ERROR =
  "This order was already submitted to LifeFile. Duplicate submissions are blocked.";
export const LIFE_FILE_IN_FLIGHT_ERROR = "This order is already being sent to LifeFile.";

/** Lost a race with another send. "sent" already has an order id. "in_flight" is still calling Life File. */
export function lifeFileSendBlocked(message: string): "sent" | "in_flight" | null {
  if (message.includes("already being sent to LifeFile")) return "in_flight";
  if (message.includes("already submitted to LifeFile")) return "sent";
  return null;
}

type RequestRow = {
  id: string;
  status: string;
  provider_id: string | null;
  user_id: string | null;
  medicine_id: string | null;
  variant_id: string | null;
  life_file_order_id?: string | null;
  life_file_status?: string | null;
};

/**
 * Resolve pharmacy + product + provider credentials, call LifeFile, and persist
 * submission fields on the medication request. Does not change request status.
 */
/** Checks pharmacy setup and provider NPI without writing anything. */
export async function assertLifeFileReady(
  supabaseAdmin: SupabaseClient,
  req: { user_id: string | null; provider_id: string | null; medicine_id: string | null; variant_id: string | null },
): Promise<void> {
  if (!req.user_id) throw new Error("This request has no patient account.");
  if (!req.provider_id) throw new Error("This request has no assigned provider.");

  const [{ data: patient }, { data: provider }] = await Promise.all([
    supabaseAdmin.from("profiles").select("id").eq("id", req.user_id).maybeSingle(),
    supabaseAdmin.from("providers").select("id, npi").eq("id", req.provider_id).maybeSingle(),
  ]);
  if (!patient) throw new Error("Patient profile not found.");
  if (!provider) throw new Error("Provider record not found.");

  const routing = await resolveLifeFileRouting(supabaseAdmin, {
    medicineId: req.medicine_id,
    variantId: req.variant_id,
    providerId: req.provider_id,
  });
  if (!(routing.credentialNpi || provider.npi)) {
    throw new Error("Provider NPI is required for Life File.");
  }

  const { readLifeFileContactPhone } = await import("@/lib/settings.functions");
  const contactPhone = await readLifeFileContactPhone(supabaseAdmin);
  if (!contactPhone) {
    throw new Error(
      "Set the pharmacy contact phone in Admin → Settings before sending to the pharmacy.",
    );
  }
}

export async function submitRequestToLifeFile(
  supabaseAdmin: SupabaseClient,
  req: RequestRow,
  options: { allowRetry?: boolean } = {},
): Promise<LifeFileSubmitResult> {
  if (req.life_file_order_id) {
    throw new Error(LIFE_FILE_ALREADY_SENT_ERROR);
  }

  if (!options.allowRetry && req.life_file_status === "failed" && req.life_file_order_id) {
    // Failed without an order id is retryable via allowRetry; with an id still block.
  }

  if (!req.user_id) {
    throw new Error("This request has no patient account.");
  }
  if (!req.provider_id) {
    throw new Error("This request has no assigned provider.");
  }

  const [{ data: patient }, { data: provider }, { data: prescription }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select(
        "full_name, dob, sex, email, street_address, apartment, city, state_code, postal_code, country",
      )
      .eq("id", req.user_id)
      .maybeSingle(),
    supabaseAdmin
      .from("providers")
      .select("id, license_number, license_states, npi, dea")
      .eq("id", req.provider_id)
      .maybeSingle(),
    supabaseAdmin
      .from("prescriptions")
      .select("id, medicine_name, directions, medicine_id, variant_id, package_id, created_at")
      .eq("request_id", req.id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  if (!patient) throw new Error("Patient profile not found.");
  if (!provider) throw new Error("Provider record not found.");
  const prescriptionRow = Array.isArray(prescription) ? prescription[0] : prescription;
  if (!prescriptionRow) {
    throw new Error("Prescribe first, then send to the pharmacy.");
  }

  const { data: providerProfile } = await supabaseAdmin
    .from("profiles")
    .select("full_name, email")
    .eq("id", req.provider_id)
    .maybeSingle();
  if (!providerProfile) throw new Error("Provider profile not found.");

  const medicineId = prescriptionRow.medicine_id ?? req.medicine_id;
  const variantId = prescriptionRow.variant_id ?? req.variant_id;

  const routing = await resolveLifeFileRouting(supabaseAdmin, {
    medicineId,
    variantId,
    providerId: req.provider_id,
  });

  const [{ data: liveMedicine }, { data: liveVariant }] = await Promise.all([
    medicineId
      ? supabaseAdmin.from("medicines").select("name").eq("id", medicineId).maybeSingle()
      : Promise.resolve({ data: null }),
    variantId
      ? supabaseAdmin.from("medicine_variants").select("name").eq("id", variantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const medicineName = liveMedicine?.name || prescriptionRow.medicine_name;
  const variantName = liveVariant?.name ?? null;
  const medicineLabel = variantName ? `${medicineName} (${variantName})` : medicineName;

  const npi = routing.credentialNpi || provider.npi;
  if (!npi) {
    throw new Error("Provider NPI is required for Life File.");
  }

  const { data: requestPlan } = await supabaseAdmin
    .from("medication_requests")
    .select("package_id")
    .eq("id", req.id)
    .maybeSingle();
  const packageId = requestPlan?.package_id ?? prescriptionRow.package_id ?? null;
  let quantity: number | null = null;
  if (packageId) {
    const { data: plan } = await supabaseAdmin
      .from("packages")
      .select("duration_months")
      .eq("id", packageId)
      .maybeSingle();
    const months = Number(plan?.duration_months);
    if (Number.isFinite(months) && months >= 1) quantity = Math.round(months);
  }
  if (!quantity) {
    throw new Error(
      "This order has no plan length, so the pharmacy quantity cannot be set. A 1-month plan sends 1, a 2-month plan sends 2, and a 3-month plan sends 3.",
    );
  }

  const { readLifeFileContactPhone } = await import("@/lib/settings.functions");
  const contactPhone = await readLifeFileContactPhone(supabaseAdmin);
  if (!contactPhone) {
    throw new Error(
      "Set the pharmacy contact phone in Admin → Settings before sending to the pharmacy.",
    );
  }

  await claimLifeFileSend(supabaseAdmin, req.id);

  try {
    const lifeFileResponse = await createLifeFileOrder({
      requestId: req.id,
      config: routing.config,
      contactPhone,
      patient: {
        fullName: patient.full_name,
        dob: patient.dob,
        sex: patient.sex,
        email: patient.email,
        streetAddress: patient.street_address,
        apartment: patient.apartment,
        city: patient.city,
        stateCode: patient.state_code,
        postalCode: patient.postal_code,
        country: patient.country,
      },
      provider: {
        fullName: providerProfile.full_name,
        npi,
        licenseNumber: provider.license_number,
        licenseState: provider.license_states?.[0] ?? null,
        dea: provider.dea,
        email: providerProfile.email,
        lifeFileProviderId: routing.providerLifeFileId,
      },
      prescription: {
        medicineName: medicineLabel,
        directions: prescriptionRow.directions,
        lfProductID: routing.lfProductId,
        quantity,
      },
    });

    const lifeFileOrderId = extractLifeFileOrderId(lifeFileResponse);
    if (!lifeFileOrderId) {
      throw new Error(
        "Life File accepted the request, but no Order ID was found in the response. Check the server console for the full response.",
      );
    }

    const { data: saved } = await supabaseAdmin
      .from("medication_requests")
      .update({
        life_file_status: "submitted",
        life_file_order_id: lifeFileOrderId,
        life_file_error: null,
        life_file_pharmacy_id: routing.pharmacyId,
        life_file_submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.id)
      .or(`life_file_order_id.is.null,life_file_order_id.eq."${lifeFileOrderId}"`)
      .select("life_file_order_id")
      .maybeSingle();
    if (!saved) {
      const { data: existing } = await supabaseAdmin
        .from("medication_requests")
        .select("life_file_order_id")
        .eq("id", req.id)
        .maybeSingle();
      const kept = existing?.life_file_order_id;
      if (kept) {
        return {
          lifeFileOrderId: kept,
          pharmacyId: routing.pharmacyId,
          pharmacyName: routing.pharmacyName,
        };
      }
      throw new Error("Life File returned an order id, but it could not be saved.");
    }

    return {
      lifeFileOrderId,
      pharmacyId: routing.pharmacyId,
      pharmacyName: routing.pharmacyName,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Life File submission failed.";
    await supabaseAdmin
      .from("medication_requests")
      .update({
        life_file_status: "failed",
        life_file_error: message.slice(0, 1000),
        life_file_pharmacy_id: routing.pharmacyId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.id)
      .eq("life_file_status", "submitting")
      .is("life_file_order_id", null);
    throw error;
  }
}

/** Lock the row so a second confirmation cannot create another Life File order. */
async function claimLifeFileSend(supabaseAdmin: SupabaseClient, requestId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("claim_life_file_submission", {
    p_request_id: requestId,
  });
  if (error) {
    if (/claim_life_file_submission|does not exist|schema cache/i.test(error.message)) {
      throw new Error(
        "Pharmacy send is waiting for the latest database update. Apply it, then send again.",
      );
    }
    throw new Error(error.message);
  }
  if (data === "claimed") return;
  if (data === "in_progress") throw new Error(LIFE_FILE_IN_FLIGHT_ERROR);
  if (data === "missing") throw new Error("Request not found.");
  throw new Error(LIFE_FILE_ALREADY_SENT_ERROR);
}

async function resolveLifeFileRouting(
  supabaseAdmin: SupabaseClient,
  args: {
    medicineId: string | null;
    variantId: string | null;
    providerId: string;
  },
): Promise<{
  pharmacyId: string | null;
  pharmacyName: string | null;
  lfProductId: number;
  config: LifeFileConfig;
  providerLifeFileId: string | null;
  credentialNpi: string | null;
}> {
  if (!args.medicineId) {
    throw new Error("Pharmacy configuration is missing for this medicine.");
  }

  let productQuery = supabaseAdmin
    .from("medicine_life_file_products")
    .select(
      "id, pharmacy_id, lf_product_id, variant_id, is_active, life_file_pharmacies(id, name, api_base_url, api_username, api_password, vendor_id, location_id, api_network_id, practice_id, is_active)",
    )
    .eq("medicine_id", args.medicineId)
    .eq("is_active", true);

  if (args.variantId) {
    productQuery = productQuery.eq("variant_id", args.variantId);
  } else {
    productQuery = productQuery.is("variant_id", null);
  }

  const { data: products, error: productsError } = await productQuery;
  if (productsError) {
    if (/api_username|api_password|practice_id/i.test(productsError.message)) {
      throw new Error(
        "LifeFile pharmacy logins are not ready yet. Apply the latest database update, then add the API username, password, and practice ID under LifeFile Pharmacies.",
      );
    }
    // Table may not exist yet in environments that have not migrated — fall back to legacy.
    if (/medicine_life_file_products|does not exist|schema cache/i.test(productsError.message)) {
      return resolveLegacyRouting(supabaseAdmin, args);
    }
    throw new Error(productsError.message);
  }

  const rows = (products ?? []) as any[];
  if (rows.length === 0) {
    throw new Error(
      "This medicine is not linked to a LifeFile pharmacy. On the medicine, choose the pharmacy and product ID, then send again.",
    );
  }

  if (rows.length > 1) {
    throw new Error(
      "This medicine is linked to more than one LifeFile pharmacy. Keep a single active pharmacy mapping for this SKU, or split into separate medicines/variants.",
    );
  }

  const row = rows[0];
  const pharmacy = Array.isArray(row.life_file_pharmacies)
    ? row.life_file_pharmacies[0]
    : row.life_file_pharmacies;

  if (!pharmacy?.id) {
    throw new Error("Pharmacy configuration is missing for this medicine.");
  }
  if (pharmacy.is_active === false) {
    throw new Error(`Pharmacy "${pharmacy.name}" is inactive.`);
  }

  const lfProductId = Number(row.lf_product_id);
  if (!Number.isInteger(lfProductId) || lfProductId <= 0) {
    throw new Error(
      args.variantId
        ? "This variant has no Life File product ID. Add it on the medicine variant in Admin → Medicines before sending to pharmacy."
        : "This medicine has no Life File product ID. Add it on the medicine in Admin → Medicines before sending to pharmacy.",
    );
  }

  const apiUsername = String(pharmacy.api_username ?? "").trim();
  const apiPassword = String(pharmacy.api_password ?? "");
  const practiceId = Number(pharmacy.practice_id);
  if (!apiUsername || !apiPassword.trim()) {
    throw new Error(
      `LifeFile login is missing for ${pharmacy.name}. Add the API username and password under LifeFile Pharmacies.`,
    );
  }
  if (!Number.isFinite(practiceId) || practiceId <= 0) {
    throw new Error(
      `Practice ID is missing for ${pharmacy.name}. Add it under LifeFile Pharmacies.`,
    );
  }

  const vendorId = String(pharmacy.vendor_id ?? "").trim();
  const locationId = String(pharmacy.location_id ?? "").trim();
  const apiNetworkId = String(pharmacy.api_network_id ?? "").trim();
  if (!vendorId || !locationId || !apiNetworkId) {
    throw new Error(
      `Pharmacy "${pharmacy.name}" is missing Vendor ID, Location ID, or API Network ID.`,
    );
  }

  const baseUrl = String(pharmacy.api_base_url || "").trim();
  if (!baseUrl || baseUrl.includes("example.invalid")) {
    throw new Error(
      `Pharmacy "${pharmacy.name}" has no valid API URL. Update it under Admin → LifeFile Pharmacies.`,
    );
  }

  return {
    pharmacyId: pharmacy.id,
    pharmacyName: pharmacy.name,
    lfProductId,
    providerLifeFileId: null,
    credentialNpi: null,
    config: {
      baseUrl,
      apiUsername,
      apiPassword,
      vendorId,
      locationId,
      apiNetworkId,
      practiceId,
    },
  };
}

async function resolveLegacyRouting(
  supabaseAdmin: SupabaseClient,
  args: {
    medicineId: string | null;
    variantId: string | null;
    providerId: string;
  },
): Promise<{
  pharmacyId: string | null;
  pharmacyName: string | null;
  lfProductId: number;
  config: LifeFileConfig;
  providerLifeFileId: string | null;
  credentialNpi: string | null;
}> {
  const [{ data: liveMedicine }, { data: liveVariant }] = await Promise.all([
    args.medicineId
      ? supabaseAdmin
          .from("medicines")
          .select("lf_product_id")
          .eq("id", args.medicineId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    args.variantId
      ? supabaseAdmin
          .from("medicine_variants")
          .select("lf_product_id")
          .eq("id", args.variantId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const lfFromVariant = liveVariant?.lf_product_id;
  const lfFromMedicine = liveMedicine?.lf_product_id;
  const lfProductIdRaw =
    lfFromVariant != null && lfFromVariant !== "" ? lfFromVariant : lfFromMedicine;
  const lfProductId =
    typeof lfProductIdRaw === "number"
      ? lfProductIdRaw
      : lfProductIdRaw != null && lfProductIdRaw !== ""
        ? Number(lfProductIdRaw)
        : NaN;

  if (!Number.isInteger(lfProductId) || lfProductId <= 0) {
    throw new Error("Pharmacy configuration is missing for this medicine.");
  }

  try {
    return {
      pharmacyId: null,
      pharmacyName: null,
      lfProductId,
      providerLifeFileId: null,
      credentialNpi: null,
      config: getLegacyLifeFileConfig(),
    };
  } catch {
    throw new Error(
      "LifeFile configuration is missing. Link the medicine to a pharmacy under LifeFile Pharmacies.",
    );
  }
}
