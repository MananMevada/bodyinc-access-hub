import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminBtnPrimary } from "@/lib/admin-ui";
import {
  openConsultation,
  type ConsultationRow,
  type ConsultationVisitStatus,
  type ListConsultationsResult,
} from "@/lib/consultations.functions";
import { formatDateTime, formatRecordId } from "@/lib/format";
import { toastError } from "@/lib/toast-message";

const STATUS_TONE: Record<ConsultationVisitStatus, string> = {
  open: "bg-[#6A9B9C] text-white hover:bg-[#6A9B9C]",
  ended: "bg-[#D5DEDD] text-[#3B4759] hover:bg-[#D5DEDD]",
  unknown: "bg-[#F8EDE8] text-[#3B4759] hover:bg-[#F8EDE8]",
};

function visitLabel(status: ConsultationVisitStatus) {
  if (status === "ended") return "Closed";
  if (status === "open") return "Started";
  return "Pending";
}

export function ConsultationsTable({
  result,
  loading,
  error,
  showPatient,
  onOpenPatient,
}: {
  result: ListConsultationsResult | undefined;
  loading: boolean;
  error: Error | null;
  showPatient?: boolean;
  onOpenPatient?: (userId: string) => void;
}) {
  const navigate = useNavigate();

  const openFn = useServerFn(openConsultation);
  const openMut = useMutation({
    mutationFn: async ({ consultationId }: { consultationId: string }) =>
      openFn({ data: { consultationId } }),
    onSuccess: (res, vars) => {
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if (res.requestId) {
        navigate({
          to: "/admin/requests/$requestId/consultation",
          params: { requestId: res.requestId },
        });
        return;
      }
      const matched = rows.find((r) => r.id === vars.consultationId);
      if (matched?.request_id) {
        navigate({
          to: "/admin/requests/$requestId/consultation",
          params: { requestId: matched.request_id },
        });
        return;
      }
      toast.error("Could not find matching consultation request.");
    },
    onError: (e: Error) => {
      toast.error(toastError(e));
    },
  });

  const rows = result?.rows ?? [];
  const colSpan = showPatient ? 6 : 5;

  return (
    <div className="admin-table-wrap m-0 w-full">
      <div className="admin-table-scroll">
        <Table className={showPatient ? "min-w-[920px]" : "min-w-[760px]"}>
          <TableHeader className="bg-[#F8FBFA]">
            <TableRow className="border-b border-[#D5DEDD] hover:bg-transparent">
              {showPatient ? (
                <TableHead className="h-11 text-[13px] font-semibold text-[#3B4759]">
                  Patient
                </TableHead>
              ) : null}
              <TableHead className="h-11 text-[13px] font-semibold text-[#3B4759]">
                Medication
              </TableHead>
              <TableHead className="h-11 text-[13px] font-semibold text-[#3B4759]">Plan</TableHead>
              <TableHead className="h-11 text-[13px] font-semibold text-[#3B4759]">
                Visit
              </TableHead>
              <TableHead className="h-11 text-[13px] font-semibold text-[#3B4759]">
                Started
              </TableHead>
              <TableHead className="h-11 text-right text-[13px] font-semibold text-[#3B4759]">
                Action
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-b border-[#D5DEDD]/50">
                <TableCell
                  colSpan={colSpan}
                  className="py-12 text-center text-[14px] font-semibold text-[#6A9B9C]/60"
                >
                  Loading…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow className="border-b border-[#D5DEDD]/50">
                <TableCell
                  colSpan={colSpan}
                  className="py-12 text-center text-[14px] font-semibold text-[#B8684B]"
                >
                  {error.message}
                </TableCell>
              </TableRow>
            ) : result && !result.configured ? (
              <TableRow className="border-b border-[#D5DEDD]/50">
                <TableCell
                  colSpan={colSpan}
                  className="py-12 text-center text-[14px] font-semibold text-[#6A9B9C]/60"
                >
                  Consultations are not available yet. Add QuickBlox credentials to enable video and
                  chat visits.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow className="border-b border-[#D5DEDD]/50">
                <TableCell
                  colSpan={colSpan}
                  className="py-12 text-center text-[14px] font-semibold text-[#6A9B9C]/60"
                >
                  No consultations started yet. Patients start a visit from the Consultation tab in
                  their portal.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <ConsultationRowView
                  key={row.id}
                  row={row}
                  showPatient={showPatient}
                  opening={openMut.isPending && openMut.variables?.consultationId === row.id}
                  onOpen={() => {
                    if (row.request_id) {
                      navigate({
                        to: "/admin/requests/$requestId/consultation",
                        params: { requestId: row.request_id },
                      });
                      return;
                    }
                    openMut.mutate({ consultationId: row.id });
                  }}
                  onOpenPatient={onOpenPatient}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ConsultationRowView({
  row,
  showPatient,
  opening,
  onOpen,
  onOpenPatient,
}: {
  row: ConsultationRow;
  showPatient?: boolean;
  opening: boolean;
  onOpen: () => void;
  onOpenPatient?: (userId: string) => void;
}) {
  return (
    <TableRow className="border-b border-[#D5DEDD] transition-colors hover:bg-[#E8EEED]/40">
      {showPatient ? (
        <TableCell>
          <button
            type="button"
            className="text-left"
            onClick={() => onOpenPatient?.(row.user_id)}
          >
            <div className="text-[14px] font-semibold text-[#3B4759]">
              {row.patient_name || "Unnamed patient"}
            </div>
            <div className="text-[12px] font-medium text-[#3B4759]/60">
              {row.patient_email || formatRecordId(row.user_id)}
            </div>
          </button>
        </TableCell>
      ) : null}
      <TableCell className="text-[14px] font-medium text-[#3B4759]">
        {row.medicine_name || "—"}
      </TableCell>
      <TableCell className="text-[14px] font-medium text-[#3B4759]/70">
        {row.plan_label || "—"}
      </TableCell>
      <TableCell>
        <Badge
          className={`rounded-lg border border-transparent px-2.5 py-0.5 text-[12px] font-semibold normal-case tracking-normal shadow-none ${STATUS_TONE[row.visit_status]}`}
        >
          {visitLabel(row.visit_status)}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-[14px] font-medium text-[#3B4759]/70">
        {formatDateTime(row.started_at)}
      </TableCell>
      <TableCell className="text-right">
        <Button
          type="button"
          onClick={onOpen}
          disabled={opening}
          className={`${adminBtnPrimary} h-9 px-4 text-[13px] sm:h-9`}
        >
          {opening ? "Opening…" : "Join visit"}
        </Button>
      </TableCell>
    </TableRow>
  );
}
