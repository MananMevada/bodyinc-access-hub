import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useNotifications, timeAgo } from "@/lib/use-notifications";
import type { AppNotification } from "@/lib/notifications.functions";

export const Route = createFileRoute("/_authenticated/provider/notifications")({
  head: () => ({
    meta: [{ title: "Notifications — Body Inc" }, { name: "robots", content: "noindex" }],
  }),
  component: ProviderNotificationsPage,
});

const HIGH_TYPES = new Set([
  "request_assigned",
  "request_ready_for_review",
  "request_needs_attention",
  "intake_updated",
  "plan_change_confirmed",
  "plan_change_declined",
  "plan_change_timeout",
]);

function isHigh(n: AppNotification) {
  if (HIGH_TYPES.has(n.type)) return true;
  return /consult|intake|waiting|assigned/i.test(`${n.type} ${n.title}`);
}

function destination(n: AppNotification) {
  if (n.link) return n.link;
  if (n.entity_id) return `/provider/requests/${n.entity_id}`;
  return null;
}

function ProviderNotificationsPage() {
  const navigate = useNavigate();
  const { items, unread, isLoading, mark } = useNotifications();

  function open(n: AppNotification) {
    if (!n.read_at) mark.mutate({ id: n.id });
    const to = destination(n);
    if (to) navigate({ to });
  }

  const groups = new Map<string, AppNotification[]>();
  const sorted = [...items].sort((a, b) => {
    const rank = Number(isHigh(b)) - Number(isHigh(a));
    if (rank !== 0) return rank;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  for (const item of sorted) {
    const key = item.type || "other";
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }

  return (
    <div className="w-full min-w-0 max-w-none">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#3B4759]">Notifications</h1>
          <p className="text-sm text-[#3B4759]/60">
            {unread > 0 ? `${unread} unread` : "No unread notifications"} · grouped by type, high
            priority first
          </p>
        </div>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => mark.mutate({ all: true })}
            className="rounded-[6px] border border-[#D5DEDD] bg-white px-3 py-1.5 text-sm font-medium text-[#6A9B9C] transition-colors hover:bg-[#E8EEED]"
          >
            Mark all read
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="px-4 py-10 text-center text-sm text-[#3B4759]/60">Loading…</p>
      ) : items.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-[#3B4759]/60">You&apos;re all caught up.</p>
      ) : (
        <div className="space-y-4">
          {[...groups.entries()].map(([type, rows]) => (
            <section key={type} className="overflow-hidden rounded-[8px] border border-[#D5DEDD] bg-white">
              <div className="border-b border-[#E8EEED] bg-[#F8FBFA] px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-[#3B4759]/60">
                {type.replaceAll("_", " ")}
              </div>
              {rows.map((n) => {
                const high = isHigh(n);
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => open(n)}
                    className={`flex w-full items-start gap-3 border-b border-[#E8EEED] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[#E8EEED] ${
                      n.read_at ? "" : "bg-[#E8EEED]/50"
                    }`}
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        n.read_at ? "bg-transparent" : high ? "bg-[#B8684B]" : "bg-[#6A9B9C]"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[#3B4759]">{n.title}</span>
                        {high ? (
                          <span className="rounded-full bg-[#F6E4DA] px-2 py-0.5 text-[11px] font-semibold text-[#8F4A33]">
                            High
                          </span>
                        ) : (
                          <span className="rounded-full bg-[#E8EEED] px-2 py-0.5 text-[11px] font-semibold text-[#3B4759]/70">
                            Normal
                          </span>
                        )}
                      </span>
                      {n.body && (
                        <span className="mt-0.5 block text-xs text-[#3B4759]/70">{n.body}</span>
                      )}
                      <span className="mt-1 block text-[11px] text-[#3B4759]/50">
                        {timeAgo(n.created_at)}
                        {destination(n) ? " · Opens the order" : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
