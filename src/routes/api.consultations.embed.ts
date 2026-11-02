import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/consultations/embed")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(
          "QuickBlox iframe embedding is deprecated. All consultations now run natively via the QuickBlox Client SDK.",
          { status: 410, headers: { "Content-Type": "text/plain" } },
        );
      },
    },
  },
});
