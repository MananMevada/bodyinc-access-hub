import { toastError } from "@/lib/toast-message";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
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
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { listClaimableRequests, claimRequest } from "@/lib/provider.functions";
import { requestStatusTone, REQUEST_STATUS_BADGE, clinicalStatusLabel } from "@/lib/request-status";
import { adminPageTitle, adminPageSubtitle, adminInput } from "@/lib/admin-ui";
import { formatDate, formatRecordId } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/provider/queue")({
  head: () => ({
    meta: [
      { title: "Order queue · Body Inc Practitioner" },
      { name: "description", content: "Order queue — Practitioner area of the Body Inc portal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProviderQueuePage,
});

function claimLocked(row: { claim_locked_at?: string | null }) {
  if (!row.claim_locked_at) return false;
  return Date.now() - new Date(row.claim_locked_at).getTime() < 45_000;
}

function ProviderQueuePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useServerFn(listClaimableRequests);
  const claim = useServerFn(claimRequest);
  const [search, setSearch] = useState("");
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const debounced = useDebouncedValue(search, 300);

  const q = useQuery({
    queryKey: ["provider-claimable", debounced],
    queryFn: () => list({ data: { search: debounced || undefined } }),
    refetchInterval: 10_000,
  });

  const claimMut = useMutation({
    mutationFn: (id: string) => {
      setClaimingId(id);
      return claim({ data: { requestId: id } });
    },
    onSuccess: (_res, id) => {
      toast.success("Order claimed.");
      qc.invalidateQueries({ queryKey: ["provider-claimable"] });
      qc.invalidateQueries({ queryKey: ["provider-dashboard"] });
      qc.invalidateQueries({ queryKey: ["requests"] });
      navigate({ to: "/provider/requests/$requestId", params: { requestId: id } });
    },
    onError: (e: Error) => toast.error(toastError(e)),
    onSettled: () => setClaimingId(null),
  });

  const rows = (q.data as any[]) ?? [];

  return (
    <div className="admin-page-shell space-y-5 font-['DM_Sans',sans-serif]">
      <div className="space-y-1">
        <h1 className={adminPageTitle}>Unassigned queue</h1>
        <p className={adminPageSubtitle}>
          Patients in your licensed states who finished intake and are in chat. If a provider is
          already assigned, the order is not listed here. Several medicines bought together show
          as one order.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#3B4759]/40" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patient or medicine…"
          className={`${adminInput} pl-9`}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#D5DEDD] bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Medication</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Intake</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-[14px] text-[#3B4759]/60">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-[14px] text-[#3B4759]/60">
                  Nothing waiting to be claimed right now.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-[#3B4759]">
                    <div>{r.patient_name}</div>
                    <div className="text-[12px] text-[#3B4759]/50">
                      {r.patient_id ? formatRecordId(r.patient_id) : "—"}
                      {r.dob ? ` · ${formatDate(r.dob)}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-[#3B4759]/80">{r.state_code}</TableCell>
                  <TableCell className="text-[#3B4759]/80">
                    <div>{r.medicine_name}</div>
                    {r.item_count > 1 ? (
                      <div className="text-[12px] text-[#3B4759]/50">{r.item_count} medicines</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-[#3B4759]/80">
                    {r.kind === "followup" ? "Renewal" : "Initial"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={`rounded-lg border-transparent px-2.5 py-0.5 text-[12px] font-semibold normal-case shadow-none ${
                        r.intake_filled
                          ? "bg-[#6A9B9C] text-white hover:bg-[#6A9B9C]"
                          : "bg-[#F6E4DA] text-[#8F4A33] hover:bg-[#F6E4DA]"
                      }`}
                    >
                      {r.intake_filled ? "Filled" : "Missing"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={`rounded-lg border-transparent px-2.5 py-0.5 text-[12px] font-semibold normal-case shadow-none ${
                        REQUEST_STATUS_BADGE[requestStatusTone(r.status)]
                      }`}
                    >
                        {clinicalStatusLabel(r.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 border-[#D5DEDD] text-[13px] font-semibold text-[#3B4759]"
                      onClick={() =>
                        navigate({
                          to: "/provider/requests/$requestId",
                          params: { requestId: r.id },
                        })
                      }
                    >
                      View
                    </Button>
                    <Button
                      size="sm"
                      className="h-9 bg-[#6A9B9C] text-[13px] font-semibold text-white hover:bg-[#5B8788] disabled:bg-[#E8EEED] disabled:text-[#3B4759]"
                      disabled={
                        !r.intake_filled ||
                        claimingId === r.id ||
                        (claimLocked(r) && claimingId !== r.id)
                      }
                      title={
                        !r.intake_filled
                          ? "intake form missing"
                          : claimLocked(r)
                            ? "This order is locked while another practitioner claims it."
                            : "Claim this order"
                      }
                      onClick={() => claimMut.mutate(r.id)}
                    >
                      {claimingId === r.id
                        ? "Claiming…"
                        : !r.intake_filled
                          ? "intake form missing"
                          : claimLocked(r)
                            ? "Locked"
                            : "Claim"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
