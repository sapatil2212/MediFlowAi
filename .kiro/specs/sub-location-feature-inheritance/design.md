# Design Document

## Overview

This feature introduces a single source of truth for plan-gated feature access and uses it to (1) make child accounts (sub-users and sub-locations) inherit the parent tenant's plan features, and (2) cleanly separate **feature availability** (driven by the plan) from **action authorization** (driven by the role).

Today, all gating is duplicated, client-side, inline ternaries in the five business dashboards. Role and plan checks are ANDed into the same filter, so a child account such as `reception` or `location` is denied the WhatsApp tab even when the inherited Premium/Enterprise plan includes it:

```js
// existing coupling (repeated ~15 times across 5 dashboards)
if (user?.role !== "admin" && (sub.id === "whatsapp" || sub.id === "users" || sub.id === "locations")) return false;
if ((user?.subscriptionPlan === "Solo" || user?.subscriptionPlan === "Basic") && sub.id === "whatsapp") return false;
```

The design adds a pure, framework-agnostic `feature-access` module that resolves, for any account, which plan-gated features are available and at what permission level. The dashboards and the server functions both consume this single module, replacing the scattered inline conditions.

### Goals

- Child accounts inherit the parent tenant's `subscriptionPlan` entitlement (already present in the session — see `verifySession`).
- One resolver produces availability + permission; the UI never re-derives plan logic.
- Server functions enforce availability and write-permission, not just tab hiding.
- Legacy plan aliases (`Solo`, `Clinic`, `Hospital`, `Custom`) resolve to canonical tiers.
- Subscription status/expiry and child-account deactivation switch features off.

### Non-Goals

- No database schema changes. Inheritance data already flows through `verifySession` via the `tenantId` join to the parent `User` row.
- No change to how WhatsApp itself connects/sends (the `whatsapp.ts` / `wa-launcher.ts` operational layer is untouched).
- No new plan tiers or pricing changes.

## Architecture

```
                         ┌─────────────────────────────────┐
                         │  src/lib/feature-access.ts       │
                         │  (pure, isomorphic, no I/O)       │
                         │                                   │
                         │  - normalizePlan(plan)            │
                         │  - PLAN_FEATURES map              │
                         │  - ROLE_PERMISSIONS map           │
                         │  - resolveFeatureAccess(account)  │
                         │  - canUseFeature / canOperate     │
                         └───────────────┬───────────────────┘
                                         │  consumed by
                 ┌───────────────────────┼────────────────────────┐
                 │                        │                        │
       ┌─────────▼─────────┐   ┌──────────▼──────────┐   ┌─────────▼──────────┐
       │ 5 dashboards      │   │ WhatsApp server fns  │   │ feature-access      │
       │ (medical, beauty, │   │ (auth.ts) – guard    │   │ server fn (optional │
       │ gym, education,   │   │ availability + write │   │ single resolved     │
       │ professional)     │   │ permission           │   │ result for client)  │
       │ tab/sub-tab filter│   └──────────────────────┘   └────────────────────┘
       │ uses resolver     │
       └───────────────────┘
```

The resolver is **pure** so it is trivially unit- and property-testable and runs identically on client and server. The session object returned by `verifySession` already contains everything the resolver needs: `role`, `subscriptionPlan`, `subscriptionStatus`, `subscriptionExpiresAt`, `tenantId`, and (implicitly, via the session existing) the active state of child accounts.

## Components and Interfaces

### 1. `src/lib/feature-access.ts` (new, pure module)

This is the `Feature_Access_Service` from the requirements.

```ts
// Canonical plan tiers
export type PlanTier = "Basic" | "Premium" | "Enterprise";

// Roles as produced by verifySession
export type AccountRole = "admin" | "reception" | "doctor" | "location";

// Plan-gated features (string ids match dashboard tab/sub-tab ids)
export type FeatureId =
  | "whatsapp"
  | "analytics"
  | "scribe"
  | "users"        // multi-user / sub-user management
  | "locations"    // multi-location management
  | "plans";       // billing/plan management

export type Permission = "operate" | "view_only" | "none";

export interface AccountContext {
  role: AccountRole;
  subscriptionPlan?: string | null;       // raw value, may be a legacy alias
  subscriptionStatus?: string | null;     // e.g. "Active", "Cancelled", "expired"
  subscriptionExpiresAt?: string | null;  // ISO string or null
  isActive?: boolean;                      // child-account active flag (default true)
  now?: Date;                              // injectable clock for tests; defaults to new Date()
}

export interface FeatureAccess {
  available: boolean;       // plan + status say the feature exists for this tenant
  permission: Permission;   // operate | view_only | none (role layered on top)
  visible: boolean;         // dashboard should render the tab/sub-tab
}

export type ResolvedAccess = Record<FeatureId, FeatureAccess>;

export function normalizePlan(plan?: string | null): PlanTier;
export function isSubscriptionActive(ctx: AccountContext): boolean;
export function planIncludesFeature(plan: PlanTier, feature: FeatureId): boolean;
export function rolePermission(role: AccountRole, feature: FeatureId): Permission;
export function resolveFeatureAccess(ctx: AccountContext): ResolvedAccess;

// convenience guards (used server-side)
export function canUseFeature(ctx: AccountContext, feature: FeatureId): boolean;     // available && permission !== none
export function canOperateFeature(ctx: AccountContext, feature: FeatureId): boolean; // available && permission === operate
```

#### `normalizePlan`

Maps raw plan strings (case-insensitive) to canonical tiers, covering legacy aliases and the free-form values found in the codebase:

| Raw value (any case)                       | Canonical |
|--------------------------------------------|-----------|
| `basic`, `solo`, `999`, `trial`, unknown   | `Basic`   |
| `premium`, `clinic`, `pro`, `1499`         | `Premium` |
| `enterprise`, `hospital`, `custom`         | `Enterprise` |

Unknown/empty defaults to `Basic` (most restrictive), matching the existing dashboard default behavior.

#### `PLAN_FEATURES` entitlement map

Derived from the current dashboard rules (WhatsApp is gated off for Basic/Solo, available for Premium and above):

| Feature     | Basic | Premium | Enterprise |
|-------------|:-----:|:-------:|:----------:|
| `whatsapp`  |   ✗   |    ✓    |     ✓      |
| `analytics` |   ✓   |    ✓    |     ✓      |
| `scribe`    |   ✓   |    ✓    |     ✓      |
| `users`     |   ✓   |    ✓    |     ✓      |
| `locations` |   ✗   |    ✓    |     ✓      |
| `plans`     |   ✓   |    ✓    |     ✓      |

> The exact per-tier mapping for non-WhatsApp features is captured here as the single source of truth. WhatsApp is the only feature whose plan-gating exists in the current code; the others were governed purely by role. If product intends different tiers for `analytics`/`locations`, this table is the one place to adjust. (Confirmed default: WhatsApp = Premium+, which preserves today's behavior.)

#### `ROLE_PERMISSIONS` map

Layers role authorization on top of availability. `admin` (parent) operates everything. The mapping below preserves existing behavior while removing role-based *suppression* of available features (Requirement 3.5):

| Feature     | admin   | doctor    | reception | location |
|-------------|---------|-----------|-----------|----------|
| `whatsapp`  | operate | operate   | view_only | operate  |
| `analytics` | operate | operate   | view_only | operate  |
| `scribe`    | operate | operate   | none      | operate  |
| `users`     | operate | none      | none      | none     |
| `locations` | operate | none      | none      | none     |
| `plans`     | operate | none      | none      | none     |

Notes derived from current code:
- `plans` stays admin-only (matches `role !== "admin" && tab.id === "plans"`).
- `users`/`locations` management stays admin-only.
- `reception` previously had `scribe`/`analytics`/`whatsapp` fully hidden. Under the new model, `analytics`/`whatsapp` become `view_only` for reception (visible, read-only), and `scribe` stays `none`. This satisfies Requirement 2.3 (sub-user WhatsApp tab shows when permission is `operate`) — reception is `view_only` for whatsapp, doctor is `operate`.
- `location` gets `operate` on whatsapp (Requirement 2.2: sub-location sees WhatsApp tab whenever the plan includes it).

#### `resolveFeatureAccess` algorithm

```
for each FeatureId f:
  plan      = normalizePlan(ctx.subscriptionPlan)
  active    = isSubscriptionActive(ctx)            // status === active AND not past expiry
  childOk   = ctx.isActive !== false               // deactivated child => everything off
  avail     = active && childOk && planIncludesFeature(plan, f)
  perm      = avail ? rolePermission(ctx.role, f) : "none"
  visible   = avail && perm !== "none"
  result[f] = { available: avail, permission: perm, visible }
```

- `isSubscriptionActive`: `false` when `subscriptionStatus` is not active (case-insensitive `active`), or when `subscriptionExpiresAt` is a valid date earlier than `now`. (Requirements 5.1, 5.2.)
- Deactivated child account (`isActive === false`) forces `available = false` for all features. (Requirement 7.)
- Plan change / upgrade / downgrade is handled implicitly: resolution always reads the current plan, so the next resolution reflects the new tier. (Requirement 6.)

### 2. Dashboard refactor (5 files)

Each dashboard computes the resolved access once near where `user` is available:

```ts
const access = useMemo(() => resolveFeatureAccess({
  role: user?.role ?? "admin",
  subscriptionPlan: user?.subscriptionPlan,
  subscriptionStatus: user?.subscriptionStatus,
  subscriptionExpiresAt: user?.subscriptionExpiresAt,
  isActive: true, // child sessions only exist when active (verifySession gates on isActive)
}), [user]);
```

The inline filters are replaced with a lookup against `access`:

```js
// before
if (user?.role !== "admin" && (sub.id === "whatsapp" || sub.id === "users" || sub.id === "locations")) return false;
if ((user?.subscriptionPlan === "Solo" || user?.subscriptionPlan === "Basic") && sub.id === "whatsapp") return false;

// after
const fa = access[sub.id as FeatureId];
if (fa && !fa.visible) return false;
```

Tabs not present in the feature map (regular operational tabs like dashboard/appointments/patients) are unaffected — only ids that exist in `FeatureId` are gated. The medical-specific `subLocationBookings` admin rule remains as a separate explicit check (it is not a plan-gated feature).

`view_only` features render but pass a `readOnly`/disabled signal to the feature panel (e.g. `WhatsAppHub` receives `canOperate={access.whatsapp.permission === "operate"}`) so action controls are disabled. (Requirement 3.3.)

### 3. Server-side enforcement (`src/lib/auth.ts` WhatsApp functions)

The WhatsApp server functions currently only check `if (!user || !user.tenantId) throw "Unauthorized"`. Add a feature guard built from the same module so hiding a tab is not the only barrier (Requirement 8):

```ts
function buildContext(user): AccountContext { /* map session fields */ }

// availability guard (read + write)
if (!canUseFeature(buildContext(user), "whatsapp"))
  throw new Error("Your plan does not include WhatsApp alerts.");

// write guard for state-changing fns (saveWhatsAppConfig, disconnect, sendTest)
if (!canOperateFeature(buildContext(user), "whatsapp"))
  throw new Error("You do not have permission to perform this action.");
```

- Read fns (`getWhatsAppStatusServerFn`, `getWhatsAppConfigServerFn`): availability guard only.
- Write/state-changing fns (`saveWhatsAppConfigServerFn`, `disconnectWhatsAppServerFn`, `sendTestWaServerFn`): availability + operate guard.
- All remain tenant-scoped via `user.tenantId` (Requirement 8.4) — unchanged.

This pattern is feature-generic: future plan-gated server functions call `canUseFeature` / `canOperateFeature` with their own `FeatureId`.

## Data Models

No persistent schema changes. The in-memory contracts are the `AccountContext`, `FeatureAccess`, and `ResolvedAccess` types above. `AccountContext` is constructed from the existing `verifySession` result; no new fields are read from the database.

## Error Handling

| Condition                                             | Behavior |
|-------------------------------------------------------|----------|
| Plan does not include requested feature (server)      | throw `Error("Your plan does not include …")` → surfaced as authorization error (Req 8.2) |
| `view_only` role attempts a write (server)            | throw `Error("You do not have permission …")` (Req 3.4, 8.3) |
| Subscription inactive/expired (server)                | availability guard fails → same plan error path (Req 5.1, 5.2) |
| Deactivated child account                             | child session is never created by `verifySession` (it gates on `isActive`); resolver also returns all-unavailable if `isActive === false` is passed (Req 7) |
| Unknown/empty plan string                             | `normalizePlan` → `Basic` (safe default) |
| Missing `subscriptionExpiresAt`                       | treated as not-expired; status governs availability |

Client side, a non-visible feature simply does not render its tab; a `view_only` feature renders disabled controls rather than throwing.

## Correctness Properties

These are the invariants the implementation must uphold; they map directly to the property-based tests and to the requirements.

### Property 1: Availability is role-independent
For a fixed `subscriptionPlan`, `subscriptionStatus`, `subscriptionExpiresAt`, and `isActive`, `resolveFeatureAccess(...)[f].available` is identical for every `role`. Availability never depends on role.
**Validates: Requirements 1.3, 3.1, 3.5**

### Property 2: Child inherits parent entitlement
A child account's resolved availability for any feature equals the parent (`admin`) account's availability for the same plan and active subscription.
**Validates: Requirements 1.1, 1.2**

### Property 3: Legacy aliases are canonical
`normalizePlan` maps `Solo→Basic`, `Clinic→Premium`, `Hospital/Custom→Enterprise`, and resolution via an alias equals resolution via its canonical tier.
**Validates: Requirements 1.4**

### Property 4: Permission implies availability
`permission !== "none"` implies `available === true`; and `visible === true` implies `available === true`. There is no permission or visibility without availability.
**Validates: Requirements 3.2, 8.1**

### Property 5: Inactive or expired subscription disables everything
If `subscriptionStatus` is not active, or `now > subscriptionExpiresAt`, then every feature is `available=false` for every role in the tenant.
**Validates: Requirements 5.1, 5.2**

### Property 6: Deactivated child loses all access
`isActive === false` implies every feature resolves to `available=false`.
**Validates: Requirements 7.1, 7.2**

### Property 7: WhatsApp tier rule
With an active subscription, `whatsapp.available` is true if and only if the normalized plan is `Premium` or `Enterprise`; otherwise it is false for every account in the tenant.
**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

### Property 8: Entitlements are monotonic across tiers
Upgrading `Basic → Premium → Enterprise` never removes a feature's availability; downgrading never adds one.
**Validates: Requirements 6.2, 6.3**

### Property 9: Server write-guard enforces operate permission
A state-changing server operation succeeds only when `canOperateFeature` is true; a `view_only` account is rejected with an authorization error.
**Validates: Requirements 3.4, 8.3**

## Testing Strategy

A test runner does not currently exist, so the first task adds **Vitest** (Vite-native) plus **fast-check** for property-based testing, and a `test` script. The `feature-access` module is pure, making it ideal for property-based testing.

### Property-based tests (`fast-check`) for `feature-access.ts`

1. **Inheritance equivalence** — For any plan + status=active, `resolveFeatureAccess` availability for a child role equals availability for `admin` (availability depends only on plan+status, not role). (Req 1.3, 3.1)
2. **Legacy alias canonicalization** — For any alias in {Solo↔Basic, Clinic↔Premium, Hospital/Custom↔Enterprise}, `normalizePlan(alias)` equals `normalizePlan(canonical)`, and resolved availability matches. (Req 1.4)
3. **Availability ignores role** — For any plan, feature, and any two roles, `available` is identical across roles. (Req 3.1, 3.5)
4. **Inactive/expired kills everything** — For any plan and role, if status≠active OR `expiresAt < now`, every feature has `available=false`. (Req 5.1, 5.2)
5. **Deactivated child kills everything** — For any plan/role, `isActive=false` ⇒ all features `available=false`. (Req 7.1)
6. **WhatsApp tier rule** — For any role with an active sub, `whatsapp.available` is true iff `normalizePlan(plan)` ∈ {Premium, Enterprise}. (Req 2.1, 2.4)
7. **Permission ⊆ availability** — For any input, `permission !== "none"` implies `available === true` (no permission without availability), and `visible` implies `available`. (Req 3, invariant)
8. **Monotonic upgrade** — For any role, upgrading Basic→Premium→Enterprise never removes availability of a feature (entitlements are non-decreasing across tiers). (Req 6.3)

### Example-based unit tests

- WhatsApp visibility matrix per role at Premium (location/doctor = visible+operate, reception = visible+view_only, admin = visible+operate).
- WhatsApp hidden for everyone at Basic. (Req 2.4)
- Server guard: `canUseFeature` false ⇒ throws; `view_only` + write ⇒ throws.

### Verification

After implementation, run `npm run lint`, `npx tsc --noEmit` (type check), and `npm test`. No build of the WhatsApp runtime is required for these changes.
