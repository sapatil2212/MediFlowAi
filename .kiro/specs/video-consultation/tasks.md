# Implementation Plan

## Overview

This plan builds the first-party video consultation capability from the inside out. The pure decision module `src/lib/video-consultation.ts` lands first and is property-tested before anything depends on it, because the design makes it the single source of truth for state transitions, join windows, signal ordering, outcome classification, and poll cadence. Feature gating (`video` FeatureId plus the profession dimension) lands early too, since every server function and every UI affordance is gated by it. Then schema, then persistence helpers, then server functions, then the browser WebRTC controller, then UI — each layer only built on top of a layer that is already green.

Nothing here provisions or configures coturn: that is operator-side and outside this repo. The only TURN work in scope is reading the environment variables, minting HMAC credentials, and documenting the variables.

## Task Dependency Graph

```json
{
  "tasks": {
    "1": { "dependsOn": [] },
    "1.1": { "dependsOn": [] },
    "1.2": { "dependsOn": ["1.1"] },
    "1.3": { "dependsOn": ["1.2"] },
    "1.4": { "dependsOn": ["1.3"] },
    "1.5": { "dependsOn": ["1.4"] },
    "2": { "dependsOn": [] },
    "2.1": { "dependsOn": [] },
    "2.2": { "dependsOn": ["2.1"] },
    "3": { "dependsOn": [] },
    "3.1": { "dependsOn": [] },
    "3.2": { "dependsOn": ["3.1"] },
    "3.3": { "dependsOn": ["3.1"] },
    "4": { "dependsOn": [] },
    "4.1": { "dependsOn": [] },
    "4.2": { "dependsOn": ["4.1"] },
    "4.3": { "dependsOn": ["4.2"] },
    "5": { "dependsOn": ["1.1", "2.1", "3.1", "4.3"] },
    "5.1": { "dependsOn": ["1.1", "4.2"] },
    "5.2": { "dependsOn": ["5.1"] },
    "5.3": { "dependsOn": ["5.2"] },
    "5.4": { "dependsOn": ["5.3"] },
    "5.5": { "dependsOn": ["5.4", "2.1"] },
    "5.6": { "dependsOn": ["5.5"] },
    "6": { "dependsOn": ["5.5", "3.1"] },
    "6.1": { "dependsOn": ["5.5"] },
    "6.2": { "dependsOn": ["6.1"] },
    "6.3": { "dependsOn": ["6.2", "3.1"] },
    "6.4": { "dependsOn": ["6.3"] },
    "7": { "dependsOn": ["6.4"] },
    "7.1": { "dependsOn": ["6.4"] },
    "7.2": { "dependsOn": ["6.4"] },
    "7.3": { "dependsOn": ["7.1", "7.2"] },
    "7.4": { "dependsOn": ["7.1"] },
    "9": { "dependsOn": ["1.1", "6.4"] },
    "9.1": { "dependsOn": ["1.1", "6.4"] },
    "10": { "dependsOn": ["9.1", "7.1"] },
    "10.1": { "dependsOn": ["9.1"] },
    "10.2": { "dependsOn": ["9.1"] },
    "10.3": { "dependsOn": ["9.1"] },
    "10.4": { "dependsOn": ["9.1"] },
    "10.5": { "dependsOn": ["10.1", "10.2", "10.3"] },
    "10.6": { "dependsOn": ["10.5"] },
    "10.7": { "dependsOn": ["10.3", "10.4", "2.1"] },
    "10.8": { "dependsOn": ["10.7"] },
    "10.9": { "dependsOn": ["7.4"] },
    "11": { "dependsOn": ["10.6", "10.8", "10.9", "5.6", "1.5", "2.2", "3.2", "3.3", "7.3"] }
  },
  "waves": [
    ["1.1", "2.1", "3.1", "4.1"],
    ["1.2", "2.2", "3.2", "3.3", "4.2"],
    ["1.3", "4.3"],
    ["1.4", "5.1"],
    ["1.5", "5.2"],
    ["5.3"],
    ["5.4"],
    ["5.5"],
    ["5.6", "6.1"],
    ["6.2"],
    ["6.3"],
    ["6.4"],
    ["7.1", "7.2"],
    ["7.3", "7.4", "9.1"],
    ["10.1", "10.2", "10.3", "10.4"],
    ["10.5", "10.7"],
    ["10.6", "10.8", "10.9"],
    ["11"]
  ]
}
```

- Wave 1 is four independent files: the pure module, `feature-access.ts`, the TURN module, and the first `db.ts` edit.
- The four `video-consultation.test.ts` tasks (1.2–1.5) are serialised because they write one file; likewise 4.1–4.3 on `db.ts`, 5.1–5.5 on `video.server.ts`, and 6.1–6.4 on `video.ts`.
- Everything in section 10 waits on the browser controller (9.1) and on the server surface it calls.

## Tasks

- [x] 1. Build the pure decision module and its property tests
- [x] 1.1 Create `src/lib/video-consultation.ts` with all types, constants, and pure functions
  - Define the exported types and constants exactly as the design's interface listing: `RoomState`, `TransitionKind`, `ConsultationMode`, `SignalKind`, `ParticipantRole`, `ParticipantStatus`, `CallOutcome`, `EndReason`, `QualityLevel`, `JoinWindowVerdict`, `PeerState`, plus `ROOM_STATES`, `TERMINAL_ROOM_STATES`, `CONSULTATION_MODES`, `SIGNAL_KINDS`, `MAX_SIGNAL_PAYLOAD_BYTES`.
  - Implement `ROOM_TRANSITIONS` as the single encoding of the state diagram: `scheduled → waiting|expired|cancelled`, `waiting → active|waiting (decline)|expired|cancelled`, `active → ended`; no `active → expired`, no `active → waiting`, terminal states have no outgoing edges.
  - Implement `isTerminalRoomState`, `canTransition`, and `applyTransition` returning `{ ok: true, next }` or `{ ok: false, next: from, reason: "terminal" | "not_permitted" }`.
  - Implement `computeJoinWindow` and `evaluateJoinWindow` (`early` / `open` / `closed`, both bounds inclusive of `open`).
  - Implement `selectSignalsAfter`, `nextCursor`, and `validateSignalPayload` (byte-length gate at 64 KiB, unknown kind, empty).
  - Implement `classifyOutcome` with the design's precedence: `existingOutcome` wins; `expired` + waited + no decision ⇒ `doctor_no_show`; other `expired` ⇒ `patient_no_show`; `ended` + 0s ⇒ `abandoned`; `ended` + >0s ⇒ `completed`; `cancelled` ⇒ `cancelled`.
  - Implement `classifyQuality`, `shouldStopPolling`, and `nextPollDelayMs` (2000 ms setup cadence, `null` to stop, 2000→4000→8000→15000 error backoff).
  - Implement `normalizeConsultationMode`, `planRoomSyncForModeChange`, `shouldEndForDisconnect` (≥60000 ms), `isTokenScopedTo`, `evaluateRateLimit` (10 failures per 60 s sliding window), and `projectForPatient` returning exactly the `PatientRoomProjection` keys.
  - No I/O, no `crypto`, no DB imports — the module must be importable from both client and server.
  - _Requirements: 3.5, 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 6.4, 6.10, 6.11, 6.12, 7.3, 7.4, 7.7, 7.8, 7.9, 7.11, 10.1, 10.5, 15.2, 15.3, 15.4, 15.5, 15.6, 15.9_

- [x] 1.2 Write property tests for the room state machine
  - Create `src/lib/video-consultation.test.ts` with `fast-check` generators built from `ROOM_STATES` and the transition-kind union via `fc.constantFrom`, so adding a state or kind without extending the maps fails the suite.
  - Property 1: every transition from a terminal state returns `{ ok: false, next: s, reason: "terminal" }`; no generated sequence escapes a terminal state.
  - Property 2: a rejected transition leaves `next === from`, and `canTransition` agrees with `applyTransition(...).ok` for every pair.
  - Property 3: folding any generated sequence from `scheduled` stays inside `ROOM_STATES`, and `active` is reachable only via `admit` from `waiting`.
  - Example tests: the three canonical paths `scheduled → waiting → active → ended`, `scheduled → expired`, and `scheduled → cancelled`.
  - _Properties: 1, 2, 3_
  - _Requirements: 4.3, 4.4, 4.7, 4.8, 5.2, 16.6_

- [x] 1.3 Write property tests for join windows and signal delivery
  - Property 4: `computeJoinWindow` yields `opensAt ≤ appointmentAt ≤ closesAt` for any non-negative before/after minutes, and `evaluateJoinWindow` returns exactly one of `early` / `open` / `closed` for every instant.
  - Property 5: `selectSignalsAfter` returns a strictly ascending subsequence with every `seq > cursor` and relative order preserved; iterating `cursor := nextCursor(...)` delivers each record exactly once and skips none.
  - Property 6: `validateSignalPayload` accepts only kinds in `SIGNAL_KINDS`, rejects empty payloads, and classifies size by byte length so multi-byte SDP cannot pass the 64 KiB ceiling.
  - Example tests: instants exactly at `opensAt` and `closesAt`; payloads one byte under and one byte over `MAX_SIGNAL_PAYLOAD_BYTES`, including a multi-byte string.
  - Inject `nowMs` explicitly; no test may sleep.
  - _Properties: 4, 5, 6_
  - _Requirements: 4.6, 6.4, 6.5, 7.3, 7.4, 7.11_

- [x] 1.4 Write property tests for outcome, quality, and poll cadence
  - Property 7: `classifyOutcome` is total over `OutcomeInput`, and feeding its result back as `existingOutcome` returns the same value — finalisation is idempotent and can never overwrite a no-show verdict.
  - Property 8: `classifyQuality` returns a level for every sample including all-`null`, and worsening one metric while holding the others fixed never improves the level.
  - Property 9: `shouldStopPolling` is true only when the room is `active` and both peers are `connected`; when true `nextPollDelayMs` is `null`, and when false with a non-terminal room the delay is positive and ≤2000 ms on the setup path.
  - Example tests: the Requirement 15.3 versus 15.4 overlap (a patient waited, no admission decision, room expired ⇒ `doctor_no_show`); `ended` with 0 connected seconds ⇒ `abandoned`; `ended` with >0 ⇒ `completed`.
  - _Properties: 7, 8, 9_
  - _Requirements: 7.7, 7.8, 7.9, 10.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.9_

- [x] 1.5 Write property tests for mode handling, token scope, rate limiting, and the patient projection
  - Property 10: `normalizeConsultationMode` accepts exactly `in_person` and `video` and rejects case and whitespace variants; `planRoomSyncForModeChange` yields `create` only for `video` with no room, `cancel` only for `in_person` with a non-terminal room, `none` otherwise, and is idempotent on re-save.
  - Property 12: `isTokenScopedTo` is true only for an unrevoked token whose bound room equals the requested room, over generated identifier pairs.
  - Property 13: `evaluateRateLimit` never permits an 11th failed attempt inside any 60-second sliding window and permits again once the window passes.
  - Property 14: the object from `projectForPatient` has exactly the `PatientRoomProjection` keys and no value equals the patient phone, patient email, `reason`, `patientId`, `tenantId`, `appointmentId`, or `roomId`.
  - _Properties: 10, 12, 13, 14_
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 4.2, 6.2, 6.6, 6.9, 6.10, 6.11, 6.12_

- [x] 2. Add the `video` feature and the profession gating dimension
- [x] 2.1 Extend `src/lib/feature-access.ts` with `video`, `PROFESSION_FEATURES`, and a `profession` context field
  - Add `"video"` to `FeatureId` and to `FEATURE_IDS`; add the `video` row to `PLAN_FEATURES` (Basic ✗, Premium ✓, Enterprise ✓) and to `ROLE_PERMISSIONS` (admin `operate`, doctor `operate`, reception `none`, location `none`).
  - Export `HEALTHCARE_PROFESSION = "Healthcare and medical"`, the `PROFESSION_FEATURES` partial map (`{ video: [HEALTHCARE_PROFESSION] }`), and `professionAllowsFeature` returning `true` for any feature absent from the map and an exact trimmed match otherwise (fail closed on unknown/undefined).
  - Add optional `profession?: string | null` to `AccountContext` and add `professionAllowsFeature(ctx.profession, feature)` as one extra conjunct in `resolveFeatureAccess` — a no-op for every pre-existing feature, keeping their resolution unchanged.
  - In `src/lib/auth.ts`, add `profession: user.profession` to `buildAccountContext` (line ~16). No query change is needed; `verifySession` already selects the parent tenant's `profession` for admin, sub-user, and sub-location sessions, which is what makes sub-account eligibility derive from the parent.
  - Keep the module pure and isomorphic (no I/O added).
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.8_

- [x] 2.2 Extend `src/lib/feature-access.test.ts` with the profession property and keep the existing suite green
  - Add a profession generator covering `"Healthcare and medical"`, the other profession strings, `undefined`, and unknown values.
  - Property 15: for every plan tier, role, subscription status, and profession, `video` resolves unavailable whenever the profession is not `Healthcare and medical`; for every feature other than `video` the resolved result is identical to the result computed with the `profession` field absent; and `permission !== "none"` still implies `available` for every feature including `video`.
  - Add example tests for the `video` role matrix at Premium (admin and doctor `operate`; reception and location `none` so even read requests are refused) and for `video` hidden at Basic for all roles.
  - Regression guard: the existing 453 lines of this file must keep passing unmodified. Its generic loops over `FEATURE_IDS` now include `video`, whose availability is `false` in every generated context (no `profession` field), which is role-independent, equal parent-to-child, alias-stable, already-false when inactive, and trivially monotonic. Add tests only; do not edit or relax the existing assertions. If any existing assertion fails, treat it as a defect in 2.1, not in the test.
  - _Properties: 15_
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8_

- [x] 3. Build TURN configuration and ephemeral credential minting
- [x] 3.1 Create `src/lib/video-turn.server.ts`
  - Implement `readTurnConfig(env = process.env)` reading `TURN_URLS`, `TURN_STUN_URLS`, `TURN_REALM`, `TURN_SHARED_SECRET`, and `TURN_CREDENTIAL_TTL_SECONDS` (comma-split URL lists, trimmed, empties dropped), and `isTurnConfigured` (non-empty `turnUrls` AND non-empty `sharedSecret`).
  - Implement `buildTurnUsername(expiryUnix, id)` as `"<expiryUnix>:<id>"`, `parseTurnUsername` as its inverse, and `deriveTurnPassword` as `createHmac("sha1", sharedSecret).update(username).digest("base64")` — coturn's `use-auth-secret` scheme.
  - Implement `mintTurnCredential(cfg, participantId, nowMs)` with `ttl = clamp(configured ?? 3600, 1, 3600)` as a hard ceiling and `expiryUnix = floor(nowMs / 1000) + ttl`.
  - Implement `buildIceConfiguration(cfg, participantId, nowMs)` returning `iceServers` populated only from these variables plus `iceTransportPolicy: "all"`, `expiresAtUnix`, and `turnConfigured`; when TURN is not configured return `{ iceServers: [], turnConfigured: false, expiresAtUnix: null }` and never substitute any other server.
  - The shared secret must appear in no return value, no log line, and no error message. All functions take `nowMs` explicitly so they are deterministic under test.
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 11.3_

- [x] 3.2 Write property and example tests for the TURN module
  - Create `src/lib/video-turn.test.ts` (node environment) with `fast-check`.
  - Property 11: for any config and clock, `expiresAtUnix` is strictly in the future with `ttlSeconds ≤ 3600` regardless of the configured value; `parseTurnUsername(buildTurnUsername(e, id))` round-trips for any `id` containing no `:`; `deriveTurnPassword` is deterministic for equal inputs and differs when the secret differs; neither username nor credential contains the shared secret as a substring; and with `isTurnConfigured` false, `buildIceConfiguration` returns an empty `iceServers` array with `turnConfigured: false`.
  - Example tests: a known-answer HMAC-SHA1 vector pinning the base64 credential to what coturn accepts for a fixed username and secret; a `TURN_CREDENTIAL_TTL_SECONDS` above 3600 clamped to 3600; and the exact unconfigured-TURN configuration shape.
  - _Properties: 11_
  - _Requirements: 8.2, 8.3, 8.4, 8.6, 11.3_

- [x] 3.3 Document the nine new environment variables
  - Add commented entries for `TURN_URLS`, `TURN_STUN_URLS`, `TURN_REALM`, `TURN_SHARED_SECRET`, `TURN_CREDENTIAL_TTL_SECONDS`, `VIDEO_JOIN_WINDOW_BEFORE_MINUTES`, `VIDEO_JOIN_WINDOW_AFTER_MINUTES`, `VIDEO_NOTICE_VERSION`, and the existing `APP_ORIGIN` to `.env`, each with its default and one line on purpose.
  - State in the comments that leaving `TURN_URLS` empty is a supported configuration (local development, host candidates only) and is never a fallback to a public STUN or TURN service, and that provisioning coturn itself is operator-side and outside this repo.
  - _Requirements: 8.5, 8.6, 8.7, 11.3, 16.8_

- [x] 4. Add the schema changes in `src/lib/db.ts`
- [x] 4.1 Add the additive `Appointment.consultationMode` column and index
  - Inside the existing bootstrap block, add `ALTER TABLE Appointment ADD COLUMN consultationMode VARCHAR(32) NOT NULL DEFAULT 'in_person'` and `ADD INDEX idx_apt_tenant_mode (tenantId, consultationMode)`, each in its own try/catch or guarded by the existing `SHOW COLUMNS` + `colNames.includes(...)` pattern.
  - Leave `appointmentType` untouched — clinical type and delivery mode are separate axes, and the `NOT NULL DEFAULT 'in_person'` is what backfills existing rows.
  - _Requirements: 3.1, 3.2, 3.9_

- [x] 4.2 Create the six new video tables
  - Add `CREATE TABLE IF NOT EXISTS` statements, each in its own try/catch, for `VideoRoom`, `VideoJoinToken`, `VideoParticipant`, `VideoSignal`, `VideoConsent`, and `VideoAuditEvent`, column-for-column and index-for-index as specified in the design's Data Models section.
  - Preserve the constraints that carry requirements: `UNIQUE (appointmentId)` on `VideoRoom` (one room per appointment), `idx_room_sweep (state, joinClosesAt)` for the expiry sweeper, `UNIQUE (tokenHash)` on `VideoJoinToken`, `UNIQUE (roomId, participantKey)` on `VideoParticipant`, `UNIQUE (roomId, seq)` plus `idx_signal_room_seq` on `VideoSignal`, `UNIQUE (roomId, noticeVersion, tokenVersion)` on `VideoConsent`, and the two audit indexes.
  - Keep `VideoSignal.payload` as `TEXT` and `VideoAuditEvent.detail` as `VARCHAR(255)` so the payload ceiling and the "no SDP in audit" rule are structural.
  - Use `VARCHAR(255) PRIMARY KEY`, `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` for row metadata, and `DATETIME(3)`/`TIMESTAMP(3)` for domain instants, matching house convention. No Prisma migration.
  - _Requirements: 4.1, 4.2, 4.9, 4.10, 5.8, 6.1, 6.2, 6.7, 7.1, 7.11, 10.6, 12.2, 15.1, 15.8_

- [x] 4.3 Register the new tables for collation normalisation
  - Append `VideoRoom`, `VideoJoinToken`, `VideoParticipant`, `VideoSignal`, `VideoConsent`, and `VideoAuditEvent` to the `tablesToNormalize` array (~line 1043) so they are converted to `utf8mb4 / utf8mb4_unicode_ci`.
  - This is required, not cosmetic: these tables join to `Appointment`, `Doctor`, and `Patient`, and mismatched collations raise errors at query time in this codebase.
  - _Requirements: 12.9_

- [ ] 5. Build the persistence and enforcement layer in `src/lib/video.server.ts`
- [x] 5.1 Implement join token issuance, revocation, and resolution
  - Create `src/lib/video.server.ts` using `query` / `queryOne` / `execute` from `src/lib/db.ts`, with every statement tenant-scoped.
  - Implement `generateJoinToken` (32 bytes from `crypto.randomBytes` rendered base64url) and `hashJoinToken` (SHA-256 hex); persist only the hash.
  - Implement `issueJoinToken(roomId, tenantId, purpose)` returning the plaintext token and an absolute link built from `APP_ORIGIN` — the only moment plaintext exists — and `revokeJoinTokens(roomId)` setting `revokedAt` on all live rows.
  - Implement `resolveJoinToken(token, clientKey)` returning `{ ok: true, value: { room, tokenId, tokenVersion } }` or `{ ok: false, status: "invalid" | "expired" | "rate_limited" }`: single point read on `tokenHash`, identical redacted response for unknown, malformed, and revoked tokens, `evaluateRateLimit` for failed attempts per client key, `evaluateJoinWindow` for expiry, and `isTokenScopedTo` for room binding. Update `lastUsedAt` / `useCount` on success.
  - _Requirements: 6.1, 6.2, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.12, 12.9_

- [ ] 5.2 Implement room creation, the single transition choke point, and expiry
  - `ensureVideoRoom(appointmentId, tenantId)`: idempotent insert relying on `UNIQUE (appointmentId)`, materialising `joinOpensAt` / `joinClosesAt` from `Appointment.dateTime` and the configured window, and denormalising `tenantId`, `appointmentId`, `doctorId` onto the row.
  - `loadRoomForRead(roomId, tenantId)`: applies lazy expiry before answering, so no caller ever observes a stale `scheduled` or `waiting` room past its window.
  - `transitionRoom(roomId, kind, ctx)`: the only writer of `state`. Loads the room `FOR UPDATE` inside a transaction on a dedicated connection, calls the pure `applyTransition`, writes only when `ok`, appends the audit row, and on a terminal result revokes tokens, deletes signal rows, and finalises the outcome. An illegal transition throws and writes nothing.
  - `expireVideoRoom(roomId, nowMs)`: idempotent, guarded by `WHERE state IN ('scheduled','waiting')` so a concurrent lazy expiry and sweep cannot disagree.
  - `sweepExpiredVideoRooms()`: selects rooms `WHERE state IN ('scheduled','waiting') AND joinClosesAt < NOW(3)` via `idx_room_sweep`, expires them through the same helper, and also deletes signal rows for rooms terminal for more than 10 minutes.
  - Also recompute `joinOpensAt` / `joinClosesAt` when the linked appointment's `dateTime` changes.
  - _Requirements: 3.3, 3.6, 4.1, 4.2, 4.5, 4.6, 4.7, 4.8, 4.9, 6.4, 6.9, 7.10, 12.9, 16.6_

- [ ] 5.3 Implement the signal mailbox
  - `allocateSignalSeq(roomId)` using `UPDATE VideoRoom SET signalSeq = LAST_INSERT_ID(signalSeq + 1) WHERE id = ? AND tenantId = ?` and reading the returned `insertId`, so the counter is atomic under concurrent publishes from both sides.
  - `insertSignal(...)` writing `tenantId`, `roomId`, `seq`, `senderRole`, `kind`, `payload` only after `validateSignalPayload` has passed, so an oversized or unknown submission persists nothing.
  - `readSignalsAfter(roomId, tenantId, cursor, forRole)` as an index range scan `WHERE roomId = ? AND seq > ? ORDER BY seq ASC`, ordered by `seq` rather than timestamp, then filtered through the pure `selectSignalsAfter`.
  - `deleteSignals(roomId)` for the terminal transition.
  - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.10, 7.11, 12.9_

- [ ] 5.4 Implement participant presence, audit append, and outcome finalisation
  - `upsertParticipant(...)` keyed on `UNIQUE (roomId, participantKey)` with `participantKey` derived as `sha256(roomId + ':patient')` for the patient and `sha256(accountId)` for the doctor, so a reload rejoins the same row; it also maintains `status`, `peerState`, `micEnabled`, `cameraEnabled`, `quality`, `joinedAt`, `admittedAt`, `leftAt`, `connectedMs`, `lastSeenAt`, and `lastPolledAt`.
  - Admission sets `VideoRoom.admittedParticipantId` only when it is `NULL`, which is the enforcement of at most one admitted patient; decline records a participant-level decision and `admissionDecisionAt` without changing the room state.
  - `recordAudit(roomId, kind, detail?, role?)` — append-only, never throws, `kind` from the fixed vocabulary, `detail` a short label that must never carry SDP, ICE candidates, or any signal payload.
  - `finalizeRoomOutcome(roomId)` accumulating `connectedSeconds` from participant-reported intervals and writing `outcome` via the pure `classifyOutcome`, so re-running it cannot overwrite a no-show verdict.
  - Implement the server-side poll throttle: stamp `lastPolledAt` and return `{ throttled: true, nextPollMs }` without running the signal query when a poll arrives under 1500 ms after the previous one for the same participant.
  - _Requirements: 4.10, 5.4, 5.8, 7.7, 9.3, 9.4, 10.1, 10.6, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.8, 15.9_

- [ ] 5.5 Implement the authorisation guards
  - `requireVideoOperator()`: `verifySession` then `canOperateFeature(buildAccountContext(user), "video")`, throwing an authorization error otherwise — so profession, plan, and role are all enforced server-side regardless of what the UI rendered.
  - `requireRoomForDoctor(roomId, user)`: loads the room tenant-scoped and rejects any caller other than the doctor assigned to the appointment or the parent account.
  - Add a read-only variant based on `canUseFeature` for the read-shaped functions, remembering that `none` blocks reads too.
  - _Requirements: 1.6, 1.7, 2.6, 2.7, 5.6, 12.9_

- [ ] 5.6 Write integration tests for the persistence layer
  - Create `src/lib/video.server.test.ts` exercising the paths the pure tests cannot reach, skipped cleanly when no test database is configured.
  - Room creation idempotency: repeated `ensureVideoRoom` calls for one appointment yield exactly one row.
  - Atomic sequence allocation: concurrent `allocateSignalSeq` calls from both roles produce a gapless set of distinct sequence numbers with no duplicates.
  - Tenant scoping: a room, token, signal, consent, and audit row created under tenant A are invisible to every read issued as tenant B.
  - Token revocation: regeneration revokes all prior live tokens for the room and the old token resolves as invalid; a terminal transition revokes every token for the room.
  - Signal deletion: reaching a terminal state deletes the room's `VideoSignal` rows, and the sweeper deletes rows for rooms terminal for over 10 minutes.
  - _Requirements: 4.2, 6.8, 6.9, 7.4, 7.5, 7.10, 12.9_

- [ ] 6. Build the server function surface in `src/lib/video.ts`
- [ ] 6.1 Implement the doctor-side room and link functions
  - Create `src/lib/video.ts` following the house pattern (`createServerFn({ method }).validator(...).handler(...)`, exported as `xxxServerFn`, errors as `new Error("message")`), with `requireVideoOperator` on every function.
  - `getVideoRoomServerFn` (GET): room state, join window, participants, waiting list, `turnConfigured`, audit summary, and whether a link is active.
  - `createVideoRoomServerFn` (POST): `ensureVideoRoom` + `issueJoinToken`, returning the plaintext join link exactly once.
  - `regenerateJoinTokenServerFn` (POST): revokes all prior tokens, issues one, returns the new link.
  - _Requirements: 3.3, 3.6, 4.1, 5.1, 6.1, 6.7, 6.8, 8.7, 13.1, 13.2, 14.6, 15.7_

- [ ] 6.2 Implement the doctor-side polling, signalling, and admission functions
  - `pollVideoRoomServerFn` (GET, `{ roomId, afterSeq, peerState }`): one round trip returning `{ roomState, waiting[], signals[], cursor, stopPolling, nextPollMs, throttled? }`, with `stopPolling` computed server-side from both participants' reported peer states so one side cannot keep the other polling forever.
  - `publishSignalServerFn` (POST): validates kind and payload before any statement, allocates the sequence, inserts, returns `{ seq }`; rejects a caller who is not a participant of the room.
  - `admitParticipantServerFn` (POST, `decision: "admit" | "decline"`): admit transitions the room to `active` and permits signal exchange; decline records the decision and leaves the room in `waiting` so a later arrival can still be admitted; only the assigned doctor or the parent account may decide; at most one admitted patient.
  - `removeParticipantServerFn` (POST): marks the participant removed, records it in the audit trail, and ends the room when the last patient is removed.
  - While the room is `waiting`, withhold every signal and any ICE configuration from the patient.
  - _Requirements: 4.4, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 7.1, 7.3, 7.4, 7.6, 7.7, 7.8, 7.9, 7.11_

- [ ] 6.3 Implement ICE issuance, session end, and call record functions
  - `getIceConfigurationServerFn` (POST — it mints a credential and writes an audit row, so it must not be cacheable or replayable): returns the configuration only when the room is `active` and the caller is admitted; on minting failure throws and records a `turn_credential_failure` audit row; a repeat call while `active` is the renewal path.
  - `endVideoRoomServerFn` (POST, `{ roomId, reason }`): applies the `end` transition through `transitionRoom`, returning `{ roomState, connectedSeconds, outcome }`, and on terminal state revokes tokens and deletes signal rows.
  - `reportCallEventServerFn` (POST): records join/leave/reconnecting/reconnected/ice_restart/connection_failed events, peer state, mic and camera state, quality, and connected milliseconds; fires `shouldEndForDisconnect` at a cumulative 60 s disconnected budget with reason `connection_lost`; records the 45 s connect-deadline failure without forcing the room terminal.
  - `getCallAuditServerFn` (GET, `{ appointmentId }`): returns join and leave events, connected duration, end reason, and outcome, and carries no media content and no signal payload.
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6, 8.8, 8.9, 10.5, 10.7, 11.7, 12.5, 15.1, 15.2, 15.7, 15.8_

- [ ] 6.4 Implement the patient-token function surface
  - These functions never call `verifySession`; each resolves the caller through `resolveJoinToken`, deriving `tenantId` from the resolved room rather than from client input, and returns a redacted failure otherwise.
  - `getJoinContextServerFn` (GET): returns `projectForPatient` output only — clinic name, doctor name, appointment datetime, status, notice version — with `invalid`, `expired`, and `rate_limited` statuses disclosing nothing further.
  - `acceptConsentServerFn` (POST): writes the `VideoConsent` row with room id, timestamp, and notice version.
  - `requestEntryServerFn` (POST): refuses without a consent row; otherwise upserts the patient participant and applies `patient_arrived`, taking `scheduled → waiting`; with consent present and a valid token, entry to the waiting room needs no further verification.
  - `getJoinStatusServerFn` (GET): the patient mirror of the doctor poll, returning signals only once admitted and the current waiting or declined status otherwise.
  - `patientPublishSignalServerFn`, `patientIceConfigServerFn`, `patientReportEventServerFn`, `patientLeaveServerFn` (POST): all rejected unless the participant is admitted; the leave path records the event and closes the participant out.
  - _Requirements: 4.3, 5.2, 5.5, 6.3, 6.5, 6.6, 6.10, 6.11, 6.12, 7.1, 7.3, 7.6, 7.7, 7.8, 7.9, 7.11, 8.1, 8.9, 9.6, 10.5, 12.1, 12.2, 12.3, 12.4, 15.1_

- [ ] 7. Wire appointments, notifications, and the scheduler
- [ ] 7.1 Add `consultationMode` to the staff appointment paths
  - Implement `syncVideoRoomForAppointment` in `src/lib/video.server.ts`, applying the pure `planRoomSyncForModeChange`: `create` runs `ensureVideoRoom` + `issueJoinToken` + notify, `cancel` runs `transitionRoom(..., "cancel")`, `none` does nothing.
  - In `src/lib/auth.ts`, add an optional `consultationMode` to the validators of `createAppointmentServerFn` (line ~737) and `updateAppointmentServerFn` (line ~1072): run it through `normalizeConsultationMode`, default it to `in_person`, reject `video` with a message naming the capability when `canOperateFeature(ctx, "video")` is false, then call `syncVideoRoomForAppointment`.
  - Trigger the `cancel` path from the existing cancel branch of `updateAppointmentServerFn` when `status` becomes `Cancelled`.
  - Never read or write `appointmentType` in any of this, and return `consultationMode` on the appointment reads the dashboard uses.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.2_

- [ ] 7.2 Extend `src/lib/appointment-notify.ts` with the join-link kinds
  - Add `videoLinkIssued` and `videoLinkReissued` to `AptNotifyKind`, and `joinLink?: string` to `AptNotifyContext`.
  - Handle both new kinds in `buildAppointmentMessage`, and append a join-link line to the four existing `reminder*` kinds when `ctx.joinLink` is present, so every video message goes through the one builder and keeps clinic branding and formatting identical.
  - Send by email through the existing `src/lib/email.ts` when `Appointment.email` is present, in addition to WhatsApp, inside the same never-throw wrapper.
  - Preserve the inherited delivery semantics: skip when the tenant WhatsApp session is not connected, write a `notification_skipped` or `notification_failed` audit row, and let the calling operation succeed.
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

- [ ] 7.3 Extend `src/lib/reminder-scheduler.ts` with join links and the expiry sweep
  - When an appointment's `consultationMode` is `video`, mint an additional token for the room and pass its link as `joinLink` on the reminder notification — because tokens are stored only as hashes, a reminder cannot re-send an old link, and prior links keep working.
  - Register `sweepExpiredVideoRooms()` in the existing 5-minute reminder cycle using the same singleton guard pattern; add no new timer and no new infrastructure.
  - _Requirements: 4.6, 6.7, 7.10, 13.3, 15.3, 15.4_

- [ ] 7.4 Add video mode support to the public booking server functions
  - In `src/lib/booking.ts`, have `getClinicInfoAndSlotsServerFn` report whether video consultation is available for the tenant (healthcare profession, plan, active subscription) so the public page can decide whether to offer the choice.
  - Add an optional `consultationMode` to `createAppointmentPublicServerFn`: normalise it, default to `in_person`, reject `video` when the tenant is not eligible with an error naming the capability, then call `syncVideoRoomForAppointment` so the room and join link are created and notified on the same path as the staff flow.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 13.1_

- [ ] 8. Checkpoint - server layer complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Build the browser WebRTC controller
- [ ] 9.1 Create `src/lib/video-peer.ts`
  - A framework-free class wrapping one `RTCPeerConnection`, driven entirely by the pure module, using only native APIs: `navigator.mediaDevices.getUserMedia`, `enumerateDevices`, `RTCPeerConnection`, `RTCRtpSender.replaceTrack`, `setSinkId`, and `getStats`.
  - Perfect negotiation with fixed roles: doctor is impolite and the offerer, patient is polite and the answerer; on an incoming offer during `have-local-offer` the patient rolls back and the doctor ignores.
  - Add audio and video transceivers `sendrecv` up front so an audio-only participant still negotiates a video m-line and can enable a camera later without a fresh offer.
  - Device switching via `replaceTrack` (and `setSinkId` for speakers, degrading to a disabled control where unsupported) so changing device never renegotiates or drops the session.
  - Track toggles set `track.enabled` and report the resulting state so each side sees the other's mic and camera state.
  - Quality sampling every 5000 ms from `getStats` (inbound jitter, packets-lost delta over packets-received delta, selected-pair round-trip time) fed to `classifyQuality`.
  - Recovery: on `disconnected`, show reconnecting, resume polling at the cadence from `nextPollDelayMs`, and have the doctor `createOffer({ iceRestart: true })` while the patient publishes `renegotiate` and waits; retry with 2 s / 4 s / 8 s spacing; track the cumulative disconnected budget and fire `endVideoRoom(reason: "connection_lost")` when `shouldEndForDisconnect` is true, however many restarts were attempted; a successful restart clears the banner and leaves the room `active`.
  - A 45 s connect deadline from admission reports `connection_failed` to both sides and audits it without forcing the room terminal.
  - Swallow control-plane polling errors without ever tearing down an established peer connection.
  - Teardown stops every local track, closes the peer connection, and releases camera and microphone; state is reconstructed from the server on mount so a reload while `active` inside the join window rejoins the same room and participant row.
  - _Requirements: 7.7, 7.8, 7.9, 8.9, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 11.1, 11.5, 11.7, 12.5, 16.2, 16.7_

- [ ] 10. Build the UI
- [ ] 10.1 Create `src/components/video/PreflightCheck.tsx`
  - Probe for WebRTC support and enumerate devices before requesting permission; render the unsupported-browser message listing supported browsers, the no-device message that leaves room state untouched, and the permission-denied state naming the denied device with the steps to grant it and a retry control.
  - Report the audio-only capability upward when a microphone exists but no camera does.
  - _Requirements: 9.5, 16.1, 16.2, 16.3, 16.4_

- [ ] 10.2 Create `src/components/video/ConsentNotice.tsx`
  - Render the teleconsultation notice with the configured notice version and gate acknowledgement so no `getUserMedia` call can happen before it is accepted; on acknowledgement call `acceptConsentServerFn`, and re-present the notice on a `consent_required` error.
  - _Requirements: 12.1, 12.2, 12.3_

- [ ] 10.3 Create `src/components/video/VideoCallShell.tsx`
  - Local preview and remote video, mic and camera toggles reflecting both sides' state, device pickers wired to the controller's `replaceTrack` path, the quality badge from `classifyQuality`, a persistent `not recorded` indicator, the reconnecting banner, the connection-failure state with a retry control, and the end-call control that closes the connection and releases devices.
  - Map rejected server calls onto the design's error taxonomy, stating the reason and the next action available.
  - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2, 10.3, 10.4, 10.7, 12.5, 12.7, 16.5_

- [ ] 10.4 Create `src/components/video/CallDocumentationDrawer.tsx`
  - A side drawer mounting the existing SOAP-note and prescription forms with `appointmentId` and `patientId` taken from the room row, so validation and authorization are identical to an in-person visit and saved records carry the right associations.
  - Non-blocking: saving must not touch the peer connection. Refuse to submit when `patientId` is missing, surfacing an error rather than writing an orphan record.
  - Confirm the existing SOAP-note and prescription handlers write atomically; if a handler performs more than one write, wrap it in a single transaction on one connection so a failure persists nothing and returns an error.
  - _Requirements: 14.1, 14.2, 14.3, 14.5_

- [ ] 10.5 Create `src/components/video/PatientConsultPage.tsx`
  - Compose the patient flow: consent → preflight → request entry → waiting → in-call → ended, driven by `getJoinContextServerFn` and `getJoinStatusServerFn` with the cadence from `nextPollDelayMs`.
  - Show only the four disclosed facts, render terminal pages for invalid, expired, and rate-limited links with no appointment, patient, or tenant detail, show the current waiting status and the declined status, and close the peer connection when the room reports `ended`.
  - _Requirements: 5.5, 6.3, 6.5, 6.6, 6.11, 6.12, 7.7, 7.8, 7.9, 9.1, 9.2, 9.6, 10.6, 12.1, 12.5, 12.7, 16.5_

- [ ] 10.6 Create `src/routes/consult.$token.tsx`
  - A public unauthenticated route following the `src/routes/book.$tenantId.tsx` precedent, rendering `PatientConsultPage` with the token from the path and no session lookup anywhere in the chain.
  - _Requirements: 6.3, 12.8_

- [ ] 10.7 Create `src/components/video/DoctorVideoConsultPanel.tsx`
  - Today's video appointments with room-state badges, the waiting-room list with Admit and Decline, copy-link and regenerate-link controls, the notice shown whenever `turnConfigured` is false warning that connections across restrictive networks may fail, the launcher for `VideoCallShell`, the documentation drawer, and the post-call summary that surfaces the documentation entry point immediately on the `ended` transition.
  - Also surface the call record for a past appointment from `getCallAuditServerFn`.
  - Render nothing operable for an account whose resolved `video` permission is not `operate`.
  - _Requirements: 5.1, 5.3, 5.4, 5.7, 8.7, 14.1, 14.4, 15.7_

- [ ] 10.8 Make the three edits to `src/routes/dashboards/medical.tsx`
  - Add a `video` entry to the tab list (desktop and mobile nav) guarded by `access.video.visible`.
  - Render `<DoctorVideoConsultPanel />` for that tab.
  - Add a consultation-mode badge to the appointment row renderer.
  - Keep the change to these three edits; all other UI lives in `src/components/video/*`. When `access.video.visible` is false the tab, the badge affordance, and the mode selector must all be absent.
  - _Requirements: 1.4, 1.5, 14.6_

- [ ] 10.9 Add the video mode selector to `src/routes/book.$tenantId.tsx`
  - Offer the in-person / video choice only when the tenant reports video availability from `getClinicInfoAndSlotsServerFn`, pass `consultationMode` to `createAppointmentPublicServerFn`, and keep it separate from the existing `appointmentType` control.
  - On a `feature_unavailable` error keep the form open with `video` deselected and show the message naming the capability.
  - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.9_

- [ ] 11. Verify the full change
  - Run `npm test` — all property, example, and integration suites pass, including `src/lib/feature-access.test.ts` unchanged apart from the Property 15 additions.
  - Run `npm run build` and fix any type or build errors introduced.
  - Audit the `package.json` diff: no new runtime dependency may appear, and no video, signalling, STUN, or TURN vendor package, script, endpoint, or credential may be referenced anywhere in the change. Confirm `iceServers` is populated only from the documented environment variables.
  - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6_

## Notes

- Tasks are ordered so the tree is never broken mid-way: pure logic and its property tests first, then gating, then schema, then persistence, then server functions, then browser controller, then UI. The dependency graph above records what may run in parallel.
- Test sub-tasks are not marked optional. The design makes `video-consultation.ts` the single source of truth for state transitions, join windows, signal ordering, outcome classification, and poll cadence, so its property tests are part of building it rather than a follow-up.
- The design text says "five new tables" and then specifies six (`VideoRoom`, `VideoJoinToken`, `VideoParticipant`, `VideoSignal`, `VideoConsent`, `VideoAuditEvent`). Task 4.2 creates all six.
- Provisioning coturn, its TLS certificate, and its firewall rules is operator-side and outside this repo. Task 3.3 documents the environment variables only; the coturn config sketch in the design is reference material for the operator.
- **Manual verification, not a task.** No automated check in this repo can assert that media actually flowed. After task 11, the following must be checked by hand per the design's "Integration and manual verification" section: two browser windows on one machine with no TURN configured (Req 16.8), then a genuine cross-network pair against coturn to confirm relay, then permission denial, camera absent, and a mid-call network drop for Requirements 10 and 16.
- Every property test injects `nowMs` or a complete input record. No test sleeps and none depends on wall-clock timing.
