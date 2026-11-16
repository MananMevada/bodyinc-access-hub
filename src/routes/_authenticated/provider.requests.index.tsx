import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequestList } from "@/components/admin/request-list";

const STATUS_TABS = [
  { value: "pending_review", label: "Under review" },
  { value: "awaiting_additional_payment", label: "Additional payment" },
  { value: "ready", label: "Ready to prescribe" },
  { value: "sent_to_pharmacy", label: "Sent to pharmacy" },
  { value: "rejected", label: "Rejected" },
];

const STATUSES = new Set(STATUS_TABS.map((tab) => tab.value));

export const Route = createFileRoute("/_authenticated/provider/requests/")({
  head: () => ({
    meta: [
      { title: "My orders · Body Inc Practitioner" },
      { name: "description", content: "My orders — Practitioner area of the Body Inc portal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    status: typeof search.status === "string" && STATUSES.has(search.status) ? search.status : "pending_review",
  }),
  component: ProviderRequestsPage,
});

function ProviderRequestsPage() {
  const navigate = useNavigate();
  const { status } = Route.useSearch();
  return (
    <RequestList
      title="My Requests"
      subtitle="Orders assigned to you. Under review is the list to finish first. Consultations can show more rows because it also includes visits that are scheduled or already in progress."
      showProvider={false}
      clinicalOnly
      initialStatus={status}
      statusTabs={STATUS_TABS}
      onOpen={(id) => navigate({ to: "/provider/requests/$requestId", params: { requestId: id } })}
      preloadTo="/provider/requests/$requestId"
    />
  );
}
