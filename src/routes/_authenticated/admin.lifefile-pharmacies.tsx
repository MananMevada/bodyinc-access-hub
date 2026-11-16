import { toastError } from "@/lib/toast-message";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/admin/confirm-delete-dialog";
import { PageHeader } from "@/components/admin/page-header";
import { FieldError, RequiredMark } from "@/components/admin/required-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createLifeFilePharmacy,
  deleteLifeFilePharmacy,
  listLifeFilePharmacies,
  updateLifeFilePharmacy,
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
import { Pencil, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/lifefile-pharmacies")({
  head: () => ({
    meta: [
      { title: "LifeFile Pharmacies · Body Inc Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LifeFilePharmaciesPage,
});

type FormState = {
  id?: string;
  name: string;
  api_base_url: string;
  api_username: string;
  api_password: string;
  vendor_id: string;
  location_id: string;
  api_network_id: string;
  practice_id: string;
  is_active: boolean;
};

const EMPTY: FormState = {
  name: "",
  api_base_url: "",
  api_username: "",
  api_password: "",
  vendor_id: "",
  location_id: "",
  api_network_id: "",
  practice_id: "",
  is_active: true,
};

function LifeFilePharmaciesPage() {
  const qc = useQueryClient();
  const list = useServerFn(listLifeFilePharmacies);
  const create = useServerFn(createLifeFilePharmacy);
  const update = useServerFn(updateLifeFilePharmacy);
  const remove = useServerFn(deleteLifeFilePharmacy);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  function validatePharmacy(values: FormState) {
    const errors: Partial<Record<keyof FormState, string>> = {};
    if (!values.name.trim()) errors.name = "Please enter the pharmacy name.";
    if (!values.api_base_url.trim()) errors.api_base_url = "Please enter the API URL.";
    else if (!/^https?:\/\//i.test(values.api_base_url.trim())) {
      errors.api_base_url = "Enter a valid URL starting with https://.";
    }
    if (!values.api_username.trim()) errors.api_username = "Please enter the API username.";
    if (!values.api_password.trim()) errors.api_password = "Please enter the API password.";
    if (!values.vendor_id.trim()) errors.vendor_id = "Please enter the Vendor ID.";
    if (!values.location_id.trim()) errors.location_id = "Please enter the Location ID.";
    if (!values.api_network_id.trim()) errors.api_network_id = "Please enter the API Network ID.";
    if (!values.practice_id.trim()) errors.practice_id = "Please enter the Practice ID.";
    else if (!/^\d+$/.test(values.practice_id.trim()) || Number(values.practice_id) <= 0) {
      errors.practice_id = "Practice ID must be a positive number.";
    }
    return errors;
  }

  const q = useQuery({
    queryKey: ["life-file-pharmacies"],
    queryFn: () => list({}),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (form.id) {
        return update({ data: { ...form, id: form.id } });
      }
      return create({ data: form });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["life-file-pharmacies"] });
      toast.success(form.id ? "Pharmacy updated." : "Pharmacy created.");
      setOpen(false);
      setForm(EMPTY);
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["life-file-pharmacies"] });
      toast.success("Pharmacy deleted.");
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1440px] space-y-5">
      <PageHeader
        title="LifeFile Pharmacies"
        crumbs={[{ label: "LifeFile Pharmacies" }]}
        actions={
          <Button
            className={adminBtnCompactPrimary}
            onClick={() => {
              setForm(EMPTY);
              setFieldErrors({});
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add pharmacy
          </Button>
        }
      />

      <Card className={adminCard}>
        <CardHeader>
          <CardTitle className={adminSectionTitle}>Configured pharmacies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {q.isLoading ? (
            <p className="text-[14px] text-[#3B4759]/60">Loading…</p>
          ) : (q.data ?? []).length === 0 ? (
            <p className="text-[14px] text-[#3B4759]/60">
              No pharmacies yet. Add each pharmacy's own LifeFile login, then choose that pharmacy on the medicine.
            </p>
          ) : (
            (q.data ?? []).map((p: any) => (
              <div
                key={p.id}
                className="flex flex-col gap-3 rounded-[12px] border border-[#E8EEED] p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-[#152A51]">{p.name}</span>
                    <Badge
                      className={`rounded-lg border-transparent px-2 py-0.5 text-[11px] font-semibold shadow-none ${
                        p.is_active
                          ? "bg-[#6A9B9C] text-white hover:bg-[#6A9B9C]"
                          : "bg-[#FBF1EC] text-[#B8684B] hover:bg-[#FBF1EC]"
                      }`}
                    >
                      {p.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="truncate text-[13px] text-[#3B4759]/70">{p.api_base_url}</div>
                  <div className="text-[13px] text-[#3B4759]/70">
                    {p.api_username ? `User: ${p.api_username}` : "No API username yet"}
                    {p.practice_id != null ? ` · Practice: ${p.practice_id}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className={adminBtnCompactSecondary}
                    onClick={() => {
                      setForm({
                        id: p.id,
                        name: p.name ?? "",
                        api_base_url: p.api_base_url ?? "",
                        api_username: p.api_username ?? "",
                        api_password: "",
                        vendor_id: p.vendor_id ?? "",
                        location_id: p.location_id ?? "",
                        api_network_id: p.api_network_id ?? "",
                        practice_id: p.practice_id != null ? String(p.practice_id) : "",
                        is_active: p.is_active !== false,
                      });
                      setFieldErrors({});
                      setOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className={adminBtnCompactDanger}
                    disabled={deleteMut.isPending}
                    onClick={() => setDeleteTarget({ id: p.id, name: p.name ?? "this pharmacy" })}
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit pharmacy" : "Add pharmacy"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label className={adminLabel}>
                Pharmacy name
                <RequiredMark />
              </Label>
              <Input
                className={`${adminInput} ${fieldErrors.name ? adminInputError : ""}`}
                value={form.name}
                onChange={(e) => {
                  setForm((f) => ({ ...f, name: e.target.value }));
                  setFieldErrors((prev) => ({ ...prev, name: undefined }));
                }}
                placeholder="e.g. Striker"
              />
              <FieldError message={fieldErrors.name} />
            </div>
            <div className="space-y-1">
              <Label className={adminLabel}>
                API URL
                <RequiredMark />
              </Label>
              <Input
                className={`${adminInput} ${fieldErrors.api_base_url ? adminInputError : ""}`}
                value={form.api_base_url}
                onChange={(e) => {
                  setForm((f) => ({ ...f, api_base_url: e.target.value }));
                  setFieldErrors((prev) => ({ ...prev, api_base_url: undefined }));
                }}
                placeholder="https://…"
              />
              <FieldError message={fieldErrors.api_base_url} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className={adminLabel}>
                  API username
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
                  API password
                  <RequiredMark />
                </Label>
                <Input
                  className={`${adminInput} ${fieldErrors.api_password ? adminInputError : ""}`}
                  type="password"
                  value={form.api_password}
                  autoComplete="new-password"
                  onChange={(e) => {
                    setForm((f) => ({ ...f, api_password: e.target.value }));
                    setFieldErrors((prev) => ({ ...prev, api_password: undefined }));
                  }}
                />
                <FieldError message={fieldErrors.api_password} />
              </div>
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
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className={adminLabel}>
                  Vendor ID
                  <RequiredMark />
                </Label>
                <Input
                  className={`${adminInput} ${fieldErrors.vendor_id ? adminInputError : ""}`}
                  value={form.vendor_id}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, vendor_id: e.target.value }));
                    setFieldErrors((prev) => ({ ...prev, vendor_id: undefined }));
                  }}
                />
                <FieldError message={fieldErrors.vendor_id} />
              </div>
              <div className="space-y-1">
                <Label className={adminLabel}>
                  Location ID
                  <RequiredMark />
                </Label>
                <Input
                  className={`${adminInput} ${fieldErrors.location_id ? adminInputError : ""}`}
                  value={form.location_id}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, location_id: e.target.value }));
                    setFieldErrors((prev) => ({ ...prev, location_id: undefined }));
                  }}
                />
                <FieldError message={fieldErrors.location_id} />
              </div>
              <div className="space-y-1">
                <Label className={adminLabel}>
                  API Network ID
                  <RequiredMark />
                </Label>
                <Input
                  className={`${adminInput} ${fieldErrors.api_network_id ? adminInputError : ""}`}
                  value={form.api_network_id}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, api_network_id: e.target.value }));
                    setFieldErrors((prev) => ({ ...prev, api_network_id: undefined }));
                  }}
                />
                <FieldError message={fieldErrors.api_network_id} />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
              <span className="text-[13px] font-medium text-[#3B4759]">Active</span>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className={adminBtnCompactSecondary} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className={adminBtnCompactPrimary}
              disabled={saveMut.isPending}
              onClick={() => {
                const next = validatePharmacy(form);
                setFieldErrors(next);
                if (Object.values(next).some(Boolean)) return;
                saveMut.mutate();
              }}
            >
              {saveMut.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        title="Delete this pharmacy?"
        description={`This permanently removes "${deleteTarget?.name ?? "this pharmacy"}". You cannot delete it while medicines or provider logins still use it.`}
        pending={deleteMut.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMut.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
