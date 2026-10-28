import { sentenceCase } from "@/lib/text-normalize";
import { toastError, toastActionWithEmail } from "@/lib/toast-message";
import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  RefreshCw,
  Repeat,
  Truck,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getRequest,
  approveRequest,
  rejectRequest,
  generatePrescription,
  advanceRequestStatus,
  assignRequestProvider,
  retryLifeFileSubmission,
  sendRequestToPharmacy,
} from "@/lib/requests.functions";
import { listProviders } from "@/lib/providers.functions";
import { claimRequest } from "@/lib/provider.functions";
import {
  requestStatusLabel,
  requestStatusTone,
  REQUEST_STATUS_BADGE,
  nextFulfillmentStep,
  clinicalStatusLabel,
  clinicalEventNote,
} from "@/lib/request-status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { adminSectionTitle, adminSectionSubtitle, adminCard } from "@/lib/admin-ui";
import { RequestChangeMedicineDialog } from "@/components/admin/request-change-medicine-dialog";
import { RequestNotes } from "@/components/admin/request-notes";
import {
  startRequestConsultation,
  finishConsultationAppointment,
} from "@/lib/consultations.functions";
import { formatCents, formatDateTimeFull, formatRecordId } from "@/lib/format";

export function RequestReviewPanel({
  requestId,
  backTo,
  canManage = false,
  clinicalOnly = false,
  canClaim = false,
}: {
  requestId: string;
  backTo: string;
  canManage?: boolean;
  /** Practitioner view: hide patient contact / billing details. */
  clinicalOnly?: boolean;
  /** Practitioner view: allow claiming an unassigned order. */
  canClaim?: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const get = useServerFn(getRequest);
  const approve = useServerFn(approveRequest);
  const reject = useServerFn(rejectRequest);
  const generate = useServerFn(generatePrescription);
  const advance = useServerFn(advanceRequestStatus);
  const retryLf = useServerFn(retryLifeFileSubmission);
  const sendPharmacy = useServerFn(sendRequestToPharmacy);
  const assign = useServerFn(assignRequestProvider);
  const listProv = useServerFn(listProviders);
  const claim = useServerFn(claimRequest);
  const startConsult = useServerFn(startRequestConsultation);
  const finishConsult = useServerFn(finishConsultationAppointment);

  const q = useQuery({
    queryKey: ["request", requestId],
    queryFn: () => get({ data: { requestId } }),
  });

  const providersQ = useQuery({
    queryKey: ["assignable-providers"],
    queryFn: () => listProv({ data: { status: "active" } }),
    enabled: canManage,
  });

  const [changeOpen, setChangeOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [rxOpen, setRxOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [sendPharmacyOpen, setSendPharmacyOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [activeConsultation, setActiveConsultation] = useState<{
    embedUrl: string;
    externalUrl: string;
  } | null>(null);
  const [iframeLoading, setIframeLoading] = useState(true);
  const consultCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeConsultation) {
      consultCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [activeConsultation]);

  const [directions, setDirections] = useState("");
  const [approveNote, setApproveNote] = useState("");
  const [trackOpen, setTrackOpen] = useState(false);
  const [tracking, setTracking] = useState("");
  const [assignId, setAssignId] = useState("");
  const patientState = (((q.data as any)?.patient?.state_code as string | undefined) ?? "")
    .trim()
    .toUpperCase();
  const matchingProviders = ((providersQ.data as any[]) ?? []).filter((p) => {
    const states = ((p.license_states ?? []) as string[]).map((s) => String(s).toUpperCase());
    return patientState ? states.includes(patientState) : false;
  });

  const assignMut = useMutation({
    mutationFn: () => assign({ data: { requestId, providerId: assignId || null } }),
    onSuccess: (res) => {
      if ((res as { alreadyAssigned?: boolean })?.alreadyAssigned) {
        toast.message(
          `Already assigned to ${(res as { providerName?: string }).providerName ?? "this provider"}.`,
        );
      } else {
        toast.success("Provider assigned.");
      }
      setAssignId("");
      refresh();
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const claimMut = useMutation({
    mutationFn: () => claim({ data: { requestId } }),
    onSuccess: () => {
      toast.success("Order claimed — it's now assigned to you.");
      qc.invalidateQueries({ queryKey: ["provider-claimable"] });
      qc.invalidateQueries({ queryKey: ["provider-dashboard"] });
      refresh();
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const consultMut = useMutation({
    mutationFn: async () => startConsult({ data: { requestId } }),
    onSuccess: (res) => {
      if (!res.ok) {
        if (consultation) {
          refresh();
          navigate({
            to: clinicalOnly
              ? "/provider/requests/$requestId/consultation"
              : "/admin/requests/$requestId/consultation",
            params: { requestId },
          });
          return;
        }
        toast.error(res.message);
        return;
      }
      refresh();
      navigate({
        to: clinicalOnly
          ? "/provider/requests/$requestId/consultation"
          : "/admin/requests/$requestId/consultation",
        params: { requestId },
      });
    },
    onError: (e: Error) => {
      if (consultation) {
        navigate({
          to: clinicalOnly
            ? "/provider/requests/$requestId/consultation"
            : "/admin/requests/$requestId/consultation",
          params: { requestId },
        });
        return;
      }
      toast.error(toastError(e));
    },
  });

  const finishConsultMut = useMutation({
    mutationFn: () => finishConsult({ data: { requestId } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Consultation concluded successfully.");
      setFinishOpen(false);
      refresh();
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["request", requestId] });
    qc.invalidateQueries({ queryKey: ["requests"] });
    qc.invalidateQueries({ queryKey: ["open-request-count"] });
  }

  const approveMut = useMutation({
    mutationFn: () =>
      approve({
        data: {
          requestId,
          note: sentenceCase(approveNote) || undefined,
        },
      }),
    onSuccess: (res) => {
      if (res?.pharmacy_error) {
        toast.error(res.pharmacy_error);
        refresh();
        return;
      }
      toastActionWithEmail("Order approved and sent to LifeFile.", res?.email_sent);
      setApproveOpen(false);
      setApproveNote("");
      refresh();
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const sendPharmacyMut = useMutation({
    mutationFn: () =>
      sendPharmacy({
        data: {
          requestId,
          directions: sentenceCase(directions) || undefined,
        },
      }),
    onSuccess: (res) => {
      toastActionWithEmail(
        res?.lifeFileOrderId ? `Sent to LifeFile: ${res.lifeFileOrderId}` : "Sent to pharmacy.",
        res?.email_sent,
      );
      setSendPharmacyOpen(false);
      setDirections("");
      refresh();
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const retryLfMut = useMutation({
    mutationFn: () => retryLf({ data: { requestId } }),
    onSuccess: (res) => {
      toastActionWithEmail(
        res?.lifeFileOrderId
          ? `Life File order created: ${res.lifeFileOrderId}`
          : "LifeFile submission retried.",
        res?.email_sent,
      );
      refresh();
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const rejectMut = useMutation({
    mutationFn: () => reject({ data: { requestId, note: sentenceCase(rejectNote) || undefined } }),
    onSuccess: (res) => {
      toastActionWithEmail(
        clinicalOnly ? "Order rejected." : "Order rejected and refunded.",
        res?.email_sent,
      );
      setRejectOpen(false);
      setRejectNote("");
      refresh();
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const generateMut = useMutation({
    mutationFn: () =>
      generate({ data: { requestId, directions: sentenceCase(directions) || undefined } }),
    onSuccess: (res) => {
      toastActionWithEmail("Prescription generated.", res?.email_sent);
      setRxOpen(false);
      setDirections("");
      refresh();
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const advanceMut = useMutation({
    mutationFn: (vars: {
      status: "sent_to_pharmacy" | "dispatched" | "delivered";
      trackingNumber?: string;
    }) => advance({ data: { requestId, ...vars } }),
    onSuccess: (result) => {
      const ok = result.lifeFileOrderId
        ? `Life File order created: ${result.lifeFileOrderId}`
        : "Status updated.";
      toastActionWithEmail(ok, result.email_sent);

      setTrackOpen(false);
      setTracking("");
      refresh();
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  if (q.isLoading) {
    return (
      <div className="admin-page-shell font-['DM_Sans',sans-serif] text-[14px] font-medium text-[#3B4759]/60">
        Loading order…
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="admin-page-shell space-y-3 font-['DM_Sans',sans-serif]">
        <Link
          to={backTo}
          className="inline-flex items-center text-[14px] font-medium text-[#3B4759]"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Link>
        <div className="text-[14px] font-semibold text-[#B8684B]">
          {(q.error as Error)?.message ?? "Order not found"}
        </div>
      </div>
    );
  }

  const {
    request,
    patient,
    medicine,
    package: pkg,
    provider,
    consultation,
    events,
    prescriptions,
    additional_payments,
  } = q.data as any;

  const status: string = request.status;
  const isUnassigned = !provider;
  const needsProviderAssignment = status === "pending_review" && canManage && !provider;
  const waitingOnProvider = status === "pending_review" && canManage && !!provider;
  const canReject =
    (status === "pending_review" || status === "awaiting_additional_payment") &&
    (!clinicalOnly || !isUnassigned);
  const canChange =
    ["pending_review", "approved", "awaiting_additional_payment"].includes(status) &&
    (!clinicalOnly || !isUnassigned);
  const canGenerate = status === "approved" && canManage;
  const canStartConsult =
    canManage &&
    Boolean(request.user_id) &&
    !["rejected", "delivered", "canceled", "cancelled"].includes(status);
  const lifeFileOrderId =
    (request as { life_file_order_id?: string | null }).life_file_order_id ||
    (events as { note?: string | null }[])
      .map((ev) => ev.note)
      .find((note) => typeof note === "string" && note.startsWith("Life File order ID:"))
      ?.replace("Life File order ID: ", "");
  const lifeFileStatus = (request as { life_file_status?: string | null }).life_file_status ?? null;
  const lifeFileError = (request as { life_file_error?: string | null }).life_file_error ?? null;
  const sentToLifeFile =
    ["sent_to_pharmacy", "dispatched", "delivered"].includes(status) ||
    (Boolean(lifeFileOrderId) && lifeFileStatus !== "failed");
  const canApprove =
    clinicalOnly &&
    !isUnassigned &&
    !sentToLifeFile &&
    ["pending_review", "approved", "prescribed"].includes(status);
  const canRetryLifeFile = lifeFileStatus === "failed" && canManage;
  const canSendToPharmacy =
    canManage &&
    !sentToLifeFile &&
    (["approved", "prescribed"].includes(status) ||
      (status === "pending_review" && lifeFileStatus === "failed"));
  const nextStep =
    canManage && !(lifeFileStatus === "failed" && status === "prescribed")
      ? nextFulfillmentStep(status)
      : clinicalOnly
        ? null
        : nextFulfillmentStep(status);
  // Providers don't advance fulfillment (dispatch/deliver); admins do.
  const fulfillmentStep = canManage ? nextStep : null;
  // When admin can send to pharmacy from approved/prescribed, hide the old "Mark sent" step.
  const showFulfillmentStep =
    fulfillmentStep && !(canSendToPharmacy && fulfillmentStep.status === "sent_to_pharmacy");

  return (
    <div className="admin-page-shell space-y-5 sm:space-y-6 font-['DM_Sans',sans-serif]">
      <Link
        to={backTo}
        className="inline-flex h-9 items-center -ml-1 px-1 text-[14px] font-medium text-[#3B4759] hover:opacity-80"
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to orders
      </Link>

      <Card className={adminCard}>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 p-4 sm:p-6">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className={`${adminSectionTitle} font-mono text-[15px] sm:text-[17px]`}>
              {formatRecordId(request.id)}
            </CardTitle>
            <CardDescription className={adminSectionSubtitle}>
              {request.kind === "followup" ? "Renewal order" : "Initial order"} ·{" "}
              {formatDateTimeFull(request.created_at)}
            </CardDescription>
          </div>
          <Badge
            className={`rounded-lg border border-transparent px-2.5 py-0.5 text-[12px] font-semibold normal-case tracking-normal shadow-none ${
              REQUEST_STATUS_BADGE[requestStatusTone(status)]
            }`}
          >
            {clinicalOnly ? clinicalStatusLabel(status) : requestStatusLabel(status)}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
          <div className="grid gap-4 text-[14px] sm:grid-cols-2">
            <Row
              label="Patient"
              value={patient?.name ?? (patient?.is_guest ? "Guest — no account yet" : "—")}
            />
            {clinicalOnly ? null : <Row label="Email" value={patient?.email ?? "—"} />}
            <Row label="State" value={patient?.state_code ?? "—"} />
            <Row label="Assigned provider" value={provider?.full_name ?? "Unassigned"} />
            <Row label="Medication" value={medicine?.name ?? "—"} />
            <Row label="Plan" value={pkg?.name ?? "—"} />
            {clinicalOnly ? null : (
              <Row
                label="Plan price"
                value={pkg?.price != null ? `$${Number(pkg.price).toFixed(2)}` : "—"}
              />
            )}
            <Row
              label="Needs approval"
              value={request.requires_consultation ? "Yes" : "No (auto)"}
            />
            <Row
              label="Consultation"
              value={
                consultation ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-normal shadow-none ${
                        consultation.is_ended
                          ? "bg-slate-100 text-slate-700 border border-slate-200"
                          : "bg-emerald-50 text-emerald-800 border border-emerald-300"
                      }`}
                    >
                      {consultation.is_ended ? "Completed" : "In Progress"}
                    </Badge>
                    {consultation.ended_at ? (
                      <span className="text-[12px] text-[#3B4759]/70">
                        {formatDateTimeFull(consultation.ended_at)}
                      </span>
                    ) : null}
                  </div>
                ) : request.requires_consultation ? (
                  <Badge
                    variant="outline"
                    className="border-amber-300 bg-amber-50 text-[11px] font-semibold text-amber-800 shadow-none"
                  >
                    Required (Not started)
                  </Badge>
                ) : (
                  "Not required"
                )
              }
            />
            {request.tracking_number ? (
              <Row label="Tracking #" value={request.tracking_number} />
            ) : null}
            {lifeFileStatus ? (
              <Row
                label="LifeFile status"
                value={
                  lifeFileStatus === "failed"
                    ? "Failed"
                    : lifeFileStatus === "submitted"
                      ? "Submitted"
                      : lifeFileStatus === "accepted"
                        ? "Accepted"
                        : lifeFileStatus
                }
              />
            ) : null}
            {lifeFileOrderId ? <Row label="Life File order ID" value={lifeFileOrderId} /> : null}
            {lifeFileError ? (
              <div className="sm:col-span-2 space-y-1">
                <div className="text-[13px] font-medium text-[#3B4759]/60">LifeFile error</div>
                <div className="text-[14px] font-medium text-[#B8684B]">{lifeFileError}</div>
              </div>
            ) : null}
          </div>

          {canManage ? (
            <div className="flex flex-wrap items-end gap-2 border-t border-[#D5DEDD] pt-4">
              <div className="min-w-[220px] space-y-1">
                <div className="text-[13px] font-medium text-[#3B4759]/60">
                  {provider
                    ? `Change provider${patientState ? ` (licensed in ${patientState})` : ""}`
                    : `Assign provider${patientState ? ` (licensed in ${patientState})` : ""}`}
                </div>
                {provider ? (
                  <p className="text-[13px] font-medium text-[#3B4759]">
                    Already assigned to {provider.full_name}
                  </p>
                ) : null}
                <Select value={assignId} onValueChange={setAssignId}>
                  <SelectTrigger className="h-10 border-[#D5DEDD] text-[13px] text-[#3B4759]">
                    <SelectValue
                      placeholder={
                        !patientState
                          ? "Patient state is missing"
                          : matchingProviders.length === 0
                            ? `No practitioner licensed in ${patientState}`
                            : provider
                              ? "Select a different provider"
                              : "Select a provider"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="font-['DM_Sans',sans-serif]">
                    {matchingProviders.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-[14px] text-[#3B4759]">
                        {p.full_name}
                        {p.id === provider?.id ? " (current)" : ""}
                        {p.is_default ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {assignId && provider?.id === assignId ? (
                  <p className="text-[12px] font-medium text-[#3B4759]/70">
                    Already assigned to {provider.full_name}. Choose someone else to change.
                  </p>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  assignMut.isPending ||
                  matchingProviders.length === 0 ||
                  (!!provider && (!assignId || assignId === provider.id)) ||
                  (!provider && !assignId)
                }
                onClick={() => assignMut.mutate()}
                className="h-10 border-[#D5DEDD] px-4 text-[13px] font-semibold text-[#3B4759]"
              >
                {assignMut.isPending
                  ? provider
                    ? "Changing…"
                    : "Assigning…"
                  : provider && (!assignId || assignId === provider.id)
                    ? "Assigned"
                    : provider
                      ? "Change provider"
                      : "Assign"}
              </Button>
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-[#D5DEDD] pt-4">
            {canClaim && !provider ? (
              <Button
                size="sm"
                onClick={() => claimMut.mutate()}
                disabled={claimMut.isPending}
                className="h-10 bg-[#6A9B9C] px-4 text-[13px] font-semibold text-white hover:bg-[#5B8788]"
              >
                {claimMut.isPending ? "Claiming…" : "Claim this order"}
              </Button>
            ) : null}
            {needsProviderAssignment ? (
              <p className="w-full text-[13px] font-medium text-[#3B4759]/80">
                Please assign a provider. When they approve, the order is sent to the pharmacy.
              </p>
            ) : null}
            {waitingOnProvider ? (
              <p className="w-full text-[13px] font-medium text-[#3B4759]/80">
                Waiting for the assigned provider to approve. Approval sends the order to the
                pharmacy. You can still send it from here if that does not go through.
              </p>
            ) : null}
            {!sentToLifeFile && lifeFileError ? (
              <p className="w-full text-[13px] font-medium text-[#B8684B]">{lifeFileError}</p>
            ) : null}
            {canApprove ? (
              <Button
                size="sm"
                onClick={() => setApproveOpen(true)}
                disabled={approveMut.isPending}
                className="h-10 bg-[#6A9B9C] px-4 text-[13px] font-semibold text-white hover:bg-[#5B8788]"
              >
                <Check className="mr-1 h-4 w-4" /> Approve
              </Button>
            ) : null}
            {canSendToPharmacy ? (
              <Button
                size="sm"
                onClick={() => setSendPharmacyOpen(true)}
                disabled={sendPharmacyMut.isPending}
                className="h-10 bg-[#6A9B9C] px-4 text-[13px] font-semibold text-white hover:bg-[#5B8788]"
              >
                <Truck className="mr-1 h-4 w-4" /> Send to pharmacy
              </Button>
            ) : null}
            {canChange ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setChangeOpen(true)}
                className="h-10 border-[#D5DEDD] px-4 text-[13px] font-semibold text-[#3B4759]"
              >
                <Repeat className="mr-1 h-4 w-4" /> Change medicine
              </Button>
            ) : null}
            {canGenerate && !canSendToPharmacy ? (
              <Button
                size="sm"
                onClick={() => setRxOpen(true)}
                className="h-10 bg-[#6A9B9C] px-4 text-[13px] font-semibold text-white hover:bg-[#5B8788]"
              >
                <FileText className="mr-1 h-4 w-4" /> Generate prescription
              </Button>
            ) : null}
            {canRetryLifeFile ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => retryLfMut.mutate()}
                disabled={retryLfMut.isPending}
                className="h-10 border-[#D5DEDD] px-4 text-[13px] font-semibold text-[#3B4759]"
              >
                <Truck className="mr-1 h-4 w-4" />{" "}
                {retryLfMut.isPending ? "Retrying…" : "Retry LifeFile"}
              </Button>
            ) : null}
            {showFulfillmentStep && fulfillmentStep ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  fulfillmentStep.status === "dispatched"
                    ? setTrackOpen(true)
                    : advanceMut.mutate({ status: fulfillmentStep.status })
                }
                disabled={advanceMut.isPending}
                className="h-10 border-[#D5DEDD] px-4 text-[13px] font-semibold text-[#3B4759]"
              >
                <Truck className="mr-1 h-4 w-4" /> {fulfillmentStep.label}
              </Button>
            ) : null}
            {canReject ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRejectOpen(true)}
                className="h-10 border-[#E7CFC3] px-4 text-[13px] font-semibold text-[#8F4A33] hover:bg-[#F6E4DA]"
              >
                <X className="mr-1 h-4 w-4" /> {clinicalOnly ? "Reject" : "Reject & refund"}
              </Button>
            ) : null}
            {consultation?.is_ended ? (
              <div className="flex flex-wrap items-center gap-2">
                {!clinicalOnly && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate({
                        to: "/admin/requests/$requestId/consultation",
                        params: { requestId },
                      })
                    }
                    className="h-10 border-[#D5DEDD] bg-white px-3.5 text-[13px] font-semibold text-[#152A51] hover:bg-[#F3F6F6]"
                  >
                    <MessageSquare className="mr-1.5 h-4 w-4 text-[#152A51]" />
                    Chat with patient
                  </Button>
                )}
              </div>
            ) : consultation ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={consultMut.isPending}
                  onClick={() => consultMut.mutate()}
                  className="h-10 bg-[#6A9B9C] px-4 text-[13px] font-semibold text-white hover:bg-[#5B8788] shadow-none"
                >
                  {consultMut.isPending ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin text-current" />
                      Connecting…
                    </>
                  ) : (
                    <>
                      <Video className="mr-1.5 h-4 w-4" />
                      {activeConsultation ? "Open consultation room" : "Join live consultation"}
                    </>
                  )}
                </Button>
                {activeConsultation ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setActiveConsultation(null)}
                    className="h-10 px-2.5 text-[12px] font-medium text-[#8F4A33] hover:bg-[#F6E4DA]"
                    title="Close inline consultation"
                  >
                    <X className="mr-1 h-3.5 w-3.5" /> Close
                  </Button>
                ) : null}
              </div>
            ) : canManage && canStartConsult ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={consultMut.isPending}
                  onClick={() => consultMut.mutate()}
                  className="h-10 bg-[#6A9B9C] px-4 text-[13px] font-semibold text-white hover:bg-[#5B8788] shadow-none"
                >
                  {consultMut.isPending ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin text-current" />
                      Connecting…
                    </>
                  ) : (
                    <>
                      <Video className="mr-1.5 h-4 w-4" />
                      {activeConsultation ? "Open consultation room" : "Start consultation"}
                    </>
                  )}
                </Button>
                {activeConsultation ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setActiveConsultation(null)}
                    className="h-10 px-2.5 text-[12px] font-medium text-[#8F4A33] hover:bg-[#F6E4DA]"
                    title="Close inline consultation"
                  >
                    <X className="mr-1 h-3.5 w-3.5" /> Close
                  </Button>
                ) : null}
              </div>
            ) : null}
            {canManage && request.session_id ? (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="h-10 border-[#D5DEDD] px-4 text-[13px] font-semibold text-[#3B4759]"
              >
                <Link
                  to="/admin/intake-sessions/$sessionId"
                  params={{ sessionId: request.session_id }}
                >
                  Open intake session
                </Link>
              </Button>
            ) : null}
          </div>

          {status === "awaiting_additional_payment" ? (
            <p className="rounded-lg bg-[#FFF4E5] px-3 py-2 text-[13px] font-medium text-[#B45309]">
              {clinicalOnly
                ? "Waiting for the patient to confirm the new plan. The prescription can be generated after they confirm."
                : "Waiting for the patient to pay the price difference. The prescription can be generated once payment succeeds."}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Embedded Live Video Consultation Window */}
      {activeConsultation ? (
        <Card
          ref={consultCardRef}
          className={`${adminCard} overflow-hidden scroll-mt-6 border-[#6A9B9C]/40 shadow-sm ring-1 ring-[#6A9B9C]/20`}
        >
          <CardHeader className="flex flex-col gap-3 border-b border-[#D5DEDD] bg-[#F7F9F9] p-3.5 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-[#152A51]">
                      Live Video Consultation {patient?.name ? `· ${patient.name}` : ""}
                    </span>
                    <Badge className="border-emerald-200 bg-emerald-100 text-[11px] font-semibold text-emerald-800 shadow-none hover:bg-emerald-100">
                      Connected
                    </Badge>
                  </div>
                  <p className="hidden text-[12px] text-[#3B4759]/70 sm:block">
                    Live video room connected. Review order details above and clinical notes below.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={activeConsultation.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#D5DEDD] bg-white px-2.5 text-[12px] font-medium text-[#3B4759] hover:bg-[#F3F6F6]"
                  title="Open consultation in full new tab"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Open in New Tab</span>
                </a>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIframeLoading(true);
                    const current = activeConsultation.embedUrl.split("&_t=")[0];
                    setActiveConsultation({
                      ...activeConsultation,
                      embedUrl: `${current}&_t=${Date.now()}`,
                    });
                  }}
                  className="h-8 w-8 rounded-lg p-0 text-[#3B4759] hover:bg-[#F3F6F6]"
                  title="Reload consultation"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${iframeLoading ? "animate-spin" : ""}`} />
                  <span className="sr-only">Reload</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveConsultation(null)}
                  className="h-8 gap-1.5 border-[#E7CFC3] bg-white px-2.5 text-[12px] font-medium text-[#8F4A33] hover:bg-[#F6E4DA]"
                  title="Close consultation view"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Close call</span>
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="relative flex min-h-[540px] h-[65vh] max-h-[750px] w-full flex-col overflow-hidden bg-white">
              {iframeLoading ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 backdrop-blur-xs">
                  <Loader2 className="h-8 w-8 animate-spin text-[#152A51]" />
                  <p className="mt-3 text-[14px] font-medium text-[#152A51]">
                    Loading QuickBlox consultation room…
                  </p>
                </div>
              ) : null}
              <iframe
                src={activeConsultation.embedUrl}
                title="Video Consultation"
                className="h-full w-full flex-1 border-0"
                allow="camera; microphone; display-capture; autoplay; clipboard-write; fullscreen;"
                allowFullScreen
                onLoad={() => setIframeLoading(false)}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!clinicalOnly && additional_payments.length > 0 ? (
        <Card className={adminCard}>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className={adminSectionTitle}>Additional payments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0 text-[14px] sm:p-6 sm:pt-0">
            {additional_payments.map((ap: any) => (
              <div key={ap.id} className="flex items-center justify-between gap-3">
                <span className="text-[#3B4759]">
                  {formatCents(ap.amount_cents)} — {ap.reason ?? "Price difference"}
                </span>
                <Badge
                  className={`rounded-lg border border-transparent px-2.5 py-0.5 text-[12px] font-semibold normal-case shadow-none ${
                    ap.status === "paid"
                      ? "bg-[#6A9B9C] text-white hover:bg-[#6A9B9C]"
                      : "bg-[#FFF4E5] text-[#B45309] hover:bg-[#FFF4E5]"
                  }`}
                >
                  {ap.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {prescriptions.length > 0 ? (
        <Card className={adminCard}>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className={adminSectionTitle}>Prescription</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0 text-[14px] sm:p-6 sm:pt-0">
            {prescriptions.map((rx: any) => (
              <div key={rx.id} className="space-y-1 rounded-lg border border-[#D5DEDD] p-3">
                <div className="font-semibold text-[#3B4759]">{rx.medicine_name}</div>
                {rx.directions ? (
                  <div className="text-[#3B4759]/80">{rx.directions}</div>
                ) : (
                  <div className="text-[#3B4759]/50">Directions to be added from the template.</div>
                )}
                <div className="text-[12px] text-[#3B4759]/60">
                  {rx.status} · {formatDateTimeFull(rx.created_at)}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Link
                    to="/rx/$prescriptionId"
                    params={{ prescriptionId: rx.id }}
                    search={{ download: false }}
                    target="_blank"
                    className="rounded-md border border-[#6A9B9C] px-3 py-1.5 text-[13px] font-semibold text-[#3B4759] hover:bg-[#E8EEED]"
                  >
                    View
                  </Link>
                  <Link
                    to="/rx/$prescriptionId"
                    params={{ prescriptionId: rx.id }}
                    search={{ download: true }}
                    target="_blank"
                    className="rounded-md bg-[#6A9B9C] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#5B8788]"
                  >
                    Download
                  </Link>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <RequestNotes requestId={requestId} />

      <Card className={adminCard}>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className={adminSectionTitle}>Status history</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          <ol className="space-y-3">
            {events.map((ev: any) => (
              <li key={ev.id} className="flex gap-3 text-[14px]">
                <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#6A9B9C]" />
                <div className="min-w-0">
                  <div className="font-medium text-[#3B4759]">
                    {clinicalOnly ? clinicalStatusLabel(ev.status) : requestStatusLabel(ev.status)}
                  </div>
                  <div className="text-[12px] text-[#3B4759]/60">
                    {ev.actor_role} · {formatDateTimeFull(ev.created_at)}
                  </div>
                  {ev.note ? (
                    <div className="text-[13px] text-[#3B4759]/80">
                      {clinicalOnly ? clinicalEventNote(ev.note) : ev.note}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <RequestChangeMedicineDialog
        requestId={requestId}
        open={changeOpen}
        onOpenChange={setChangeOpen}
        onChanged={refresh}
        hideFinancial={clinicalOnly}
        currentMedicineId={medicine?.id ?? request.medicine_id ?? null}
        currentVariantId={request.variant_id ?? null}
        currentPackageId={pkg?.id ?? request.package_id ?? null}
        current={{
          medicineName: medicine?.name ?? null,
          planName: pkg?.name ?? null,
          price: clinicalOnly ? null : pkg?.price != null ? Number(pkg.price) : null,
        }}
      />

      {/* Reject */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{clinicalOnly ? "Reject order" : "Reject & refund"}</DialogTitle>
            <DialogDescription>
              {clinicalOnly
                ? "This closes the order. The patient will be notified. This cannot be undone."
                : "This refunds the patient's payment, cancels the subscription, and closes the order. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label className="text-[13px] font-medium text-[#3B4759]">Reason (optional)</label>
            <Textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Why is this being rejected?"
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => rejectMut.mutate()}
              disabled={rejectMut.isPending}
              className="bg-[#8F4A33] text-white hover:bg-[#8F4A33]"
            >
              {rejectMut.isPending ? "Rejecting…" : clinicalOnly ? "Reject" : "Reject & refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Provider clinical approve only */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve order</DialogTitle>
            <DialogDescription>
              Clinically approve this order for {medicine?.name ?? "this medication"}. It is sent to
              the pharmacy when you approve. Admin can send it again only if that send fails.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label className="text-[13px] font-medium text-[#3B4759]">Note (optional)</label>
            <Textarea
              value={approveNote}
              onChange={(e) => setApproveNote(e.target.value)}
              placeholder="Optional note for the record"
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => approveMut.mutate()} disabled={approveMut.isPending}>
              {approveMut.isPending ? "Approving…" : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin send to LifeFile after provider approval */}
      <Dialog open={sendPharmacyOpen} onOpenChange={setSendPharmacyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to pharmacy</DialogTitle>
            <DialogDescription>
              Submit this order for {medicine?.name ?? "this medication"} to the pharmacy.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label className="text-[13px] font-medium text-[#3B4759]">Directions (optional)</label>
            <Textarea
              value={directions}
              onChange={(e) => setDirections(e.target.value)}
              placeholder="e.g. Take as directed. Test Order Do Not Fill"
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendPharmacyOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => sendPharmacyMut.mutate()} disabled={sendPharmacyMut.isPending}>
              {sendPharmacyMut.isPending ? "Sending…" : "Send to pharmacy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate prescription */}
      <Dialog open={rxOpen} onOpenChange={setRxOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate prescription</DialogTitle>
            <DialogDescription>
              Creates the prescription for {medicine?.name ?? "this medication"}, visible to the
              patient, provider, and admin. These directions are sent to the pharmacy. For a Life
              File test order, include: Test Order Do Not Fill.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label className="text-[13px] font-medium text-[#3B4759]">Directions (optional)</label>
            <Textarea
              value={directions}
              onChange={(e) => setDirections(e.target.value)}
              placeholder="e.g. Take as directed. Test Order Do Not Fill"
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRxOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => generateMut.mutate()} disabled={generateMut.isPending}>
              {generateMut.isPending ? "Generating…" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dispatch tracking number */}
      <Dialog open={trackOpen} onOpenChange={setTrackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark dispatched</DialogTitle>
            <DialogDescription>Enter the shipment tracking number, if available.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label className="text-[13px] font-medium text-[#3B4759]">Tracking number</label>
            <Input
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="e.g. 1Z999AA10123456784"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrackOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                advanceMut.mutate({ status: "dispatched", trackingNumber: tracking || undefined })
              }
              disabled={advanceMut.isPending}
            >
              {advanceMut.isPending ? "Saving…" : "Mark dispatched"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finish consultation confirmation */}
      <AlertDialog open={finishOpen} onOpenChange={setFinishOpen}>
        <AlertDialogContent className="max-w-md font-['DM_Sans',sans-serif]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#152A51]">Finish consultation?</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] text-[#3B4759]/80">
              This will mark the live consultation appointment as completed for both practitioner
              and patient.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel disabled={finishConsultMut.isPending} className="border-[#D5DEDD]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => finishConsultMut.mutate()}
              disabled={finishConsultMut.isPending}
              className="bg-[#152A51] text-white hover:bg-[#1C3665]"
            >
              {finishConsultMut.isPending ? "Finishing…" : "Finish consultation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[13px] font-medium text-[#3B4759]/60">{label}</div>
      <div className="text-[14px] font-medium text-[#3B4759]">{value}</div>
    </div>
  );
}
