/**
 * video-consultation.ts
 *
 * Pure, isomorphic decision logic for the video consultation feature.
 *
 * This module performs NO I/O, imports nothing from the database, auth, or
 * `crypto`, and runs identically on the client and the server. It is the single
 * source of truth for:
 *   - the Video_Room state machine (Req 4)
 *   - join-window computation and evaluation (Req 6.4, 6.5)
 *   - signal ordering / filtering by sequence position (Req 7.3, 7.4)
 *   - signal payload validation (Req 7.11)
 *   - call outcome classification (Req 15.2-15.6, 15.9)
 *   - connection-quality classification (Req 10.1)
 *   - polling cadence and stop conditions (Req 7.7-7.9)
 *   - consultation-mode normalization and room-sync planning (Req 3)
 *   - token scope, rate limiting, and the patient projection (Req 6)
 *
 * Because it is pure it is the primary target of the property-based test suite.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoomState = "scheduled" | "waiting" | "active" | "ended" | "expired" | "cancelled";
export type TransitionKind = "patient_arrived" | "admit" | "decline" | "end" | "expire" | "cancel";
export type ConsultationMode = "in_person" | "video";
export type SignalKind = "offer" | "answer" | "ice_candidate" | "renegotiate";
export type ParticipantRole = "doctor" | "patient";
export type ParticipantStatus = "requested" | "admitted" | "declined" | "left" | "removed";
export type CallOutcome = "completed" | "abandoned" | "patient_no_show" | "doctor_no_show" | "cancelled";
export type EndReason =
  | "doctor_ended"
  | "patient_ended"
  | "participant_removed"
  | "connection_lost"
  | "cancelled"
  | "expired";
export type QualityLevel = "good" | "fair" | "poor";
export type JoinWindowVerdict = "early" | "open" | "closed";
export type PeerState = "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ROOM_STATES: readonly RoomState[] = [
  "scheduled",
  "waiting",
  "active",
  "ended",
  "expired",
  "cancelled",
] as const;

export const TERMINAL_ROOM_STATES: readonly RoomState[] = ["ended", "expired", "cancelled"] as const;

export const CONSULTATION_MODES: readonly ConsultationMode[] = ["in_person", "video"] as const;

export const SIGNAL_KINDS: readonly SignalKind[] = ["offer", "answer", "ice_candidate", "renegotiate"] as const;

/** Maximum signal payload size in bytes (Req 7.11). */
export const MAX_SIGNAL_PAYLOAD_BYTES = 64 * 1024;

/** Setup-path polling cadence ceiling in ms (Req 7.7). */
export const SETUP_POLL_INTERVAL_MS = 2000;

/** Cumulative disconnected budget before a room is force-ended (Req 10.5). */
export const DISCONNECT_END_BUDGET_MS = 60_000;

/** Sliding rate-limit window and cap for failed join attempts (Req 6.12). */
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_ATTEMPTS = 10;

/**
 * The single encoding of the Video_Room state diagram. Any transition not
 * present here is not permitted. Terminal states have no outgoing edges.
 *
 *   scheduled --patient_arrived--> waiting
 *   scheduled --expire----------> expired
 *   scheduled --cancel----------> cancelled
 *   waiting   --admit-----------> active
 *   waiting   --decline---------> waiting   (records a decision, stays waiting)
 *   waiting   --expire----------> expired
 *   waiting   --cancel----------> cancelled
 *   active    --end-------------> ended
 *   active    --cancel----------> cancelled
 */
export const ROOM_TRANSITIONS: Record<RoomState, Partial<Record<TransitionKind, RoomState>>> = {
  scheduled: {
    patient_arrived: "waiting",
    expire: "expired",
    cancel: "cancelled",
  },
  waiting: {
    admit: "active",
    decline: "waiting",
    expire: "expired",
    cancel: "cancelled",
  },
  active: {
    end: "ended",
    cancel: "cancelled",
  },
  ended: {},
  expired: {},
  cancelled: {},
};

// ---------------------------------------------------------------------------
// State machine (Req 4)
// ---------------------------------------------------------------------------

export function isTerminalRoomState(s: RoomState): boolean {
  return TERMINAL_ROOM_STATES.includes(s);
}

export function canTransition(from: RoomState, kind: TransitionKind): boolean {
  const edge = ROOM_TRANSITIONS[from]?.[kind];
  return edge !== undefined;
}

export type TransitionResult =
  | { ok: true; next: RoomState }
  | { ok: false; next: RoomState; reason: "terminal" | "not_permitted" };

export function applyTransition(from: RoomState, kind: TransitionKind): TransitionResult {
  if (isTerminalRoomState(from)) {
    return { ok: false, next: from, reason: "terminal" };
  }
  const next = ROOM_TRANSITIONS[from]?.[kind];
  if (next === undefined) {
    return { ok: false, next: from, reason: "not_permitted" };
  }
  return { ok: true, next };
}

// ---------------------------------------------------------------------------
// Join window (Req 6.4, 6.5)
// ---------------------------------------------------------------------------

export interface JoinWindowConfig {
  beforeMinutes: number;
  afterMinutes: number;
}

export interface JoinWindow {
  opensAt: number; // epoch ms
  closesAt: number; // epoch ms
}

export function computeJoinWindow(appointmentAt: number, cfg: JoinWindowConfig): JoinWindow {
  const before = Math.max(0, cfg.beforeMinutes) * 60_000;
  const after = Math.max(0, cfg.afterMinutes) * 60_000;
  return {
    opensAt: appointmentAt - before,
    closesAt: appointmentAt + after,
  };
}

export function evaluateJoinWindow(nowMs: number, w: JoinWindow): JoinWindowVerdict {
  if (nowMs < w.opensAt) return "early";
  if (nowMs > w.closesAt) return "closed";
  return "open";
}

// ---------------------------------------------------------------------------
// Signal ordering and validation (Req 7.3, 7.4, 7.11)
// ---------------------------------------------------------------------------

export interface SignalRecord {
  seq: number;
  kind: SignalKind;
  senderRole: ParticipantRole;
  payload: string;
}

/**
 * Returns signals for the given reader, strictly after the cursor sequence
 * position, in ascending seq order. A participant only wants messages from the
 * OTHER role (its own were echoed back would be noise), so same-role messages
 * are filtered out.
 */
export function selectSignalsAfter(all: SignalRecord[], cursor: number, forRole: ParticipantRole): SignalRecord[] {
  return all
    .filter((s) => s.seq > cursor && s.senderRole !== forRole)
    .sort((a, b) => a.seq - b.seq);
}

/** The new cursor after consuming a batch: the max seq seen, or the old cursor. */
export function nextCursor(selected: SignalRecord[], cursor: number): number {
  let max = cursor;
  for (const s of selected) {
    if (s.seq > max) max = s.seq;
  }
  return max;
}

export function validateSignalPayload(
  kind: string,
  payload: string
):
  | { ok: true; kind: SignalKind }
  | { ok: false; reason: "unknown_kind" | "too_large" | "empty" } {
  if (!SIGNAL_KINDS.includes(kind as SignalKind)) {
    return { ok: false, reason: "unknown_kind" };
  }
  if (payload === null || payload === undefined || payload.length === 0) {
    return { ok: false, reason: "empty" };
  }
  // Byte length, not character count — multi-byte SDP must not slip past.
  const bytes = utf8ByteLength(payload);
  if (bytes > MAX_SIGNAL_PAYLOAD_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true, kind: kind as SignalKind };
}

/** UTF-8 byte length without depending on Buffer/TextEncoder availability. */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate — a full code point is 4 bytes; consume the low surrogate.
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Outcome classification (Req 15.2-15.6, 15.9)
// ---------------------------------------------------------------------------

export interface OutcomeInput {
  terminalState: Extract<RoomState, "ended" | "expired" | "cancelled">;
  patientEverAdmitted: boolean;
  patientEverWaited: boolean;
  admissionDecisionRecorded: boolean;
  connectedSeconds: number;
  existingOutcome: CallOutcome | null;
}

/**
 * Deterministic and idempotent. Precedence, highest first:
 *   1. an already-recorded outcome is never overwritten (Req 15.6)
 *   2. expired + a patient waited + no admission decision => doctor_no_show (15.4)
 *   3. expired (otherwise)                                => patient_no_show (15.3)
 *   4. ended + 0 connected seconds                        => abandoned       (15.5)
 *   5. ended + >0 connected seconds                       => completed       (15.9)
 *   6. cancelled                                          => cancelled       (3.7, 3.8)
 */
export function classifyOutcome(i: OutcomeInput): CallOutcome {
  if (i.existingOutcome !== null && i.existingOutcome !== undefined) {
    return i.existingOutcome;
  }
  if (i.terminalState === "expired") {
    if (i.patientEverWaited && !i.admissionDecisionRecorded) {
      return "doctor_no_show";
    }
    return "patient_no_show";
  }
  if (i.terminalState === "cancelled") {
    return "cancelled";
  }
  // ended
  if (i.connectedSeconds > 0) {
    return "completed";
  }
  return "abandoned";
}

// ---------------------------------------------------------------------------
// Connection quality (Req 10.1)
// ---------------------------------------------------------------------------

export interface QualitySample {
  rttMs: number | null;
  packetLossPct: number | null;
  jitterMs: number | null;
}

/**
 * Total and monotonic: worsening any single metric never improves the level.
 * Missing metrics are treated optimistically (a null does not by itself drag
 * the level down), but any present metric in the "poor" band forces "poor".
 */
export function classifyQuality(s: QualitySample): QualityLevel {
  const rtt = s.rttMs;
  const loss = s.packetLossPct;
  const jitter = s.jitterMs;

  const poor =
    (rtt !== null && rtt > 400) ||
    (loss !== null && loss > 5) ||
    (jitter !== null && jitter > 100);
  if (poor) return "poor";

  const fair =
    (rtt !== null && rtt > 200) ||
    (loss !== null && loss > 2) ||
    (jitter !== null && jitter > 40);
  if (fair) return "fair";

  return "good";
}

// ---------------------------------------------------------------------------
// Polling cadence (Req 7.7-7.9)
// ---------------------------------------------------------------------------

export function shouldStopPolling(roomState: RoomState, localPeer: PeerState, remotePeer: PeerState): boolean {
  return roomState === "active" && localPeer === "connected" && remotePeer === "connected";
}

/**
 * Returns the delay before the next poll in ms, or null to stop polling.
 * - Stops once the call is genuinely up (Req 7.8).
 * - Never stops while a non-terminal room has not connected, however long that
 *   takes (Req 7.9).
 * - Never exceeds the 2s setup cadence on the happy path (Req 7.7); backs off
 *   only on consecutive transport errors to protect the server.
 */
export function nextPollDelayMs(i: {
  roomState: RoomState;
  localPeer: PeerState;
  remotePeer: PeerState;
  consecutiveErrors: number;
}): number | null {
  if (isTerminalRoomState(i.roomState)) return null;
  if (shouldStopPolling(i.roomState, i.localPeer, i.remotePeer)) return null;

  if (i.consecutiveErrors > 0) {
    // 2s, 4s, 8s, capped at 15s — protects the server from a hammering client
    // while never abandoning the call.
    const backoff = SETUP_POLL_INTERVAL_MS * Math.pow(2, Math.min(i.consecutiveErrors, 3));
    return Math.min(backoff, 15_000);
  }
  return SETUP_POLL_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// Consultation mode and room sync (Req 3)
// ---------------------------------------------------------------------------

export function normalizeConsultationMode(
  v: unknown
): { ok: true; mode: ConsultationMode } | { ok: false; reason: "invalid" } {
  if (typeof v !== "string") return { ok: false, reason: "invalid" };
  const trimmed = v.trim().toLowerCase();
  if (trimmed === "in_person") return { ok: true, mode: "in_person" };
  if (trimmed === "video") return { ok: true, mode: "video" };
  return { ok: false, reason: "invalid" };
}

export type RoomSyncAction = "create" | "cancel" | "none";

/**
 * Plans the room-lifecycle side effect of an appointment mode change.
 * - create: target is video and no room exists yet (Req 3.3, 3.6)
 * - cancel: target is in_person and a non-terminal room exists (Req 3.7)
 * - none:   everything else, including idempotent re-saves (Req 4.2)
 */
export function planRoomSyncForModeChange(i: {
  from: ConsultationMode | null;
  to: ConsultationMode;
  hasRoom: boolean;
  roomState: RoomState | null;
}): RoomSyncAction {
  if (i.to === "video") {
    return i.hasRoom ? "none" : "create";
  }
  // to === "in_person"
  if (i.hasRoom && i.roomState !== null && !isTerminalRoomState(i.roomState)) {
    return "cancel";
  }
  return "none";
}

// ---------------------------------------------------------------------------
// Disconnect budget, token scope (Req 10.5, 6.10)
// ---------------------------------------------------------------------------

export function shouldEndForDisconnect(totalDisconnectedMs: number): boolean {
  return totalDisconnectedMs >= DISCONNECT_END_BUDGET_MS;
}

export function isTokenScopedTo(tokenRoomId: string, requestedRoomId: string, tokenRevoked: boolean): boolean {
  if (tokenRevoked) return false;
  return tokenRoomId === requestedRoomId;
}

// ---------------------------------------------------------------------------
// Rate limiting (Req 6.12)
// ---------------------------------------------------------------------------

export interface RateLimitState {
  hits: number[]; // epoch ms of failed attempts
}

/**
 * Sliding-window limiter. Records the attempt at nowMs, prunes hits older than
 * the window, and allows only while at most RATE_LIMIT_MAX_ATTEMPTS fall inside
 * the window. The 11th failed attempt within 60s is rejected.
 */
export function evaluateRateLimit(
  state: RateLimitState,
  nowMs: number
): { allowed: boolean; state: RateLimitState } {
  const cutoff = nowMs - RATE_LIMIT_WINDOW_MS;
  const recent = (state.hits ?? []).filter((t) => t > cutoff);
  recent.push(nowMs);
  const allowed = recent.length <= RATE_LIMIT_MAX_ATTEMPTS;
  return { allowed, state: { hits: recent } };
}

// ---------------------------------------------------------------------------
// Patient projection (Req 6.6, 6.11)
// ---------------------------------------------------------------------------

export type PatientStatus =
  | "waiting"
  | "admitted"
  | "declined"
  | "active"
  | "ended"
  | "expired"
  | "invalid"
  | "rate_limited";

/** The ONLY fields a patient may ever see. Enforced by construction. */
export interface PatientRoomProjection {
  status: PatientStatus;
  clinicName: string | null;
  doctorName: string | null;
  appointmentAt: string | null;
  noticeVersion: string;
}

/**
 * Builds the patient-facing projection from an internal room view. The returned
 * object has EXACTLY the PatientRoomProjection keys and never carries patient
 * PII, reason, or any internal identifier (Req 6.6, 6.11).
 */
export function projectForPatient(i: {
  status: PatientStatus;
  clinicName?: string | null;
  doctorName?: string | null;
  appointmentAt?: string | null;
  noticeVersion?: string | null;
}): PatientRoomProjection {
  const redacted = i.status === "invalid" || i.status === "rate_limited";
  return {
    status: i.status,
    clinicName: redacted ? null : i.clinicName ?? null,
    doctorName: redacted ? null : i.doctorName ?? null,
    appointmentAt: redacted ? null : i.appointmentAt ?? null,
    noticeVersion: i.noticeVersion ?? "v1",
  };
}
