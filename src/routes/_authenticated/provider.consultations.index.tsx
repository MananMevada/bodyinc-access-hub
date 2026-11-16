import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listConsultationHistory, listConsultationWindow } from "@/lib/provider.functions";
import { adminPageSubtitle, adminPageTitle } from "@/lib/admin-ui";
import { formatDate, formatDateTime, formatRecordId } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/provider/consultations/")({
  head: () => ({
    meta: [
      { title: "Consultations · Body Inc Practitioner" },
      {
        name: "description",
        content: "All assigned patients with a required or live consultation.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProviderConsultationsPage,
});

function ProviderConsultationsPage() {
  const navigate = useNavigate();
  const list = useServerFn(listConsultationWindow);
  const history = useServerFn(listConsultationHistory);
  const q = useQuery({
    queryKey: ["provider-consultation-window"],
    queryFn: () => list({}),
  });
  const past = useQuery({
    queryKey: ["provider-consultation-history"],
    queryFn: () => history({}),
  });
  const rows = (q.data as any[]) ?? [];
  const historyRows = (past.data as any[]) ?? [];

  return (
    <div className="admin-page-shell space-y-6 font-['DM_Sans',sans-serif]">
      <div className="space-y-1">
        <h1 className={adminPageTitle}>Consultation window</h1>
        <p className={adminPageSubtitle}>
          Every assigned patient who needs a consultation, in one list. Join consultation opens that
          patient's order, including intake, history, and notes. Patients without a required
          or in-progress visit are hidden.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#D5DEDD] bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Medication</TableHead>
              <TableHead>Consultation</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-[14px] text-[#3B4759]/60">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-[14px] text-[#3B4759]/60">
                  No consultations are required right now.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium text-[#3B4759]">
                    <div>{row.patient_name}</div>
                    <div className="text-[12px] text-[#3B4759]/50">
                      {row.patient_id ? formatRecordId(row.patient_id) : "—"}
                      {row.dob ? ` · ${formatDate(row.dob)}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-[#3B4759]/80">{row.medicine_name}</TableCell>
                  <TableCell>
                    <div className="text-[13px] text-[#3B4759]">{row.consultation_status}</div>
                    <div className="text-[12px] text-[#3B4759]/60">
                      {row.consultation_mode === "scheduled" && row.consultation_scheduled_at
                        ? `Scheduled · ${formatDateTime(row.consultation_scheduled_at)}`
                        : "Instant"}
                    </div>
                    {row.patient_waiting ? (
                      <Badge className="mt-1 border-transparent bg-[#FFF4E5] text-[11px] font-semibold text-[#B45309] shadow-none hover:bg-[#FFF4E5]">
                        Patient waiting
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      className="h-9 bg-[#6A9B9C] text-[13px] font-semibold text-white hover:bg-[#5B8788]"
                      onClick={() =>
                        navigate({
                          to: "/provider/requests/$requestId/consultation",
                          params: { requestId: row.id },
                        })
                      }
                    >
                      Join consultation
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2">
        <h2 className="text-[18px] font-semibold text-[#152A51]">Consultation history</h2>
        <p className="text-[13px] text-[#3B4759]/60">Finished visits for your patients.</p>
        <div className="overflow-x-auto rounded-xl border border-[#D5DEDD] bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Medication</TableHead>
                <TableHead>Ended</TableHead>
                <TableHead className="text-right">Order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {past.isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-[14px] text-[#3B4759]/60">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : historyRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-[14px] text-[#3B4759]/60">
                    No finished consultations yet.
                  </TableCell>
                </TableRow>
              ) : (
                historyRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-[#3B4759]">
                      {row.patient_name}
                      <div className="text-[12px] text-[#3B4759]/50">
                        {row.patient_id ? formatRecordId(row.patient_id) : ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-[#3B4759]/80">{row.medicine_name}</TableCell>
                    <TableCell className="text-[#3B4759]/80">
                      {formatDateTime(row.ended_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.request_id ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 border-[#D5DEDD] text-[13px] font-semibold text-[#3B4759]"
                          onClick={() =>
                            navigate({
                              to: "/provider/requests/$requestId",
                              params: { requestId: row.request_id },
                            })
                          }
                        >
                          Open order
                        </Button>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
