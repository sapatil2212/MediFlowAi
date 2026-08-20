# Implementation Plan: Restaurant Dashboard Settings

## Overview

This plan delivers restaurant Settings parity in safe TypeScript vertical increments: pure models, MariaDB/Prisma schema mirrors, tenant and location authorization, closure-aware availability, profile security, the responsive Settings shell, operational editors, public menu projection, WhatsApp controls, user/branch lifecycle, and regression validation. Each production behavior and core automated validation task is required. Property-based tests use fast-check and map one-to-one to the design's 18 correctness properties.

## Tasks

- [x] 1. Build the pure settings domain model
  - Keep this increment I/O-free so validation, normalization, ordering, navigation, scope, and plan rules can be reused by server and UI layers.
  - _Requirements: 1.2, 2.7, 3.3–3.7, 4.3–4.6, 5.1–5.9, 6.1–6.13, 8.3–8.13, 9.3–9.7, 10.1–10.12, 11.1–11.4_

  - [x] 1.1 Create core contracts, limits, result types, and normalization helpers
    - Create `src/lib/restaurant-settings-model.ts` with the design's area, closure, menu, location-scope, profile, verification, user-limit, permission, and typed result contracts.
    - Export stable field errors and exact bounds/defaults; keep database, auth, React, clock, and network dependencies out of this module.
    - _Requirements: 2.7, 2.10, 2.14, 3.1, 4.3, 4.6, 5.2, 5.3, 6.3, 6.12, 8.4, 8.10, 8.11, 11.1_

  - [x] 1.2 Implement pure hours, closure, profile, and security helpers
    - Implement strict calendar-date validation, seven-day hour validation, named presets, apply-to-open-days, profile trimming, photo MIME/byte validation, verification timing/binding rules, and password input validation.
    - Return all applicable field errors without mutating submitted or stored snapshots.
    - _Requirements: 2.7, 2.10, 2.12, 2.14–2.24, 3.3–3.7, 4.3, 4.5, 4.6, 11.1, 11.2_

  - [x] 1.3 Implement pure dining-area and menu invariants
    - Implement deterministic area/menu ordering, tenant-wide case-insensitive uniqueness, default display orders, synthetic `Main`, assigned counts, item defaults and bounds, cap checks, cascade previews, and public available-item projection.
    - Add deterministic id tie-breakers and never mutate input collections.
    - _Requirements: 5.1–5.9, 6.1–6.13, 11.1, 11.4_

  - [x] 1.4 Implement pure navigation, scope, permission, and user-plan helpers
    - Implement canonical tab derivation/fallback, Profile/security capability view models, server-derived owner/branch/primary scope decisions, feature-write guard decisions, and shared SubUser plan limits/messages.
    - Cover canonical and legacy plan names and role changes as removal from the old role plus addition to the new role.
    - _Requirements: 1.2, 1.6–1.9, 2.1, 2.13, 7.1, 8.1, 8.3, 8.13, 9.1, 9.3–9.7, 10.1–10.12_

- [x] 2. Add restart-safe schema and runtime persistence
  - Make MariaDB initialization authoritative, keep Prisma as a matching mirror, and centralize all tenant/location-constrained row access.
  - _Requirements: 2.5, 2.11, 3.6, 4.3–4.13, 5.1–5.10, 6.1–6.14, 8.2–8.14, 9.2–9.8, 10.11, 10.12, 11.1–11.6_

  - [x] 2.1 Add additive runtime DDL for settings records
    - Extend `src/lib/db.ts` with idempotent tables/indexes for dining areas, closure days, menu categories/items, and account email verification plus nullable `areaId` and account photo columns.
    - Match the design's lengths, nullability, collation, unique keys, location/scope keys, and independent fail-closed startup logging.
    - _Requirements: 2.10–2.20, 4.3–4.6, 5.1–5.9, 6.1–6.13, 9.3–9.7, 10.11, 11.1–11.4_

  - [x] 2.2 Update the Prisma schema mirror
    - Add mapped models and scalar compatibility columns to `prisma/schema.prisma` without introducing Prisma calls into restaurant runtime paths.
    - Match the critical SQL names, sizes, defaults, indexes, and nullability from `src/lib/db.ts`.
    - _Requirements: 4.3, 5.2, 6.3, 9.4, 10.11, 11.1_

  - [x] 2.3 Implement idempotent dining-area backfill and compatibility migration
    - Backfill scoped canonical areas from trimmed legacy `RestaurantTable.area`, assign deterministic orders, resolve `areaId` where possible, and retain all legacy area strings and appointments.
    - Make repeated startup safe and preserve unresolved/blank values through effective `Main`.
    - _Requirements: 4.11, 5.1, 5.8, 5.9, 9.3–9.7, 11.6_

  - [x] 2.4 Create the settings repository shell and global record access
    - Create `src/lib/restaurant-settings.server.ts` with tenant-first APIs, null-safe location predicates, transactions, typed row mapping, and repository methods for profile, hours, verification, and WhatsApp config.
    - Ensure identifier lookups always constrain tenant and effective location where applicable.
    - _Requirements: 2.5–2.24, 3.1–3.9, 7.2–7.13, 10.3, 10.9–10.12, 11.1, 11.2_

  - [x] 2.5 Add scoped closure, area, and table repository operations
    - Implement month/scope closure reads, duplicate-safe create/exact delete, booking counts, ordered area reads/default order/guarded delete, table area synchronization, and table-closure cleanup in transactions.
    - Never update existing appointments when closures, areas, or tables change.
    - _Requirements: 4.1–4.13, 5.1–5.10, 9.3–9.7, 10.3, 10.11, 10.12, 11.1, 11.3–11.6_

  - [x] 2.6 Add scoped menu repository operations
    - Implement ordered tree reads, tenant-wide category uniqueness, same-scope category resolution, atomic tenant cap checks, item upserts/state changes, cascade preview, and confirmed transactional deletion.
    - Add a primary-scope public read returning available items only.
    - _Requirements: 6.1–6.14, 9.3–9.7, 10.3, 10.11, 10.12, 11.1, 11.4_

  - [x] 2.7 Add account, SubUser, Branch, and strict WhatsApp repository/adapters
    - Add cross-account email uniqueness and account-bound verification persistence, role-specific credential/photo updates, complete tenant-scoped SubUser lifecycle, guarded Branch row operations, and strict WhatsApp status/config adapters.
    - Deactivation/deletion must remove sessions transactionally; adapter failures must not report success.
    - _Requirements: 2.10–2.24, 7.2–7.13, 8.2–8.15, 9.1, 9.2, 9.8, 10.5–10.10_

  - [x] 2.8 Write schema initialization, drift, and migration integration tests
    - Prove pre-feature initialization succeeds twice, runtime/Prisma critical metadata agree, area backfill is deterministic, and tables/appointments/settings remain unchanged.
    - Test affected panels fail closed when a required new schema object is unavailable.
    - _Requirements: 4.11, 5.9, 9.3–9.7, 10.11, 11.1, 11.6_

- [x] 3. Enforce feature authorization and server-derived scope
  - Establish one guarded server-function pipeline before exposing any new mutation.
  - _Requirements: 7.1, 8.1, 9.1, 9.3–9.8, 10.1–10.12_

  - [x] 3.1 Create the authenticated settings boundary and scope resolver
    - Create `src/lib/restaurant-settings.ts`; verify sessions, resolve Feature Access, derive tenant/location scope, validate owner branch selections, and reject inactive or spoofing branch accounts before row access.
    - Keep authorization before validation-dependent reads and map foreign ids to not found.
    - _Requirements: 9.3–9.7, 10.3–10.12_

  - [x] 3.2 Implement guarded bootstrap and reusable read/write wrappers
    - Return navigation permissions, account identity, profile summary, validated branch choices, and plan messages; provide wrappers requiring feature visibility for reads and `operate` for writes.
    - Return the unresolved-access Profile-only state without exposing mutation controls.
    - _Requirements: 1.7–1.9, 2.1, 7.1, 8.1, 9.1, 10.1–10.10_

  - [x] 3.3 Write property test for feature write authorization
    - **Property 14: Feature writes require operate permission**
    - Use injected repository/external adapters and assert non-`operate` permissions never reach a state-changing adapter.
    - **Validates: Requirements 10.3–10.10**

  - [x] 3.4 Write property test for tenant and location isolation
    - **Property 15: Tenant and location isolation**
    - Generate mixed tenants/scopes, owner selections, branch sessions, and spoofed ids; assert reads/writes contain only the effective server-derived scope.
    - **Validates: Requirements 9.3–9.5, 9.7, 10.11, 10.12**

  - [x] 3.5 Write authorization and scope integration tests
    - Exercise owner primary/selected branch, branch spoofing, reception primary, inactive child, unresolved access, foreign ids, and every feature's `view_only`/`none` write refusal against fake or transactional repositories.
    - Assert refused operations preserve persistent and external state.
    - _Requirements: 1.9, 9.3–9.8, 10.1–10.12_

- [x] 4. Make availability and booking rechecks closure-aware
  - Feed one closure snapshot into both availability reads and the locked booking transaction without changing existing indicator precedence.
  - _Requirements: 3.9, 4.7, 4.8, 4.11, 11.5, 11.6_

  - [x] 4.1 Extend the pure availability core for closures
    - Add `AvailabilityClosureInput` to `src/lib/restaurant-availability.ts`; close restaurant dates after out-of-window precedence and remove table-scoped ids before existing capacity/occupancy rules.
    - Preserve behavior when no closure input is present.
    - _Requirements: 4.7, 4.8, 11.5_

  - [x] 4.2 Load closure snapshots in public and transactional booking paths
    - Extend `src/lib/restaurant.server.ts` snapshot loading and `createBookingAtomic` recheck to use tenant/date/effective-location closures under the existing lock order.
    - Ensure newly closed dates/tables cannot pass a stale availability response.
    - _Requirements: 3.9, 4.7, 4.8, 4.11, 11.5, 11.6_

  - [x] 4.3 Wire closure-aware availability through server functions
    - Update `src/lib/restaurant.ts` so public availability, public booking, and walk-in paths all call the same closure-aware computation and preserve existing messages/contracts.
    - _Requirements: 3.9, 4.7, 4.8, 11.5, 11.6_

  - [x] 4.4 Write property test for closure-aware availability
    - **Property 8: Closure-aware availability**
    - Generate valid snapshots plus restaurant/table closure sets and compare results with a reference filter while retaining all pre-existing rules.
    - **Validates: Requirements 4.7, 4.8, 11.5**

  - [x] 4.5 Write closure concurrency and endpoint integration tests
    - Test whole-restaurant closure, exact table exclusion, unaffected tables, endpoint/transaction agreement, and a closure racing a booking recheck.
    - Assert closure changes never rewrite existing appointment fields/statuses.
    - _Requirements: 3.9, 4.7, 4.8, 4.11, 11.5, 11.6_

  - [x] 4.6 Run focused availability and booking regression tests
    - Update existing expected navigation only where the approved supersession requires it; keep locking, stale-response, slot, capacity, status, and non-restaurant tests green.
    - _Requirements: 1.2, 2.1, 3.9, 4.7, 4.8, 10.1, 11.5, 11.6_

- [ ] 5. Deliver restaurant profile and self-service account security
  - Keep tenant profile mutation permission-gated while account security remains available to every signed-in Settings account.
  - _Requirements: 2.1–2.24, 10.1, 11.1, 11.2_

  - [x] 5.1 Implement profile read/save server functions
    - Return the canonical booking path, merged tenant/account fields, permission view model, and trimmed atomic profile writes with owner compatibility synchronization.
    - Expose no profile save path unless `restaurant_config` is `operate`.
    - _Requirements: 2.1–2.9, 10.1, 10.3, 10.4, 11.1, 11.2_

  - [x] 5.2 Implement role-aware profile photo upload
    - Validate decoded bytes and detected MIME before Cloudinary, update `User`, `SubUser`, or `Location` only after upload success, and preserve the old URL on every failure.
    - _Requirements: 2.10–2.12, 10.3, 10.4_

  - [x] 5.3 Implement account email-change lifecycle
    - Add request/resend/confirm functions with global case-insensitive uniqueness, cryptographic four-digit codes stored hashed, exact five-minute validity, exact 60-second resend boundary, account/email binding, transactional consumption, and role-specific account updates.
    - Send no code for current/in-use addresses and preserve email on invalid, expired, raced, or consumed codes.
    - _Requirements: 2.13–2.20_

  - [x] 5.4 Implement own-password change
    - Verify the current hash, validate eight-character minimum and confirmation, update the signed-in account table only, and return requirement-specific errors without changing the hash on failure.
    - _Requirements: 2.13, 2.21–2.24_

  - [x] 5.5 Build `RestaurantProfilePanel`
    - Add selectable exact portal text, copy with cleanup-safe two-second confirmation, QR rendering, profile/photo states by permission, and always-visible email/password controls with accessible loading/error/success status.
    - Ensure QR, clipboard, and displayed text use one exact browser-origin booking link.
    - _Requirements: 2.1–2.24_

  - [x] 5.6 Write property test for profile/security capability visibility
    - **Property 2: Profile security visibility is independent of configuration permission**
    - Generate every role and config permission; assert security is always present and profile mutation is available exactly for `operate`.
    - **Validates: Requirements 2.6, 2.8, 2.9, 2.13**

  - [x] 5.7 Write property test for profile normalization round trips
    - **Property 3: Profile normalization round trip**
    - Use an injected repository model to assert trimmed save/read equality and unchanged state after identical repeated saves.
    - **Validates: Requirements 2.7, 11.1, 11.2**

  - [x] 5.8 Write property test for exact profile photo validation
    - **Property 4: Profile photo validation is exact**
    - Generate MIME types and byte lengths around 5 MiB; assert acceptance iff both rules pass and rejection preserves the URL.
    - **Validates: Requirements 2.10, 2.12**

  - [x] 5.9 Write property test for email verification lifecycle
    - **Property 5: Email verification lifecycle**
    - Generate account/email/code bindings and instants around 60 seconds/five minutes; assert acceptance, resend, consumption, and no-change semantics exactly.
    - **Validates: Requirements 2.14, 2.16, 2.17, 2.20**

  - [ ] 5.10 Write profile and security component/integration tests
    - Test portal copy timing and QR decode, field inventory, permission modes, photo adapter success/failure, User/SubUser/Location email changes, uniqueness, concurrent confirmation, password errors, and stored-state preservation.
    - _Requirements: 2.1–2.24, 10.1, 11.1, 11.2_

- [ ] 6. Build the responsive Settings navigation shell
  - Mount only the active panel and centralize canonical visibility/fallback behavior in the route.
  - _Requirements: 1.1–1.9, 2.1, 7.1, 8.1, 9.1, 10.1, 10.2_

  - [x] 6.1 Refactor the restaurant route Settings shell
    - Update `src/routes/dashboards/restaurant.tsx` to render heading/description, nine-tab canonical order, owner branch selection, unresolved/empty messages, dropdown below 768 px, horizontal tabs at 768 px and above, and one active panel.
    - Reset scoped dialog/query state on branch change and avoid mounting hidden polling panels.
    - _Requirements: 1.1–1.9, 2.1, 7.1, 8.1, 9.1, 9.6, 9.7, 10.1, 10.2_

  - [x] 6.2 Write property test for canonical settings navigation
    - **Property 1: Canonical settings navigation**
    - Generate resolved/unresolved access and requested tabs; assert uniqueness, governing visibility, order, fallback, Profile-first behavior, and exactly one selected panel mapping.
    - **Validates: Requirements 1.2, 1.6, 1.7, 1.9, 2.1, 7.1, 8.1, 9.1, 10.1, 10.2**

  - [ ] 6.3 Write Settings shell component tests
    - Test entitled nine-tab inventory, unresolved/defensive empty states, invalid-tab fallback, exact active body, selected semantics, 767/768 responsive modes, keyboard/focus behavior, and duplicate-label absence.
    - _Requirements: 1.1–1.9, 2.1, 10.1, 10.2_

- [ ] 7. Deliver hours, closures, dining areas, and tables
  - Complete the restaurant configuration vertical slice, including read-only modes and booking-count warnings.
  - _Requirements: 3.1–3.9, 4.1–4.13, 5.1–5.10, 9.3–9.7, 10.3, 10.4, 11.1–11.6_

  - [x] 7.1 Expose atomic hours and closure server functions
    - Add seven-day save/read, month navigation reads, duplicate-safe closure create/exact delete, table/restaurant scope validation, affected-booking counts, and stable errors to `src/lib/restaurant-settings.ts`.
    - Require config visibility for reads and `operate` for changes.
    - _Requirements: 3.1–3.9, 4.1–4.11, 4.13, 9.3–9.7, 10.3, 10.4, 11.1–11.3, 11.5, 11.6_

  - [x] 7.2 Expose dining-area and registry-backed table operations
    - Add ordered effective area reads, create/delete guards, assigned/table closure counts, registry-only area selection, canonical `area`/`areaId` synchronization, and scope-aware table operations.
    - Preserve the synthetic `Main` behavior and existing table deletion/booking safeguards.
    - _Requirements: 4.12, 4.13, 5.1–5.10, 9.3–9.7, 10.3, 10.4, 10.11, 10.12, 11.1, 11.4, 11.6_

  - [x] 7.3 Build operating-hours and restaurant-closure UI
    - Create `OperatingHoursSettings` with seven rows, at least three presets, apply-to-open-days, stored/draft separation, atomic save feedback, timezone month calendar, previous/next navigation, create/delete controls, warnings, and read-only mode.
    - _Requirements: 3.1–3.8, 4.1–4.11, 4.13_

  - [x] 7.4 Build dining-area and table-closure UI
    - Create `DiningAreasSettings` and extend `TableManager` with ordered counts, create/delete refusal, registry-only selector, closure badges/calendar, branch scope, and read-only action absence.
    - _Requirements: 4.2–4.6, 4.8–4.13, 5.1–5.10, 9.3–9.7_

  - [x] 7.5 Write property test for draft-only hour shortcuts
    - **Property 6: Hour shortcuts change drafts only**
    - Generate valid seven-day drafts/stored snapshots; assert preset and apply-to-all effects while stored data and closed flags remain protected.
    - **Validates: Requirements 3.3, 3.4, 3.5**

  - [ ] 7.6 Write property test for atomic operating-hours validation
    - **Property 7: Operating-hours validation is atomic**
    - Generate duplicates, omissions, malformed/open-day time pairs, and valid permutations; assert complete weekday errors, rollback, and normalized round trip.
    - **Validates: Requirements 3.1, 3.2, 3.6, 3.7, 11.1**

  - [ ] 7.7 Write property test for closure uniqueness and booking noninterference
    - **Property 9: Closure uniqueness and booking noninterference**
    - Use an injected transactional model to assert repeated create yields one row, exact delete isolation, and byte-equivalent booking/status collections.
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.11, 11.3, 11.6**

  - [x] 7.8 Write property test for malformed closure validation
    - **Property 10: Closure validation rejects every malformed field**
    - Generate nonexistent/malformed dates and overlong reasons, asserting every offending field is reported and collections remain unchanged.
    - **Validates: Requirements 4.6**

  - [x] 7.9 Write property test for dining-area registry invariants
    - **Property 11: Dining-area registry invariants**
    - Generate scoped areas/tables and insertion permutations; assert canonical order, counts, defaults, uniqueness, effective `Main`, and round trips.
    - **Validates: Requirements 5.1–5.3, 5.5, 5.6, 5.8, 5.9, 11.1, 11.4**

  - [x] 7.10 Write hours, closure, area, and table component/integration tests
    - Test three presets, apply-to-all, calendar navigation, invalid atomic save, duplicate/date validation, warning counts without booking mutation, Main fallback, delete refusal, registry selector, closure badges, scope changes, and `view_only` action absence.
    - _Requirements: 3.1–3.9, 4.1–4.13, 5.1–5.10, 9.3–9.7, 10.3, 10.4, 11.1–11.6_

- [ ] 8. Deliver dashboard menu management and public menu projection
  - Keep dashboard CRUD scoped and guarded while public menu failures remain informational and never block booking.
  - _Requirements: 6.1–6.14, 9.3–9.7, 10.3, 10.4, 10.11, 10.12, 11.1, 11.4_

  - [x] 8.1 Expose guarded menu management server functions
    - Add ordered reads, category/item create/edit/delete, state changes, cap/uniqueness validation, cascade preview/confirmed delete, and same-scope category resolution.
    - Require `restaurant_config: operate` for every mutation and preserve all rows on invalid/cap/race failures.
    - _Requirements: 6.1–6.8, 6.12–6.14, 9.3–9.7, 10.3, 10.4, 10.11, 10.12, 11.1, 11.4_

  - [ ] 8.2 Build `MenuSettings`
    - Add ordered category/item editors, validation summaries, limits, available/unavailable state, stored/draft state, two-step cascade confirmation, branch scope, and read-only mode.
    - _Requirements: 6.1–6.8, 6.12–6.14, 9.3–9.7_

  - [x] 8.3 Add the public restaurant menu server projection
    - Expose a primary-scope public read containing ordered available items only; log failures with correlation ids and return an empty informational projection without affecting availability.
    - _Requirements: 6.9–6.11, 9.5, 11.4_

  - [x] 8.4 Render `PublicRestaurantMenu` in the restaurant booking form
    - Update `src/routes/book.$tenantId.tsx` restaurant branch to show names, prices, and descriptions only when available items exist; leave all non-restaurant branches and booking controls unchanged.
    - _Requirements: 6.9–6.11_

  - [x] 8.5 Write property test for menu validation, defaults, and limits
    - **Property 12: Menu validation, defaults, and limits**
    - Generate fields/counts around every bound; assert trimming, default `available`, all-field errors, category uniqueness, and hard tenant caps without mutation.
    - **Validates: Requirements 6.3–6.5, 6.12, 6.13, 11.1**

  - [x] 8.6 Write property test for menu ordering and public projection
    - **Property 13: Menu ordering and public projection**
    - Generate arbitrary menu trees and permutations; assert canonical dashboard equality and exact ordered available-only public projection.
    - **Validates: Requirements 6.1, 6.8–6.11, 11.4**

  - [ ] 8.7 Write menu dashboard/public integration tests
    - Test CRUD, limits, cascade preview/confirm, unavailable retention, tenant/location isolation, ordered public content, empty/error omission, and unchanged availability/booking controls.
    - _Requirements: 6.1–6.14, 9.3–9.7, 10.3, 10.4, 10.11, 10.12, 11.1, 11.4_

- [ ] 9. Deliver WhatsApp alert configuration and pairing
  - Reuse tenant-keyed service calls but expose strict Settings status and never conflate transport failure with success.
  - _Requirements: 7.1–7.13, 10.9, 10.10, 11.2_

  - [ ] 9.1 Implement strict WhatsApp settings server functions
    - Add guarded config save, strict status read, initialize, disconnect, and test-message queue functions; map status transport errors to `ERROR` while returning prior config separately.
    - Preserve config on save/queue failures and enforce `whatsapp: operate` before external state-changing calls.
    - _Requirements: 7.2–7.13, 10.9, 10.10, 11.2_

  - [x] 9.2 Build `WhatsAppAlertsSettings`
    - Render config, all five states, refresh, QR/instructions, three-second non-overlapping polling while not connected, connected metrics/actions, cleanup on tab switch/unmount, and `view_only` action absence.
    - _Requirements: 7.1–7.13_

  - [ ] 9.3 Write WhatsApp state-machine component/integration tests
    - Use fake timers and mocked adapters to test every state, refresh, polling interval/overlap/cleanup, QR, connected metrics, permission refusal, strict `ERROR`, and no false success or config mutation.
    - _Requirements: 7.1–7.13, 10.9, 10.10, 11.2_

- [ ] 10. Deliver complete user and branch management
  - Centralize plan limits and preserve server enforcement for every account lifecycle mutation.
  - _Requirements: 8.1–8.15, 9.1–9.8, 10.5–10.8_

  - [x] 10.1 Implement guarded SubUser lifecycle server functions
    - Add list/create/edit/password/deactivate/delete with tenant email uniqueness, shared role limits, session revocation, optional-password updates, confirmations, and plan-upgrade outcomes.
    - Require `users: operate` for writes and keep all users unchanged on validation, plan, authorization, or storage failure.
    - _Requirements: 8.1–8.15, 10.5, 10.6_

  - [ ] 10.2 Build `RestaurantUsersSettings`
    - Render complete user fields and plan message; add create/edit/deactivate/delete confirmations, optional password edit, upgrade navigation control, stored-state feedback, and `view_only` action absence.
    - _Requirements: 8.1–8.15_

  - [ ] 10.3 Guard and complete Branch lifecycle operations
    - Refactor shared Location operations behind Feature Access, tenant constraints, active/inactive handling, centralized plan limits, and transactional create/update/delete behavior.
    - Require `locations: operate` for writes and preserve rows on refusal/failure.
    - _Requirements: 9.1, 9.2, 9.8, 10.7, 10.8_

  - [ ] 10.4 Build restaurant Branch management and owner scope selection
    - Render Branch terminology, complete fields/state, permission-aware actions, owner selector, forced branch-session scope, and query/dialog reset when scope changes.
    - _Requirements: 9.1–9.8_

  - [ ] 10.5 Write property test for consistent user plan rules and validation
    - **Property 16: User plan rules and validation are consistent**
    - Generate plan aliases, role counts/changes, roles, passwords, and confirmations; assert messages and mutation guards derive from identical limits and failures preserve users.
    - **Validates: Requirements 8.3, 8.4, 8.10, 8.11, 8.13**

  - [ ] 10.6 Write property test for password omission preservation
    - **Property 17: Password omission preserves a SubUser hash**
    - Generate stored users and edits with/without passwords; assert byte-identical omission behavior and valid replacement without overwriting non-submitted fields.
    - **Validates: Requirements 8.5, 8.6, 8.7**

  - [ ] 10.7 Write user and Branch component/integration tests
    - Test plan limits/messages, all validation errors, optional password, deactivate/session denial, exact deletion, storage failure, upgrade navigation, Branch terminology/limits, scope selection, and both features' `view_only` modes.
    - _Requirements: 8.1–8.15, 9.1–9.8, 10.5–10.8_

- [ ] 11. Complete persistence, integration, and regression validation
  - Validate assembled behavior and compatibility without requiring manual application runs or deployment.
  - _Requirements: 1.1–11.6_

  - [ ] 11.1 Write property test for booking noninterference across settings changes
    - **Property 18: Availability-affecting settings do not rewrite bookings**
    - Generate bookings and valid hours/rules/closure/area/menu changes; assert ids, tables, snapshots, and statuses remain identical while only subsequent availability may differ.
    - **Validates: Requirements 3.9, 4.11, 11.5, 11.6**

  - [ ] 11.2 Write end-to-end persistence consistency integration tests
    - Cover normalized save/read round trips, repeated idempotent saves, duplicate closure concurrency, atomic seven-hour rollback, area delete counts, menu cap/cascade transactions, and profile/user lifecycle rollback.
    - _Requirements: 2.7, 3.6, 3.7, 4.3–4.6, 5.1–5.9, 6.1–6.13, 8.4–8.14, 11.1–11.6_

  - [ ] 11.3 Write assembled permission and location regression tests
    - Exercise each Settings mutation under `operate`, `view_only`, `none`, unresolved access, foreign tenant, owner primary/branch, branch session, reception, and inactive child contexts.
    - Assert no repository/external mutation on refusal and no cross-scope rows in reads.
    - _Requirements: 7.10, 8.15, 9.3–9.8, 10.1–10.12_

  - [ ] 11.4 Extend public booking and legacy dashboard regression tests
    - Extend `src/routes/book.$tenantId.restaurant.test.tsx`, restaurant availability/integration suites, and feature-access tests for closures/menu/Profile supersession while preserving all five non-restaurant flows and inherited-plan behavior.
    - _Requirements: 2.1, 3.9, 4.7, 4.8, 6.9–6.11, 10.1, 11.5, 11.6_

  - [ ] 11.5 Run automated repository validation and fix failures
    - Run `npm test -- --run`, `npx tsc --noEmit`, `npm run lint`, and `npm run build`; fix implementation/test failures without weakening assertions.
    - Confirm each property test carries `Feature: restaurant-dashboard-settings, Property N: ...` and uses at least 100 runs (400 for inexpensive pure properties).
    - _Requirements: 1.1–11.6_

  - [ ] 11.6 Expand nonessential accessibility test polish
    - Add extra screen-reader announcement, focus-restoration, and touch-target assertions beyond the required selector/dialog behavior after all core validation passes.
    - _Requirements: 1.4–1.6_

- [ ] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Task 11.6 is the only optional task; it is deferrable test polish. All production behavior, property tests, core unit/component tests, integration tests, and regression validation are required.
- Every property-based test is a separate task, maps to exactly one of the 18 design properties, and should create a dedicated `src/lib/restaurant-dashboard-settings.property-N.test.ts` file so property tasks can execute independently.
- Server functions must authorize and derive scope before row access; UI gating is never the security boundary.
- No task deploys, runs a development server, requires manual QA, or changes production data outside automated tests/migrations.
- Each task assumes `requirements.md` and `design.md` remain the source of truth for detailed contracts and stable messages.

## Task Dependency Graph

```json
{
  "tasks": {
    "1.1": { "dependsOn": [] },
    "1.2": { "dependsOn": ["1.1"] },
    "1.3": { "dependsOn": ["1.2"] },
    "1.4": { "dependsOn": ["1.3"] },
    "2.1": { "dependsOn": [] },
    "2.2": { "dependsOn": ["2.1"] },
    "2.3": { "dependsOn": ["2.1"] },
    "2.4": { "dependsOn": ["1.1", "2.1"] },
    "2.5": { "dependsOn": ["1.2", "1.3", "2.3", "2.4"] },
    "2.6": { "dependsOn": ["1.3", "2.4"] },
    "2.7": { "dependsOn": ["1.2", "1.4", "2.4"] },
    "2.8": { "dependsOn": ["2.2", "2.3", "2.5", "2.6", "2.7"] },
    "3.1": { "dependsOn": ["1.4", "2.4"] },
    "3.2": { "dependsOn": ["3.1"] },
    "3.3": { "dependsOn": ["3.2"] },
    "3.4": { "dependsOn": ["3.1"] },
    "3.5": { "dependsOn": ["2.5", "2.6", "2.7", "3.2"] },
    "4.1": { "dependsOn": ["1.2"] },
    "4.2": { "dependsOn": ["2.5", "4.1"] },
    "4.3": { "dependsOn": ["3.2", "4.2"] },
    "4.4": { "dependsOn": ["4.1"] },
    "4.5": { "dependsOn": ["4.2", "4.3"] },
    "4.6": { "dependsOn": ["4.3", "4.5"] },
    "5.1": { "dependsOn": ["2.4", "3.2"] },
    "5.2": { "dependsOn": ["2.7", "5.1"] },
    "5.3": { "dependsOn": ["2.7", "5.2"] },
    "5.4": { "dependsOn": ["2.7", "5.3"] },
    "5.5": { "dependsOn": ["5.1", "5.2", "5.3", "5.4"] },
    "5.6": { "dependsOn": ["1.4"] },
    "5.7": { "dependsOn": ["1.2", "5.1"] },
    "5.8": { "dependsOn": ["1.2", "5.2"] },
    "5.9": { "dependsOn": ["1.2", "5.3"] },
    "5.10": { "dependsOn": ["5.5", "5.6", "5.7", "5.8", "5.9"] },
    "6.1": { "dependsOn": ["3.2", "5.5"] },
    "6.2": { "dependsOn": ["1.4", "6.1"] },
    "6.3": { "dependsOn": ["6.1", "6.2"] },
    "7.1": { "dependsOn": ["2.5", "3.2", "4.3", "5.4"] },
    "7.2": { "dependsOn": ["2.5", "3.2", "7.1"] },
    "7.3": { "dependsOn": ["6.1", "7.1"] },
    "7.4": { "dependsOn": ["6.1", "7.2"] },
    "7.5": { "dependsOn": ["1.2"] },
    "7.6": { "dependsOn": ["1.2", "7.1"] },
    "7.7": { "dependsOn": ["2.5", "7.1"] },
    "7.8": { "dependsOn": ["1.2"] },
    "7.9": { "dependsOn": ["1.3", "2.5"] },
    "7.10": { "dependsOn": ["4.5", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8", "7.9"] },
    "8.1": { "dependsOn": ["2.6", "3.2", "7.2"] },
    "8.2": { "dependsOn": ["6.1", "8.1"] },
    "8.3": { "dependsOn": ["2.6"] },
    "8.4": { "dependsOn": ["8.3"] },
    "8.5": { "dependsOn": ["1.3", "8.1"] },
    "8.6": { "dependsOn": ["1.3", "8.3"] },
    "8.7": { "dependsOn": ["8.2", "8.4", "8.5", "8.6"] },
    "9.1": { "dependsOn": ["2.7", "3.2", "8.1"] },
    "9.2": { "dependsOn": ["6.1", "9.1"] },
    "9.3": { "dependsOn": ["9.2"] },
    "10.1": { "dependsOn": ["2.7", "3.2", "9.1"] },
    "10.2": { "dependsOn": ["6.1", "10.1"] },
    "10.3": { "dependsOn": ["2.7", "3.2", "10.1"] },
    "10.4": { "dependsOn": ["6.1", "10.3"] },
    "10.5": { "dependsOn": ["1.4", "10.1"] },
    "10.6": { "dependsOn": ["1.4", "10.1"] },
    "10.7": { "dependsOn": ["10.2", "10.4", "10.5", "10.6"] },
    "11.1": { "dependsOn": ["4.5", "7.10", "8.7"] },
    "11.2": { "dependsOn": ["2.8", "5.10", "7.10", "8.7", "10.7"] },
    "11.3": { "dependsOn": ["3.5", "7.10", "8.7", "9.3", "10.7"] },
    "11.4": { "dependsOn": ["4.6", "6.3", "8.7", "9.3", "10.7"] },
    "11.5": { "dependsOn": ["11.1", "11.2", "11.3", "11.4"] },
    "11.6": { "dependsOn": ["11.5"] }
  },
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3"] },
    { "id": 2, "tasks": ["1.3", "2.4", "4.1", "7.5", "7.8"] },
    { "id": 3, "tasks": ["1.4", "2.5"] },
    { "id": 4, "tasks": ["2.6", "3.1", "4.2", "5.6", "7.9"] },
    { "id": 5, "tasks": ["2.7", "3.4", "4.4"] },
    { "id": 6, "tasks": ["2.8", "3.2"] },
    { "id": 7, "tasks": ["3.3", "3.5", "4.3", "5.1", "8.3"] },
    { "id": 8, "tasks": ["4.5", "5.2", "5.7", "8.4"] },
    { "id": 9, "tasks": ["4.6", "5.3"] },
    { "id": 10, "tasks": ["5.4"] },
    { "id": 11, "tasks": ["5.5", "5.8", "7.1"] },
    { "id": 12, "tasks": ["5.9", "6.1", "7.2"] },
    { "id": 13, "tasks": ["6.2", "7.3", "7.4", "8.1"] },
    { "id": 14, "tasks": ["5.10", "6.3", "7.6", "7.7", "8.2", "9.1"] },
    { "id": 15, "tasks": ["7.10", "8.5", "8.6", "9.2", "10.1"] },
    { "id": 16, "tasks": ["8.7", "9.3", "10.2", "10.3"] },
    { "id": 17, "tasks": ["10.4", "10.5", "10.6"] },
    { "id": 18, "tasks": ["10.7", "11.1"] },
    { "id": 19, "tasks": ["11.2", "11.3", "11.4"] },
    { "id": 20, "tasks": ["11.5"] },
    { "id": 21, "tasks": ["11.6"] }
  ]
}
```
