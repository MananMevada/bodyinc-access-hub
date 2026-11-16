import { useEffect } from "react";
import { Link, useRouter, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useNotifications } from "@/lib/use-notifications";
import { providerSidebarCounts } from "@/lib/provider.functions";
import {
  countPendingConsultations,
  pendingConsultationCountQueryKey,
} from "@/lib/consultations.functions";
import { clearCachedPortalRoles } from "@/lib/portal-role-cache";
import { logoutQuickbloxSdk } from "@/lib/consultations/qb-sdk-cleanup";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const items = [
  { title: "Dashboard", url: "/provider", exact: true },
  { title: "Consultations", url: "/provider/consultations", count: "consultations" as const },
  { title: "My Requests", url: "/provider/requests", count: "requests" as const },
  { title: "Unassigned Queue", url: "/provider/queue", count: "queue" as const },
  { title: "Notifications", url: "/provider/notifications", badge: true },
  { title: "My Patients", url: "/provider/patients" },
  { title: "Availability", url: "/provider/availability" },
  { title: "Payouts", url: "/provider/payouts" },
  { title: "Help", url: "/provider/help" },
  { title: "My Profile", url: "/provider/profile" },
];

export const providerSidebarCountsQueryKey = ["provider-sidebar-counts"] as const;

const navItemBase =
  "flex h-8 w-full items-center rounded-[8px] px-3 text-[14px] font-medium !text-[#152A51] transition-all";

const navActive =
  "!bg-[#F2F7F6] data-[active=true]:!bg-[#F2F7F6] hover:!bg-[#F2F7F6] data-[active=true]:hover:!bg-[#F2F7F6]";

const navIdle = "bg-transparent hover:!bg-[#F2F7F6]/70";

export function ProviderSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { unread } = useNotifications();
  const loadCounts = useServerFn(providerSidebarCounts);
  const countPendingConsults = useServerFn(countPendingConsultations);
  const countsQ = useQuery({
    queryKey: providerSidebarCountsQueryKey,
    queryFn: () => loadCounts({}),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const pendingConsultationsQ = useQuery({
    queryKey: pendingConsultationCountQueryKey,
    queryFn: () => countPendingConsults({}),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const counts = {
    ...(countsQ.data ?? { requests: 0, queue: 0 }),
    consultations: pendingConsultationsQ.data ?? 0,
  };

  useEffect(() => {
    for (const item of items) {
      void router.preloadRoute({ to: item.url } as Parameters<typeof router.preloadRoute>[0]);
    }
  }, [router]);

  const isActive = (url: string, exact?: boolean) =>
    exact ? pathname === url : pathname === url || pathname.startsWith(url + "/");

  async function handleLogout() {
    logoutQuickbloxSdk();
    await queryClient.cancelQueries();
    queryClient.clear();
    clearCachedPortalRoles();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <Sidebar
      collapsible="icon"
      variant="sidebar"
      className="font-['DM_Sans'] border-[#E8EEED] bg-white shadow-none [&_[data-sidebar=sidebar]]:bg-white"
    >
      <div className="absolute -right-2.5 top-6 z-50 hidden md:block">
        <SidebarTrigger className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-[#152A51] p-5 text-white shadow-md transition-all hover:bg-[#152A51]/90">
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect
              x="2"
              y="2"
              width="16"
              height="16"
              rx="2"
              stroke="white"
              strokeWidth="2"
              fill="none"
            />
            <line x1="8" y1="2" x2="8" y2="18" stroke="white" strokeWidth="2" />
          </svg>
        </SidebarTrigger>
      </div>

      <SidebarHeader className="flex-shrink-0 select-none bg-transparent px-0 pb-1 pt-5">
        <div className="flex flex-col items-start px-4 group-data-[collapsible=icon]:hidden">
          <img
            src="/logo.svg"
            alt="Body Inc"
            className="h-auto max-h-[60px] w-full max-w-[160px] object-contain sm:max-w-[190px]"
          />
        </div>
        <div className="mt-3 h-px w-full bg-[#E8EEED] group-data-[collapsible=icon]:hidden" />
        <div className="mx-auto hidden h-8 w-8 items-center justify-center rounded-md bg-[#152A51] text-sm font-black text-white group-data-[collapsible=icon]:flex">
          B
        </div>
      </SidebarHeader>

      <SidebarContent className="flex flex-1 flex-col justify-between overflow-y-auto bg-transparent px-2 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {items.map((item) => {
                const active = isActive(item.url, item.exact);
                const rawCount = item.badge ? unread : item.count ? counts[item.count] : 0;
                const badge = rawCount > 0 ? (rawCount > 99 ? "99+" : String(rawCount)) : null;
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={badge ? `${item.title} (${badge})` : item.title}
                      className={`${navItemBase} ${active ? navActive : navIdle} ${badge ? "pr-9" : ""}`}
                    >
                      <Link to={item.url} preload="intent">
                        <span className="truncate">{item.title}</span>
                        {badge && (
                          <>
                            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#B8684B] px-1.5 text-[11px] font-semibold text-white group-data-[collapsible=icon]:hidden">
                              {badge}
                            </span>
                            <span className="hidden h-2 w-2 shrink-0 rounded-full bg-[#B8684B] group-data-[collapsible=icon]:block" />
                          </>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto flex-shrink-0 p-0 group-data-[collapsible=icon]:hidden">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={handleLogout}
                  className={`${navItemBase} cursor-pointer ${navIdle}`}
                >
                  <span>Logout</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
