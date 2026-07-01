import { defineConfig } from "vitest/config";

// Standalone Vitest config kept separate from the Lovable/TanStack Vite app config
// (vite.config.ts) so test runs don't load the dev/build plugins. The module under
// test is pure and server-side, so a node environment is sufficient (no jsdom).
export default defineConfig({
  // Resolve TypeScript path aliases (e.g. "@/*") natively, matching tsconfig.json.
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: true,
    // Don't fail the run before real test files exist (Task 2.2 adds them).
    passWithNoTests: true,
  },
});
