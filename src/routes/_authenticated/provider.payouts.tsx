import { createFileRoute } from "@tanstack/react-router";
import { adminPageSubtitle, adminPageTitle } from "@/lib/admin-ui";

export const Route = createFileRoute("/_authenticated/provider/payouts")({
  head: () => ({
    meta: [
      { title: "Payouts · Body Inc Practitioner" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProviderPayoutsPage,
});

function ProviderPayoutsPage() {
  return (
    <div className="admin-page-shell space-y-3 font-['DM_Sans',sans-serif]">
      <h1 className={adminPageTitle}>Payouts</h1>
      <p className={adminPageSubtitle}>
        Earnings are settled outside this portal by the Body Inc admin team. This page does not
        show payment amounts, because practitioners do not handle billing here.
      </p>
    </div>
  );
}
