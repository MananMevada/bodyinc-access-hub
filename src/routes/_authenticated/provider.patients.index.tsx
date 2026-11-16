import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
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
import { listMyPatients } from "@/lib/provider.functions";
import { requestStatusTone, REQUEST_STATUS_BADGE, clinicalStatusLabel } from "@/lib/request-status";
import { adminPageTitle, adminPageSubtitle, adminInput } from "@/lib/admin-ui";
import { formatDate, formatRecordId } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/provider/patients/")({
  head: () => ({
    meta: [
      { title: "My patients · Body Inc Practitioner" },
      { name: "description", content: "My patients — Practitioner area of the Body Inc portal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProviderPatientsPage,
});

function ProviderPatientsPage() {
  const navigate = useNavigate();
  const list = useServerFn(listMyPatients);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 300);

  const q = useQuery({
    queryKey: ["provider-patients", debounced],
    queryFn: () => list({ data: { search: debounced || undefined } }),
  });

  const rows = (q.data as any[]) ?? [];

  return (
    <div className="admin-page-shell space-y-5 font-['DM_Sans',sans-serif]">
      <div className="space-y-1">
        <h1 className={adminPageTitle}>My patients</h1>
        <p className={adminPageSubtitle}>
          Everyone assigned to you, including finished orders. This is a directory. To approve, prescribe,
          or join a consultation, open the order from My Requests.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#3B4759]/40" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, medicine or state…"
          className={`${adminInput} pl-9`}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#D5DEDD] bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Patient ID</TableHead>
              <TableHead>Date of birth</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Latest medication</TableHead>
              <TableHead>Latest status</TableHead>
              <TableHead className="text-right">Orders</TableHead>
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
                  No patients assigned to you yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((p) => (
                <TableRow
                  key={p.key}
                  className="cursor-pointer"
                  onClick={() =>
                    navigate({
                      to: "/provider/patients/$patientKey",
                      params: { patientKey: p.key },
                    })
                  }
                >
                  <TableCell className="font-medium text-[#3B4759]">
                    {p.name}
                    {p.is_guest ? (
                      <span className="ml-2 text-[12px] text-[#3B4759]/50">guest</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-[13px] text-[#3B4759]/80">
                    {p.patient_id ? formatRecordId(p.patient_id) : "—"}
                  </TableCell>
                  <TableCell className="text-[#3B4759]/80">
                    {p.dob ? formatDate(p.dob) : "—"}
                  </TableCell>
                  <TableCell className="text-[#3B4759]/80">{p.state_code ?? "—"}</TableCell>
                  <TableCell className="text-[#3B4759]/80">{p.latest_medicine}</TableCell>
                  <TableCell>
                    <Badge
                      className={`rounded-lg border-transparent px-2.5 py-0.5 text-[12px] font-semibold normal-case shadow-none ${
                        REQUEST_STATUS_BADGE[requestStatusTone(p.latest_status)]
                      }`}
                    >
                      {clinicalStatusLabel(p.latest_status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-[13px] font-semibold text-[#6A9B9C]">
                      {p.order_count} order{p.order_count === 1 ? "" : "s"}
                    </span>
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
