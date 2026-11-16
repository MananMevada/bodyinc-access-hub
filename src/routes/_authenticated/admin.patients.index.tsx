import { toastError } from "@/lib/toast-message";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { MoreHorizontal, Search, Mail, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { RefreshButton } from "@/components/admin/refresh-button";
import {
  deletePatient,
  listPatients,
  sendPatientPasswordReset,
  setPatientActive,
} from "@/lib/patients.functions";
import { adminPageTitle, adminPageSubtitle, adminInput, adminSelect } from "@/lib/admin-ui";
import { formatDate, normalizeIdSearch } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/patients/")({
  head: () => ({
    meta: [
      { title: "Patients · Body Inc Admin" },
      { name: "description", content: "Patients — Admin area of the Body Inc portal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PatientsListPage,
});

function PatientsListPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const list = useServerFn(listPatients);
  const setActive = useServerFn(setPatientActive);
  const reset = useServerFn(sendPatientPasswordReset);

  const remove = useServerFn(deletePatient);

  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search);
  const [status, setStatus] = useState<"all" | "active" | "deactivated">("all");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  const searchTerm = normalizeIdSearch(debounced);

  const query = useQuery({
    queryKey: ["patients", { search: searchTerm, status }],
    queryFn: () => list({ data: { search: searchTerm || undefined, status } }),
    placeholderData: keepPreviousData,
  });

  const activeMut = useMutation({
    mutationFn: (vars: { userId: string; is_active: boolean }) => setActive({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      toast.success("Changes saved.");
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const resetMut = useMutation({
    mutationFn: (userId: string) =>
      reset({ data: { userId, redirect_to: `${window.location.origin}/reset-password` } }),
    onSuccess: () => toast.success("Password reset email sent."),
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (userId: string) => remove({ data: { userId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      toast.success("Patient deleted.");
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  return (
    <div className="admin-page-shell space-y-5 sm:space-y-6 font-['DM_Sans',sans-serif]">
      <div className="admin-page-header">
        <div className="min-w-0 space-y-2 sm:space-y-4">
          <h2 className={adminPageTitle}>Patients</h2>
          <p className={adminPageSubtitle}>
            Browse patient accounts, review intake responses, and manage access.
          </p>
        </div>
        <RefreshButton onClick={() => query.refetch()} loading={query.isFetching} />
      </div>

      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#3B4759]/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by patient ID, name, email, or phone…"
            className={`${adminInput} pl-9`}
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className={`${adminSelect} sm:w-40`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="deactivated">Deactivated</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="admin-table-wrap m-0 w-full">
        <div className="admin-table-scroll">
          <Table className="min-w-[820px]">
            <TableHeader className="bg-[#F8FBFA]">
              <TableRow className="border-b border-[#D5DEDD] hover:bg-transparent">
                <TableHead className="text-[#3B4759] font-semibold h-11 text-[13px]">
                  Name
                </TableHead>
                <TableHead className="text-[#3B4759] font-semibold h-11 text-[13px]">
                  Email
                </TableHead>
                <TableHead className="text-[#3B4759] font-semibold h-11 text-[13px]">
                  Phone
                </TableHead>
                <TableHead className="text-[#3B4759] font-semibold h-11 text-[13px]">DOB</TableHead>
                <TableHead className="text-[#3B4759] font-semibold h-11 text-[13px]">
                  Joined
                </TableHead>
                <TableHead className="text-[#3B4759] font-semibold h-11 text-[13px]">
                  Status
                </TableHead>
                <TableHead className="w-12 h-11 text-[13px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading && (
                <TableRow className="border-b border-[#D5DEDD]">
                  <TableCell
                    colSpan={7}
                    className="py-12 text-center text-[#3B4759]/60 font-medium text-[14px]"
                  >
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {query.isError && (
                <TableRow className="border-b border-[#D5DEDD]">
                  <TableCell
                    colSpan={7}
                    className="py-12 text-center text-[#B8684B] font-semibold text-[14px]"
                  >
                    {(query.error as Error).message}
                  </TableCell>
                </TableRow>
              )}
              {!query.isLoading && query.data?.length === 0 && (
                <TableRow className="border-b border-[#D5DEDD]">
                  <TableCell
                    colSpan={7}
                    className="py-12 text-center text-[#3B4759]/60 font-medium text-[14px]"
                  >
                    No patients found.
                  </TableCell>
                </TableRow>
              )}
              {query.data?.map((p: any) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer border-b border-[#D5DEDD] hover:bg-[#E8EEED]/40 transition-colors"
                  onPointerEnter={() => {
                    void router.preloadRoute({
                      to: "/admin/patients/$patientId",
                      params: { patientId: p.id },
                    });
                  }}
                  onClick={() =>
                    navigate({
                      to: "/admin/patients/$patientId",
                      params: { patientId: p.id },
                    })
                  }
                >
                  <TableCell className="font-semibold text-[#3B4759] text-[14px]">
                    {p.full_name || "—"}
                  </TableCell>
                  <TableCell className="text-[#3B4759] font-medium text-[14px]">
                    {p.email}
                  </TableCell>
                  <TableCell className="text-[#3B4759] font-medium text-[14px]">
                    {p.phone || "—"}
                  </TableCell>
                  <TableCell className="text-[#3B4759] font-medium text-[14px]">
                    {formatDate(p.dob)}
                  </TableCell>
                  <TableCell className="text-[#3B4759]/80 font-medium text-[14px]">
                    {formatDate(p.created_at)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={p.is_active ? "default" : "secondary"}
                      className={`font-bold text-[12px] px-2.5 py-0.5 rounded-lg shadow-none normal-case tracking-normal border border-transparent ${
                        p.is_active
                          ? "bg-[#E8F5E9] text-[#3B4759] hover:bg-[#E8F5E9]"
                          : "bg-[#E8EEED] text-[#3B4759] hover:bg-[#E8EEED]"
                      }`}
                    >
                      {p.is_active ? "Active" : "Deactivated"}
                    </Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-[#E8EEED] text-[#6A9B9C] rounded-xl"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="rounded-xl border-[#D5DEDD] shadow-md p-1"
                      >
                        <DropdownMenuItem
                          className="rounded-lg text-[#3B4759] font-semibold text-[13px] focus:bg-[#E8EEED] focus:text-[#3B4759]"
                          onClick={() =>
                            navigate({
                              to: "/admin/patients/$patientId",
                              params: { patientId: p.id },
                            })
                          }
                        >
                          View Profile
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="rounded-lg text-[#3B4759] font-semibold text-[13px] focus:bg-[#E8EEED] focus:text-[#3B4759]"
                          onClick={() => resetMut.mutate(p.id)}
                        >
                          <Mail className="mr-2 h-4 w-4 stroke-[2.5] text-[#6A9B9C]" /> Send
                          password reset
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-[#D5DEDD]" />
                        <DropdownMenuItem
                          className={`rounded-lg font-bold text-[13px] focus:bg-[#E8EEED] ${
                            p.is_active
                              ? "text-[#B8684B] focus:text-[#B8684B]"
                              : "text-[#2E7D32] focus:text-[#2E7D32]"
                          }`}
                          onClick={() =>
                            activeMut.mutate({ userId: p.id, is_active: !p.is_active })
                          }
                        >
                          {p.is_active ? "Deactivate" : "Reactivate"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="rounded-lg font-bold text-[13px] text-[#B8684B] focus:bg-[#FBF1EC] focus:text-[#B8684B]"
                          onClick={() =>
                            setDeleteTarget({ id: p.id, label: p.full_name || p.email })
                          }
                        >
                          <Trash2 className="mr-2 h-4 w-4 stroke-[2.5]" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMut.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="rounded-2xl border-[#D5DEDD]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#3B4759]">
              Delete {deleteTarget?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[#6A9B9C]/80 font-medium">
              This removes the patient and their orders from the live lists and cancels any active
              subscription. A copy is kept under Settings, Deleted items, and can be put back. A
              restored login needs a password reset, and Stripe billing is not turned back on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMut.isPending} className="rounded-xl">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMut.isPending}
              className="rounded-xl bg-[#B8684B] text-white hover:bg-[#A95C41]"
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteMut.mutate(deleteTarget.id);
              }}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete patient"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
