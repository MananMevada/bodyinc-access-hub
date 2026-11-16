import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlanChange } from "@/lib/plan-change.functions";

export const Route = createFileRoute("/plan-change/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Plan change — Body Inc" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlanChangePage,
});

function PlanChangePage() {
  const { token } = Route.useParams();
  const load = useServerFn(getPlanChange);

  const q = useQuery({
    queryKey: ["plan-change", token],
    queryFn: () => load({ data: { token } }),
  });

  const row = q.data;
  const payUrl = row && row.found ? row.pay_url : null;

  useEffect(() => {
    if (payUrl) window.location.replace(payUrl);
  }, [payUrl]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F7F6] p-4 font-['DM_Sans',sans-serif]">
      <Card className="w-full max-w-lg border-[#D5DEDD]">
        <CardHeader>
          <CardTitle className="text-[#152A51]">Plan change</CardTitle>
          <CardDescription>
            {payUrl
              ? "Taking you to the payment page."
              : "This change does not need a response from you."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-[14px] text-[#3B4759]">
          {q.isLoading ? <p>Loading…</p> : null}
          {q.isError ? <p>This link could not be opened. Ask your practitioner to send it again.</p> : null}
          {row && !row.found ? <p>This link is no longer valid.</p> : null}
          {row?.found ? (
            <>
              {row.message ? <p className="font-medium">{row.message}</p> : null}
              <p>
                Proposed treatment: <span className="font-semibold">{row.medicine_name}</span>
              </p>
              {(row.amount_cents ?? 0) > 0 ? (
                <p>
                  An additional payment of ${((row.amount_cents ?? 0) / 100).toFixed(2)} is due in the
                  patient portal.
                </p>
              ) : (
                <p>There is no extra charge. You can close this page.</p>
              )}
              {payUrl ? (
                <Button asChild className="bg-[#6A9B9C] text-white hover:bg-[#5B8788]">
                  <a href={payUrl}>Continue to payment</a>
                </Button>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
