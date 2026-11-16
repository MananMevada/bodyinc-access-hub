import { toastError } from "@/lib/toast-message";
import { FormActionBar } from "@/components/admin/form-action-bar";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  getSettings,
  normalizeLifeFileContactPhone,
  updateSettings,
  type PlatformSettings,
} from "@/lib/settings.functions";
import { syncShippingBatch } from "@/lib/shipping-reprice.functions";
import { ActivityLogTab } from "@/components/admin/activity-log-tab";
import { DangerZoneTab } from "@/components/admin/danger-zone-tab";
import { DeletedItemsCard } from "@/components/admin/deleted-items-card";
import { OffersTab } from "@/components/admin/offers-tab";
import {
  adminPageTitle,
  adminPageSubtitle,
  adminLabel,
  adminInput,
  adminBtnPrimary,
  adminCard,
  adminCardPad,
} from "@/lib/admin-ui";

export const Route = createFileRoute("/_authenticated/admin/settings/")({
  head: () => ({
    meta: [
      { title: "Settings · Body Inc Admin" },
      { name: "description", content: "Settings — Admin area of the Body Inc portal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsPage,
});

type FormState = {
  consultation_fee: string;
  consultation_fee_enabled: boolean;
  shipping_fee: string;
  shipping_fee_enabled: boolean;
  referral_reward: string;
  referral_enabled: boolean;
  maintenance_mode: boolean;
  new_signups_enabled: boolean;
  lifefile_contact_phone: string;
};

function centsToStr(cents: number) {
  return (cents / 100).toFixed(2);
}

function strToCents(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function toForm(s: PlatformSettings): FormState {
  return {
    consultation_fee: centsToStr(s.consultation_fee_cents),
    consultation_fee_enabled: s.consultation_fee_enabled,
    shipping_fee: centsToStr(s.shipping_fee_cents),
    shipping_fee_enabled: s.shipping_fee_enabled,
    referral_reward: centsToStr(s.referral_reward_cents),
    referral_enabled: s.referral_enabled,
    maintenance_mode: s.maintenance_mode,
    new_signups_enabled: s.new_signups_enabled,
    lifefile_contact_phone: s.lifefile_contact_phone,
  };
}

function FeeRow({
  label,
  help,
  value,
  onChange,
  enabled,
  onToggle,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className={`${adminCard} ${adminCardPad}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label className={adminLabel}>{label}</Label>
          <p className="text-xs text-[#3B4759]/70">{help}</p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs font-semibold text-[#3B4759]/70">
            {enabled ? "Enabled" : "Disabled"}
          </span>
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            className="data-[state=checked]:bg-[#6A9B9C] data-[state=unchecked]:bg-[#D5DEDD]"
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-[#3B4759]">$</span>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          disabled={!enabled}
          className={`${adminInput} w-40 disabled:opacity-50`}
        />
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={`${adminCard} ${adminCardPad}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label className={adminLabel}>{label}</Label>
          <p className="text-xs text-[#3B4759]/70">{help}</p>
        </div>
        <Switch
          checked={checked}
          onCheckedChange={onChange}
          className="mt-1 data-[state=checked]:bg-[#6A9B9C] data-[state=unchecked]:bg-[#D5DEDD]"
        />
      </div>
    </div>
  );
}

type SyncTotals = {
  scanned: number;
  updated: number;
  added: number;
  removed: number;
  skipped: number;
  errors: number;
};

const ZERO_TOTALS: SyncTotals = {
  scanned: 0,
  updated: 0,
  added: 0,
  removed: 0,
  skipped: 0,
  errors: 0,
};

function ShippingSync({ unsaved }: { unsaved: boolean }) {
  const qc = useQueryClient();
  const syncFn = useServerFn(syncShippingBatch);
  const [running, setRunning] = useState(false);
  const [scanned, setScanned] = useState(0);

  async function runSync() {
    setRunning(true);
    setScanned(0);
    let statusIndex = 0;
    let startingAfter: string | null = null;
    let totals: SyncTotals = { ...ZERO_TOTALS };
    try {
      // Bounded to avoid any accidental infinite loop; far above realistic batch counts.
      for (let i = 0; i < 100_000; i++) {
        const res = await syncFn({ data: { statusIndex, startingAfter, totals } });
        totals = res.totals;
        statusIndex = res.statusIndex;
        startingAfter = res.startingAfter;
        setScanned(totals.scanned);
        if (res.done) break;
      }
      toast.success(
        `Synced ${totals.scanned} subscription${totals.scanned === 1 ? "" : "s"}: ${totals.updated} updated, ${totals.added} added, ${totals.removed} removed${
          totals.errors ? `, ${totals.errors} failed` : ""
        }.`,
      );
      qc.invalidateQueries({ queryKey: ["admin-activity-log"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-dashed border-[#D5DEDD] bg-[#F8FBFA] p-4">
      <div className="space-y-0.5">
        <Label className="text-[14px] font-bold text-[#3B4759]">
          Apply to existing subscriptions
        </Label>
        <p className="text-xs text-[#6A9B9C]/70">
          Save the fee first. New subscriptions use the saved amount automatically; this updates the
          recurring shipping on all active subscriptions to match (adds, re-prices, or removes it).
          Changes take effect on each subscription&apos;s next renewal.
        </p>
        {unsaved ? (
          <p className="pt-1 text-xs font-semibold text-[#B8684B]">
            You have unsaved shipping changes — click “Save changes” first, then sync.
          </p>
        ) : null}
        {running ? (
          <p className="pt-1 text-xs font-semibold text-[#6A9B9C]">
            Syncing… {scanned} processed (keep this tab open)
          </p>
        ) : null}
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            disabled={running || unsaved}
            className="h-9 shrink-0 rounded-xl border-[#D5DEDD] font-semibold text-[#3B4759] hover:bg-[#E8EEED]"
          >
            {running ? "Syncing…" : "Sync now"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="rounded-2xl border-[#D5DEDD]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#3B4759]">
              Sync shipping to active subscriptions?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[#6A9B9C]/80">
              This updates the recurring shipping charge on every active subscription in Stripe to
              match the currently saved shipping fee. It applies from each subscription&apos;s next
              renewal. It runs in batches while this tab stays open. Make sure you&apos;ve saved the
              fee you want first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void runSync()}
              className="rounded-xl bg-[#6A9B9C] text-white hover:bg-[#5B8788]"
            >
              Sync now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SettingsPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getSettings);
  const updateFn = useServerFn(updateSettings);

  const query = useQuery({
    queryKey: ["platform-settings"],
    queryFn: () => getFn(),
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [tab, setTab] = useState("fees");
  useEffect(() => {
    if (query.data) setForm(toForm(query.data));
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (payload: Partial<PlatformSettings>) => updateFn({ data: payload }),
    onSuccess: (res) => {
      toast.success(res.changed ? "Settings saved" : "No changes to save");
      qc.invalidateQueries({ queryKey: ["platform-settings"] });
      qc.invalidateQueries({ queryKey: ["admin-activity-log"] });
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  function save() {
    if (!form) return;
    const consultationCents = strToCents(form.consultation_fee);
    const shippingCents = strToCents(form.shipping_fee);
    const referralCents = strToCents(form.referral_reward);
    if (consultationCents === null || shippingCents === null || referralCents === null) {
      toast.error("Enter valid, non-negative amounts");
      return;
    }
    let lifefileContactPhone = "";
    try {
      lifefileContactPhone = normalizeLifeFileContactPhone(form.lifefile_contact_phone);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enter a valid pharmacy contact phone");
      return;
    }
    mutation.mutate({
      consultation_fee_cents: consultationCents,
      consultation_fee_enabled: form.consultation_fee_enabled,
      shipping_fee_cents: shippingCents,
      shipping_fee_enabled: form.shipping_fee_enabled,
      referral_reward_cents: referralCents,
      referral_enabled: form.referral_enabled,
      maintenance_mode: form.maintenance_mode,
      new_signups_enabled: form.new_signups_enabled,
      lifefile_contact_phone: lifefileContactPhone,
    });
  }

  return (
    <div className="admin-page-shell space-y-5 sm:space-y-6 font-['DM_Sans',sans-serif]">
      <div className="min-w-0 space-y-2 sm:space-y-4">
        <h2 className={adminPageTitle}>Settings</h2>
        <p className={adminPageSubtitle}>
          Configure fees, referrals, offers, and platform-wide behavior.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full min-w-0">
        <TabsList className="flex h-auto w-full flex-wrap bg-[#E8EEED] text-[#3B4759]/70 sm:w-auto">
          <TabsTrigger value="fees">Fees</TabsTrigger>
          <TabsTrigger value="referrals">Referrals</TabsTrigger>
          <TabsTrigger value="offers">Offers</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="audit">Audit logs</TabsTrigger>
          <TabsTrigger value="danger" className="data-[state=active]:text-destructive">
            Danger zone
          </TabsTrigger>
        </TabsList>

        <TabsContent value="fees" className="mt-4">
          <Card className={`${adminCard} ${adminCardPad} space-y-4`}>
            {form ? (
              <>
                <FeeRow
                  label="Consultation fee"
                  help="Charged one time when a patient starts a new medication from the shop. It is FREE on the first onboarding order and is never charged on recurring renewals."
                  value={form.consultation_fee}
                  onChange={(v) => set("consultation_fee", v)}
                  enabled={form.consultation_fee_enabled}
                  onToggle={(v) => set("consultation_fee_enabled", v)}
                />
                <FeeRow
                  label="Shipping fee"
                  help="FREE on the first onboarding order, then charged on every recurring renewal and on every shop order (including its renewals)."
                  value={form.shipping_fee}
                  onChange={(v) => set("shipping_fee", v)}
                  enabled={form.shipping_fee_enabled}
                  onToggle={(v) => set("shipping_fee_enabled", v)}
                />
                <ShippingSync
                  unsaved={
                    !!query.data &&
                    (strToCents(form.shipping_fee) !== query.data.shipping_fee_cents ||
                      form.shipping_fee_enabled !== query.data.shipping_fee_enabled)
                  }
                />
              </>
            ) : (
              <p className="text-sm text-[#3B4759]/60">Loading…</p>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="referrals" className="mt-4">
          <Card className={`${adminCard} ${adminCardPad} space-y-4`}>
            {form ? (
              <FeeRow
                label="Referral reward"
                help="Wallet credit granted to a referrer when their invited friend starts a plan."
                value={form.referral_reward}
                onChange={(v) => set("referral_reward", v)}
                enabled={form.referral_enabled}
                onToggle={(v) => set("referral_enabled", v)}
              />
            ) : (
              <p className="text-sm text-[#3B4759]/60">Loading…</p>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="offers" className="mt-4">
          <OffersTab />
        </TabsContent>

        <TabsContent value="system" className="mt-4">
          <Card className={`${adminCard} ${adminCardPad} space-y-4`}>
            {form ? (
              <>
                <ToggleRow
                  label="Maintenance mode"
                  help="When on, the patient portal shows a maintenance notice and blocks checkout."
                  checked={form.maintenance_mode}
                  onChange={(v) => set("maintenance_mode", v)}
                />
                <ToggleRow
                  label="Allow new signups"
                  help="When off, new patients cannot create accounts or start onboarding."
                  checked={form.new_signups_enabled}
                  onChange={(v) => set("new_signups_enabled", v)}
                />
                <div className={`${adminCard} ${adminCardPad} space-y-3`}>
                  <div className="space-y-0.5">
                    <Label htmlFor="lifefile-contact-phone" className={adminLabel}>
                      Pharmacy contact phone
                    </Label>
                    <p className="text-xs text-[#3B4759]/70">
                      Sent to LifeFile on every order, for every patient and every pharmacy. The
                      patient&apos;s own phone is not sent. Orders cannot go to the pharmacy until
                      this number is saved.
                    </p>
                  </div>
                  <Input
                    id="lifefile-contact-phone"
                    value={form.lifefile_contact_phone}
                    onChange={(e) => set("lifefile_contact_phone", e.target.value)}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="e.g. (555) 555-1234"
                    className={`${adminInput} max-w-xs`}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-[#3B4759]/60">Loading…</p>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <ActivityLogTab />
        </TabsContent>

        <TabsContent value="danger" className="mt-4 space-y-4">
          <DangerZoneTab />
          <DeletedItemsCard />
        </TabsContent>
      </Tabs>

      {form && tab !== "audit" && tab !== "danger" && tab !== "offers" ? (
        <FormActionBar submitting={mutation.isPending} submitLabel="Save changes" onSubmit={save} />
      ) : null}
    </div>
  );
}
