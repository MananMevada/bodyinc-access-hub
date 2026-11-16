import { sentenceCase, titleCaseName, upperTrim } from "@/lib/text-normalize";
import { toastError } from "@/lib/toast-message";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FieldError, RequiredMark } from "@/components/admin/required-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyProviderProfile, updateMyProviderProfile } from "@/lib/provider.functions";
import { StateMultiSelect } from "@/components/admin/state-multi-select";
import { AvatarUpload } from "@/components/admin/avatar-upload";
import {
  adminCard,
  adminInput,
  adminInputError,
  adminPageTitle,
  adminPageSubtitle,
  adminSectionTitle,
  adminSectionSubtitle,
} from "@/lib/admin-ui";

export const Route = createFileRoute("/_authenticated/provider/profile")({
  head: () => ({
    meta: [
      { title: "My profile · Body Inc Practitioner" },
      { name: "description", content: "My profile — Practitioner area of the Body Inc portal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProviderProfilePage,
});

function ProviderProfilePage() {
  const qc = useQueryClient();
  const get = useServerFn(getMyProviderProfile);
  const save = useServerFn(updateMyProviderProfile);

  const q = useQuery({ queryKey: ["provider-profile"], queryFn: () => get({}) });

  const [form, setForm] = useState({
    full_name: "",
    bio: "",
    credentials: "",
    specialty: "",
    years_experience: "",
    languages: "",
    consultation_types: "",
  });
  const [licenseStates, setLicenseStates] = useState<string[]>([]);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    const d = q.data as any;
    if (!d) return;
    setForm({
      full_name: d.full_name ?? "",
      bio: d.bio ?? "",
      credentials: d.credentials ?? "",
      specialty: d.specialty ?? "",
      years_experience: d.years_experience != null ? String(d.years_experience) : "",
      languages: (d.languages ?? []).join(", "),
      consultation_types: (d.consultation_types ?? []).join(", "),
    });
    setLicenseStates(((d.license_states ?? []) as string[]).map((s) => String(s).toUpperCase()));
    setAvatarUrl(typeof d.avatar_url === "string" ? d.avatar_url : "");
  }, [q.data]);

  const mut = useMutation({
    mutationFn: () =>
      save({
        data: {
          full_name: titleCaseName(form.full_name),
          bio: sentenceCase(form.bio) || undefined,
          credentials: upperTrim(form.credentials) || undefined,
          specialty: titleCaseName(form.specialty) || undefined,
          years_experience: form.years_experience ? Number(form.years_experience) : null,
          languages: form.languages
            .split(",")
            .map((s) => titleCaseName(s))
            .filter(Boolean),
          consultation_types: form.consultation_types
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          license_states: licenseStates,
          avatar_url: avatarUrl.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Profile updated.");
      qc.invalidateQueries({ queryKey: ["provider-profile"] });
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const d = (q.data as any) ?? {};

  return (
    <div className="admin-page-shell space-y-5 font-['DM_Sans',sans-serif]">
      <div className="space-y-1">
        <h1 className={adminPageTitle}>My profile</h1>
        <p className={adminPageSubtitle}>
          Update how you appear to patients. Licensing details are managed by the admin team.
        </p>
      </div>

      <Card className={adminCard}>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className={adminSectionTitle}>Details</CardTitle>
          <CardDescription className={adminSectionSubtitle}>
            {d.email ? `Signed in as ${d.email}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 pt-0 sm:grid-cols-2 sm:p-6 sm:pt-0">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-[13px] text-[#3B4759]">Photo</Label>
            <AvatarUpload value={avatarUrl || null} onChange={setAvatarUrl} disabled={mut.isPending} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px] text-[#3B4759]">
              Full name
              <RequiredMark />
            </Label>
            <Input
              value={form.full_name}
              onChange={(e) => {
                setForm({ ...form, full_name: e.target.value });
                if (e.target.value.trim().length >= 2) setNameError("");
              }}
              className={`${adminInput} ${nameError ? adminInputError : ""}`}
            />
            <FieldError message={nameError} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px] text-[#3B4759]">Credentials</Label>
            <Input
              value={form.credentials}
              onChange={(e) => setForm({ ...form, credentials: e.target.value })}
              placeholder="MD, NP…"
              className={adminInput}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px] text-[#3B4759]">Specialty</Label>
            <Input
              value={form.specialty}
              onChange={(e) => setForm({ ...form, specialty: e.target.value })}
              className={adminInput}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px] text-[#3B4759]">Years of experience</Label>
            <Input
              type="number"
              min={0}
              value={form.years_experience}
              onChange={(e) => setForm({ ...form, years_experience: e.target.value })}
              className={adminInput}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px] text-[#3B4759]">Languages (comma separated)</Label>
            <Input
              value={form.languages}
              onChange={(e) => setForm({ ...form, languages: e.target.value })}
              className={adminInput}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px] text-[#3B4759]">
              Consultation types (comma separated)
            </Label>
            <Input
              value={form.consultation_types}
              onChange={(e) => setForm({ ...form, consultation_types: e.target.value })}
              className={adminInput}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-[13px] text-[#3B4759]">Bio</Label>
            <Textarea
              rows={5}
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              className="border-[#D5DEDD] text-[14px] text-[#3B4759]"
            />
          </div>
          <div className="sm:col-span-2">
            <Button
              disabled={mut.isPending}
              onClick={() => {
                if (form.full_name.trim().length < 2) {
                  setNameError("Please enter the full name.");
                  return;
                }
                setNameError("");
                mut.mutate();
              }}
              className="h-10 bg-[#6A9B9C] px-5 text-[13px] font-semibold text-white hover:bg-[#5B8788]"
            >
              {mut.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className={adminCard}>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className={adminSectionTitle}>Licensing</CardTitle>
          <CardDescription className={adminSectionSubtitle}>
            Keep your licensed states current — they decide which patients you can claim.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0 text-[14px] sm:p-6 sm:pt-0">
          <div className="max-w-md">
            <Label className="text-[13px] text-[#3B4759]">Licensed states</Label>
            <div className="mt-1.5">
              <StateMultiSelect
                selected={licenseStates}
                onToggle={(s) =>
                  setLicenseStates((prev) =>
                    prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
                  )
                }
                onSetSelected={setLicenseStates}
              />
            </div>
          </div>
          <Button
            disabled={mut.isPending}
            onClick={() => {
              if (form.full_name.trim().length < 2) {
                setNameError("Please enter the full name.");
                return;
              }
              mut.mutate();
            }}
            className="h-10 bg-[#6A9B9C] px-5 text-[13px] font-semibold text-white hover:bg-[#5B8788]"
          >
            {mut.isPending ? "Saving…" : "Save licensing"}
          </Button>
          <div className="text-[13px] text-[#3B4759]/70">
            Admin managed — Licence #: {d.license_number ?? "—"} · NPI: {d.npi ?? "—"} · DEA:{" "}
            {d.dea ?? "—"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
