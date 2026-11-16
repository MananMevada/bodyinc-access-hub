import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-message";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WIPE_GROUPS, expandGroups, type WipeGroupKey } from "@/lib/danger-zone";
import { wipePlatformData } from "@/lib/danger-zone.functions";

const LABELS = Object.fromEntries(WIPE_GROUPS.map((g) => [g.key, g.label])) as Record<
  WipeGroupKey,
  string
>;

export function DangerZoneTab() {
  const qc = useQueryClient();
  const wipeFn = useServerFn(wipePlatformData);
  const [selected, setSelected] = useState<WipeGroupKey[]>([]);
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [running, setRunning] = useState(false);

  const expanded = selected.length ? expandGroups(selected) : [];
  const extras = expanded.filter((k) => !selected.includes(k));

  function toggle(key: WipeGroupKey, on: boolean) {
    setSelected((s) => (on ? [...s, key] : s.filter((k) => k !== key)));
  }

  async function run() {
    setRunning(true);
    try {
      const res = await wipeFn({ data: { groups: selected } });
      const total = Object.values(res.deleted).reduce((a, b) => a + b, 0);
      toast.success(
        `Removed ${total} record${total === 1 ? "" : "s"} from the live system. A backup was stored.`,
      );
      setOpen(false);
      setSelected([]);
      setConfirmText("");
      qc.invalidateQueries();
    } catch (e) {
      toast.error(toastError(e));
    } finally {
      setRunning(false);
    }
  }

  const allSelected = selected.length === WIPE_GROUPS.length;

  return (
    <Card className="min-w-0 space-y-4 rounded-2xl border-destructive/30 bg-destructive/[0.03] p-4 sm:p-6">
      <div className="space-y-1">
        <h3 className="text-[16px] font-bold text-destructive">Delete platform data</h3>
        <p className="text-xs text-muted-foreground">
          Removes the selected data from the live system and stores a copy in the backup.
          Cleared data is not shown in the app. Admin users and platform settings are never
          touched, and nothing is changed in Stripe.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setSelected(allSelected ? [] : WIPE_GROUPS.map((g) => g.key))}
        className="text-xs font-semibold text-destructive underline underline-offset-2"
      >
        {allSelected ? "Clear all" : "Select all"}
      </button>

      <div className="space-y-2">
        {WIPE_GROUPS.map((g) => {
          const checked = selected.includes(g.key);
          const implied = !checked && extras.includes(g.key);
          return (
            <label
              key={g.key}
              className="flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-border bg-background p-3"
            >
              <Checkbox
                checked={checked || implied}
                onCheckedChange={(v) => toggle(g.key, v === true)}
                className="mt-0.5 data-[state=checked]:border-destructive data-[state=checked]:bg-destructive"
              />
              <span className="min-w-0 space-y-0.5">
                <span className="block text-sm font-semibold">
                  {g.label}
                  {implied ? (
                    <span className="ml-2 text-xs font-medium text-destructive">
                      required by your selection
                    </span>
                  ) : null}
                </span>
                <span className="block text-xs text-muted-foreground">{g.help}</span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button
          variant="destructive"
          disabled={selected.length === 0}
          onClick={() => {
            setConfirmText("");
            setOpen(true);
          }}
          className="rounded-xl"
        >
          Delete selected data
        </Button>
      </div>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              This clears data from the live system
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>The following will be removed from the live system and stored in the backup:</p>
                <ul className="list-disc space-y-1 pl-5">
                  {expanded.map((k) => (
                    <li key={k}>
                      {LABELS[k]}
                      {!selected.includes(k) ? " (required by your selection)" : ""}
                    </li>
                  ))}
                </ul>
                <p>
                  Nothing is deleted in Stripe — this only clears the app database. Type{" "}
                  <span className="font-bold text-destructive">DELETE</span> to confirm.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Confirmation</Label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="rounded-xl"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={confirmText !== "DELETE" || running}
              onClick={() => void run()}
              className="rounded-xl"
            >
              {running ? "Clearing…" : "Clear from live system"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
