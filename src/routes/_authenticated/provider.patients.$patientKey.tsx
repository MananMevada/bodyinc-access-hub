import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyPatient } from "@/lib/provider.functions";
import { requestStatusTone, REQUEST_STATUS_BADGE, clinicalStatusLabel } from "@/lib/request-status";
import { adminCard, adminSectionTitle, adminSectionSubtitle } from "@/lib/admin-ui";
import { formatDate, formatDateTimeFull, formatRecordId } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/provider/patients/$patientKey")({
  head: () => ({
    meta: [
      { title: "Patient record · Body Inc Practitioner" },
      {
        name: "description",
        content: "Patient record — Practitioner area of the Body Inc portal.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProviderPatientDetail,
});

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[13px] font-medium text-[#3B4759]/60">{label}</div>
      <div className="text-[14px] font-medium text-[#3B4759]">{value ?? "—"}</div>
    </div>
  );
}

function ProviderPatientDetail() {
  const { patientKey } = Route.useParams();
  const navigate = useNavigate();
  const get = useServerFn(getMyPatient);

  const q = useQuery({
    queryKey: ["provider-patient", patientKey],
    queryFn: () => get({ data: { key: patientKey } }),
  });

  if (q.isLoading) {
    return (
      <div className="admin-page-shell font-['DM_Sans',sans-serif] text-[14px] text-[#3B4759]/60">
        Loading patient…
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="admin-page-shell space-y-3 font-['DM_Sans',sans-serif]">
        <Link
          to="/provider/patients"
          className="inline-flex items-center text-[14px] text-[#3B4759]"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Link>
        <div className="text-[14px] font-semibold text-[#B8684B]">
          {(q.error as Error)?.message ?? "Patient not found"}
        </div>
      </div>
    );
  }

  const { patient, orders, prescriptions } = q.data as any;

  return (
    <div className="admin-page-shell space-y-5 font-['DM_Sans',sans-serif]">
      <Link
        to="/provider/patients"
        className="-ml-1 inline-flex h-9 items-center px-1 text-[14px] font-medium text-[#3B4759] hover:opacity-80"
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to patients
      </Link>

      <Card className={adminCard}>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className={adminSectionTitle}>{patient.name}</CardTitle>
          <CardDescription className={adminSectionSubtitle}>
            Read-only directory. Allergies, medications, and intake answers are on each order.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 pt-0 sm:grid-cols-3 sm:p-6 sm:pt-0">
          <Row label="Patient ID" value={patient.id ? formatRecordId(patient.id) : "—"} />
          <Row label="Date of birth" value={patient.dob ? formatDate(patient.dob) : "—"} />
          <Row label="Age" value={patient.age ?? "—"} />
          <Row label="Sex" value={patient.sex ?? "—"} />
          <Row label="State" value={patient.state_code ?? "—"} />
        </CardContent>
      </Card>

      <Card className={adminCard}>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className={adminSectionTitle}>Order history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-0 sm:p-6 sm:pt-0">
          {orders.map((o: any) => (
            <button
              key={o.id}
              type="button"
              onClick={() =>
                navigate({ to: "/provider/requests/$requestId", params: { requestId: o.id } })
              }
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-[#D5DEDD] p-3 text-left hover:bg-[#E8EEED]/50"
            >
              <div>
                <div className="text-[14px] font-medium text-[#3B4759]">{o.medicine_name}</div>
                <div className="text-[12px] text-[#3B4759]/60">
                  {o.kind === "followup" ? "Renewal" : "Initial"} ·{" "}
                  {formatDateTimeFull(o.created_at)}
                </div>
              </div>
              <Badge
                className={`rounded-lg border-transparent px-2.5 py-0.5 text-[12px] font-semibold normal-case shadow-none ${
                  REQUEST_STATUS_BADGE[requestStatusTone(o.status)]
                }`}
              >
                {clinicalStatusLabel(o.status)}
              </Badge>
            </button>
          ))}
        </CardContent>
      </Card>

      {prescriptions.length > 0 ? (
        <Card className={adminCard}>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className={adminSectionTitle}>Prescriptions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0 text-[14px] sm:p-6 sm:pt-0">
            {prescriptions.map((rx: any) => (
              <div key={rx.id} className="rounded-lg border border-[#D5DEDD] p-3">
                <div className="font-medium text-[#3B4759]">{rx.medicine_name}</div>
                {rx.directions ? (
                  <div className="text-[13px] text-[#3B4759]/80">{rx.directions}</div>
                ) : null}
                <div className="text-[12px] text-[#3B4759]/60">
                  {rx.status} · {formatDateTimeFull(rx.created_at)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
