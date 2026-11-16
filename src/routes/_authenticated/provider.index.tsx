import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { providerDashboard } from "@/lib/provider.functions";
import { adminCard, adminPageTitle, adminPageSubtitle } from "@/lib/admin-ui";
import { clinicalStatusLabel } from "@/lib/request-status";
import { formatRecordId } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/provider/")({
  head: () => ({
    meta: [
      { title: "Practitioner dashboard · Body Inc Practitioner" },
      {
        name: "description",
        content: "Practitioner dashboard — Practitioner area of the Body Inc portal.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProviderDashboard,
});

function greetingFor(date: Date) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 21) return "Good evening";
  return "Working late";
}

function useTimeGreeting() {
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setGreeting(greetingFor(new Date()));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);
  return greeting;
}

function ProviderDashboard() {
  const navigate = useNavigate();
  const greeting = useTimeGreeting();
  const get = useServerFn(providerDashboard);
  const q = useQuery({ queryKey: ["provider-dashboard"], queryFn: () => get({}) });
  const d = (q.data as any) ?? {};

  const heading = greeting
    ? `${greeting}${d.full_name ? `, ${d.full_name}` : ""}`
    : "Practitioner dashboard";

  const next = d.next_consultation as
    | {
        id: string;
        patient_name: string;
        medicine_name: string;
        patient_waiting?: boolean;
      }
    | null
    | undefined;
  const priority = (d.priority as any[]) ?? [];

  const tiles: {
    label: string;
    value: string | number;
    hint: string;
    onClick: () => void;
  }[] = [
    {
      label: "Needs review",
      value: d.pending_review ?? 0,
      hint: "Opens orders under review",
      onClick: () =>
        navigate({ to: "/provider/requests", search: { status: "pending_review" } }),
    },
    {
      label: "Next consultation",
      value: next ? next.patient_name : "None",
      hint: next
        ? `${next.medicine_name}${next.patient_waiting ? " · patient waiting" : ""}`
        : "No required consultation is waiting",
      onClick: () => {
        if (!next) {
          navigate({ to: "/provider/consultations" });
          return;
        }
        navigate({ to: "/provider/requests/$requestId", params: { requestId: next.id } });
      },
    },
    {
      label: "Ready to prescribe",
      value: d.approved ?? 0,
      hint: "Approved or prescribed, not yet at the pharmacy",
      onClick: () => navigate({ to: "/provider/requests", search: { status: "ready" } }),
    },
    {
      label: "Additional payment",
      value: d.awaiting_additional_payment ?? 0,
      hint: "Waiting for the patient to pay the price difference",
      onClick: () =>
        navigate({
          to: "/provider/requests",
          search: { status: "awaiting_additional_payment" },
        }),
    },
  ];

  return (
    <div className="admin-page-shell space-y-5 font-['DM_Sans',sans-serif]">
      <div className="space-y-1">
        <h1 className={adminPageTitle}>{heading}</h1>
        <p className={adminPageSubtitle}>Your workload at a glance.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => navigate({ to: "/provider/consultations" })}
          className="h-10 bg-[#152A51] px-4 text-[13px] font-semibold text-white hover:bg-[#1C3665]"
        >
          Consultation window
          {d.consultation_count ? ` (${d.consultation_count})` : ""}
        </Button>
        {next ? (
          <Button
            type="button"
            onClick={() =>
              navigate({
                to: "/provider/requests/$requestId/consultation",
                params: { requestId: next.id },
              })
            }
            className="h-10 bg-[#6A9B9C] px-4 text-[13px] font-semibold text-white hover:bg-[#5B8788]"
          >
            Join consultation
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate({ to: "/provider/queue" })}
          className="h-10 border-[#D5DEDD] text-[13px] font-semibold text-[#3B4759]"
        >
          Available to claim{q.isLoading ? "" : ` (${d.claimable ?? 0})`}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <button key={t.label} type="button" onClick={t.onClick} className="text-left">
            <Card className={`${adminCard} h-full transition-colors hover:bg-[#E8EEED]/50`}>
              <CardContent className="space-y-1 p-5">
                <div className="text-[13px] font-medium text-[#3B4759]/60">{t.label}</div>
                <div className="truncate text-[28px] font-bold leading-tight text-[#3B4759]">
                  {q.isLoading ? "—" : t.value}
                </div>
                <div className="text-[12px] text-[#3B4759]/60">{t.hint}</div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <Card className={adminCard}>
        <CardContent className="space-y-3 p-5">
          <div>
            <div className="text-[15px] font-semibold text-[#152A51]">Priority</div>
            <p className="text-[12px] text-[#3B4759]/60">
              Patient waiting, then ready to prescribe, then newly assigned.
            </p>
          </div>
          {priority.length === 0 ? (
            <p className="text-[14px] text-[#3B4759]/60">Nothing in your queue.</p>
          ) : (
            <ul className="divide-y divide-[#E8EEED]">
              {priority.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() =>
                      navigate({
                        to: "/provider/requests/$requestId",
                        params: { requestId: row.id },
                      })
                    }
                    className="flex w-full items-center justify-between gap-3 py-2 text-left"
                  >
                    <span>
                      <span className="block text-[14px] font-medium text-[#3B4759]">
                        {row.patient_name}
                        {row.patient_id ? (
                          <span className="ml-2 font-mono text-[12px] text-[#3B4759]/50">
                            {formatRecordId(row.patient_id)}
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-[12px] text-[#3B4759]/60">
                        {row.medicine_name}
                        {row.patient_waiting ? " · patient waiting" : ""}
                      </span>
                    </span>
                    <span className="text-[12px] font-semibold text-[#3B4759]">
                      {clinicalStatusLabel(row.status, row.plan_change_delta_cents)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
