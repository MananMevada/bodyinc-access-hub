import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, lazy, Suspense, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import {
  clearPasswordRecoveryPending,
  getPasswordRecoveryRedirectUrl,
  isOtpLogin,
  isPasswordRecoveryPending,
} from "@/lib/password-recovery";
import { clearCachedPortalRoles } from "@/lib/portal-role-cache";
import { logoutQuickbloxSdk } from "@/lib/consultations/qb-sdk-cleanup";
import { supabase } from "@/integrations/supabase/client";
import { registerServiceWorker } from "@/lib/register-pwa";

const LazyToaster = lazy(() =>
  import("@/components/ui/sonner").then((m) => ({ default: m.Toaster })),
);

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Body Inc" },
      { name: "description", content: "Practitioner and admin portal for Body Inc." },
      { name: "author", content: "Body Inc" },
      { name: "theme-color", content: "#152A51" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Body Inc" },
      { property: "og:title", content: "Body Inc" },
      { property: "og:description", content: "Practitioner and admin portal for Body Inc." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/fevicone.svg", type: "image/svg+xml" },
      { rel: "shortcut icon", href: "/fevicone.svg" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    registerServiceWorker();
  }, []);

  useEffect(() => {
    const recoveryRedirect = getPasswordRecoveryRedirectUrl();
    if (recoveryRedirect) {
      window.location.replace(recoveryRedirect);
      return;
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        if (isOtpLogin()) {
          clearPasswordRecoveryPending();
          return;
        }
        const redirectUrl = getPasswordRecoveryRedirectUrl();
        if (redirectUrl) {
          window.location.replace(redirectUrl);
          return;
        }
        if (window.location.pathname !== "/reset-password") {
          window.location.replace("/reset-password");
        }
        return;
      }

      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;

      if (event === "SIGNED_IN") {
        const redirectUrl = getPasswordRecoveryRedirectUrl();
        if (redirectUrl) {
          window.location.replace(redirectUrl);
          return;
        }
        // Recovery creates a session before the new password is saved — stay on reset page.
        if (
          typeof window !== "undefined" &&
          (window.location.pathname === "/reset-password" || isPasswordRecoveryPending())
        ) {
          return;
        }
      }

      if (event === "SIGNED_OUT") {
        clearPasswordRecoveryPending();
        clearCachedPortalRoles();
        logoutQuickbloxSdk();
      }
      router.invalidate();
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Suspense fallback={null}>
        <LazyToaster />
      </Suspense>
    </QueryClientProvider>
  );
}
