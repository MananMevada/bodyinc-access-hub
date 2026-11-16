import { toastError } from "@/lib/toast-message";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense } from "react";
import { toast } from "sonner";
import { FormSkeleton } from "@/components/admin/form-skeleton";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getProvider, updateProvider, enableQuickbloxAgent } from "@/lib/providers.functions";
import { adminBtnPrimary, adminCard, adminSectionTitle } from "@/lib/admin-ui";
const ProviderForm = lazy(() =>
  import("@/components/admin/provider-form").then((m) => ({ default: m.ProviderForm })),
);

export const Route = createFileRoute("/_authenticated/admin/providers/$providerId")({
  head: () => ({
    meta: [
      { title: "Edit practitioner · Body Inc Admin" },
      { name: "description", content: "Edit practitioner — Admin area of the Body Inc portal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EditProviderPage,
});

function EditProviderPage() {
  const { providerId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const get = useServerFn(getProvider);
  const update = useServerFn(updateProvider);
  const enableQb = useServerFn(enableQuickbloxAgent);

  const query = useQuery({
    queryKey: ["providers", providerId],
    queryFn: () => get({ data: { id: providerId } }),
  });

  const mutation = useMutation({
    mutationFn: (values: any) => update({ data: { id: providerId, ...values } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers"] });
      toast.success("Provider updated.");
      navigate({ to: "/admin/providers" });
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const enableQbMut = useMutation({
    mutationFn: () => enableQb({ data: { id: providerId } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["providers"] });
      qc.invalidateQueries({ queryKey: ["providers", providerId] });
      toast.success(
        res.created ? "QuickBlox agent created for this provider." : "QuickBlox agent is linked.",
      );
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  if (query.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading provider…</div>;
  }
  if (query.isError || !query.data) {
    return (
      <div className="text-sm text-destructive">
        {(query.error as Error)?.message ?? "Provider not found"}
      </div>
    );
  }

  const d = query.data as any;
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1440px] overflow-x-hidden">
      <PageHeader
        backTo="/admin/providers"
        backLabel="providers"
        crumbs={[{ label: "Providers", to: "/admin/providers" }]}
        title={d.full_name ?? "Edit practitioner"}
      />
      <Card className={`${adminCard} mb-5 p-4 sm:mb-6 sm:p-6`}>
        <CardHeader className="space-y-0 p-0 pb-4">
          <CardTitle className={adminSectionTitle}>QuickBlox agent</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {d.qb_user_id ? (
                <Badge className="rounded-lg border-transparent bg-[#6A9B9C] px-2.5 py-0.5 text-[12px] font-semibold text-white shadow-none hover:bg-[#6A9B9C]">
                  Linked
                </Badge>
              ) : (
                <Badge className="rounded-lg border-transparent bg-[#FBF1EC] px-2.5 py-0.5 text-[12px] font-semibold text-[#B8684B] shadow-none hover:bg-[#FBF1EC]">
                  Not linked
                </Badge>
              )}
              {d.email ? (
                <span className="text-[14px] font-medium text-[#3B4759]">{d.email}</span>
              ) : null}
            </div>
            <p className="mt-2 text-[13px] font-normal text-[#3B4759]/80">
              {d.qb_user_id
                ? "This practitioner joins video and chat visits as themselves in QuickBlox."
                : "Create a QuickBlox agent so this practitioner can join visits"}
            </p>
          </div>
          <Button
            type="button"
            className={`${adminBtnPrimary} h-11 shrink-0 px-5 sm:h-11`}
            disabled={enableQbMut.isPending}
            onClick={() => enableQbMut.mutate()}
          >
            {enableQbMut.isPending
              ? "Linking…"
              : d.qb_user_id
                ? "Refresh QuickBlox agent"
                : "Create QuickBlox agent"}
          </Button>
        </CardContent>
      </Card>
      <Suspense fallback={<FormSkeleton />}>
        <ProviderForm
          mode="edit"
          submitting={mutation.isPending}
          defaultValues={{
            email: d.email,
            full_name: d.full_name,
            phone: d.phone ?? "",
            avatar_url: d.avatar_url ?? "",
            bio: d.bio ?? "",
            credentials: d.credentials ?? undefined,
            specialty: d.specialty ?? "",
            npi: d.npi ?? "",
            dea: d.dea ?? "",
            license_number: d.license_number ?? "",
            license_states: d.license_states ?? [],
            years_experience: d.years_experience ?? undefined,
            languages: d.languages ?? [],
            consultation_types: d.consultation_types ?? [],
            address_line1: d.address_line1 ?? "",
            address_line2: d.address_line2 ?? "",
            city: d.city ?? "",
            state: d.state ?? undefined,
            zip: d.zip ?? "",
            country: d.country ?? "US",
            is_active: d.is_active,
          }}
          onSubmit={(values) => mutation.mutate(values)}
          onCancel={() => navigate({ to: "/admin/providers" })}
        />
      </Suspense>
    </div>
  );
}
