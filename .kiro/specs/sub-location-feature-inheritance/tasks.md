# Implementation Plan

## Overview

This plan introduces a single, pure `feature-access` module as the source of truth for plan-gated feature access, then rewires the five business dashboards and the WhatsApp server functions to consume it. The result: child accounts (sub-users and sub-locations) inherit the parent tenant's plan features, while role only governs whether an account can operate or merely view an available feature. Test tooling (Vitest + fast-check) is added first so the pure resolver can be validated with property-based tests.

## Task Dependency Graph

```json
{
  "tasks": {
    "1": { "dependsOn": [] },
    "2": { "dependsOn": ["1"] },
    "2.1": { "dependsOn": ["1"] },
    "2.2": { "dependsOn": ["2.1"] },
    "3": { "dependsOn": ["2.1"] },
    "4": { "dependsOn": ["2.1"] },
    "4.1": { "dependsOn": ["2.1"] },
    "4.2": { "dependsOn": ["2.1"] },
    "4.3": { "dependsOn": ["2.1"] },
    "4.4": { "dependsOn": ["2.1"] },
    "4.5": { "dependsOn": ["2.1"] },
    "5": { "dependsOn": ["4.1", "4.2", "4.3", "4.4", "4.5"] },
    "6": { "dependsOn": ["2.2", "3", "5"] }
  },
  "waves": [
    ["1"],
    ["2.1"],
    ["2.2", "3", "4.1", "4.2", "4.3", "4.4", "4.5"],
    ["5"],
    ["6"]
  ]
}
```

- Task 1 has no dependencies.
- Task 2.1 depends on 1.
- Tasks 2.2, 3, 4.1, 4.2, 4.3, 4.4, 4.5 all depend on 2.1 and run in parallel (wave 3).
- Task 5 depends on the dashboard tasks (4.1–4.5) that pass the operate flag.
- Task 6 (verify) depends on all implementation tasks.

## Tasks

- [ ] 1. Set up test tooling (Vitest + fast-check)
  - Add `vitest` and `fast-check` as devDependencies and a `test` script (`vitest run`) and `test:watch` script to `package.json`.
  - Add a minimal `vitest.config.ts` (or extend the existing Vite config) so `*.test.ts` files under `src/` are picked up in a node environment.
  - Verify the runner executes with a trivial smoke test, then remove the smoke test.
  - _Requirements: (tooling foundation for all property-based tests)_

- [ ] 2. Implement the pure `feature-access` module
- [ ] 2.1 Create `src/lib/feature-access.ts` with types, maps, and pure functions
  - Define types: `PlanTier`, `AccountRole`, `FeatureId`, `Permission`, `AccountContext`, `FeatureAccess`, `ResolvedAccess`.
  - Implement `normalizePlan` (case-insensitive; Solo/999/trial/unknown→Basic, Clinic/Premium/Pro/1499→Premium, Hospital/Custom/Enterprise→Enterprise).
  - Implement `PLAN_FEATURES` entitlement map and `planIncludesFeature`.
  - Implement `ROLE_PERMISSIONS` map and `rolePermission`.
  - Implement `isSubscriptionActive` (status active AND not past `subscriptionExpiresAt` using injectable `now`).
  - Implement `resolveFeatureAccess` per the design algorithm (availability = active && childOk && planIncludesFeature; permission layered; visible = available && permission !== none).
  - Implement `canUseFeature` and `canOperateFeature` convenience guards.
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 3.1, 3.2, 4.1, 4.3, 5.1, 5.2, 6.1, 7.1_

- [ ] 2.2 Write property-based tests for `feature-access.ts`
  - Create `src/lib/feature-access.test.ts` using `fast-check`.
  - Property 1: availability is role-independent for fixed plan/status/active inputs.
  - Property 2: child availability equals admin availability (same plan, active).
  - Property 3: legacy alias resolution equals canonical-tier resolution.
  - Property 4: `permission !== "none"` ⇒ `available`; `visible` ⇒ `available`.
  - Property 5: inactive/expired ⇒ all features unavailable for every role.
  - Property 6: `isActive=false` ⇒ all features unavailable.
  - Property 7: whatsapp available iff normalized plan ∈ {Premium, Enterprise} with active sub.
  - Property 8: monotonic entitlements Basic→Premium→Enterprise.
  - Add example-based tests: per-role WhatsApp matrix at Premium (location/doctor operate, reception view_only, admin operate); WhatsApp hidden at Basic for all roles.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.5, 4.1, 4.2, 5.1, 5.2, 6.2, 6.3, 7.1_

- [ ] 3. Add server-side feature enforcement to WhatsApp server functions
  - In `src/lib/auth.ts`, add a small `buildAccountContext(user)` helper that maps a `verifySession` result to `AccountContext`.
  - `getWhatsAppStatusServerFn` and `getWhatsAppConfigServerFn`: after the existing auth check, reject with an authorization error when `canUseFeature(ctx, "whatsapp")` is false.
  - `saveWhatsAppConfigServerFn`, `disconnectWhatsAppServerFn`, `sendTestWaServerFn`: additionally reject with an authorization error when `canOperateFeature(ctx, "whatsapp")` is false.
  - Keep all functions tenant-scoped via `user.tenantId` (no change).
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 3.4, 7.2_

- [ ] 4. Refactor dashboard tab/sub-tab gating to consume the resolver
- [ ] 4.1 Refactor `src/routes/dashboards/medical.tsx`
  - Compute `access = useMemo(() => resolveFeatureAccess({ role, subscriptionPlan, subscriptionStatus, subscriptionExpiresAt, isActive: true }), [user])`.
  - Replace the desktop nav, mobile nav, and settings sub-tab inline filters with `access[id]?.visible` lookups; keep the non-plan-gated `subLocationBookings` admin check as an explicit separate condition.
  - Pass an operate flag to the WhatsApp panel (`WhatsAppHub`) so `view_only` renders disabled action controls.
  - _Requirements: 2.2, 2.3, 2.4, 3.3, 3.5, 4.3_

- [ ] 4.2 Refactor `src/routes/dashboards/professional.tsx`
  - Same resolver-based replacement for desktop nav, mobile nav, and settings sub-tab filters; wire the WhatsApp panel operate flag.
  - _Requirements: 2.2, 2.3, 2.4, 3.3, 3.5, 4.3_

- [ ] 4.3 Refactor `src/routes/dashboards/gym.tsx`
  - Same resolver-based replacement for desktop nav, mobile nav, and settings sub-tab filters; wire the WhatsApp panel operate flag.
  - _Requirements: 2.2, 2.3, 2.4, 3.3, 3.5, 4.3_

- [ ] 4.4 Refactor `src/routes/dashboards/education.tsx`
  - Same resolver-based replacement for desktop nav, mobile nav, and settings sub-tab filters; wire the WhatsApp panel operate flag.
  - _Requirements: 2.2, 2.3, 2.4, 3.3, 3.5, 4.3_

- [ ] 4.5 Refactor `src/routes/dashboards/beauty.tsx`
  - Same resolver-based replacement for desktop nav, mobile nav, and settings sub-tab filters; wire the WhatsApp panel operate flag.
  - _Requirements: 2.2, 2.3, 2.4, 3.3, 3.5, 4.3_

- [ ] 5. Wire WhatsAppHub read-only mode
  - Update `src/components/WhatsAppHub.tsx` to accept an optional `canOperate` prop (default `true`) and disable action controls (connect/disconnect/save config/send test) when `canOperate` is false, so `view_only` accounts see the feature without acting.
  - _Requirements: 3.3, 3.4_

- [ ] 6. Verify the full change
  - Run `npm test` (all property and unit tests pass), `npx tsc --noEmit` (type check clean), and `npm run lint`.
  - Fix any type or lint errors introduced by the refactor.
  - _Requirements: all_

## Notes

- No database schema changes are required; child accounts already carry the parent's `subscriptionPlan` and subscription fields through `verifySession` (joined on `tenantId`).
- The `feature-access` module is intentionally pure and isomorphic so it can run on both client and server and be validated with property-based tests.
- The `PLAN_FEATURES` table in the design preserves today's behavior (WhatsApp = Premium and above). If product later wants different tiers for analytics/locations, that table is the single place to change.
- Tasks 2.2, 3, and 4.1–4.5 are independent once 2.1 lands and may be executed in parallel.
