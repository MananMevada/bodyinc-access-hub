import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  FileText,
  Repeat,
  Truck,
  Video,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequestNotes } from "@/components/admin/request-notes";
import { adminCard, adminSectionSubtitle, adminSectionTitle } from "@/lib/admin-ui";
import type { ClinicalAnswer, ClinicalIntake, PastOrder } from "@/lib/clinical-intake";
import { formatDate, formatDateTimeFull, formatRecordId } from "@/lib/format";
import {
  clinicalEventNote,
  clinicalStatusLabel,
  REQUEST_STATUS_BADGE,
  requestStatusTone,
} from "@/lib/request-status";

type Primary = {
  key: "claim" | "review" | "join" | "approve" | "prescribe" | "send";
  label: string;
  disabled?: boolean;
  disabledReason?: string;
};

export function OrderWorkspace({
  requestId,
  backTo,
  request,
  patient,
  medicine,
  planName,
  providerName,
  consultation,
  events,
  prescriptions,
  intake,
  pastOrders,
  orderItems = [],
  canClaim,
  canChange,
  canReject,
  claimPending,
  consultPending,
  outcomePending,
  remindPending,
  onClaim,
  onJoin,
  onApprove,
  onChange,
  onChangeItem,
  onReject,
  onPrescribe,
  onSend,
  onOutcome,
  onRemind,
  onEscalate,
  onSchedule,
  escalatePending,
  schedulePending,
}: {
  requestId: string;
  backTo: string;
  request: any;
  patient: any;
  medicine: any;
  planName: string | null;
  providerName: string | null;
  consultation: any;
  events: any[];
  prescriptions: any[];
  intake: ClinicalIntake | null;
  pastOrders: PastOrder[];
  orderItems?: {
    id: string;
    medicine_name: string;
    plan_name: string | null;
    status: string;
    provider_id: string | null;
  }[];
  canClaim: boolean;
  canChange: boolean;
  canReject: boolean;
  claimPending: boolean;
  consultPending: boolean;
  outcomePending: boolean;
  remindPending: boolean;
  onClaim: () => void;
  onJoin: () => void;
  onApprove: () => void;
  onChange: () => void;
  onChangeItem?: (requestId: string) => void;
  onReject: () => void;
  onPrescribe: () => void;
  onSend: () => void;
  onOutcome: (outcome: "no_show" | "call_dropped" | "reschedule") => void;
  onRemind: () => void;
  onEscalate: () => void;
  onSchedule: (mode: "instant" | "scheduled", scheduledAt?: string) => void;
  escalatePending: boolean;
  schedulePending: boolean;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const [reviewed, setReviewed] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"instant" | "scheduled">(
    request.consultation_mode === "scheduled" ? "scheduled" : "instant",
  );
  const [scheduleAt, setScheduleAt] = useState(
    request.consultation_scheduled_at
      ? String(request.consultation_scheduled_at).slice(0, 16)
      : "",
  );
  const status: string = request.status;
  const intakeFilled = Boolean(intake?.filled);
  const consultRequired = Boolean(request.requires_consultation);
  const consultDone = Boolean(consultation?.is_ended);
  const recordedOutcome = latestCallOutcome(events);
  const sent =
    ["sent_to_pharmacy", "dispatched", "delivered"].includes(status) ||
    (Boolean(request.life_file_order_id) && request.life_file_status !== "failed");

  const primary = primaryAction({
    status,
    canClaim,
    hasProvider: Boolean(providerName),
    intakeFilled,
    consultRequired,
    consultDone,
    reviewed,
    sent,
    claimPending,
    consultPending,
  });

  function runPrimary() {
    if (!primary || primary.disabled) return;
    if (primary.key === "claim") onClaim();
    else if (primary.key === "review") {
      setReviewed(true);
      setTab("intake");
    } else if (primary.key === "join") onJoin();
    else if (primary.key === "approve") onApprove();
    else if (primary.key === "prescribe") onPrescribe();
    else if (primary.key === "send") onSend();
  }

  return (
    <div className="space-y-5">
      <Link
        to={backTo}
        className="-ml-1 inline-flex h-9 items-center px-1 text-[14px] font-medium text-[#3B4759] hover:opacity-80"
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to orders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-mono text-[18px] font-semibold text-[#152A51]">
            Order ID {formatRecordId(request.id)}
          </h1>
          <p className="text-[13px] text-[#3B4759]/70">
            {request.kind === "followup" ? "Renewal order" : "Initial order"} ·{" "}
            {formatDateTimeFull(request.created_at)}
          </p>
        </div>
        <Badge
          className={`rounded-lg border-transparent px-2.5 py-0.5 text-[12px] font-semibold normal-case shadow-none ${
            REQUEST_STATUS_BADGE[requestStatusTone(status)]
          }`}
        >
          {clinicalStatusLabel(status, request.plan_change_delta_cents)}
        </Badge>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          if (value === "intake") setReviewed(true);
        }}
      >
        <TabsList className="h-auto flex-wrap justify-start bg-[#E8EEED]">
          {["overview", "intake", "consultation", "notes", "history"].map((key) => (
            <TabsTrigger key={key} value={key} className="capitalize">
              {key === "intake" ? "Eligibility" : key}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <Card className={adminCard}>
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className={adminSectionTitle}>Overview</CardTitle>
              <CardDescription className={adminSectionSubtitle}>
                Review the intake, join the consultation if it is required, then approve, prescribe,
                and send to the pharmacy. All of that stays on this order.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
              <div className="grid gap-4 text-[14px] sm:grid-cols-2">
                <Field label="Patient" value={patient?.name ?? "—"} />
                <Field
                  label="Patient ID"
                  value={patient?.id ? formatRecordId(patient.id) : "—"}
                />
                <Field label="Date of birth" value={patient?.dob ? formatDate(patient.dob) : "—"} />
                <Field label="State" value={patient?.state_code ?? "—"} />
                <Field
                  label="Medication"
                  value={
                    orderItems.length > 1
                      ? orderItems.map((item) => item.medicine_name).join(", ")
                      : (medicine?.name ?? "—")
                  }
                />
                <Field
                  label="Plan"
                  value={
                    orderItems.length > 1
                      ? orderItems.map((item) => item.plan_name || "Plan").join(", ")
                      : (planName ?? "—")
                  }
                />
                <Field
                  label="Status"
                  value={clinicalStatusLabel(status, request.plan_change_delta_cents)}
                />
                <Field label="Assigned provider" value={providerName ?? "Unassigned"} />
              </div>

              {consultRequired && !consultDone && status === "pending_review" ? (
                <p className="rounded-lg bg-[#FFF4E5] px-3 py-2 text-[13px] font-medium text-[#B45309]">
                  This consultation is required and has not been finished. Join the consultation before
                  you approve.
                </p>
              ) : null}
              {!intakeFilled ? (
                <p className="rounded-lg bg-[#F6E4DA] px-3 py-2 text-[13px] font-medium text-[#8F4A33]">
                  Intake form missing. Claiming and approval stay blocked until the patient submits
                  it.
                </p>
              ) : null}
              {status === "awaiting_additional_payment" ? (
                <div className="space-y-2 rounded-lg bg-[#FFF4E5] px-3 py-2 text-[13px] font-medium text-[#B45309]">
                  <p>
                    {Number(request.plan_change_delta_cents) > 0
                      ? "Waiting for the patient to pay the difference or decline it. Payment sends the prescription to the pharmacy. A decline, or no response within 7 days, restores the previous medicine and plan."
                      : "Waiting for the patient to approve or reject this change. Approval sends the prescription to the pharmacy. A rejection, or no response within 7 days, restores the previous medicine and plan."}{" "}
                  </p>
                  <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={remindPending}
                      onClick={onRemind}
                      className="h-9 border-[#E7CFC3] text-[13px] font-semibold text-[#8F4A33]"
                    >
                      {remindPending ? "Sending…" : "Send reminder"}
                    </Button>
                </div>
              ) : null}

              {orderItems.length > 1 ? (
                <div className="space-y-2 rounded-lg border border-[#D5DEDD] p-3">
                  <div className="text-[13px] font-semibold text-[#152A51]">
                    Medicines in this order
                  </div>
                  <p className="text-[12px] text-[#3B4759]/70">
                    These were purchased together and share one consultation. Change each medicine
                    from here if the plan needs to be different.
                  </p>
                  {orderItems.map((item) => {
                    const lineChangeable =
                      ["pending_review", "approved", "awaiting_additional_payment"].includes(
                        item.status,
                      ) && Boolean(onChangeItem);
                    return (
                      <div
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E8EEED] pt-2"
                      >
                        <div>
                          <div className="text-[14px] font-medium text-[#3B4759]">
                            {item.medicine_name}
                          </div>
                          <div className="text-[12px] text-[#3B4759]/60">
                            {item.plan_name ?? "Plan"} · {clinicalStatusLabel(item.status)}
                          </div>
                        </div>
                        {lineChangeable ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onChangeItem?.(item.id)}
                            className="h-9 border-[#D5DEDD] text-[13px] font-semibold text-[#3B4759]"
                          >
                            <Repeat className="mr-1 h-4 w-4" /> Change
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t border-[#D5DEDD] pt-4">
                {primary ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={primary.disabled}
                    title={primary.disabledReason}
                    onClick={runPrimary}
                    className="h-10 bg-[#6A9B9C] px-4 text-[13px] font-semibold text-white hover:bg-[#5B8788]"
                  >
                    <PrimaryIcon name={primary.key} />
                    {primary.disabled && primary.disabledReason
                      ? primary.disabledReason
                      : primary.label}
                  </Button>
                ) : null}
                {canChange ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onChange}
                    className="h-10 border-[#D5DEDD] px-4 text-[13px] font-semibold text-[#3B4759]"
                  >
                    <Repeat className="mr-1 h-4 w-4" /> Change medicine
                  </Button>
                ) : null}
                {providerName && !sent && !["rejected", "cancelled", "refunded"].includes(status) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={escalatePending}
                    onClick={onEscalate}
                    className="h-10 border-[#D5DEDD] px-4 text-[13px] font-semibold text-[#3B4759]"
                  >
                    {escalatePending ? "Escalating…" : "Escalate to another provider"}
                  </Button>
                ) : null}
                {canReject ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onReject}
                    className="h-10 border-[#E7CFC3] px-4 text-[13px] font-semibold text-[#8F4A33] hover:bg-[#F6E4DA]"
                  >
                    <X className="mr-1 h-4 w-4" /> Reject
                  </Button>
                ) : null}
              </div>

              {prescriptions.length > 0 ? (
                <div className="space-y-2 border-t border-[#D5DEDD] pt-4">
                  <div className="text-[13px] font-medium text-[#3B4759]/60">Prescription</div>
                  {prescriptions.map((rx) => (
                    <div key={rx.id} className="rounded-lg border border-[#D5DEDD] p-3 text-[14px]">
                      <div className="font-semibold text-[#3B4759]">{rx.medicine_name}</div>
                      <div className="text-[#3B4759]/80">
                        {rx.directions || "Directions to be added from the template."}
                      </div>
                      <div className="text-[12px] text-[#3B4759]/60">
                        {rx.status} · {formatDateTimeFull(rx.created_at)}
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Link
                          to="/rx/$prescriptionId"
                          params={{ prescriptionId: rx.id }}
                          search={{ download: false }}
                          target="_blank"
                          className="rounded-md border border-[#6A9B9C] px-3 py-1.5 text-[13px] font-semibold text-[#3B4759]"
                        >
                          View
                        </Link>
                        <Link
                          to="/rx/$prescriptionId"
                          params={{ prescriptionId: rx.id }}
                          search={{ download: true }}
                          target="_blank"
                          className="rounded-md bg-[#6A9B9C] px-3 py-1.5 text-[13px] font-semibold text-white"
                        >
                          Download
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="intake">
          <IntakePanel intake={intake} />
        </TabsContent>

        <TabsContent value="consultation">
          <Card className={adminCard}>
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className={adminSectionTitle}>Consultation</CardTitle>
              <CardDescription className={adminSectionSubtitle}>
                {consultRequired
                  ? "Required before approval."
                  : "Not required for this order. You can still join if the patient is in a visit."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0 text-[14px] sm:p-6 sm:pt-0">
              <Field
                label="Status"
                value={
                  consultation
                    ? consultation.is_ended
                      ? "Completed"
                      : "In progress"
                    : consultRequired
                      ? "Required (not started)"
                      : "Not required"
                }
              />
              <Field
                label="Schedule"
                value={
                  request.consultation_mode === "scheduled" && request.consultation_scheduled_at
                    ? `Scheduled · ${formatDateTimeFull(request.consultation_scheduled_at)}`
                    : consultation?.started_at
                      ? `Instant · started ${formatDateTimeFull(consultation.started_at)}`
                      : consultRequired
                        ? "Instant — join when the patient is ready"
                        : "Instant"
                }
              />
              <div className="space-y-2 rounded-lg border border-[#D5DEDD] p-3">
                <div className="text-[13px] font-medium text-[#3B4759]">Set consultation</div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={scheduleMode === "instant" ? "default" : "outline"}
                    onClick={() => setScheduleMode("instant")}
                    className="h-9 text-[13px]"
                  >
                    Instant
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={scheduleMode === "scheduled" ? "default" : "outline"}
                    onClick={() => setScheduleMode("scheduled")}
                    className="h-9 text-[13px]"
                  >
                    Scheduled
                  </Button>
                </div>
                {scheduleMode === "scheduled" ? (
                  <input
                    type="datetime-local"
                    value={scheduleAt}
                    onChange={(e) => setScheduleAt(e.target.value)}
                    className="h-10 rounded-md border border-[#D5DEDD] px-3 text-[13px] text-[#3B4759]"
                  />
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  disabled={schedulePending || (scheduleMode === "scheduled" && !scheduleAt)}
                  onClick={() =>
                    onSchedule(
                      scheduleMode,
                      scheduleMode === "scheduled" ? new Date(scheduleAt).toISOString() : undefined,
                    )
                  }
                  className="h-9 bg-[#6A9B9C] text-[13px] font-semibold text-white hover:bg-[#5B8788]"
                >
                  {schedulePending ? "Saving…" : "Save schedule"}
                </Button>
              </div>
              {consultation?.is_ended || recordedOutcome ? (
                <Field
                  label="Call outcome"
                  value={
                    recordedOutcome ??
                    (consultation?.ended_at
                      ? `Completed ${formatDateTimeFull(consultation.ended_at)}`
                      : "Completed")
                  }
                />
              ) : null}
              {consultation && !consultation.is_ended ? (
                <p className="text-[13px] font-medium text-[#B45309]">Patient waiting</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    (!consultation?.is_ended && consultPending) ||
                    ["rejected", "cancelled", "delivered"].includes(status)
                  }
                  onClick={() => {
                    if (consultation?.is_ended) {
                      navigate({
                        to: "/provider/requests/$requestId/consultation",
                        params: { requestId },
                      });
                      return;
                    }
                    onJoin();
                  }}
                  className="h-10 bg-[#6A9B9C] px-4 text-[13px] font-semibold text-white hover:bg-[#5B8788]"
                >
                  <Video className="mr-1 h-4 w-4" />
                  {consultation?.is_ended
                    ? "Open call record"
                    : consultPending
                      ? "Connecting…"
                      : "Join consultation"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={outcomePending}
                  onClick={() => onOutcome("no_show")}
                  className="h-10 border-[#D5DEDD] text-[13px] font-semibold text-[#3B4759]"
                >
                  Mark no-show
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={outcomePending}
                  onClick={() => onOutcome("call_dropped")}
                  className="h-10 border-[#D5DEDD] text-[13px] font-semibold text-[#3B4759]"
                >
                  Call dropped
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={outcomePending}
                  onClick={() => {
                    setScheduleMode("scheduled");
                    onOutcome("reschedule");
                  }}
                  className="h-10 border-[#D5DEDD] text-[13px] font-semibold text-[#3B4759]"
                >
                  Reschedule
                </Button>
              </div>
              <p className="text-[12px] text-[#3B4759]/60">
                No-show, a dropped call, or a reschedule stays on this order. Join again when the
                patient is back. Notes you add afterward are internal.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes">
          <RequestNotes requestId={requestId} />
        </TabsContent>

        <TabsContent value="history">
          <div className="space-y-4">
            <Card className={adminCard}>
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className={adminSectionTitle}>Status timeline</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
                <ol className="space-y-3">
                  {events.map((ev) => (
                    <li key={ev.id} className="flex gap-3 text-[14px]">
                      <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#6A9B9C]" />
                      <div>
                        <div className="font-medium text-[#3B4759]">
                          {clinicalStatusLabel(ev.status)}
                        </div>
                        <div className="text-[12px] text-[#3B4759]/60">
                          {ev.actor_role} · {formatDateTimeFull(ev.created_at)}
                        </div>
                        {ev.note ? (
                          <div className="text-[13px] text-[#3B4759]/80">
                            {clinicalEventNote(ev.note)}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            <Card className={adminCard}>
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className={adminSectionTitle}>Past orders</CardTitle>
                <CardDescription className={adminSectionSubtitle}>
                  Earlier orders and internal notes for this patient, including renewals.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-0 sm:p-6 sm:pt-0">
                {pastOrders.length === 0 ? (
                  <p className="text-[14px] text-[#3B4759]/60">No earlier orders.</p>
                ) : (
                  pastOrders.map((order) => (
                    <div key={order.id} className="rounded-lg border border-[#D5DEDD] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[14px] font-medium text-[#3B4759]">
                            {formatRecordId(order.id)} · {order.medicine_name}
                          </div>
                          <div className="text-[12px] text-[#3B4759]/60">
                            {order.kind === "followup" ? "Renewal" : "Initial"} ·{" "}
                            {formatDateTimeFull(order.created_at)}
                          </div>
                        </div>
                        <Badge
                          className={`rounded-lg border-transparent px-2.5 py-0.5 text-[12px] font-semibold normal-case shadow-none ${
                            REQUEST_STATUS_BADGE[requestStatusTone(order.status)]
                          }`}
                        >
                          {clinicalStatusLabel(order.status)}
                        </Badge>
                      </div>
                      {order.notes.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {order.notes.map((note) => (
                            <li key={note.id} className="text-[13px] text-[#3B4759]/80">
                              {note.body}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-[12px] text-[#3B4759]/50">No prior notes.</p>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function latestCallOutcome(events: { status?: string; created_at?: string }[]): string | null {
  const latest = [...events]
    .reverse()
    .find((ev) =>
      ["consultation_no_show", "consultation_dropped", "consultation_reschedule"].includes(
        ev.status ?? "",
      ),
    );
  if (latest?.status === "consultation_no_show") return "Patient no-show";
  if (latest?.status === "consultation_dropped") return "Call dropped";
  if (latest?.status === "consultation_reschedule") return "Reschedule requested";
  return null;
}

function primaryAction(input: {
  status: string;
  canClaim: boolean;
  hasProvider: boolean;
  intakeFilled: boolean;
  consultRequired: boolean;
  consultDone: boolean;
  reviewed: boolean;
  sent: boolean;
  claimPending: boolean;
  consultPending: boolean;
}): Primary | null {
  if (!input.hasProvider && input.canClaim && !input.sent) {
    if (!input.intakeFilled) {
      return { key: "claim", label: "Claim", disabled: true, disabledReason: "intake form missing" };
    }
    return {
      key: "claim",
      label: input.claimPending ? "Claiming…" : "Claim",
      disabled: input.claimPending,
    };
  }
  if (input.sent || ["rejected", "cancelled", "delivered"].includes(input.status)) return null;
  if (
    !input.intakeFilled &&
    ["pending_review", "payment_completed", "provider_assigned", "awaiting_additional_payment"].includes(
      input.status,
    )
  ) {
    return null;
  }
  if (input.consultRequired && !input.consultDone && input.status === "pending_review") {
    return {
      key: "join",
      label: input.consultPending ? "Connecting…" : "Join consultation",
      disabled: input.consultPending,
    };
  }
  if (input.status === "pending_review") {
    if (!input.intakeFilled) {
      return { key: "approve", label: "Approve", disabled: true, disabledReason: "intake form missing" };
    }
    if (!input.reviewed) return { key: "review", label: "Review" };
    return { key: "approve", label: "Approve" };
  }
  if (input.status === "approved") return { key: "prescribe", label: "Prescribe" };
  if (input.status === "prescribed") return { key: "send", label: "Send to pharmacy" };
  return null;
}

function PrimaryIcon({ name }: { name: Primary["key"] }) {
  if (name === "approve" || name === "review") return <Check className="mr-1 h-4 w-4" />;
  if (name === "join") return <Video className="mr-1 h-4 w-4" />;
  if (name === "prescribe") return <FileText className="mr-1 h-4 w-4" />;
  if (name === "send") return <Truck className="mr-1 h-4 w-4" />;
  return null;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[13px] font-medium text-[#3B4759]/60">{label}</div>
      <div className="text-[14px] font-medium text-[#3B4759]">{value}</div>
    </div>
  );
}

function IntakePanel({ intake }: { intake: ClinicalIntake | null }) {
  if (!intake?.filled) {
    return (
      <Card className={adminCard}>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className={adminSectionTitle}>Intake form</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 text-[14px] text-[#8F4A33] sm:p-6 sm:pt-0">
          Intake form missing. There is nothing to review until the patient submits it.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {intake.red_flags.length > 0 ? (
        <Card className="border-[#E7CFC3] bg-[#F6E4DA]">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-[16px] text-[#8F4A33]">Red flags</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0 sm:p-6 sm:pt-0">
            {intake.red_flags.map((flag, i) => (
              <div key={`${flag.label}-${i}`}>
                <div className="text-[14px] font-semibold text-[#8F4A33]">{flag.label}</div>
                <div className="text-[13px] text-[#3B4759]">{flag.detail}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className={adminCard}>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className={adminSectionTitle}>Vitals</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 pt-0 sm:grid-cols-3 sm:p-6 sm:pt-0">
          <Field label="Height" value={intake.height_cm ? `${intake.height_cm} cm` : "—"} />
          <Field label="Weight" value={intake.weight_kg ? `${intake.weight_kg} kg` : "—"} />
          <Field label="BMI" value={intake.bmi ?? "—"} />
        </CardContent>
      </Card>

      <AnswerGroup title="Allergies" rows={intake.allergies} empty="No allergy answers recorded." />
      <AnswerGroup
        title="Current medications"
        rows={intake.medications}
        empty="No medication answers recorded."
      />
      <AnswerGroup title="History" rows={intake.history} empty="No history answers recorded." />
      <AnswerGroup title="Other answers" rows={intake.other} empty="No other answers." />
    </div>
  );
}

function AnswerGroup({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: ClinicalAnswer[];
  empty: string;
}) {
  return (
    <Card className={adminCard}>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className={adminSectionTitle}>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0 sm:p-6 sm:pt-0">
        {rows.length === 0 ? (
          <p className="text-[14px] text-[#3B4759]/60">{empty}</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className={row.redFlag ? "rounded-md bg-[#F6E4DA] p-2" : ""}>
              <div className="text-[13px] text-[#3B4759]/60">{row.prompt}</div>
              <div className="text-[14px] font-medium text-[#3B4759]">{row.answer}</div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
