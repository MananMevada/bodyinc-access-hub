import { toastError } from "@/lib/toast-message";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getMyProviderProfile,
  releaseUnreviewedOrders,
  updateMyProviderProfile,
} from "@/lib/provider.functions";
import { adminCard, adminPageSubtitle, adminPageTitle, adminSectionTitle } from "@/lib/admin-ui";

export const Route = createFileRoute("/_authenticated/provider/availability")({
  head: () => ({
    meta: [
      { title: "Availability · Body Inc Practitioner" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProviderAvailabilityPage,
});

function ProviderAvailabilityPage() {
  const qc = useQueryClient();
  const get = useServerFn(getMyProviderProfile);
  const save = useServerFn(updateMyProviderProfile);
  const release = useServerFn(releaseUnreviewedOrders);
  const q = useQuery({ queryKey: ["provider-profile"], queryFn: () => get({}) });
  const [note, setNote] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const d = q.data as any;
    if (!d) return;
    setNote(d.availability_note ?? "");
    setUnavailable(Boolean(d.is_unavailable));
  }, [q.data]);

  const mut = useMutation({
    mutationFn: () => {
      const d = q.data as any;
      return save({
        data: {
          full_name: d.full_name,
          bio: d.bio || undefined,
          credentials: d.credentials || undefined,
          specialty: d.specialty || undefined,
          years_experience: d.years_experience,
          languages: d.languages ?? [],
          consultation_types: d.consultation_types ?? [],
          license_states: d.license_states ?? [],
          avatar_url: d.avatar_url || null,
          availability_note: note,
          is_unavailable: unavailable,
        },
      });
    },
    onSuccess: (res) => {
      const released = res?.released ?? 0;
      toast.success(
        released
          ? `Availability saved. ${released} unreviewed order${released === 1 ? "" : "s"} returned to the queue.`
          : "Availability saved.",
      );
      qc.invalidateQueries({ queryKey: ["provider-profile"] });
      qc.invalidateQueries({ queryKey: ["provider-dashboard"] });
      qc.invalidateQueries({ queryKey: ["requests"] });
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const releaseMut = useMutation({
    mutationFn: () => release({}),
    onSuccess: (res) => {
      toast.success(
        res.released
          ? `${res.released} unreviewed order${res.released === 1 ? "" : "s"} returned to the queue.`
          : "No unreviewed orders to release.",
      );
      qc.invalidateQueries({ queryKey: ["provider-dashboard"] });
      qc.invalidateQueries({ queryKey: ["requests"] });
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  return (
    <div className="admin-page-shell space-y-5 font-['DM_Sans',sans-serif]">
      <div className="space-y-1">
        <h1 className={adminPageTitle}>Availability</h1>
        <p className={adminPageSubtitle}>
          Licensed states stay on your profile. Marking yourself unavailable returns unreviewed
          orders to the queue and blocks new assignments until you turn it off.
        </p>
      </div>

      <Card className={adminCard}>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className={adminSectionTitle}>Schedule</CardTitle>
          <CardDescription className="text-[13px] text-[#3B4759]/70">
            Hours you can take consultations. This is shown to the admin team.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[#D5DEDD] px-3 py-3">
            <div>
              <Label className="text-[14px] text-[#3B4759]">I am unavailable</Label>
              <p className="text-[12px] text-[#3B4759]/60">
                Saving this returns your unreviewed orders to the queue. You cannot be assigned or
                claim new orders until you turn this off.
              </p>
            </div>
            <Switch checked={unavailable} onCheckedChange={setUnavailable} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px] text-[#3B4759]">Hours and notes</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="Weekdays 9am–5pm ET. Away 12–14 Nov."
              className="border-[#D5DEDD] text-[14px] text-[#3B4759]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={mut.isPending || q.isLoading}
              onClick={() => mut.mutate()}
              className="h-10 bg-[#6A9B9C] text-[13px] font-semibold text-white hover:bg-[#5B8788]"
            >
              {mut.isPending ? "Saving…" : "Save availability"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={releaseMut.isPending}
              onClick={() => releaseMut.mutate()}
              className="h-10 border-[#D5DEDD] text-[13px] font-semibold text-[#3B4759]"
            >
              {releaseMut.isPending ? "Releasing…" : "Release unreviewed orders"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
