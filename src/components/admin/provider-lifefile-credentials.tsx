import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toastError } from "@/lib/toast-message";
import { ConfirmDeleteDialog } from "@/components/admin/confirm-delete-dialog";
import { FieldError, RequiredMark } from "@/components/admin/required-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteProviderLifeFileCredential,
  listLifeFilePharmacies,
  listProviderLifeFileCredentials,
  upsertProviderLifeFileCredential,
} from "@/lib/lifefile-pharmacies.functions";
import {
  adminBtnCompactDanger,
  adminBtnCompactPrimary,
  adminBtnCompactSecondary,
  adminCard,
  adminInput,
  adminInputError,
  adminLabel,
  adminSectionTitle,
} from "@/lib/admin-ui";

type CredForm = {
  id?: string;
  pharmacy_id: string;
  api_base_url: string;
  api_username: string;
  api_password: string;
  provider_life_file_id: string;
  practice_id: string;
  npi: string;
  is_active: boolean;
};

const EMPTY: CredForm = {
  pharmacy_id: "",
  api_base_url: "",
  api_username: "",
  api_password: "",
  provider_life_file_id: "",
  practice_id: "",
  npi: "",
  is_active: true,
};

type CredErrors = Partial<Record<keyof CredForm, string>>;

function validateCredentials(form: CredForm): CredErrors {
  const errors: CredErrors = {};
  if (!form.pharmacy_id) errors.pharmacy_id = "Please select a pharmacy.";
  if (!form.api_username.trim()) errors.api_username = "Please enter a username.";
  if (!form.id && !form.api_password.trim()) errors.api_password = "Please enter a password.";
  if (!form.practice_id.trim()) {
    errors.practice_id = "Please enter the Practice ID.";
  } else if (!/^\d+$/.test(form.practice_id.trim()) || Number(form.practice_id) <= 0) {
    errors.practice_id = "Practice ID must be a positive number.";
  }
  if (form.npi.trim() && !/^\d{10}$/.test(form.npi.trim())) {
    errors.npi = "NPI must be 10 digits, or leave it blank.";
  }
  if (form.api_base_url.trim() && !/^https?:\/\//i.test(form.api_base_url.trim())) {
    errors.api_base_url = "Enter a valid URL starting with https://, or leave it blank.";
  }
  return errors;
}

export function ProviderLifeFileCredentialsSection({ providerId }: { providerId: string }) {
  const qc = useQueryClient();
  const listCreds = useServerFn(listProviderLifeFileCredentials);
  const listPharmacies = useServerFn(listLifeFilePharmacies);
  const upsert = useServerFn(upsertProviderLifeFileCredential);
  const remove = useServerFn(deleteProviderLifeFileCredential);

  const [form, setForm] = useState<CredForm>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<CredErrors>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const credsQ = useQuery({
    queryKey: ["provider-life-file-credentials", providerId],
    queryFn: () => listCreds({ data: { providerId } }),
  });
  const pharmaciesQ = useQuery({
    queryKey: ["life-file-pharmacies"],
    queryFn: () => listPharmacies({}),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          id: form.id,
          provider_id: providerId,
          pharmacy_id: form.pharmacy_id,
          api_base_url: form.api_base_url,
          api_username: form.api_username,
          api_password: form.api_password,
          provider_life_file_id: form.provider_life_file_id,
          practice_id: form.practice_id,
          npi: form.npi,
          is_active: form.is_active,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provider-life-file-credentials", providerId] });
      toast.success("LifeFile pharmacy credentials saved.");
      setForm(EMPTY);
      setEditing(false);
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provider-life-file-credentials", providerId] });
      toast.success("Credentials removed.");
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const pharmacies = pharmaciesQ.data ?? [];
  const creds = credsQ.data ?? [];

  return (
    <Card className={`${adminCard} mb-5 p-4 sm:mb-6 sm:p-6`}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-0 pb-4">
        <div>
          <CardTitle className={adminSectionTitle}>LifeFile pharmacy configuration</CardTitle>
          <p className="mt-1 text-[13px] font-normal text-[#3B4759]/80">
            Add the pharmacy API username and password this practitioner uses to send orders.
            Provider LifeFile ID is optional.
          </p>
        </div>
        {!editing ? (
          <Button
            type="button"
            className={`${adminBtnCompactPrimary} shrink-0`}
            onClick={() => {
              setForm(EMPTY);
              setFieldErrors({});
              setEditing(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add pharmacy
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        {credsQ.isLoading ? (
          <p className="text-[14px] text-[#3B4759]/60">Loading…</p>
        ) : creds.length === 0 && !editing ? (
          <p className="text-[14px] text-[#3B4759]/60">No LifeFile pharmacies configured yet.</p>
        ) : (
          creds.map((c: any) => (
            <div
              key={c.id}
              className="flex flex-col gap-2 rounded-[12px] border border-[#E8EEED] p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 text-[14px] text-[#3B4759]">
                <div className="font-semibold text-[#152A51]">
                  {c.pharmacy_name ?? "Pharmacy"}
                  {!c.is_active ? " (inactive)" : ""}
                </div>
                <div className="text-[13px] text-[#3B4759]/70">
                  User: {c.api_username}
                  {c.provider_life_file_id ? ` · LF ID: ${c.provider_life_file_id}` : ""}
                  {c.practice_id != null ? ` · Practice: ${c.practice_id}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className={adminBtnCompactSecondary}
                  onClick={() => {
                    setForm({
                      id: c.id,
                      pharmacy_id: c.pharmacy_id,
                      api_base_url: c.api_base_url ?? "",
                      api_username: c.api_username ?? "",
                      api_password: "",
                      provider_life_file_id: c.provider_life_file_id ?? "",
                      practice_id: c.practice_id != null ? String(c.practice_id) : "",
                      npi: c.npi ?? "",
                      is_active: c.is_active !== false,
                    });
                    setFieldErrors({});
                    setEditing(true);
                  }}
                >
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={adminBtnCompactDanger}
                  onClick={() =>
                    setDeleteTarget({ id: c.id, name: c.pharmacy_name ?? "this pharmacy" })
                  }
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              </div>
            </div>
          ))
        )}

        {editing ? (
          <div className="space-y-3 rounded-[12px] border border-[#D5DEDD] bg-[#F8FBFA] p-4">
            <div className="space-y-1">
              <Label className={adminLabel}>
                Pharmacy
                <RequiredMark />
              </Label>
              <Select
                value={form.pharmacy_id}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, pharmacy_id: v }));
                  setFieldErrors((prev) => ({ ...prev, pharmacy_id: undefined }));
                }}
                disabled={!!form.id}
              >
                <SelectTrigger className={`${adminInput} ${fieldErrors.pharmacy_id ? adminInputError : ""}`}>
                  <SelectValue placeholder="Select pharmacy" />
                </SelectTrigger>
                <SelectContent>
                  {pharmacies.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={fieldErrors.pharmacy_id} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className={adminLabel}>
                  Username
                  <RequiredMark />
                </Label>
                <Input
                  className={`${adminInput} ${fieldErrors.api_username ? adminInputError : ""}`}
                  value={form.api_username}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, api_username: e.target.value }));
                    setFieldErrors((prev) => ({ ...prev, api_username: undefined }));
                  }}
                />
                <FieldError message={fieldErrors.api_username} />
              </div>
              <div className="space-y-1">
                <Label className={adminLabel}>
                  Password{form.id ? " (leave blank to keep)" : ""}
                  {form.id ? null : <RequiredMark />}
                </Label>
                <Input
                  className={`${adminInput} ${fieldErrors.api_password ? adminInputError : ""}`}
                  type="password"
                  value={form.api_password}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, api_password: e.target.value }));
                    setFieldErrors((prev) => ({ ...prev, api_password: undefined }));
                  }}
                  autoComplete="new-password"
                />
                <FieldError message={fieldErrors.api_password} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className={adminLabel}>Provider LifeFile ID (optional)</Label>
                <Input
                  className={`${adminInput} ${fieldErrors.provider_life_file_id ? adminInputError : ""}`}
                  value={form.provider_life_file_id}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, provider_life_file_id: e.target.value }));
                    setFieldErrors((prev) => ({ ...prev, provider_life_file_id: undefined }));
                  }}
                />
                <FieldError message={fieldErrors.provider_life_file_id} />
              </div>
              <div className="space-y-1">
                <Label className={adminLabel}>
                  Practice ID
                  <RequiredMark />
                </Label>
                <Input
                  className={`${adminInput} ${fieldErrors.practice_id ? adminInputError : ""}`}
                  inputMode="numeric"
                  value={form.practice_id}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, practice_id: e.target.value }));
                    setFieldErrors((prev) => ({ ...prev, practice_id: undefined }));
                  }}
                />
                <FieldError message={fieldErrors.practice_id} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className={adminLabel}>NPI (optional override)</Label>
                <Input
                  className={`${adminInput} ${fieldErrors.npi ? adminInputError : ""}`}
                  value={form.npi}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, npi: e.target.value }));
                    setFieldErrors((prev) => ({ ...prev, npi: undefined }));
                  }}
                />
                <FieldError message={fieldErrors.npi} />
              </div>
              <div className="space-y-1">
                <Label className={adminLabel}>API URL override (optional)</Label>
                <Input
                  className={`${adminInput} ${fieldErrors.api_base_url ? adminInputError : ""}`}
                  value={form.api_base_url}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, api_base_url: e.target.value }));
                    setFieldErrors((prev) => ({ ...prev, api_base_url: undefined }));
                  }}
                  placeholder="Uses pharmacy URL if blank"
                />
                <FieldError message={fieldErrors.api_base_url} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
              <span className="text-[13px] font-medium text-[#3B4759]">Active</span>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                className={adminBtnCompactPrimary}
                disabled={saveMut.isPending}
                onClick={() => {
                  const next = validateCredentials(form);
                  setFieldErrors(next);
                  if (Object.values(next).some(Boolean)) return;
                  saveMut.mutate();
                }}
              >
                {saveMut.isPending ? "Saving…" : "Save credentials"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className={adminBtnCompactSecondary}
                onClick={() => {
                  setEditing(false);
                  setForm(EMPTY);
                  setFieldErrors({});
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        title="Remove these credentials?"
        description={`This removes the LifeFile login for ${deleteTarget?.name ?? "this pharmacy"}. Orders cannot be sent there until you add it again.`}
        confirmLabel="Remove credentials"
        pending={deleteMut.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMut.mutate(deleteTarget.id);
        }}
      />
    </Card>
  );
}
