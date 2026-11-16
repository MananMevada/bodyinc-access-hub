import { createFileRoute, Link } from "@tanstack/react-router";
import { adminPageSubtitle, adminPageTitle } from "@/lib/admin-ui";

export const Route = createFileRoute("/_authenticated/provider/help")({
  head: () => ({
    meta: [
      { title: "Help · Body Inc Practitioner" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProviderHelpPage,
});

const STEPS = [
  "Start on the Dashboard. The cards open a filtered list, and Join consultation opens the next visit.",
  "My Requests is the work list for orders assigned to you. Under review is the list to finish first.",
  "My Patients is a directory of everyone assigned to you, including finished orders. Open the order from My Requests when you need to decide.",
  "Consultations lists assigned orders that need a visit, or already have one in progress. That list can be longer than Under review.",
  "On the order, review the intake form first. Allergies, medications, and history are on that tab.",
  "If the order needs a consultation, use Join consultation, then Approve. Finishing the consultation sends that approved order to the pharmacy.",
  "If the order does not need a consultation, Approve writes the prescription and sends it to the pharmacy.",
  "Reject and Change medicine both need a reason. A higher price asks the patient to pay or decline. The same or a lower price asks the patient to approve or reject. No response within 7 days restores the previous plan, and the patient is not charged.",
  "Claim from the Unassigned queue only when the intake form is filled. Once any provider claims or is assigned, the order leaves that queue.",
];

function ProviderHelpPage() {
  return (
    <div className="admin-page-shell space-y-5 font-['DM_Sans',sans-serif]">
      <div className="space-y-1">
        <h1 className={adminPageTitle}>Help and support</h1>
        <p className={adminPageSubtitle}>
          My Requests is where you decide. My Patients is the directory of people assigned to you.
        </p>
      </div>
      <ol className="list-decimal space-y-2 pl-5 text-[14px] text-[#3B4759]">
        {STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="text-[14px] text-[#3B4759]">
        If you are unavailable, update{" "}
        <Link to="/provider/availability" className="font-semibold text-[#6A9B9C]">
          Availability
        </Link>{" "}
        and ask the admin team to reassign anything you cannot release. Licensed states are on{" "}
        <Link to="/provider/profile" className="font-semibold text-[#6A9B9C]">
          My Profile
        </Link>
        .
      </p>
    </div>
  );
}
