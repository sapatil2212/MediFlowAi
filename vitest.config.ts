import { defineConfig } from "vitest/config";

// Standalone Vitest config kept separate from the Lovable/TanStack Vite app config
// (vite.config.ts) so test runs don't load the dev/build plugins.
//
// Two projects, because the suite now has two shapes:
//   - `node`: the pure, I/O-free modules under src/lib. Same environment,
//     include glob, globals and passWithNoTests settings as before.
//   - `dom`: the React component suites (`*.test.tsx`), which need a DOM. jsdom
//     is scoped to those files only, and each also carries a
//     `// @vitest-environment jsdom` docblock so the environment is explicit at
//     the file level too.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    testTimeout: 30_000,
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          globals: true,
          testTimeout: 30_000,
          passWithNoTests: true,
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/setup.ts"],
          globals: true,
          testTimeout: 30_000,
          passWithNoTests: true,
        },
      },
    ],
  },
});
