import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { ProviderSidebar } from "@/components/provider/provider-sidebar";
import { isBrowser } from "@/lib/is-browser";
import { supabase } from "@/integrations/supabase/client";
import { ensureSession } from "@/lib/auth-session-cache";
import { cachePortalRole, readCachedPortalRole } from "@/lib/portal-role-cache";

export const Route = createFileRoute("/_authenticated/provider")({
  ssr: false,
  shouldReload: false,
  head: () => ({
    meta: [{ title: "Provider — Body Inc" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: async ({ context }) => {
    if (!isBrowser()) return;

    let role = (context as { role?: string }).role;
    if (!role) {
      const session = await ensureSession();
      if (!session?.user) throw redirect({ to: "/auth" });
      const userId = session.user.id;
      role = readCachedPortalRole(userId) ?? undefined;
      if (!role) {
        const { data: fetched, error } = await supabase.rpc("get_user_portal", {
          _user_id: userId,
        });
        if (error) throw redirect({ to: "/auth" });
        role = (fetched as string) ?? undefined;
        cachePortalRole(userId, role);
      }
    }

    // Admins have their own console; anyone who isn't a provider is sent away.
    if (role === "admin") throw redirect({ to: "/admin" });
    if (role !== "provider") throw redirect({ to: "/dashboard" });
  },
  component: ProviderLayout,
});

const TITLES: Record<string, string> = {
  "/provider": "Dashboard",
  "/provider/requests": "My Requests",
  "/provider/queue": "Unassigned queue",
  "/provider/patients": "My Patients",
  "/provider/consultations": "Consultations",
  "/provider/notifications": "Notifications",
  "/provider/availability": "Availability",
  "/provider/payouts": "Payouts",
  "/provider/help": "Help",
  "/provider/profile": "My Profile",
};

function ProviderLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const cleaned = pathname.replace(/\/$/, "");
  const title =
    TITLES[cleaned] ??
    (cleaned.startsWith("/provider/patients")
      ? "My Patients"
      : cleaned.startsWith("/provider/requests")
        ? "My Requests"
        : "Provider");

  return (
    <SidebarProvider className="font-dm-sans flex min-h-svh w-full overflow-x-hidden bg-white">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap');
        .font-dm-sans { font-family: 'DM Sans', sans-serif !important; }
      `}</style>

      <ProviderSidebar />

      <SidebarInset className="min-w-0 flex-1 overflow-x-hidden bg-white">
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-[#E8EEED] bg-white px-4 py-3 lg:hidden">
          <SidebarTrigger className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-[#152A51]/20 bg-[#152A51] text-white shadow-sm hover:bg-[#152A51]/90" />
          <span className="truncate text-base font-semibold text-[#152A51]">{title}</span>
        </div>

        <main className="h-full w-full min-w-0 overflow-y-auto p-4 sm:p-6 lg:px-8 lg:pt-6 lg:pb-8">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
