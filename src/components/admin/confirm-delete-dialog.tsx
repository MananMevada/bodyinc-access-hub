import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function ConfirmDeleteDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  pending = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <AlertDialogContent className="max-w-md rounded-2xl border border-[#D5DEDD] bg-white p-6 font-['DM_Sans',sans-serif]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[18px] font-bold text-[#3B4759]">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[14px] font-medium leading-relaxed text-[#3B4759]/80">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-2 gap-2">
          <AlertDialogCancel disabled={pending} className="rounded-xl border-[#D5DEDD]">
            Cancel
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            className="rounded-xl"
            onClick={onConfirm}
          >
            {pending ? "Deleting…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
