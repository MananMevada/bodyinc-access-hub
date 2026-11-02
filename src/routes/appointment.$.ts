import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/appointment/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const reqUrl = new URL(request.url);
        // External iframe proxy is deprecated; redirect to native consultation dashboard
        return Response.redirect(new URL("/admin/consultations", reqUrl.origin).toString(), 302);
      },
    },
  },
});
