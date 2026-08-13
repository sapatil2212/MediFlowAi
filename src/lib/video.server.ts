// ─────────────────────────────────────────────────────────────────────────────
// video.server.ts — persistence and enforcement for video consultations.
//
// Server-only (`.server.ts` house convention, cf. `auth.server.ts`). Raw SQL
// through `query` / `queryOne` / `execute` from `./db`; no Prisma. Every
// statement is tenant-scoped, and on the patient path the `tenantId` is taken
// from the room the token resolved to — never from caller input (Req 12.9).
//
// All decision logic lives in the pure, isomorphic `./video-consultation`
// module. This file does I/O and nothing else: it never re-derives a join
// window, a rate-limit verdict, or a token scope check locally.
//
// Sections are appended in order: tokens, rooms, signals, participants, guards.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { execute, queryOne } from "./db";
import {
  evaluateJoinWindow,
  evaluateRateLimit,
  isTerminalRoomState,
  isTokenScopedTo,
  type JoinWindow,
  type JoinWindowConfig,
  type RateLimitState,
  type RoomState,
} from "./video-consultation";

// ─────────────────────────────────────────────────────────────────────────────
// Shared types and configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One `VideoRoom` row, column-for-column. Domain instants are `DATETIME(3)` and
 * arrive from the driver as `Date` (or a string on some driver configurations),
 * so both are admitted here and normalised at the point of use.
 */
export interface VideoRoomRow {
  id: string;
  tenantId: string;
  /** NULL for ad-hoc ("instant" / share-link) rooms, which have no Appointment. */
  appointmentId: string | null;
  doctorId: string | null;
  state: RoomState;
  joinOpensAt: Date | string | null;
  joinClosesAt: Date | string | null;
  tokenVersion: number;
  signalSeq: number;
  admittedParticipantId: string | null;
  admissionDecisionAt: Date | string | null;
  activatedAt: Date | string | null;
  endedAt: Date | string | null;
  endReason: string | null;
  outcome: string | null;
  connectedSeconds: number;
  disconnectedSinceAt: Date | string | null;
  disconnectedTotalMs: number;
  noticeVersion: string;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

/** Defaults mandated by Req 6.4; both bounds are environment-configurable. */
export const DEFAULT_JOIN_WINDOW_BEFORE_MINUTES = 30;
export const DEFAULT_JOIN_WINDOW_AFTER_MINUTES = 120;
/** Stamped onto consent rows so the accepted notice text stays reconstructible. */
export const DEFAULT_NOTICE_VERSION = "v1";

/**
 * Environment-derived configuration. Extends `JoinWindowConfig` so it can be
 * handed straight to the pure `computeJoinWindow` without reshaping.
 */
export interface VideoConfig extends JoinWindowConfig {
  noticeVersion: string;
  /** Absolute origin used to build patient join links. */
  appOrigin: string;
}

/** Parses a positive-integer environment value, falling back on anything else. */
function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

/**
 * Reads the four video environment variables (Req 6.4, 8.5). `env` is injectable
 * so callers and tests never have to mutate globals.
 */
export function readVideoConfig(env: Record<string, string | undefined> = process.env): VideoConfig {
  const configuredOrigin = (env.APP_ORIGIN || "").trim();
  const appOrigin =
    configuredOrigin.length > 0
      ? configuredOrigin.replace(/\/+$/, "")
      : env.NODE_ENV === "production"
        ? "https://bookmytime.tech"
        : "http://localhost:3000";

  return {
    beforeMinutes: readPositiveInt(env.VIDEO_JOIN_WINDOW_BEFORE_MINUTES, DEFAULT_JOIN_WINDOW_BEFORE_MINUTES),
    afterMinutes: readPositiveInt(env.VIDEO_JOIN_WINDOW_AFTER_MINUTES, DEFAULT_JOIN_WINDOW_AFTER_MINUTES),
    noticeVersion: (env.VIDEO_NOTICE_VERSION || "").trim() || DEFAULT_NOTICE_VERSION,
    appOrigin,
  };
}

/** `DATETIME(3)` column → epoch milliseconds, or `null` when unusable. */
function toEpochMs(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Maps a driver row onto `VideoRoomRow` so the shape is controlled here. */
function mapVideoRoomRow(row: any): VideoRoomRow {
  return {
    id: String(row.id),
    tenantId: String(row.tenantId),
    // Must NOT be String()-coerced: an ad-hoc room has a NULL appointmentId, and
    // String(null) yields the truthy string "null", which sends every instant
    // room down the appointment branch of patientFactsFor / requestEntry / audit.
    appointmentId: row.appointmentId ?? null,
    doctorId: row.doctorId ?? null,
    state: row.state as RoomState,
    joinOpensAt: row.joinOpensAt ?? null,
    joinClosesAt: row.joinClosesAt ?? null,
    tokenVersion: Number(row.tokenVersion ?? 0),
    signalSeq: Number(row.signalSeq ?? 0),
    admittedParticipantId: row.admittedParticipantId ?? null,
    admissionDecisionAt: row.admissionDecisionAt ?? null,
    activatedAt: row.activatedAt ?? null,
    endedAt: row.endedAt ?? null,
    endReason: row.endReason ?? null,
    outcome: row.outcome ?? null,
    connectedSeconds: Number(row.connectedSeconds ?? 0),
    disconnectedSinceAt: row.disconnectedSinceAt ?? null,
    disconnectedTotalMs: Number(row.disconnectedTotalMs ?? 0),
    noticeVersion: String(row.noticeVersion ?? DEFAULT_NOTICE_VERSION),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

/** Every `VideoRoom` column, qualified for joins. */
const VIDEO_ROOM_COLUMNS = `
  r.id, r.tenantId, r.appointmentId, r.doctorId, r.state,
  r.joinOpensAt, r.joinClosesAt, r.tokenVersion, r.signalSeq,
  r.admittedParticipantId, r.admissionDecisionAt, r.activatedAt,
  r.endedAt, r.endReason, r.outcome, r.connectedSeconds,
  r.disconnectedSinceAt, r.disconnectedTotalMs, r.noticeVersion,
  r.createdAt, r.updatedAt
`;

// ─────────────────────────────────────────────────────────────────────────────
// Join tokens (Req 6)
//
// A join token is the ENTIRE security boundary for the unauthenticated patient
// path, so it is handled as a bearer credential: 256 bits of entropy, stored
// only as a SHA-256 hash, bound to one room and the patient role, valid only
// inside the join window, individually revocable, revoked wholesale at terminal
// state. Failed lookups are rate-limited and answered identically whether the
// token is unknown, malformed, or revoked, so the endpoint is not an oracle.
// ─────────────────────────────────────────────────────────────────────────────

/** Purpose recorded on the token row, mirroring `VideoJoinToken.purpose`. */
export type JoinTokenPurpose = "created" | "regenerated" | "reminder";

/** 32 bytes → 43 base64url characters. Anything outside that shape is refused. */
const JOIN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

/**
 * Mints a join token: 32 bytes from `randomBytes` (256 bits, well above the
 * 128-bit floor in Req 6.1) rendered base64url so the value is URL-safe and
 * needs no escaping inside a link.
 *
 * Returns the plaintext AND its hash. Only the hash is ever persisted (Req 6.7);
 * the plaintext must travel no further than the join link in the response and
 * must never be logged.
 */
export function generateJoinToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashJoinToken(token) };
}

/**
 * SHA-256 hex of a join token — the stored form and the lookup key.
 *
 * An unkeyed hash is sufficient here precisely because the input is 256 bits of
 * uniform randomness: there is no dictionary to run and no salt to add value.
 * Determinism is what lets `UNIQUE (tokenHash)` double as the lookup index.
 */
export function hashJoinToken(token: string): string {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Join token is required");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time hex-digest comparison.
 *
 * The primary lookup is an indexed equality on `UNIQUE (tokenHash)`, which is a
 * database index probe rather than a secret comparison in application code, so
 * it is not the timing channel that `timingSafeEqual` exists to close. This
 * check is defence in depth: it re-verifies the row the index returned without
 * introducing a length- or content-dependent comparison of our own.
 */
function hashesMatch(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Issues a fresh join token for a room and returns the absolute patient link.
 *
 * This is the ONLY moment the plaintext token exists: it is returned here,
 * embedded in the link, and then unrecoverable. `VideoRoom.tokenVersion` is
 * bumped atomically with MariaDB's `LAST_INSERT_ID(expr)` trick — the same
 * pattern the signal sequence uses — so two concurrent issuances can never
 * stamp the same version onto two rows.
 *
 * On localhost / 127.0.0.1 the request Host is preferred over APP_ORIGIN so
 * local testing does not mint production URLs while developing.
 */
export async function issueJoinToken(
  roomId: string,
  tenantId: string,
  purpose: JoinTokenPurpose,
): Promise<{ token: string; link: string }> {
  if (!roomId || !tenantId) {
    throw new Error("Room id and tenant id are required to issue a join token");
  }

  const room = await queryOne<{ id: string }>(
    `SELECT id FROM VideoRoom WHERE id = ? AND tenantId = ? LIMIT 1`,
    [roomId, tenantId],
  );
  if (!room) {
    throw new Error("Video room not found");
  }

  const bumped = await execute(
    `UPDATE VideoRoom SET tokenVersion = LAST_INSERT_ID(tokenVersion + 1) WHERE id = ? AND tenantId = ?`,
    [roomId, tenantId],
  );
  if (bumped.affectedRows === 0) {
    throw new Error("Video room not found");
  }
  const version = Number(bumped.insertId ?? 0) || 1;

  const { token, hash } = generateJoinToken();

  await execute(
    `INSERT INTO VideoJoinToken (id, tenantId, roomId, tokenHash, version, purpose, useCount)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [randomUUID(), tenantId, roomId, hash, version, purpose],
  );

  const appOrigin = await resolveJoinLinkOrigin();
  return { token, link: `${appOrigin}/consult/${token}` };
}

/** Prefer localhost request origin during local development; otherwise APP_ORIGIN. */
export async function resolveJoinLinkOrigin(
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const configured = readVideoConfig(env).appOrigin;
  try {
    const mod: any = await import("@tanstack/react-start/server");
    const h = typeof mod.getHeaders === "function" ? mod.getHeaders() : {};
    const host = (h["x-forwarded-host"] || h["host"] || "").toString().trim().split(",")[0].trim();
    if (host && (host.startsWith("localhost") || host.startsWith("127.0.0.1"))) {
      const proto =
        (h["x-forwarded-proto"] || "").toString().trim().split(",")[0].trim() || "http";
      return `${proto}://${host}`.replace(/\/+$/, "");
    }
  } catch {
    /* fall through */
  }
  return configured;
}

/**
 * Revokes every live token for a room (Req 6.8 on regeneration, Req 6.9 at a
 * terminal transition). Idempotent: the `revokedAt IS NULL` guard means a second
 * call is a no-op and cannot move an existing revocation timestamp.
 *
 * `roomId` is a UUID that belongs to exactly one tenant and callers reach it
 * only through a tenant-scoped room load, so the room identity is the tenant
 * scope here (Req 12.9).
 */
export async function revokeJoinTokens(roomId: string): Promise<void> {
  if (!roomId) {
    throw new Error("Room id is required to revoke join tokens");
  }

  await execute(
    `UPDATE VideoJoinToken SET revokedAt = NOW(3) WHERE roomId = ? AND revokedAt IS NULL`,
    [roomId],
  );
}

/** A token that resolved to a live room inside its join window. */
export interface ResolvedToken {
  room: VideoRoomRow;
  tokenId: string;
  tokenVersion: number;
}

export type ResolveTokenFailure = "invalid" | "expired" | "rate_limited" | "ended";

// ---- failed-attempt rate limiting (Req 6.12) ----
//
// Counters live in this process only. That is adequate for the current
// single-instance deployment and keeps the hot patient path free of a network
// round trip, but a multi-instance or serverless deployment would need a shared
// store (Redis, or a small table keyed by client) — otherwise the effective
// limit multiplies by the instance count. Recorded here rather than in the pure
// module because the pure module holds no state.
const joinFailureStates = new Map<string, RateLimitState>();

/** Hard ceiling on tracked clients, so a spray of distinct keys cannot grow the map without bound. */
const MAX_TRACKED_CLIENTS = 10_000;
/** Entries older than this carry no weight in any sliding window and are dropped. */
const RATE_LIMIT_STATE_TTL_MS = 60_000;
let lastRateLimitPruneMs = 0;

/** Drops clients whose recorded failures have all aged out of the window. */
function pruneJoinFailureStates(nowMs: number): void {
  lastRateLimitPruneMs = nowMs;
  const cutoff = nowMs - RATE_LIMIT_STATE_TTL_MS;

  for (const [key, state] of joinFailureStates) {
    const recent = state.hits.filter((t) => Number.isFinite(t) && t > cutoff);
    if (recent.length === 0) {
      joinFailureStates.delete(key);
    } else if (recent.length !== state.hits.length) {
      joinFailureStates.set(key, { hits: recent });
    }
  }
}

/** Normalises the caller-supplied client key; unattributable callers share one bucket. */
function normalizeClientKey(clientKey: string): string {
  const key = typeof clientKey === "string" ? clientKey.trim() : "";
  return key.length > 0 ? key.slice(0, 200) : "unknown";
}

/**
 * Pre-flight check: is this client already over its failure budget?
 *
 * The pure `evaluateRateLimit` both decides and records, so the returned state is
 * deliberately discarded here — a successful resolution must leave the counter
 * untouched. The hit is committed by `recordJoinFailure` on the failure path.
 */
function isRateLimited(key: string, nowMs: number): boolean {
  const state = joinFailureStates.get(key) ?? { hits: [] };
  return !evaluateRateLimit(state, nowMs).allowed;
}

/** Commits one failed attempt against the client's sliding window. */
function recordJoinFailure(key: string, nowMs: number): void {
  if (joinFailureStates.size >= MAX_TRACKED_CLIENTS || nowMs - lastRateLimitPruneMs > RATE_LIMIT_STATE_TTL_MS) {
    pruneJoinFailureStates(nowMs);
  }

  const state = joinFailureStates.get(key) ?? { hits: [] };
  const { allowed, state: next } = evaluateRateLimit(state, nowMs);
  joinFailureStates.set(key, next);

  // `allowed === false` means the window was already full; the pure function
  // leaves such attempts unrecorded so a client cannot extend its own lockout.
  void allowed;
}

/**
 * Resolves a patient join token to its room.
 *
 * Order matters and is deliberate:
 *   1. Failure budget first, so a brute-force attempt costs no database work.
 *   2. Shape check, so a malformed value never reaches the hash or the query.
 *   3. One indexed point read on `UNIQUE (tokenHash)`, joined to the room.
 *   4. Scope, liveness, and window checks.
 *
 * Unknown, malformed, revoked, and terminal-room tokens all return the SAME
 * `invalid` status with no appointment, patient, or tenant detail, so the
 * endpoint cannot be used as an oracle (Req 6.6). Anything outside the join
 * window returns `expired` (Req 6.5). Nothing here is logged: a log line
 * carrying the token would defeat hashed storage.
 */
export async function resolveJoinToken(
  token: string,
  clientKey: string,
): Promise<{ ok: true; value: ResolvedToken } | { ok: false; status: ResolveTokenFailure }> {
  const nowMs = Date.now();
  const key = normalizeClientKey(clientKey);

  if (isRateLimited(key, nowMs)) {
    return { ok: false, status: "rate_limited" };
  }

  const fail = (status: Exclude<ResolveTokenFailure, "rate_limited">) => {
    recordJoinFailure(key, nowMs);
    return { ok: false as const, status };
  };

  if (typeof token !== "string" || !JOIN_TOKEN_PATTERN.test(token)) {
    return fail("invalid");
  }

  const tokenHash = hashJoinToken(token);

  const row = await queryOne<any>(
    // `t.version` MUST NOT be aliased `tokenVersion`: VIDEO_ROOM_COLUMNS already
    // carries `r.tokenVersion`, and the MariaDB driver rejects a result set with
    // two identically-named fields ("duplicate field name") before returning any
    // row. That threw on EVERY patient link regardless of the token, which the
    // caller then surfaced as an invalid link.
    `SELECT ${VIDEO_ROOM_COLUMNS},
            t.id AS tokenId, t.tokenHash AS storedTokenHash, t.version AS joinTokenVersion,
            t.roomId AS tokenRoomId, t.revokedAt AS tokenRevokedAt
     FROM VideoJoinToken t
     JOIN VideoRoom r ON r.id = t.roomId AND r.tenantId = t.tenantId
     WHERE t.tokenHash = ?
     LIMIT 1`,
    [tokenHash],
  );

  if (!row || !hashesMatch(String(row.storedTokenHash ?? ""), tokenHash)) {
    return fail("invalid");
  }

  const room = mapVideoRoomRow(row);
  const revoked = row.tokenRevokedAt !== null && row.tokenRevokedAt !== undefined;

  // Terminal state is checked BEFORE revocation, because a terminal transition
  // revokes every token for the room (Req 6.9) — so the revocation branch below
  // used to swallow every finished consultation and report "invalid link".
  //
  // The token hash has already matched at this point, so the caller demonstrably
  // holds the link we issued. Naming a finished consultation to them leaks
  // nothing to anyone who does NOT hold it: an unknown or forged token still
  // gets `invalid`, so this is not an oracle (Req 6.6). And "check the link the
  // clinic sent you" is simply wrong for a patient whose call just ended.
  if (isTerminalRoomState(room.state)) {
    return fail("ended");
  }

  // A token's authority is exactly one room. The requested room is the one the
  // join revealed, so this also catches a token whose room row went missing or
  // was replaced, and it folds revocation into the same verdict (Req 6.2, 6.10).
  // Reaching it on a non-terminal room means the link was deliberately reissued.
  if (!isTokenScopedTo(String(row.tokenRoomId ?? ""), room.id, revoked)) {
    return fail("invalid");
  }

  const opensAt = toEpochMs(room.joinOpensAt);
  const closesAt = toEpochMs(room.joinClosesAt);
  if (opensAt === null || closesAt === null) {
    // Fail closed: without a materialised window the token cannot be shown to be
    // inside one, and Req 6.5 admits a token only inside its window.
    return fail("expired");
  }

  const window: JoinWindow = { opensAt, closesAt };
  // Req 6.5 rejects a token presented "outside its Join_Window" with an
  // expired-link status, and `early` is outside it just as `closed` is — so both
  // verdicts map to `expired`. Collapsing them also avoids handing an attacker a
  // before/after discriminator that would leak the appointment time.
  if (evaluateJoinWindow(nowMs, window) !== "open") {
    return fail("expired");
  }

  // Success. Tenant scope comes from the resolved room, never from caller input
  // (Req 12.9). The `revokedAt IS NULL` guard makes the stamp a no-op if the
  // token was revoked between the read and this write.
  const tokenId = String(row.tokenId);
  await execute(
    `UPDATE VideoJoinToken
     SET lastUsedAt = NOW(3), useCount = useCount + 1
     WHERE id = ? AND tenantId = ? AND roomId = ? AND revokedAt IS NULL`,
    [tokenId, room.tenantId, room.id],
  );

  return {
    ok: true,
    value: { room, tokenId, tokenVersion: Number(row.joinTokenVersion ?? 0) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rooms (Req 3, 4) — creation, the single transition choke point, and expiry.
//
// `transitionRoom` is the ONLY writer of `VideoRoom.state`. It loads the room
// FOR UPDATE inside a transaction, calls the pure `applyTransition`, writes only
// on success, appends an audit row, and on a terminal result revokes tokens,
// deletes signal rows, and finalises the outcome.
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from "./db";
import {
  applyTransition,
  classifyOutcome,
  computeJoinWindow,
  selectSignalsAfter,
  shouldEndForDisconnect,
  validateSignalPayload,
  type CallOutcome,
  type ParticipantRole,
  type SignalKind,
  type SignalRecord,
  type TransitionKind,
} from "./video-consultation";
import { verifySession } from "./auth.server";
import {
  canOperateFeature,
  canUseFeature,
  type AccountContext,
  type AccountRole,
} from "./feature-access";

/** Minimal appointment shape the video layer needs. */
export interface VideoAppointmentInfo {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  phone: string | null;
  dateTime: Date | string;
  reason: string;
  status: string;
  doctorId: string | null;
  consultationMode: string;
  clinicName: string | null;
  doctorName: string | null;
  patientId: string | null;
}

/** Loads an appointment plus clinic and doctor names, tenant-scoped. */
export async function loadAppointmentForVideo(
  appointmentId: string,
  tenantId: string,
): Promise<VideoAppointmentInfo | null> {
  const row = await queryOne<any>(
    `SELECT a.id, a.tenantId, a.name, a.email, a.phone, a.dateTime, a.reason, a.status,
            a.doctorId, a.patientId, a.consultationMode,
            u.clinicName AS clinicName, d.name AS doctorName
     FROM Appointment a
     LEFT JOIN User u ON a.tenantId COLLATE utf8mb4_unicode_ci = u.tenantId COLLATE utf8mb4_unicode_ci
     LEFT JOIN Doctor d ON a.doctorId COLLATE utf8mb4_unicode_ci = d.id COLLATE utf8mb4_unicode_ci
     WHERE a.id = ? AND a.tenantId = ?
     LIMIT 1`,
    [appointmentId, tenantId],
  );
  if (!row) return null;
  return {
    id: String(row.id),
    tenantId: String(row.tenantId),
    name: String(row.name ?? ""),
    email: row.email ?? null,
    phone: row.phone ?? null,
    dateTime: row.dateTime,
    reason: String(row.reason ?? ""),
    status: String(row.status ?? "Pending"),
    doctorId: row.doctorId ?? null,
    consultationMode: String(row.consultationMode ?? "in_person"),
    clinicName: row.clinicName ?? null,
    doctorName: row.doctorName ?? null,
    patientId: row.patientId ?? null,
  };
}

/** Loads one room by id, tenant-scoped, without applying lazy expiry. */
async function loadRoomRaw(roomId: string, tenantId: string): Promise<VideoRoomRow | null> {
  const row = await queryOne<any>(
    `SELECT ${VIDEO_ROOM_COLUMNS} FROM VideoRoom r WHERE r.id = ? AND r.tenantId = ? LIMIT 1`,
    [roomId, tenantId],
  );
  return row ? mapVideoRoomRow(row) : null;
}

/** Loads a room by appointment id, tenant-scoped. */
export async function loadRoomByAppointment(
  appointmentId: string,
  tenantId: string,
): Promise<VideoRoomRow | null> {
  const row = await queryOne<any>(
    `SELECT ${VIDEO_ROOM_COLUMNS} FROM VideoRoom r WHERE r.appointmentId = ? AND r.tenantId = ? LIMIT 1`,
    [appointmentId, tenantId],
  );
  return row ? mapVideoRoomRow(row) : null;
}

/**
 * Idempotently ensures exactly one room exists for an appointment (Req 3.3,
 * 3.6, 4.1, 4.2). Relies on `UNIQUE (appointmentId)` rather than a read-then-
 * write, so concurrent creates cannot produce two rooms. Materialises the join
 * window from `Appointment.dateTime` and the configured window so the sweeper
 * has an indexable predicate.
 */
export async function ensureVideoRoom(appointmentId: string, tenantId: string): Promise<VideoRoomRow> {
  const existing = await loadRoomByAppointment(appointmentId, tenantId);
  if (existing) return existing;

  const appt = await loadAppointmentForVideo(appointmentId, tenantId);
  if (!appt) throw new Error("Appointment not found");

  const cfg = readVideoConfig();
  const apptMs = toEpochMs(appt.dateTime) ?? Date.now();
  const window = computeJoinWindow(apptMs, cfg);

  await execute(
    `INSERT INTO VideoRoom (id, tenantId, appointmentId, doctorId, state, joinOpensAt, joinClosesAt, noticeVersion)
     VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      randomUUID(),
      tenantId,
      appointmentId,
      appt.doctorId,
      new Date(window.opensAt),
      new Date(window.closesAt),
      cfg.noticeVersion,
    ],
  );

  const room = await loadRoomByAppointment(appointmentId, tenantId);
  if (!room) throw new Error("Failed to create video room");
  await recordAudit(room.id, "state_change", "created", undefined, tenantId, appointmentId);
  return room;
}

/** Recomputes the join window when the linked appointment's dateTime changes. */
export async function refreshRoomWindow(appointmentId: string, tenantId: string): Promise<void> {
  const appt = await loadAppointmentForVideo(appointmentId, tenantId);
  if (!appt) return;
  const cfg = readVideoConfig();
  const apptMs = toEpochMs(appt.dateTime) ?? Date.now();
  const window = computeJoinWindow(apptMs, cfg);
  await execute(
    `UPDATE VideoRoom SET joinOpensAt = ?, joinClosesAt = ?
     WHERE appointmentId = ? AND tenantId = ? AND state IN ('scheduled','waiting')`,
    [new Date(window.opensAt), new Date(window.closesAt), appointmentId, tenantId],
  );
}

/**
 * Loads a room for reading, applying lazy expiry first (Req 4.6) so no caller
 * ever observes a stale `scheduled`/`waiting` room past its window.
 */
export async function loadRoomForRead(roomId: string, tenantId: string): Promise<VideoRoomRow> {
  let room = await loadRoomRaw(roomId, tenantId);
  if (!room) throw new Error("Video room not found");

  if (room.state === "scheduled" || room.state === "waiting") {
    const closesAt = toEpochMs(room.joinClosesAt);
    if (closesAt !== null && Date.now() > closesAt) {
      await expireVideoRoom(roomId, Date.now());
      room = (await loadRoomRaw(roomId, tenantId)) ?? room;
    }
  }
  return room;
}

/** Context threaded into a transition so audit and terminal side effects are precise. */
export interface TransitionContext {
  tenantId: string;
  /** NULL for ad-hoc (instant / share-link) rooms that have no Appointment. */
  appointmentId: string | null;
  actorRole?: ParticipantRole;
  endReason?: string;
  detail?: string;
  participantId?: string;
}

/**
 * The single writer of `VideoRoom.state`. Serialises on the room row with
 * `SELECT ... FOR UPDATE`, applies the pure `applyTransition`, and writes only
 * when the transition is legal. An illegal transition throws and writes nothing
 * (Req 4.7, 4.8, 16.6). On reaching a terminal state it revokes tokens, deletes
 * signals, and finalises the outcome (Req 6.9, 7.10, 15.2).
 */
export async function transitionRoom(
  roomId: string,
  kind: TransitionKind,
  ctx: TransitionContext,
): Promise<VideoRoomRow> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const rows: any[] = await conn.query(
      `SELECT ${VIDEO_ROOM_COLUMNS} FROM VideoRoom r WHERE r.id = ? AND r.tenantId = ? FOR UPDATE`,
      [roomId, ctx.tenantId],
    );
    const current = rows && rows[0] ? mapVideoRoomRow(rows[0]) : null;
    if (!current) {
      await conn.rollback();
      throw new Error("Video room not found");
    }

    const result = applyTransition(current.state, kind);
    if (!result.ok) {
      await conn.rollback();
      throw new Error(
        result.reason === "terminal"
          ? "This consultation has already finished."
          : "That action is not allowed for the current consultation state.",
      );
    }

    const next = result.next;
    const nowIso = new Date();
    const sets: string[] = ["state = ?"];
    const params: any[] = [next];

    if (kind === "admit") {
      // At most one admitted patient: set admittedParticipantId only if free.
      sets.push("admittedParticipantId = COALESCE(admittedParticipantId, ?)");
      params.push(ctx.participantId ?? null);
      sets.push("admissionDecisionAt = ?");
      params.push(nowIso);
      sets.push("activatedAt = COALESCE(activatedAt, ?)");
      params.push(nowIso);
    }
    if (kind === "decline") {
      sets.push("admissionDecisionAt = ?");
      params.push(nowIso);
    }
    if (next === "ended") {
      sets.push("endedAt = ?");
      params.push(nowIso);
      if (ctx.endReason) {
        sets.push("endReason = ?");
        params.push(ctx.endReason);
      }
    }
    if (next === "cancelled" || next === "expired") {
      sets.push("endedAt = COALESCE(endedAt, ?)");
      params.push(nowIso);
      sets.push("endReason = COALESCE(endReason, ?)");
      params.push(ctx.endReason ?? next);
    }

    params.push(roomId, ctx.tenantId);
    await conn.query(`UPDATE VideoRoom SET ${sets.join(", ")} WHERE id = ? AND tenantId = ?`, params);

    // Audit row inside the same transaction.
    await conn.query(
      `INSERT INTO VideoAuditEvent (id, tenantId, roomId, appointmentId, participantRole, kind, detail)
       VALUES (?, ?, ?, ?, ?, 'state_change', ?)`,
      [randomUUID(), ctx.tenantId, roomId, ctx.appointmentId, ctx.actorRole ?? null, ctx.detail ?? `${current.state}->${next}`],
    );

    if (isTerminalRoomState(next)) {
      await conn.query(`UPDATE VideoJoinToken SET revokedAt = NOW(3) WHERE roomId = ? AND revokedAt IS NULL`, [roomId]);
      await conn.query(`DELETE FROM VideoSignal WHERE roomId = ?`, [roomId]);
    }

    await conn.commit();

    // Finalise outcome outside the row lock (idempotent, reads its own state).
    if (isTerminalRoomState(next)) {
      await finalizeRoomOutcome(roomId, ctx.tenantId);
    }

    const updated = await loadRoomRaw(roomId, ctx.tenantId);
    return updated ?? current;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Idempotently expires a scheduled/waiting room whose window has closed
 * (Req 4.6). Guarded by state so a concurrent lazy expiry and sweep cannot
 * disagree, and routed through `transitionRoom` so the terminal side effects
 * (token revocation, signal deletion, outcome) all run.
 */
export async function expireVideoRoom(roomId: string, _nowMs: number): Promise<void> {
  const room = await queryOne<any>(
    `SELECT r.id, r.tenantId, r.appointmentId, r.state FROM VideoRoom r WHERE r.id = ? LIMIT 1`,
    [roomId],
  );
  if (!room) return;
  if (room.state !== "scheduled" && room.state !== "waiting") return;
  try {
    await transitionRoom(roomId, "expire", {
      tenantId: String(room.tenantId),
      appointmentId: String(room.appointmentId),
      endReason: "expired",
      detail: "window_closed",
    });
  } catch {
    // A concurrent transition may have already moved the room; expiry is best-effort.
  }
}

/**
 * Sweeps rooms whose window has closed while still scheduled/waiting (Req 4.6)
 * and prunes signal rows for rooms terminal for over 10 minutes (Req 7.10).
 * Invoked from the existing reminder cycle — no new timer.
 */
export async function sweepExpiredVideoRooms(): Promise<void> {
  const due = await queryScoped<any>(
    `SELECT id FROM VideoRoom WHERE state IN ('scheduled','waiting') AND joinClosesAt IS NOT NULL AND joinClosesAt < NOW(3) LIMIT 200`,
  );
  for (const r of due) {
    await expireVideoRoom(String(r.id), Date.now());
  }
  // Belt-and-braces cleanup of any orphaned signals for terminal rooms.
  await execute(
    `DELETE s FROM VideoSignal s JOIN VideoRoom r ON s.roomId = r.id
     WHERE r.state IN ('ended','expired','cancelled') AND r.updatedAt < (NOW(3) - INTERVAL 10 MINUTE)`,
  );
}

/** A non-tenant-scoped SELECT helper used only by the global sweeper. */
async function queryScoped<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const conn = await pool.getConnection();
  try {
    const rows: any = await conn.query(sql, params);
    return Array.isArray(rows) ? (rows as T[]) : [];
  } finally {
    conn.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Signals (Req 7) — the DB-polled signalling mailbox.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allocates the next per-room signal sequence atomically with MariaDB's
 * `LAST_INSERT_ID(expr)` trick, so concurrent publishes from both sides never
 * collide (Req 7.4).
 */
export async function allocateSignalSeq(roomId: string, tenantId: string): Promise<number> {
  const res = await execute(
    `UPDATE VideoRoom SET signalSeq = LAST_INSERT_ID(signalSeq + 1) WHERE id = ? AND tenantId = ?`,
    [roomId, tenantId],
  );
  if (res.affectedRows === 0) throw new Error("Video room not found");
  return Number(res.insertId ?? 0);
}

/**
 * Validates and inserts one signal (Req 7.1, 7.11). An oversized or unknown
 * submission persists nothing — validation runs before any statement.
 */
export async function insertSignal(
  roomId: string,
  tenantId: string,
  senderRole: ParticipantRole,
  kind: string,
  payload: string,
): Promise<{ seq: number }> {
  const check = validateSignalPayload(kind, payload);
  if (!check.ok) {
    throw new Error(check.reason === "too_large" ? "Signal payload too large" : "Invalid signal");
  }
  const seq = await allocateSignalSeq(roomId, tenantId);
  await execute(
    `INSERT INTO VideoSignal (id, tenantId, roomId, seq, senderRole, kind, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), tenantId, roomId, seq, senderRole, check.kind as SignalKind, payload],
  );
  return { seq };
}

/**
 * Reads signals after a cursor for the given reader role (Req 7.3, 7.4). The
 * index range scan does the heavy lifting; the pure `selectSignalsAfter` applies
 * the ordering and same-role filtering invariant.
 */
export async function readSignalsAfter(
  roomId: string,
  tenantId: string,
  cursor: number,
  forRole: ParticipantRole,
): Promise<SignalRecord[]> {
  const rows = await queryScoped<any>(
    `SELECT seq, kind, senderRole, payload FROM VideoSignal
     WHERE roomId = ? AND tenantId = ? AND seq > ? ORDER BY seq ASC LIMIT 200`,
    [roomId, tenantId, cursor],
  );
  const mapped: SignalRecord[] = rows.map((r) => ({
    seq: Number(r.seq),
    kind: r.kind as SignalKind,
    senderRole: r.senderRole as ParticipantRole,
    payload: String(r.payload),
  }));
  return selectSignalsAfter(mapped, cursor, forRole);
}

/** Deletes all signals for a room (Req 7.10). */
export async function deleteSignals(roomId: string): Promise<void> {
  await execute(`DELETE FROM VideoSignal WHERE roomId = ?`, [roomId]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Participants, audit, outcome (Req 4.10, 5, 10, 15)
// ─────────────────────────────────────────────────────────────────────────────

export interface VideoParticipantRow {
  id: string;
  tenantId: string;
  roomId: string;
  role: ParticipantRole;
  participantKey: string;
  accountId: string | null;
  displayName: string | null;
  /** Self-reported age, collected on the patient join form. */
  displayAge: number | null;
  status: string;
  peerState: string | null;
  micEnabled: number;
  cameraEnabled: number;
  quality: string | null;
  joinedAt: Date | string | null;
  admittedAt: Date | string | null;
  leftAt: Date | string | null;
  connectedMs: number;
  lastSeenAt: Date | string | null;
  lastPolledAt: Date | string | null;
}

/** Stable participant identity across reloads without cookies (Req 10.6). */
export function patientParticipantKey(roomId: string): string {
  return createHash("sha256").update(`${roomId}:patient`).digest("hex");
}
export function doctorParticipantKey(accountId: string): string {
  return createHash("sha256").update(String(accountId)).digest("hex");
}

/** Loads participants for a room, tenant-scoped. */
export async function loadParticipants(roomId: string, tenantId: string): Promise<VideoParticipantRow[]> {
  const rows = await queryScoped<any>(
    `SELECT * FROM VideoParticipant WHERE roomId = ? AND tenantId = ? ORDER BY createdAt ASC`,
    [roomId, tenantId],
  );
  return rows.map(mapParticipantRow);
}

function mapParticipantRow(r: any): VideoParticipantRow {
  return {
    id: String(r.id),
    tenantId: String(r.tenantId),
    roomId: String(r.roomId),
    role: r.role as ParticipantRole,
    participantKey: String(r.participantKey),
    accountId: r.accountId ?? null,
    displayName: r.displayName ?? null,
    displayAge: r.displayAge === null || r.displayAge === undefined ? null : Number(r.displayAge),
    status: String(r.status ?? "requested"),
    peerState: r.peerState ?? null,
    micEnabled: Number(r.micEnabled ?? 1),
    cameraEnabled: Number(r.cameraEnabled ?? 1),
    quality: r.quality ?? null,
    joinedAt: r.joinedAt ?? null,
    admittedAt: r.admittedAt ?? null,
    leftAt: r.leftAt ?? null,
    connectedMs: Number(r.connectedMs ?? 0),
    lastSeenAt: r.lastSeenAt ?? null,
    lastPolledAt: r.lastPolledAt ?? null,
  };
}

/** Inserts or updates a participant row keyed on (roomId, participantKey). */
export async function upsertParticipant(input: {
  tenantId: string;
  roomId: string;
  role: ParticipantRole;
  participantKey: string;
  accountId?: string | null;
  displayName?: string | null;
  displayAge?: number | null;
  status?: string;
}): Promise<VideoParticipantRow> {
  const existing = await queryOne<any>(
    `SELECT * FROM VideoParticipant WHERE roomId = ? AND participantKey = ? LIMIT 1`,
    [input.roomId, input.participantKey],
  );
  if (existing) {
    await execute(
      `UPDATE VideoParticipant
         SET lastSeenAt = NOW(3),
             displayName = COALESCE(?, displayName),
             displayAge = COALESCE(?, displayAge),
             status = COALESCE(?, status)
       WHERE id = ?`,
      [input.displayName ?? null, input.displayAge ?? null, input.status ?? null, existing.id],
    );
    const reloaded = await queryOne<any>(`SELECT * FROM VideoParticipant WHERE id = ? LIMIT 1`, [existing.id]);
    return mapParticipantRow(reloaded);
  }
  const id = randomUUID();
  await execute(
    `INSERT INTO VideoParticipant
       (id, tenantId, roomId, role, participantKey, accountId, displayName, displayAge, status, joinedAt, lastSeenAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [
      id,
      input.tenantId,
      input.roomId,
      input.role,
      input.participantKey,
      input.accountId ?? null,
      input.displayName ?? null,
      input.displayAge ?? null,
      input.status ?? "requested",
    ],
  );
  const created = await queryOne<any>(`SELECT * FROM VideoParticipant WHERE id = ? LIMIT 1`, [id]);
  return mapParticipantRow(created);
}

/** Updates a participant's reported peer/media/quality state. */
export async function updateParticipantState(
  participantId: string,
  tenantId: string,
  patch: { peerState?: string; micEnabled?: boolean; cameraEnabled?: boolean; quality?: string; addConnectedMs?: number },
): Promise<void> {
  const sets: string[] = ["lastSeenAt = NOW(3)"];
  const params: any[] = [];
  if (patch.peerState !== undefined) {
    sets.push("peerState = ?");
    params.push(patch.peerState);
  }
  if (patch.micEnabled !== undefined) {
    sets.push("micEnabled = ?");
    params.push(patch.micEnabled ? 1 : 0);
  }
  if (patch.cameraEnabled !== undefined) {
    sets.push("cameraEnabled = ?");
    params.push(patch.cameraEnabled ? 1 : 0);
  }
  if (patch.quality !== undefined) {
    sets.push("quality = ?");
    params.push(patch.quality);
  }
  if (patch.addConnectedMs && patch.addConnectedMs > 0) {
    sets.push("connectedMs = connectedMs + ?");
    params.push(Math.floor(patch.addConnectedMs));
  }
  params.push(participantId, tenantId);
  await execute(`UPDATE VideoParticipant SET ${sets.join(", ")} WHERE id = ? AND tenantId = ?`, params);
}

/** Marks a participant as left/removed and stamps leftAt. */
export async function markParticipantGone(
  participantId: string,
  tenantId: string,
  status: "left" | "removed",
): Promise<void> {
  await execute(
    `UPDATE VideoParticipant SET status = ?, leftAt = COALESCE(leftAt, NOW(3)) WHERE id = ? AND tenantId = ?`,
    [status, participantId, tenantId],
  );
}

/**
 * Append-only audit writer (Req 15.1). Never throws — a failed audit write must
 * not break the calling operation. `detail` is a short label; SDP, ICE
 * candidates, and signal payloads must never be passed here (Req 15.8).
 */
export async function recordAudit(
  roomId: string,
  kind: string,
  detail: string | null,
  role: ParticipantRole | undefined,
  tenantId: string,
  appointmentId: string | null,
): Promise<void> {
  try {
    await execute(
      `INSERT INTO VideoAuditEvent (id, tenantId, roomId, appointmentId, participantRole, kind, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), tenantId, roomId, appointmentId, role ?? null, kind, detail ? String(detail).slice(0, 255) : null],
    );
  } catch (err: any) {
    console.error("[Video][audit] failed:", err?.message);
  }
}

/** Returns audit events for a room, oldest first. */
export async function loadAuditEvents(roomId: string, tenantId: string): Promise<any[]> {
  const rows = await queryScoped<any>(
    `SELECT participantRole, kind, detail, occurredAt FROM VideoAuditEvent
     WHERE roomId = ? AND tenantId = ? ORDER BY occurredAt ASC, id ASC LIMIT 500`,
    [roomId, tenantId],
  );
  return rows.map((r) => ({
    role: r.participantRole ?? null,
    kind: String(r.kind),
    detail: r.detail ?? null,
    at: r.occurredAt instanceof Date ? r.occurredAt.toISOString() : r.occurredAt,
  }));
}

/**
 * Finalises the outcome and connected duration of a terminal room (Req 15.2-
 * 15.6, 15.9). Idempotent via the pure `classifyOutcome`, which preserves any
 * outcome already recorded. Accumulates connected seconds from participants.
 */
export async function finalizeRoomOutcome(roomId: string, tenantId: string): Promise<void> {
  const room = await loadRoomRaw(roomId, tenantId);
  if (!room) return;
  if (!isTerminalRoomState(room.state)) return;

  const participants = await loadParticipants(roomId, tenantId);
  const patient = participants.find((p) => p.role === "patient");
  const patientEverAdmitted = participants.some((p) => p.role === "patient" && p.admittedAt !== null);
  const patientEverWaited = participants.some((p) => p.role === "patient");
  const admissionDecisionRecorded = room.admissionDecisionAt !== null;

  // Connected seconds: max reported by any participant (both sides report their
  // own connected time; they should agree closely, so the max is a safe figure).
  let connectedMs = room.connectedSeconds * 1000;
  for (const p of participants) connectedMs = Math.max(connectedMs, p.connectedMs);
  const connectedSeconds = Math.floor(connectedMs / 1000);

  const terminal = room.state as "ended" | "expired" | "cancelled";
  const outcome: CallOutcome = classifyOutcome({
    terminalState: terminal,
    patientEverAdmitted,
    patientEverWaited,
    admissionDecisionRecorded,
    connectedSeconds,
    existingOutcome: (room.outcome as CallOutcome | null) ?? null,
  });

  await execute(
    `UPDATE VideoRoom SET outcome = COALESCE(outcome, ?), connectedSeconds = GREATEST(connectedSeconds, ?)
     WHERE id = ? AND tenantId = ?`,
    [outcome, connectedSeconds, roomId, tenantId],
  );
  void patient;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guards (Req 1.6, 1.7, 2.6, 2.7, 5.6, 12.9)
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionUser {
  id: string;
  tenantId: string;
  role: AccountRole;
  profession?: string | null;
  doctorId?: string | null;
  name?: string;
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
  subscriptionExpiresAt?: string | null;
}

/** Rebuilds the pure AccountContext from a session (mirrors auth.ts). */
function contextFromSession(user: any): AccountContext {
  return {
    role: (user.role ?? "admin") as AccountRole,
    profession: user.profession,
    subscriptionPlan: user.subscriptionPlan,
    subscriptionStatus: user.subscriptionStatus,
    subscriptionExpiresAt: user.subscriptionExpiresAt,
    isActive: true,
  };
}

/**
 * Verifies a session and that the account may OPERATE video consultations —
 * profession, plan, and role are all enforced server-side here regardless of
 * what the client rendered (Req 1.6, 1.7, 2.6).
 */
export async function requireVideoOperator(): Promise<SessionUser> {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  if (!canOperateFeature(contextFromSession(user), "video")) {
    throw new Error("You do not have access to video consultations.");
  }
  return user as SessionUser;
}

/** Read variant: at least view permission (still blocks `none` roles, Req 2.7). */
export async function requireVideoViewer(): Promise<SessionUser> {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error("Unauthorized");
  if (!canUseFeature(contextFromSession(user), "video")) {
    throw new Error("You do not have access to video consultations.");
  }
  return user as SessionUser;
}

/**
 * Loads a room and asserts the caller is the doctor assigned to the appointment
 * or the parent (admin) account (Req 5.6). Reception/location never reach here
 * because the operator guard rejects them first.
 */
export async function requireRoomForDoctor(roomId: string, user: SessionUser): Promise<VideoRoomRow> {
  const room = await loadRoomForRead(roomId, user.tenantId);
  const isAdmin = user.role === "admin";
  const isAssignedDoctor = user.role === "doctor" && !!user.doctorId && room.doctorId === user.doctorId;

  // Ad-hoc meetings are owned by whoever created them, so the host is also
  // authorised even when no Doctor record is attached to the room.
  let isHost = false;
  const extras = await loadRoomExtras(roomId, user.tenantId);
  if (extras?.kind === "instant" && extras.hostAccountId && extras.hostAccountId === user.id) {
    isHost = true;
  }

  if (!isAdmin && !isAssignedDoctor && !isHost) {
    throw new Error("You are not assigned to this consultation.");
  }
  return room;
}

// ─────────────────────────────────────────────────────────────────────────────
// Appointment integration (Req 3) — the mode-change side effect planner.
// ─────────────────────────────────────────────────────────────────────────────
import { planRoomSyncForModeChange, type ConsultationMode } from "./video-consultation";

/**
 * Applies the room-lifecycle consequence of an appointment's consultation mode.
 * Pure planning via `planRoomSyncForModeChange`; this wrapper does the I/O.
 * Never throws in a way that would block the appointment write — a notify or
 * room-sync failure is logged, and the appointment remains intact (Req 16.6).
 */
export async function syncVideoRoomForAppointment(input: {
  appointmentId: string;
  tenantId: string;
  from: ConsultationMode | null;
  to: ConsultationMode;
  notify?: boolean;
}): Promise<{ room: VideoRoomRow | null; joinLink: string | null }> {
  const existing = await loadRoomByAppointment(input.appointmentId, input.tenantId);
  const action = planRoomSyncForModeChange({
    from: input.from,
    to: input.to,
    hasRoom: !!existing,
    roomState: existing ? existing.state : null,
  });

  if (action === "create") {
    const room = await ensureVideoRoom(input.appointmentId, input.tenantId);
    const { link } = await issueJoinToken(room.id, input.tenantId, "created");
    if (input.notify !== false) {
      // Best-effort; never blocks the appointment write.
      void notifyVideoLink(input.appointmentId, input.tenantId, link, "videoLinkIssued").catch((e) =>
        console.error("[Video][notify] issue failed:", e?.message),
      );
    }
    return { room, joinLink: link };
  }

  if (action === "cancel" && existing) {
    try {
      const room = await transitionRoom(existing.id, "cancel", {
        tenantId: input.tenantId,
        appointmentId: input.appointmentId,
        endReason: "cancelled",
        detail: "mode_changed_to_in_person",
      });
      return { room, joinLink: null };
    } catch (e: any) {
      console.error("[Video][sync] cancel failed:", e?.message);
      return { room: existing, joinLink: null };
    }
  }

  return { room: existing, joinLink: null };
}

/**
 * Sends the patient join link through the appointment notification pipeline.
 * Imported lazily to avoid a cycle and to keep this module free of the WhatsApp
 * client at import time.
 */
export async function notifyVideoLink(
  appointmentId: string,
  tenantId: string,
  joinLink: string,
  kind: "videoLinkIssued" | "videoLinkReissued",
): Promise<void> {
  const appt = await loadAppointmentForVideo(appointmentId, tenantId);
  if (!appt) return;
  const { sendAppointmentNotification, sendVideoLinkEmail } = await import("./appointment-notify");
  const dateTime = appt.dateTime instanceof Date ? appt.dateTime : new Date(appt.dateTime);
  await sendAppointmentNotification(tenantId, appt.phone, kind, {
    name: appt.name,
    clinicName: appt.clinicName,
    doctorName: appt.doctorName,
    dateTime,
    joinLink,
  });
  if (appt.email) {
    try {
      await sendVideoLinkEmail(appt.email, {
        name: appt.name,
        clinicName: appt.clinicName,
        doctorName: appt.doctorName,
        dateTime,
        joinLink,
      });
    } catch (e: any) {
      console.error("[Video][notify] email failed:", e?.message);
      await recordAudit(
        (await loadRoomByAppointment(appointmentId, tenantId))?.id ?? "",
        "notification_failed",
        "email",
        undefined,
        tenantId,
        appointmentId,
      );
    }
  }
}


/**
 * Whether a TENANT is eligible for video consultations at all — profession is
 * healthcare, plan includes video, and the subscription is active. Role is not
 * considered here: this answers "does this workspace have the capability",
 * which is the correct gate for booking flows where the actor may be a patient
 * (Req 3.4). Staff console operation is separately gated by requireVideoOperator.
 */
export async function isTenantVideoEligible(tenantId: string): Promise<boolean> {
  const u = await queryOne<any>(
    `SELECT profession, subscriptionPlan, subscriptionStatus, subscriptionExpiresAt FROM User WHERE tenantId = ? LIMIT 1`,
    [tenantId],
  );
  if (!u) return false;
  const expires =
    u.subscriptionExpiresAt instanceof Date
      ? u.subscriptionExpiresAt.toISOString()
      : u.subscriptionExpiresAt ?? null;
  return canOperateFeature(
    {
      role: "admin",
      profession: u.profession,
      subscriptionPlan: u.subscriptionPlan,
      subscriptionStatus: u.subscriptionStatus,
      subscriptionExpiresAt: expires,
      isActive: true,
    },
    "video",
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Ad-hoc meetings — instant and scheduled-by-link rooms with no Appointment.
//
// These share the whole existing machinery (state machine, signalling, tokens,
// audit) and differ only in that `appointmentId` is NULL, `kind` is 'instant',
// and the human-facing identity is a short `meetingCode` instead of a booking.
// ─────────────────────────────────────────────────────────────────────────────

/** Human-friendly meeting code, Google-Meet shaped: abc-defg-hij. */
export function generateMeetingCode(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789"; // no l/1/0/o
  const pick = (n: number) =>
    Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}

export interface CreateInstantRoomInput {
  tenantId: string;
  hostAccountId: string;
  doctorId?: string | null;
  title?: string | null;
  /** null / omitted => start now. */
  scheduledAt?: Date | null;
  guestName?: string | null;
  guestPhone?: string | null;
  guestEmail?: string | null;
  /** Skip the waiting room (host is present and expecting the guest). */
  autoAdmit?: boolean;
  /** How long the link stays usable, in minutes, from now or from scheduledAt. */
  windowAfterMinutes?: number;
}

/**
 * Creates an ad-hoc room plus its first join link.
 *
 * The join window is materialised the same way as for appointments so the
 * sweeper, lazy expiry, and token validation all behave identically. For an
 * instant meeting the window opens immediately.
 */
export async function createInstantVideoRoom(
  input: CreateInstantRoomInput,
): Promise<{ room: VideoRoomRow; joinLink: string; meetingCode: string }> {
  const cfg = readVideoConfig();
  const now = Date.now();
  const startMs = input.scheduledAt ? input.scheduledAt.getTime() : now;
  const isInstant = !input.scheduledAt;
  // Approval-by-default; auto-admit must be requested explicitly.
  const autoAdmit = input.autoAdmit === true;

  // Instant meetings open right away; scheduled links honour the normal lead-in.
  const opensAt = isInstant ? now : startMs - cfg.beforeMinutes * 60_000;
  const afterMinutes = input.windowAfterMinutes ?? Math.max(cfg.afterMinutes, 240);
  const closesAt = startMs + afterMinutes * 60_000;

  const id = randomUUID();
  let meetingCode = generateMeetingCode();

  // Retry on the (vanishingly unlikely) code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await execute(
        `INSERT INTO VideoRoom
           (id, tenantId, appointmentId, doctorId, state, joinOpensAt, joinClosesAt, noticeVersion,
            kind, title, meetingCode, scheduledAt, hostAccountId, guestName, guestPhone, guestEmail, autoAdmit)
         VALUES (?, ?, NULL, ?, 'scheduled', ?, ?, ?, 'instant', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.tenantId,
          input.doctorId ?? null,
          new Date(opensAt),
          new Date(closesAt),
          cfg.noticeVersion,
          input.title ?? (isInstant ? "Instant consultation" : "Scheduled consultation"),
          meetingCode,
          input.scheduledAt ?? null,
          input.hostAccountId,
          input.guestName ?? null,
          input.guestPhone ?? null,
          input.guestEmail ?? null,
          autoAdmit ? 1 : 0,
        ],
      );
      break;
    } catch (err: any) {
      if (String(err?.message ?? "").includes("uq_room_code") && attempt < 4) {
        meetingCode = generateMeetingCode();
        continue;
      }
      throw err;
    }
  }

  const room = await loadRoomRaw(id, input.tenantId);
  if (!room) throw new Error("Failed to create meeting");

  const { link } = await issueJoinToken(room.id, input.tenantId, "created");
  await recordAudit(room.id, "state_change", isInstant ? "instant_created" : "scheduled_created", "doctor", input.tenantId, null);

  return { room, joinLink: link, meetingCode };
}

/** Lists ad-hoc meetings for a tenant (most recent first). */
export async function listInstantRooms(tenantId: string, hostAccountId: string | null, isAdmin: boolean): Promise<any[]> {
  const params: any[] = [tenantId];
  // The ad-hoc columns are NOT part of VIDEO_ROOM_COLUMNS, so they have to be
  // selected explicitly — the row mapping below reads every one of them.
  let sql = `SELECT ${VIDEO_ROOM_COLUMNS},
                    r.kind, r.title, r.meetingCode, r.scheduledAt,
                    r.guestName, r.guestPhone, r.guestEmail, r.autoAdmit
             FROM VideoRoom r WHERE r.tenantId = ? AND r.kind = 'instant'`;
  if (!isAdmin && hostAccountId) {
    sql += ` AND r.hostAccountId = ?`;
    params.push(hostAccountId);
  }
  sql += ` ORDER BY COALESCE(r.scheduledAt, r.createdAt) DESC LIMIT 100`;
  const rows = await queryScoped<any>(sql, params);
  return rows.map((r) => ({
    ...mapVideoRoomRow(r),
    kind: r.kind,
    title: r.title,
    meetingCode: r.meetingCode,
    scheduledAt: r.scheduledAt,
    guestName: r.guestName,
    guestPhone: r.guestPhone,
    guestEmail: r.guestEmail,
    autoAdmit: Number(r.autoAdmit ?? 0),
  }));
}

/** Loads the ad-hoc extras that `VideoRoomRow` does not carry. */
export async function loadRoomExtras(roomId: string, tenantId: string): Promise<{
  kind: string;
  title: string | null;
  meetingCode: string | null;
  scheduledAt: Date | string | null;
  guestName: string | null;
  guestPhone: string | null;
  guestEmail: string | null;
  autoAdmit: boolean;
  hostAccountId: string | null;
} | null> {
  const r = await queryOne<any>(
    `SELECT kind, title, meetingCode, scheduledAt, guestName, guestPhone, guestEmail, autoAdmit, hostAccountId
     FROM VideoRoom WHERE id = ? AND tenantId = ? LIMIT 1`,
    [roomId, tenantId],
  );
  if (!r) return null;
  return {
    kind: String(r.kind ?? "appointment"),
    title: r.title ?? null,
    meetingCode: r.meetingCode ?? null,
    scheduledAt: r.scheduledAt ?? null,
    guestName: r.guestName ?? null,
    guestPhone: r.guestPhone ?? null,
    guestEmail: r.guestEmail ?? null,
    autoAdmit: Number(r.autoAdmit ?? 0) === 1,
    hostAccountId: r.hostAccountId ?? null,
  };
}

/**
 * Sends an ad-hoc meeting link to a guest over WhatsApp and/or email.
 * Never throws — a delivery failure must not fail meeting creation.
 */
export async function notifyInstantMeetingLink(
  tenantId: string,
  room: VideoRoomRow,
  joinLink: string,
  guest: { name?: string | null; phone?: string | null; email?: string | null },
  scheduledAt: Date | null,
): Promise<void> {
  const clinicName = await resolveClinicNameSafe(tenantId);
  const doctorName = room.doctorId ? await resolveDoctorNameSafe(room.doctorId) : "";
  const when = scheduledAt ?? new Date();
  const kind = scheduledAt ? "videoLinkIssued" : "videoLinkIssued";

  try {
    const { sendAppointmentNotification, sendVideoLinkEmail } = await import("./appointment-notify");
    if (guest.phone) {
      await sendAppointmentNotification(tenantId, guest.phone, kind as any, {
        name: guest.name || "there",
        clinicName,
        doctorName,
        dateTime: when,
        joinLink,
      });
    }
    if (guest.email) {
      await sendVideoLinkEmail(guest.email, {
        name: guest.name || "there",
        clinicName,
        doctorName,
        dateTime: when,
        joinLink,
      });
    }
  } catch (err: any) {
    console.error("[Video][instant notify] failed:", err?.message);
    await recordAudit(room.id, "notification_failed", "instant_link", undefined, tenantId, null);
  }
}

async function resolveClinicNameSafe(tenantId: string): Promise<string> {
  try {
    const { resolveClinicName } = await import("./appointment-notify");
    return await resolveClinicName(tenantId);
  } catch {
    return "our clinic";
  }
}

async function resolveDoctorNameSafe(doctorId: string): Promise<string> {
  try {
    const { resolveDoctorName } = await import("./appointment-notify");
    return await resolveDoctorName(doctorId);
  } catch {
    return "";
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// View shaping and request helpers.
//
// These live here rather than in `video.ts` so that the server-function module
// contains ONLY `createServerFn` declarations. The TanStack compiler extracts
// every handler body into a separate split module, so keeping shared helpers
// out of that file keeps the extraction trivial and the split module small.
// ─────────────────────────────────────────────────────────────────────────────

/** `DATETIME`/`Date` → ISO string, or null when absent/unparsable. */
export function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Best-effort client key for rate limiting the patient token path (Req 6.12). */
export async function clientKeyFromRequest(): Promise<string> {
  try {
    const mod: any = await import("@tanstack/react-start/server");
    const h = typeof mod.getHeaders === "function" ? mod.getHeaders() : {};
    const fwd = (h["x-forwarded-for"] || "").toString();
    const ip = fwd.split(",")[0].trim() || (h["x-real-ip"] || "").toString().trim();
    return ip || "unknown";
  } catch {
    return "unknown";
  }
}

/** Hash of the caller's user agent, for the consent record. Never the raw value. */
export async function userAgentHash(): Promise<string | null> {
  try {
    const mod: any = await import("@tanstack/react-start/server");
    const h = typeof mod.getHeaders === "function" ? mod.getHeaders() : {};
    const ua = (h["user-agent"] || "").toString();
    return ua ? createHash("sha256").update(ua).digest("hex") : null;
  } catch {
    return null;
  }
}

/** Number of live (unrevoked) join tokens for a room. */
export async function activeLinkCount(roomId: string, tenantId: string): Promise<number> {
  const row = await queryOne<any>(
    `SELECT COUNT(*) AS c FROM VideoJoinToken WHERE roomId = ? AND tenantId = ? AND revokedAt IS NULL`,
    [roomId, tenantId],
  );
  return Number(row?.c ?? 0);
}

/** Shapes a participant row for the doctor UI (no signalling internals). */
export function publicParticipant(p: VideoParticipantRow) {
  return {
    id: p.id,
    role: p.role,
    displayName: p.displayName,
    displayAge: p.displayAge,
    status: p.status,
    peerState: p.peerState,
    micEnabled: p.micEnabled === 1,
    cameraEnabled: p.cameraEnabled === 1,
    quality: p.quality,
    joinedAt: toIso(p.joinedAt),
    admittedAt: toIso(p.admittedAt),
    leftAt: toIso(p.leftAt),
  };
}

/** Full doctor-facing room view. */
export async function buildDoctorRoomView(room: VideoRoomRow, user: SessionUser) {
  const { readTurnConfig, isTurnConfigured } = await import("./video-turn.server");
  const [participants, appt, linkCount] = await Promise.all([
    loadParticipants(room.id, user.tenantId),
    room.appointmentId ? loadAppointmentForVideo(room.appointmentId, user.tenantId) : Promise.resolve(null),
    activeLinkCount(room.id, user.tenantId),
  ]);
  const waiting = participants.filter((p) => p.role === "patient" && p.status === "requested").map(publicParticipant);
  const cfg = readTurnConfig();
  return {
    room: {
      id: room.id,
      appointmentId: room.appointmentId,
      state: room.state,
      joinOpensAt: toIso(room.joinOpensAt),
      joinClosesAt: toIso(room.joinClosesAt),
      admittedParticipantId: room.admittedParticipantId,
      endReason: room.endReason,
      outcome: room.outcome,
      connectedSeconds: room.connectedSeconds,
      noticeVersion: room.noticeVersion,
    },
    participants: participants.map(publicParticipant),
    waiting,
    appointment: appt
      ? {
          name: appt.name,
          dateTime: toIso(appt.dateTime),
          doctorName: appt.doctorName,
          clinicName: appt.clinicName,
          patientId: appt.patientId,
          consultationMode: appt.consultationMode,
        }
      : null,
    turnConfigured: isTurnConfigured(cfg),
    linkActive: linkCount > 0,
  };
}

/** Loads the patient participant row for a room, if one exists. */
export async function loadPatientParticipant(
  roomId: string,
  tenantId: string,
): Promise<VideoParticipantRow | null> {
  const pKey = patientParticipantKey(roomId);
  const row = await queryOne<any>(
    `SELECT * FROM VideoParticipant WHERE roomId = ? AND tenantId = ? AND participantKey = ? LIMIT 1`,
    [roomId, tenantId, pKey],
  );
  return row ? mapParticipantRow(row) : null;
}

/** Marks a participant admitted (idempotent). */
export async function markAdmitted(participantId: string, tenantId: string): Promise<void> {
  await execute(
    `UPDATE VideoParticipant SET status = 'admitted', admittedAt = COALESCE(admittedAt, NOW(3)) WHERE id = ? AND tenantId = ?`,
    [participantId, tenantId],
  );
}

/** Derives the patient-facing status label from the room and participant. */
export function patientStatusFrom(
  room: VideoRoomRow,
  participant: VideoParticipantRow | null,
): "waiting" | "admitted" | "declined" | "active" | "ended" | "expired" {
  if (room.state === "ended") return "ended";
  if (room.state === "expired" || room.state === "cancelled") return "expired";
  if (participant?.status === "removed") return "declined";
  if (room.state === "active" && participant?.status === "admitted") return "active";
  if (participant?.status === "admitted") return "admitted";
  return "waiting";
}

/**
 * The four facts a patient may see, resolved for either room kind.
 *
 * Appointment rooms read them from the booking; ad-hoc rooms have no
 * Appointment row, so the clinic comes from the tenant and the time from the
 * room's own `scheduledAt` (null for an instant meeting).
 */
export async function patientFactsFor(room: VideoRoomRow): Promise<{
  clinicName: string | null;
  doctorName: string | null;
  appointmentAt: string | null;
}> {
  if (room.appointmentId) {
    const appt = await loadAppointmentForVideo(room.appointmentId, room.tenantId);
    return {
      clinicName: appt?.clinicName ?? null,
      doctorName: appt?.doctorName ?? null,
      appointmentAt: toIso(appt?.dateTime ?? null),
    };
  }
  const [extras, clinic, doctor] = await Promise.all([
    loadRoomExtras(room.id, room.tenantId),
    queryOne<any>(`SELECT clinicName FROM User WHERE tenantId = ? LIMIT 1`, [room.tenantId]),
    room.doctorId
      ? queryOne<any>(`SELECT name FROM Doctor WHERE id = ? LIMIT 1`, [room.doctorId])
      : Promise.resolve(null),
  ]);
  return {
    clinicName: clinic?.clinicName ?? null,
    doctorName: doctor?.name ?? null,
    appointmentAt: toIso(extras?.scheduledAt ?? null),
  };
}

/** Audit kinds a client may report. Anything else collapses to `state_change`. */
const ALLOWED_EVENT_KINDS = new Set([
  "joined",
  "left",
  "reconnecting",
  "reconnected",
  "ice_restart",
  "connection_failed",
  "connection_lost",
  "quality",
  "mic_toggle",
  "camera_toggle",
]);

/** Whitelists the audit kind so arbitrary strings never reach the audit row. */
export function sanitizeEventKind(kind: string): string {
  return ALLOWED_EVENT_KINDS.has(kind) ? kind : "state_change";
}

/** True for the three terminal room states. */
export function isTerminalStateName(s: string): boolean {
  return s === "ended" || s === "expired" || s === "cancelled";
}

/** Extracts just host[:port] from a turn:/turns:/stun: URL, for display. */
export function safeHostOf(url: string): string {
  const m = /^(?:stun|stuns|turn|turns):([^?]+)/i.exec(url.trim());
  return m ? m[1] : "";
}

/**
 * Tracks the cumulative disconnected budget on a room and ends the call once it
 * exceeds the 60s ceiling (Req 10.5). Returns the resulting room state.
 */
export async function maybeEndForDisconnect(
  room: VideoRoomRow,
  kind: string,
  tenantId: string,
): Promise<string> {
  const now = Date.now();

  if (kind === "reconnecting" || kind === "connection_lost" || kind === "connection_failed") {
    const fresh = await loadRoomForRead(room.id, tenantId);
    const since = fresh.disconnectedSinceAt ? new Date(fresh.disconnectedSinceAt as any).getTime() : null;
    const total = fresh.disconnectedTotalMs + (since ? now - since : 0);
    if (since === null) {
      await execute(`UPDATE VideoRoom SET disconnectedSinceAt = NOW(3) WHERE id = ? AND tenantId = ?`, [
        room.id,
        tenantId,
      ]);
    }
    if (shouldEndForDisconnect(total) && fresh.state === "active") {
      const updated = await transitionRoom(room.id, "end", {
        tenantId,
        appointmentId: room.appointmentId,
        endReason: "connection_lost",
        detail: "disconnect_budget_exceeded",
      });
      return updated.state;
    }
    return fresh.state;
  }

  if (kind === "reconnected") {
    const fresh = await loadRoomForRead(room.id, tenantId);
    const since = fresh.disconnectedSinceAt ? new Date(fresh.disconnectedSinceAt as any).getTime() : null;
    if (since !== null) {
      await execute(
        `UPDATE VideoRoom SET disconnectedTotalMs = disconnectedTotalMs + ?, disconnectedSinceAt = NULL WHERE id = ? AND tenantId = ?`,
        [Math.max(0, now - since), room.id, tenantId],
      );
    }
    return fresh.state;
  }

  return room.state;
}

/** Records a consent acknowledgement for a room (idempotent per notice version). */
export async function recordConsent(room: VideoRoomRow): Promise<void> {
  const uaHash = await userAgentHash();
  await execute(
    `INSERT INTO VideoConsent (id, tenantId, roomId, appointmentId, noticeVersion, tokenVersion, userAgentHash)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE acknowledgedAt = NOW(3), userAgentHash = VALUES(userAgentHash)`,
    [randomUUID(), room.tenantId, room.id, room.appointmentId, room.noticeVersion, 1, uaHash],
  );
}

/** True when a consent row exists for the room (Req 12.3). */
export async function hasConsent(room: VideoRoomRow): Promise<boolean> {
  const row = await queryOne<any>(
    `SELECT id FROM VideoConsent WHERE roomId = ? AND tenantId = ? LIMIT 1`,
    [room.id, room.tenantId],
  );
  return !!row;
}


// ─────────────────────────────────────────────────────────────────────────────
// Token resolution wrappers and small room operations used by the server
// function surface. Keeping these here means `video.ts` holds only
// `createServerFn` declarations.
// ─────────────────────────────────────────────────────────────────────────────

/** Non-throwing token resolution, for read paths that return a redacted status. */
export async function resolveJoinTokenSoft(
  token: string,
  clientKey: string,
): Promise<{ ok: true; value: ResolvedToken } | { ok: false; status: ResolveTokenFailure }> {
  return await resolveJoinToken(token, clientKey);
}

/**
 * Throwing token resolution for write paths. The thrown messages are sentinels
 * the patient UI maps onto its terminal states; none of them disclose any
 * appointment, patient, or tenant detail (Req 6.6).
 */
export async function resolveJoinTokenOrThrow(token: string, clientKey: string): Promise<ResolvedToken> {
  const res = await resolveJoinToken(token, clientKey);
  if (!res.ok) {
    if (res.status === "rate_limited") throw new Error("RATE_LIMITED");
    if (res.status === "expired") throw new Error("EXPIRED_LINK");
    if (res.status === "ended") throw new Error("ENDED_LINK");
    throw new Error("INVALID_LINK");
  }
  return res.value;
}

/**
 * Loads a participant either by id or by participant key, always tenant- and
 * room-scoped.
 */
export async function loadParticipantById(
  participantId: string | null,
  roomId: string,
  tenantId: string,
  participantKey?: string,
): Promise<VideoParticipantRow | null> {
  const row = participantId
    ? await queryOne<any>(
        `SELECT * FROM VideoParticipant WHERE id = ? AND roomId = ? AND tenantId = ? LIMIT 1`,
        [participantId, roomId, tenantId],
      )
    : participantKey
      ? await queryOne<any>(
          `SELECT * FROM VideoParticipant WHERE participantKey = ? AND roomId = ? AND tenantId = ? LIMIT 1`,
          [participantKey, roomId, tenantId],
        )
      : null;
  return row ? mapParticipantRow(row) : null;
}

/**
 * Registers the host as the doctor participant and, for an auto-admit room,
 * promotes a guest who is already waiting so they connect immediately.
 * Returns the resulting room state.
 */
export async function registerHostParticipant(room: VideoRoomRow, user: SessionUser): Promise<string> {
  await upsertParticipant({
    tenantId: user.tenantId,
    roomId: room.id,
    role: "doctor",
    participantKey: doctorParticipantKey(user.id),
    accountId: user.id,
    displayName: user.name ?? "Doctor",
    status: "admitted",
  });
  await recordAudit(room.id, "joined", "host_joined", "doctor", user.tenantId, room.appointmentId);

  const extras = await loadRoomExtras(room.id, user.tenantId);
  if (!extras?.autoAdmit) return room.state;

  const participants = await loadParticipants(room.id, user.tenantId);
  const waitingGuest = participants.find((p) => p.role === "patient" && p.status === "requested");
  if (!waitingGuest || room.state !== "waiting") return room.state;

  try {
    const updated = await transitionRoom(room.id, "admit", {
      tenantId: user.tenantId,
      appointmentId: room.appointmentId,
      actorRole: "doctor",
      detail: "auto_admitted",
      participantId: waitingGuest.id,
    });
    await markAdmitted(waitingGuest.id, user.tenantId);
    return updated.state;
  } catch {
    return room.state;
  }
}

/** Ends an active/waiting room on the doctor's behalf. */
export async function endRoomAsDoctor(
  room: VideoRoomRow,
  tenantId: string,
  reason?: string,
): Promise<{ roomState: string; connectedSeconds: number; outcome: string | null }> {
  if (room.state !== "active" && room.state !== "waiting") {
    return { roomState: room.state, connectedSeconds: room.connectedSeconds, outcome: room.outcome };
  }
  const endReason = reason === "connection_lost" ? "connection_lost" : "doctor_ended";
  const updated = await transitionRoom(room.id, "end", {
    tenantId,
    appointmentId: room.appointmentId,
    actorRole: "doctor",
    endReason,
    detail: endReason,
  });
  return { roomState: updated.state, connectedSeconds: updated.connectedSeconds, outcome: updated.outcome };
}

/** Cancels an ad-hoc meeting on the host's behalf. */
export async function cancelRoomForHost(room: VideoRoomRow, tenantId: string): Promise<{ roomState: string }> {
  if (isTerminalStateName(room.state)) return { roomState: room.state };
  const updated = await transitionRoom(room.id, "cancel", {
    tenantId,
    appointmentId: room.appointmentId,
    actorRole: "doctor",
    endReason: "cancelled",
    detail: "host_cancelled",
  });
  return { roomState: updated.state };
}
