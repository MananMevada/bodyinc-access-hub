import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";

const listInput = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.enum(["all", "active", "deactivated"]).default("all"),
  })
  .default({ status: "all" });

const idInput = z.object({ userId: z.string().uuid() });

export const listPatients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Find user_ids with role = 'patient'
    const { data: roleRows, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "patient");
    if (roleErr) throw new Error(roleErr.message);
    const userIds = (roleRows ?? []).map((r: any) => r.user_id);
    if (userIds.length === 0) return [];

    // One paged listUsers sweep replaces a getUserById call per patient row (that was
    // N auth round trips scaling with patient count); it runs concurrently with the
    // profiles query below.
    const authByIdPromise = (async () => {
      const map = new Map<string, any>();
      for (let authPage = 1; ; authPage++) {
        const { data: usersPage, error: usersErr } = await supabaseAdmin.auth.admin.listUsers({
          page: authPage,
          perPage: 1000,
        });
        if (usersErr) throw new Error(usersErr.message);
        const users = usersPage?.users ?? [];
        for (const u of users) map.set(u.id, u);
        if (users.length < 1000) break;
      }
      return map;
    })();

    // Accept #BI-XXXX / BI-XXXX / XXXX (and longer compact UUID pastes) the same way requests do.
    const { normalizeIdSearch } = await import("@/lib/format");
    const idTerm = data.search ? normalizeIdSearch(data.search).replace(/-/g, "") : "";
    const idMatchedIds =
      idTerm && /^[0-9a-fA-F]{2,}$/i.test(idTerm)
        ? userIds.filter((id: string) =>
            id.replace(/-/g, "").toLowerCase().startsWith(idTerm.toLowerCase()),
          )
        : [];

    let q = supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, phone, dob, avatar_url, created_at")
      .in("id", userIds)
      .order("created_at", { ascending: false });

    if (data.search) {
      const s = `%${data.search}%`;
      q = q.or(`full_name.ilike.${s},email.ilike.${s},phone.ilike.${s}`);
    }
    const [{ data: textProfiles, error }, idProfilesRes] = await Promise.all([
      q,
      idMatchedIds.length
        ? supabaseAdmin
            .from("profiles")
            .select("id, full_name, email, phone, dob, avatar_url, created_at")
            .in("id", idMatchedIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (error) throw new Error(error.message);
    if (idProfilesRes.error) throw new Error(idProfilesRes.error.message);

    const merged = new Map<string, any>();
    for (const p of (textProfiles ?? []) as any[]) merged.set(p.id, p);
    for (const p of (idProfilesRes.data ?? []) as any[]) merged.set(p.id, p);
    const profiles = [...merged.values()].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const authById = await authByIdPromise;

    const rows = (profiles ?? []).map((p: any) => {
      const u: any = authById.get(p.id) ?? null;
      const bannedUntil = u?.banned_until ? new Date(u.banned_until) : null;
      const isDeactivated = !!(bannedUntil && bannedUntil.getTime() > Date.now());
      return {
        ...p,
        is_active: !isDeactivated,
        last_sign_in_at: u?.last_sign_in_at ?? null,
        email_confirmed_at: u?.email_confirmed_at ?? null,
      };
    });

    if (data.status === "active") return rows.filter((r) => r.is_active);
    if (data.status === "deactivated") return rows.filter((r) => !r.is_active);
    return rows;
  });

export const getPatient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: role, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!role || role.role !== "patient") throw new Error("Patient not found");

    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, full_name, email, phone, dob, sex, avatar_url, street_address, apartment, city, state_code, postal_code, country, sms_consent, marketing_consent, created_at, updated_at",
      )
      .eq("id", data.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!profile) throw new Error("Patient profile not found");

    const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    const u: any = userRes?.user ?? null;
    const bannedUntil = u?.banned_until ? new Date(u.banned_until) : null;
    const isDeactivated = !!(bannedUntil && bannedUntil.getTime() > Date.now());

    return {
      ...profile,
      is_active: !isDeactivated,
      banned_until: u?.banned_until ?? null,
      last_sign_in_at: u?.last_sign_in_at ?? null,
      email_confirmed_at: u?.email_confirmed_at ?? null,
    };
  });

const profileUpdate = z.object({
  userId: z.string().uuid(),
  full_name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .nullable()
    .optional(),
  sex: z.enum(["male", "female", "other"]).nullable().optional(),
  street_address: z.string().trim().max(255).nullable().optional(),
  apartment: z.string().trim().max(60).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  state_code: z.string().trim().max(2).nullable().optional(),
  postal_code: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v ? v.replace(/\D/g, "").slice(0, 6) : v)),
  country: z.string().trim().max(120).nullable().optional(),
});

export const updatePatientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => profileUpdate.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { userId, ...rest } = data;
    const patch: Record<string, any> = {};
    if (rest.full_name !== undefined) patch.full_name = rest.full_name;
    if (rest.phone !== undefined) patch.phone = rest.phone || null;
    if (rest.dob !== undefined) patch.dob = rest.dob || null;
    if (rest.sex !== undefined) patch.sex = rest.sex;
    if (rest.street_address !== undefined) patch.street_address = rest.street_address || null;
    if (rest.apartment !== undefined) patch.apartment = rest.apartment || null;
    if (rest.city !== undefined) patch.city = rest.city || null;
    if (rest.state_code !== undefined)
      patch.state_code = rest.state_code ? rest.state_code.toUpperCase() : null;
    if (rest.postal_code !== undefined) patch.postal_code = rest.postal_code || null;
    if (rest.country !== undefined) patch.country = rest.country || null;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase
      .from("profiles")
      .update(patch as any)
      .eq("id", userId);
    if (error) throw new Error(error.message);

    if (typeof rest.full_name === "string") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
      const metadata = (authUser.user?.user_metadata ?? {}) as Record<string, unknown>;
      const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { ...metadata, full_name: rest.full_name },
      });
      if (authErr) console.error("[patients] auth name sync failed:", authErr);

      const { error: sessionErr } = await supabaseAdmin
        .from("intake_sessions")
        .update({ full_name: rest.full_name })
        .eq("claimed_by_user_id", userId);
      if (sessionErr) console.error("[patients] intake name sync failed:", sessionErr);

      try {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("stripe_customer_id")
          .eq("id", userId)
          .maybeSingle();
        if (profile?.stripe_customer_id) {
          const { getStripe } = await import("@/integrations/stripe/client.server");
          await getStripe().customers.update(profile.stripe_customer_id, { name: rest.full_name });
        }
      } catch (err) {
        console.error("[patients] stripe name sync failed:", err);
      }
    }

    return { ok: true };
  });

export const setPatientActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ userId: z.string().uuid(), is_active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.is_active ? "none" : "876000h",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePatient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: role, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!role || role.role !== "patient") throw new Error("Patient not found");

    const {
      authUserBackup,
      backupThen,
      fetchMatching,
      newBackupId,
    } = await import("@/lib/data-backup.server");
    const db = supabaseAdmin as any;
    const [profileRes, authUserRes, requests, subscriptions, payments, shopOrders, consultations, sessions] =
      await Promise.all([
        db.from("profiles").select("*").eq("id", data.userId).maybeSingle(),
        supabaseAdmin.auth.admin.getUserById(data.userId),
        fetchMatching(db, "medication_requests", "user_id", [data.userId]),
        fetchMatching(db, "subscriptions", "user_id", [data.userId]),
        fetchMatching(db, "payments", "user_id", [data.userId]),
        fetchMatching(db, "shop_checkout_orders", "user_id", [data.userId]),
        fetchMatching(db, "patient_consultations", "user_id", [data.userId]),
        fetchMatching(db, "intake_sessions", "claimed_by_user_id", [data.userId]),
      ]);
    if (profileRes.error) throw new Error(profileRes.error.message);
    const requestIds = requests.map((row: { id: string }) => row.id);
    const shopIds = shopOrders.map((row: { id: string }) => row.id);
    const sessionIds = sessions.map((row: { id: string }) => row.id);
    const [
      events,
      notes,
      prescriptions,
      extraPayments,
      shopItems,
      shopEvents,
      feedback,
      roles,
      intakeAnswers,
    ] = await Promise.all([
      fetchMatching(db, "medication_request_events", "request_id", requestIds),
      fetchMatching(db, "medication_request_notes", "request_id", requestIds),
      fetchMatching(db, "prescriptions", "request_id", requestIds),
      fetchMatching(db, "additional_payments", "request_id", requestIds),
      fetchMatching(db, "shop_checkout_order_items", "order_id", shopIds),
      fetchMatching(db, "shop_checkout_events", "order_id", shopIds),
      fetchMatching(db, "subscription_cancellation_feedback", "user_id", [data.userId]),
      fetchMatching(db, "user_roles", "user_id", [data.userId]),
      fetchMatching(db, "intake_session_questionnaire_responses", "session_id", sessionIds),
    ]);
    const { data: changeLogs } = await db
      .from("admin_activity_log")
      .select("*")
      .in("action", ["request.change_medicine", "subscription.change_medicine"])
      .limit(5000);
    const entityIds = new Set([
      ...requestIds,
      ...subscriptions.map((row: { id: string }) => row.id),
    ]);
    const logs = ((changeLogs ?? []) as any[]).filter((row) => {
      if (row.after?.user_id === data.userId) return true;
      return row.entity_id && entityIds.has(row.entity_id);
    });
    const person = profileRes.data as { full_name?: string | null; email?: string | null } | null;
    const label = person?.full_name?.trim() || person?.email || "Patient";
    const live = subscriptions.filter(
      (row: { stripe_subscription_id?: string | null; status?: string }) =>
        row.stripe_subscription_id &&
        ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(row.status ?? ""),
    );

    await backupThen(
      db,
      {
        wipeId: newBackupId(),
        group: "patient",
        wipedBy: context.userId,
        label,
        batches: [
          { table: "auth.users", rows: authUserRes.data.user ? [authUserBackup(authUserRes.data.user)] : [] },
          { table: "profiles", rows: profileRes.data ? [profileRes.data] : [] },
          { table: "user_roles", rows: roles },
          { table: "medication_requests", rows: requests },
          { table: "medication_request_events", rows: events },
          { table: "medication_request_notes", rows: notes },
          { table: "prescriptions", rows: prescriptions },
          { table: "additional_payments", rows: extraPayments },
          { table: "subscriptions", rows: subscriptions },
          { table: "payments", rows: payments },
          { table: "shop_checkout_orders", rows: shopOrders },
          { table: "shop_checkout_order_items", rows: shopItems },
          { table: "shop_checkout_events", rows: shopEvents },
          { table: "patient_consultations", rows: consultations },
          { table: "intake_sessions", rows: sessions },
          { table: "intake_session_questionnaire_responses", rows: intakeAnswers },
          { table: "subscription_cancellation_feedback", rows: feedback },
          { table: "admin_activity_log", rows: logs },
        ],
      },
      async () => {
        if (live.length) {
          const { getStripe } = await import("@/integrations/stripe/client.server");
          const stripe = getStripe();
          for (const row of live) {
            try {
              await stripe.subscriptions.cancel(row.stripe_subscription_id);
            } catch (e: any) {
              if (e?.code !== "resource_missing") {
                throw new Error(
                  `Could not cancel Stripe subscription ${row.stripe_subscription_id}: ${e?.message ?? e}`,
                );
              }
            }
          }
        }
        if (requestIds.length) {
          await db.from("additional_payments").delete().in("request_id", requestIds);
          await db.from("medication_request_events").delete().in("request_id", requestIds);
          await db.from("medication_request_notes").delete().in("request_id", requestIds);
          await db.from("prescriptions").delete().in("request_id", requestIds);
          const { error: requestError } = await db.from("medication_requests").delete().in("id", requestIds);
          if (requestError) throw new Error(requestError.message);
        }
        if (shopIds.length) {
          await db.from("shop_checkout_events").delete().in("order_id", shopIds);
          await db.from("shop_checkout_order_items").delete().in("order_id", shopIds);
          const { error: shopError } = await db.from("shop_checkout_orders").delete().in("id", shopIds);
          if (shopError) throw new Error(shopError.message);
        }
        await db.from("subscription_cancellation_feedback").delete().eq("user_id", data.userId);
        const { deleteMedicineChangeHistory } = await import("@/lib/audit.functions");
        await deleteMedicineChangeHistory(supabaseAdmin, {
          userId: data.userId,
          entityIds: [...entityIds],
        });
        const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
        if (error) throw new Error(error.message);
      },
    );
    return { ok: true };
  });

export const sendPatientPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ userId: z.string().uuid(), redirect_to: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name")
      .eq("id", data.userId)
      .maybeSingle();
    if (error || !profile?.email) throw new Error("Patient email not found");

    // Patients reset their password on the PATIENT portal — never on this admin app's
    // origin (which is what the client-provided redirect_to points at).
    const portalUrl = process.env.PATIENT_PORTAL_URL?.replace(/\/$/, "");
    const redirectTo = portalUrl
      ? `${portalUrl}/auth/callback?next=/reset-password`
      : data.redirect_to;

    const { sendThemedRecoveryEmail } = await import("@/lib/email/send-recovery.server");
    const sent = await sendThemedRecoveryEmail({
      supabaseAdmin,
      email: profile.email,
      redirectTo,
      fullName: (profile as { full_name?: string | null }).full_name ?? null,
    });
    if (!sent.ok) throw new Error(sent.message);
    return { ok: true };
  });

export const getPatientRelated = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", data.userId)
      .maybeSingle();
    const email = (profile as any)?.email ?? null;

    // Orders = the patient's confirmed subscriptions (both onboarding + shop write these).
    const subQ = supabaseAdmin
      .from("subscriptions")
      .select("id, stripe_subscription_id, package_id, medicine_id, status, created_at")
      .eq("user_id", data.userId)
      .not("status", "in", "(incomplete,incomplete_expired)")
      .order("created_at", { ascending: false })
      .limit(100);

    // Sessions can be claimed by user or match email
    let sessionQ = supabaseAdmin
      .from("intake_sessions")
      .select("id, full_name, email, status, selected_plan_id, created_at, claimed_by_user_id")
      .order("created_at", { ascending: false })
      .limit(100);
    if (email) {
      sessionQ = sessionQ.or(`claimed_by_user_id.eq.${data.userId},email.eq.${email}`);
    } else {
      sessionQ = sessionQ.eq("claimed_by_user_id", data.userId);
    }

    const paymentQ = supabaseAdmin
      .from("payments")
      .select(
        "id, amount_cents, currency, status, stripe_invoice_id, stripe_subscription_id, created_at",
      )
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(100);

    const [{ data: subs }, { data: sessions }, { data: payments }] = await Promise.all([
      subQ,
      sessionQ,
      paymentQ,
    ]);

    const subRows = subs ?? [];
    const pkgIds = Array.from(new Set(subRows.map((s: any) => s.package_id).filter(Boolean)));
    const medIds = Array.from(new Set(subRows.map((s: any) => s.medicine_id).filter(Boolean)));
    const [{ data: pkgs }, { data: meds }] = await Promise.all([
      pkgIds.length
        ? supabaseAdmin.from("packages").select("id, name").in("id", pkgIds)
        : Promise.resolve({ data: [] as any[] }),
      medIds.length
        ? supabaseAdmin.from("medicines").select("id, name").in("id", medIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const pkgMap = new Map((pkgs ?? []).map((p: any) => [p.id, p.name]));
    const medMap = new Map((meds ?? []).map((m: any) => [m.id, m.name]));
    const payBySub = new Map<string, any>();
    for (const p of payments ?? []) {
      // payments are desc; overwriting leaves the earliest (initial charge) per subscription
      if (p.stripe_subscription_id) payBySub.set(p.stripe_subscription_id, p);
    }

    const orders = subRows.map((s: any) => {
      const pay = payBySub.get(s.stripe_subscription_id);
      const item =
        [medMap.get(s.medicine_id), pkgMap.get(s.package_id)].filter(Boolean).join(" — ") || "—";
      return {
        id: s.id,
        selected_plan_code: item,
        total: pay ? Number(pay.amount_cents) / 100 : 0,
        status: s.status === "active" ? "paid" : s.status,
        created_at: s.created_at,
      };
    });

    return {
      orders,
      sessions: sessions ?? [],
      payments: payments ?? [],
    };
  });

export const getPatientClinical = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", data.userId)
      .maybeSingle();
    const email = (profile as any)?.email ?? null;

    const sessionCols =
      "id, height_cm, weight_kg, state_code, selected_plan_id, status, created_at";
    // The session this user claimed is the definitive one; otherwise the latest matching email.
    let session: any = (
      await supabaseAdmin
        .from("intake_sessions")
        .select(sessionCols)
        .eq("claimed_by_user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data;
    if (!session && email) {
      session = (
        await supabaseAdmin
          .from("intake_sessions")
          .select(sessionCols)
          .eq("email", email)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data;
    }

    const h = Number(session?.height_cm ?? 0);
    const w = Number(session?.weight_kg ?? 0);
    const bmi = h && w ? Number((w / ((h / 100) * (h / 100))).toFixed(1)) : null;

    let goal: string | null = null;
    let eligibility: string | null = null;
    if (session) {
      const [{ data: catLink }, { data: elig }] = await Promise.all([
        supabaseAdmin
          .from("intake_session_categories")
          .select("medication_categories(name)")
          .eq("session_id", session.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from("intake_session_eligibility_results")
          .select("result")
          .eq("session_id", session.id)
          .order("evaluated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      goal = (catLink as any)?.medication_categories?.name ?? null;
      eligibility = (elig as any)?.result ?? null;
    }

    // Current medicine/plan: prefer the live subscription (reflects any admin medicine change),
    // fall back to the intake session's selected plan.
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("medicine_id, package_id, status")
      .eq("user_id", data.userId)
      .not("status", "in", "(incomplete,incomplete_expired)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let medicineId = (sub as any)?.medicine_id ?? null;
    const packageId = (sub as any)?.package_id ?? session?.selected_plan_id ?? null;
    const subscriptionStatus = (sub as any)?.status ?? null;

    let plan: { name: string | null; duration_months: number | null; price: number | null } | null =
      null;
    if (packageId) {
      const { data: pkg } = await supabaseAdmin
        .from("packages")
        .select("name, duration_months, price, medicine_id")
        .eq("id", packageId)
        .maybeSingle();
      if (pkg) {
        plan = {
          name: pkg.name,
          duration_months: pkg.duration_months,
          price: Number(pkg.price),
        };
        if (!medicineId) medicineId = (pkg as any).medicine_id;
      }
    }

    let medicineName: string | null = null;
    if (medicineId) {
      const { data: med } = await supabaseAdmin
        .from("medicines")
        .select("name")
        .eq("id", medicineId)
        .maybeSingle();
      medicineName = (med as any)?.name ?? null;
    }

    return {
      has_data: Boolean(session || sub),
      bmi,
      height_cm: session?.height_cm ?? null,
      weight_kg: session?.weight_kg ?? null,
      goal,
      eligibility,
      state_code: session?.state_code ?? null,
      medicine_name: medicineName,
      plan,
      subscription_status: subscriptionStatus,
    };
  });
