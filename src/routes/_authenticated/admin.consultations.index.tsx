import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { RefreshButton } from "@/components/admin/refresh-button";
import { ConsultationsTable } from "@/components/consultations-table";
import { listConsultations } from "@/lib/consultations.functions";
import { adminInput, adminPageSubtitle, adminPageTitle } from "@/lib/admin-ui";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { normalizeIdSearch } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/consultations/")({
  head: () => ({
    meta: [
      { title: "Consultations · Body Inc Admin" },
      {
        name: "description",
        content: "Patient video and chat consultations — Admin area of the Body Inc portal.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminConsultationsPage,
});

function AdminConsultationsPage() {
  const navigate = useNavigate();
  const list = useServerFn(listConsultations);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search);
  const searchTerm = normalizeIdSearch(debounced);

  const q = useQuery({
    queryKey: ["admin-consultations", { search: searchTerm }],
    queryFn: () => list({ data: { search: searchTerm || undefined } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="admin-page-shell !max-w-none space-y-5 sm:space-y-6 font-['DM_Sans',sans-serif]">
      <div className="admin-page-header">
        <div className="min-w-0 space-y-2 sm:space-y-4">
          <h2 className={adminPageTitle}>Consultations</h2>
          <p className={adminPageSubtitle}>
            Join video or chat visits that patients start from the Consultation tab. Each paid plan
            includes one visit.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshButton onClick={() => q.refetch()} loading={q.isFetching} />
        </div>
      </div>

      <div className="relative min-w-0 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#3B4759]/40" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patient, email, or medication…"
          className={`${adminInput} pl-9`}
        />
      </div>

      <ConsultationsTable
        result={q.data}
        loading={q.isLoading}
        error={(q.error as Error) ?? null}
        showPatient
        onOpenPatient={(userId) =>
          navigate({ to: "/admin/patients/$patientId", params: { patientId: userId } })
        }
      />
    </div>
  );
}
