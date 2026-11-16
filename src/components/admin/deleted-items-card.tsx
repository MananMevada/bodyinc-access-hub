import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-message";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { listDeletedBackups, restoreDeletedBackup } from "@/lib/data-backup.functions";

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function DeletedItemsCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDeletedBackups);
  const restoreFn = useServerFn(restoreDeletedBackup);
  const [wipeId, setWipeId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["deleted-backups"],
    queryFn: () => listFn({}),
  });
  const rows = (query.data ?? []).filter((row) => !row.restored);
  const target = rows.find((row) => row.wipeId === wipeId) ?? null;

  const restore = useMutation({
    mutationFn: (id: string) => restoreFn({ data: { wipeId: id } }),
    onSuccess: (result) => {
      toast.success(
        result.needsPasswordReset
          ? "Put back. Send a password reset before that person can sign in. Stripe billing is not turned back on."
          : "Put back into the live system.",
      );
      setWipeId(null);
      qc.invalidateQueries({ queryKey: ["deleted-backups"] });
      qc.invalidateQueries();
    },
    onError: (error: Error) => toast.error(toastError(error)),
  });

  return (
    <Card className="min-w-0 space-y-4 rounded-2xl border-border bg-background p-4 sm:p-6">
      <div className="space-y-1">
        <h3 className="text-[16px] font-bold text-[#3B4759]">Deleted items</h3>
        <p className="text-xs text-muted-foreground">
          Patient, order, medicine, questionnaire, category, rule, LifeFile, promo, offer, and
          provider deletes are stored here, along with a Settings clear. A restored login needs a
          password reset, and a canceled Stripe subscription is not restarted.
        </p>
      </div>

      {query.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {!query.isLoading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is waiting to be restored.</p>
      ) : null}

      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.wipeId}
            className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#3B4759]">{row.label}</p>
              <p className="text-xs text-muted-foreground">
                {when(row.wipedAt)} · {row.rowCount} saved row{row.rowCount === 1 ? "" : "s"} ·{" "}
                {row.tables.filter((table) => table !== "auth.users").slice(0, 4).join(", ")}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setWipeId(row.wipeId)}
            >
              Put back
            </Button>
          </div>
        ))}
      </div>

      <AlertDialog open={wipeId !== null} onOpenChange={(open) => !open && setWipeId(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Put {target?.label ?? "this"} back?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved rows are written into the live tables again. If this was a person, send them
              a password reset. Stripe billing stays canceled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl" disabled={restore.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              className="rounded-xl"
              disabled={!wipeId || restore.isPending}
              onClick={() => wipeId && restore.mutate(wipeId)}
            >
              {restore.isPending ? "Restoring…" : "Put back"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
