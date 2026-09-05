// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    router: {
      // Exclude *.test.ts(x) files under src/routes from being treated as route files
      routeFileIgnorePattern: "\\.test\\.tsx?$",
    },
  },
  nitro: {
    preset: "node-server",
  },
  vite: {
    ssr: {
      // Externalize heavy CJS packages that use Node globals (module, require, __dirname)
      // so they are loaded natively by Node instead of being bundled by Vite
      external: ["whatsapp-web.js", "puppeteer", "qrcode", "bcryptjs", "nodemailer", "mariadb"],
      noExternal: [],
    },
    server: {
      // The dashboard routes are very large single-file modules (several thousand
      // lines each, pulling in recharts/jspdf/xlsx). Transforming one on first
      // request can take long enough to exceed Vite's 60s module-runner RPC
      // timeout on a busy machine, which surfaces as a confusing
      // "transport invoke timed out" SSR error rather than a slow page.
      // Warming them at startup moves that work off the first request, so the
      // SSR fetch is served from an already-populated module graph.
      warmup: {
        ssrFiles: ["./src/routes/dashboards/*.tsx", "./src/routes/book.$tenantId.tsx"],
      },
    },
  },
});
