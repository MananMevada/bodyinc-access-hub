// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Build for Vercel (serverless Node functions) when building outside Lovable's sandbox.
  // Inside Lovable, the preset is forced to Cloudflare automatically — this override
  // only kicks in on Vercel/CI builds. Switch to "vercel-edge" for Edge runtime.
  nitro: {
    preset: "vercel",
  },
  // Project lives under a path containing ":" (Admin:Provider). Vite's fs guard
  // rejects any path with colons on non-Windows systems, so relax it for local dev.
  vite: {
    server: {
      port: 8080,
      fs: {
        strict: false,
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/@supabase")) return "supabase";
            if (
              id.includes("node_modules/@tanstack/react-router") ||
              id.includes("node_modules/@tanstack/react-query") ||
              id.includes("node_modules/@tanstack/query-core")
            ) {
              return "tanstack";
            }
            if (id.includes("node_modules/@radix-ui")) return "radix";
          },
        },
      },
    },
    plugins: [
      visualizer({
        filename: "stats.html",
        gzipSize: true,
        open: false,
      }),
    ],
  },
});
