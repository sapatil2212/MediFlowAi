import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  ROOM_STATES,
  TERMINAL_ROOM_STATES,
  SIGNAL_KINDS,
  CONSULTATION_MODES,
  MAX_SIGNAL_PAYLOAD_BYTES,
  RATE_LIMIT_MAX_ATTEMPTS,
  SETUP_POLL_INTERVAL_MS,
  applyTransition,
  canTransition,
  isTerminalRoomState,
  computeJoinWindow,
  evaluateJoinWindow,
  selectSignalsAfter,
  nextCursor,
  validateSignalPayload,
  utf8ByteLength,
  classifyOutcome,
  classifyQuality,
  shouldStopPolling,
  nextPollDelayMs,
  normalizeConsultationMode,
  planRoomSyncForModeChange,
  isTokenScopedTo,
  evaluateRateLimit,
  projectForPatient,
  type RoomState,
  type TransitionKind,
  type SignalRecord,
  type SignalKind,
  type ParticipantRole,
  type QualitySample,
  type CallOutcome,
  type RateLimitState,
  type PeerState,
} from "./video-consultation";

// ---------------------------------------------------------------------------
// Generators built from the exported constants, so adding a state/kind without
// extending the maps fails the suite rather than silently passing.
// ---------------------------------------------------------------------------
const arbRoomState = fc.constantFrom<RoomState>(...ROOM_STATES);
const TRANSITION_KINDS: TransitionKind[] = [
  "patient_arrived",
  "admit",
  "decline",
  "end",
  "expire",
  "cancel",
];
const arbTransitionKind = fc.constantFrom<TransitionKind>(...TRANSITION_KINDS);
const arbSignalKind = fc.constantFrom<SignalKind>(...SIGNAL_KINDS);
const arbRole = fc.constantFrom<ParticipantRole>("doctor", "patient");
const PEER_STATES: PeerState[] = [
  "new",
  "connecting",
  "connected",
  "disconnected",
  "failed",
  "closed",
];
const arbPeerState = fc.constantFrom<PeerState>(...PEER_STATES);

// ===========================================================================
// Task 1.2 — Room state machine (Properties 1, 2, 3)
// ===========================================================================
describe("Property 1: terminal room states are absorbing", () => {
  it("every transition from a terminal state is rejected as terminal", () => {
    fc.assert(
      fc.property(fc.constantFrom(...TERMINAL_ROOM_STATES), arbTransitionKind, (s, kind) => {
        const r = applyTransition(s, kind);
        expect(r.ok).toBe(false);
        expect(r.next).toBe(s);
        if (!r.ok) expect(r.reason).toBe("terminal");
      }),
    );
  });

  it("no generated transition sequence can escape a terminal state", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TERMINAL_ROOM_STATES),
        fc.array(arbTransitionKind),
        (start, kinds) => {
          let state: RoomState = start;
          for (const k of kinds) {
            const r = applyTransition(state, k);
            state = r.next;
          }
          expect(isTerminalRoomState(state)).toBe(true);
          expect(state).toBe(start);
        },
      ),
    );
  });
});

describe("Property 2: a rejected transition is a no-op and agrees with canTransition", () => {
  it("rejected transitions leave next === from", () => {
    fc.assert(
      fc.property(arbRoomState, arbTransitionKind, (from, kind) => {
        const r = applyTransition(from, kind);
        if (!r.ok) expect(r.next).toBe(from);
      }),
    );
  });

  it("canTransition agrees with applyTransition(...).ok for non-terminal states", () => {
    fc.assert(
      fc.property(arbRoomState, arbTransitionKind, (from, kind) => {
        const r = applyTransition(from, kind);
        if (isTerminalRoomState(from)) {
          // canTransition reflects the edge map; applyTransition additionally
          // guards terminal states. They agree because terminal states have no edges.
          expect(canTransition(from, kind)).toBe(false);
          expect(r.ok).toBe(false);
        } else {
          expect(canTransition(from, kind)).toBe(r.ok);
        }
      }),
    );
  });
});

describe("Property 3: reachability respects the lifecycle", () => {
  it("folding any sequence from scheduled stays within ROOM_STATES", () => {
    fc.assert(
      fc.property(fc.array(arbTransitionKind), (kinds) => {
        let state: RoomState = "scheduled";
        for (const k of kinds) state = applyTransition(state, k).next;
        expect(ROOM_STATES).toContain(state);
      }),
    );
  });

  it("active is reachable only via admit from waiting", () => {
    fc.assert(
      fc.property(fc.array(arbTransitionKind), (kinds) => {
        let state: RoomState = "scheduled";
        let sawAdmitFromWaiting = false;
        for (const k of kinds) {
          if (state === "waiting" && k === "admit") sawAdmitFromWaiting = true;
          state = applyTransition(state, k).next;
        }
        if (state === "active") expect(sawAdmitFromWaiting).toBe(true);
      }),
    );
  });

  it("canonical paths", () => {
    // scheduled -> waiting -> active -> ended
    let s: RoomState = "scheduled";
    s = applyTransition(s, "patient_arrived").next;
    expect(s).toBe("waiting");
    s = applyTransition(s, "admit").next;
    expect(s).toBe("active");
    s = applyTransition(s, "end").next;
    expect(s).toBe("ended");
    // scheduled -> expired
    expect(applyTransition("scheduled", "expire").next).toBe("expired");
    // scheduled -> cancelled
    expect(applyTransition("scheduled", "cancel").next).toBe("cancelled");
    // decline keeps waiting
    expect(applyTransition("waiting", "decline").next).toBe("waiting");
  });
});

// ===========================================================================
// Task 1.3 — Join windows and signal delivery (Properties 4, 5, 6)
// ===========================================================================
describe("Property 4: join windows are ordered and evaluation is total", () => {
  it("opensAt <= appointmentAt <= closesAt", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        fc.integer({ min: 0, max: 1440 }),
        fc.integer({ min: 0, max: 1440 }),
        (appt, before, after) => {
          const w = computeJoinWindow(appt, { beforeMinutes: before, afterMinutes: after });
          expect(w.opensAt).toBeLessThanOrEqual(appt);
          expect(w.closesAt).toBeGreaterThanOrEqual(appt);
        },
      ),
    );
  });

  it("evaluateJoinWindow returns exactly one verdict per instant", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        fc.integer({ min: 0, max: 1440 }),
        fc.integer({ min: 0, max: 1440 }),
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        (appt, before, after, now) => {
          const w = computeJoinWindow(appt, { beforeMinutes: before, afterMinutes: after });
          const v = evaluateJoinWindow(now, w);
          if (now < w.opensAt) expect(v).toBe("early");
          else if (now > w.closesAt) expect(v).toBe("closed");
          else expect(v).toBe("open");
        },
      ),
    );
  });

  it("boundaries are inclusive of open", () => {
    const w = computeJoinWindow(1_000_000, { beforeMinutes: 30, afterMinutes: 120 });
    expect(evaluateJoinWindow(w.opensAt, w)).toBe("open");
    expect(evaluateJoinWindow(w.closesAt, w)).toBe("open");
    expect(evaluateJoinWindow(w.opensAt - 1, w)).toBe("early");
    expect(evaluateJoinWindow(w.closesAt + 1, w)).toBe("closed");
  });
});

describe("Property 5: signal delivery is ordered, gapless, and never repeats", () => {
  const arbSignals = fc.array(
    fc.record({
      seq: fc.integer({ min: 1, max: 1000 }),
      kind: arbSignalKind,
      senderRole: arbRole,
      payload: fc.string(),
    }),
    { maxLength: 50 },
  );

  it("selectSignalsAfter returns strictly ascending, seq > cursor, other-role only", () => {
    fc.assert(
      fc.property(
        arbSignals,
        fc.integer({ min: 0, max: 1000 }),
        arbRole,
        (all, cursor, forRole) => {
          // de-dup seq to model the DB uniqueness of (roomId, seq)
          const uniq = dedupeBySeq(all);
          const out = selectSignalsAfter(uniq, cursor, forRole);
          for (let k = 1; k < out.length; k++) expect(out[k].seq).toBeGreaterThan(out[k - 1].seq);
          for (const s of out) {
            expect(s.seq).toBeGreaterThan(cursor);
            expect(s.senderRole).not.toBe(forRole);
          }
        },
      ),
    );
  });

  it("iterating cursor delivers each record exactly once", () => {
    fc.assert(
      fc.property(arbSignals, arbRole, (all, forRole) => {
        const uniq = dedupeBySeq(all);
        const expected = uniq
          .filter((s) => s.senderRole !== forRole)
          .map((s) => s.seq)
          .sort((a, b) => a - b);
        const delivered: number[] = [];
        let cursor = 0;
        // Simulate polls that reveal signals incrementally.
        for (let reveal = 1; reveal <= 1000; reveal += 50) {
          const visible = uniq.filter((s) => s.seq <= reveal);
          const batch = selectSignalsAfter(visible, cursor, forRole);
          for (const b of batch) delivered.push(b.seq);
          cursor = nextCursor(batch, cursor);
        }
        // final sweep
        const batch = selectSignalsAfter(uniq, cursor, forRole);
        for (const b of batch) delivered.push(b.seq);
        expect(delivered.slice().sort((a, b) => a - b)).toEqual(expected);
        expect(new Set(delivered).size).toBe(delivered.length); // no repeats
      }),
    );
  });

  function dedupeBySeq(all: SignalRecord[]): SignalRecord[] {
    const m = new Map<number, SignalRecord>();
    for (const s of all) if (!m.has(s.seq)) m.set(s.seq, s);
    return [...m.values()];
  }
});

describe("Property 6: payload validation is a hard gate", () => {
  it("accepts only known kinds, rejects empty, gates on byte length", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (kind, payload) => {
        const r = validateSignalPayload(kind, payload);
        if (r.ok) {
          expect(SIGNAL_KINDS).toContain(r.kind);
          expect(payload.length).toBeGreaterThan(0);
          expect(utf8ByteLength(payload)).toBeLessThanOrEqual(MAX_SIGNAL_PAYLOAD_BYTES);
        }
      }),
    );
  });

  it("boundary: one byte over is rejected, at limit is accepted", () => {
    const atLimit = "a".repeat(MAX_SIGNAL_PAYLOAD_BYTES);
    const overLimit = "a".repeat(MAX_SIGNAL_PAYLOAD_BYTES + 1);
    expect(validateSignalPayload("offer", atLimit).ok).toBe(true);
    expect(validateSignalPayload("offer", overLimit).ok).toBe(false);
    expect(validateSignalPayload("offer", "").ok).toBe(false);
    expect(validateSignalPayload("bogus", "x").ok).toBe(false);
  });

  it("multi-byte characters are counted by byte length", () => {
    // '€' is 3 bytes in UTF-8.
    const chars = Math.floor(MAX_SIGNAL_PAYLOAD_BYTES / 3) + 1;
    const s = "€".repeat(chars);
    expect(s.length).toBeLessThanOrEqual(MAX_SIGNAL_PAYLOAD_BYTES); // char count under
    expect(validateSignalPayload("offer", s).ok).toBe(false); // byte count over
  });
});

// ===========================================================================
// Task 1.4 — Outcome, quality, poll cadence (Properties 7, 8, 9)
// ===========================================================================
describe("Property 7: outcome classification is deterministic and idempotent", () => {
  const arbInput = fc.record({
    terminalState: fc.constantFrom<"ended" | "expired" | "cancelled">(
      "ended",
      "expired",
      "cancelled",
    ),
    patientEverAdmitted: fc.boolean(),
    patientEverWaited: fc.boolean(),
    admissionDecisionRecorded: fc.boolean(),
    connectedSeconds: fc.integer({ min: 0, max: 10_000 }),
    existingOutcome: fc.constantFrom<CallOutcome | null>(
      null,
      "completed",
      "abandoned",
      "patient_no_show",
      "doctor_no_show",
      "cancelled",
    ),
  });

  it("idempotent: feeding the result back returns it unchanged", () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const once = classifyOutcome(i);
        const twice = classifyOutcome({ ...i, existingOutcome: once });
        expect(twice).toBe(once);
      }),
    );
  });

  it("precedence rules", () => {
    expect(
      classifyOutcome({
        terminalState: "expired",
        patientEverWaited: true,
        admissionDecisionRecorded: false,
        patientEverAdmitted: false,
        connectedSeconds: 0,
        existingOutcome: null,
      }),
    ).toBe("doctor_no_show");
    expect(
      classifyOutcome({
        terminalState: "expired",
        patientEverWaited: false,
        admissionDecisionRecorded: false,
        patientEverAdmitted: false,
        connectedSeconds: 0,
        existingOutcome: null,
      }),
    ).toBe("patient_no_show");
    expect(
      classifyOutcome({
        terminalState: "ended",
        patientEverWaited: true,
        admissionDecisionRecorded: true,
        patientEverAdmitted: true,
        connectedSeconds: 0,
        existingOutcome: null,
      }),
    ).toBe("abandoned");
    expect(
      classifyOutcome({
        terminalState: "ended",
        patientEverWaited: true,
        admissionDecisionRecorded: true,
        patientEverAdmitted: true,
        connectedSeconds: 120,
        existingOutcome: null,
      }),
    ).toBe("completed");
    // existing wins
    expect(
      classifyOutcome({
        terminalState: "ended",
        patientEverWaited: true,
        admissionDecisionRecorded: true,
        patientEverAdmitted: true,
        connectedSeconds: 120,
        existingOutcome: "patient_no_show",
      }),
    ).toBe("patient_no_show");
  });
});

describe("Property 8: quality classification is total and monotonic", () => {
  const arbMetric = fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 2000 }));
  const arbSample = fc.record({ rttMs: arbMetric, packetLossPct: arbMetric, jitterMs: arbMetric });
  const rank = { good: 0, fair: 1, poor: 2 } as const;

  it("returns a level for every sample including all-null", () => {
    fc.assert(
      fc.property(arbSample, (s) => {
        expect(["good", "fair", "poor"]).toContain(classifyQuality(s as QualitySample));
      }),
    );
    expect(classifyQuality({ rttMs: null, packetLossPct: null, jitterMs: null })).toBe("good");
  });

  it("worsening rtt never improves the level", () => {
    fc.assert(
      fc.property(arbSample, fc.integer({ min: 0, max: 2000 }), (s, worse) => {
        const base = s as QualitySample;
        const rtt0 = base.rttMs ?? 0;
        const worsened: QualitySample = { ...base, rttMs: rtt0 + worse };
        expect(rank[classifyQuality(worsened)]).toBeGreaterThanOrEqual(rank[classifyQuality(base)]);
      }),
    );
  });
});

describe("Property 9: polling stops only when the call is genuinely up", () => {
  it("stopPolling true iff active and both connected", () => {
    fc.assert(
      fc.property(arbRoomState, arbPeerState, arbPeerState, (rs, lp, rp) => {
        const stop = shouldStopPolling(rs, lp, rp);
        expect(stop).toBe(rs === "active" && lp === "connected" && rp === "connected");
        if (stop) {
          expect(
            nextPollDelayMs({ roomState: rs, localPeer: lp, remotePeer: rp, consecutiveErrors: 0 }),
          ).toBeNull();
        }
      }),
    );
  });

  it("non-terminal, not-connected room keeps a positive bounded delay on the setup path", () => {
    fc.assert(
      fc.property(arbRoomState, arbPeerState, arbPeerState, (rs, lp, rp) => {
        if (isTerminalRoomState(rs)) return;
        if (shouldStopPolling(rs, lp, rp)) return;
        const d = nextPollDelayMs({
          roomState: rs,
          localPeer: lp,
          remotePeer: rp,
          consecutiveErrors: 0,
        });
        expect(d).not.toBeNull();
        expect(d as number).toBeGreaterThan(0);
        expect(d as number).toBeLessThanOrEqual(SETUP_POLL_INTERVAL_MS);
      }),
    );
  });

  it("terminal room stops polling", () => {
    for (const s of TERMINAL_ROOM_STATES) {
      expect(
        nextPollDelayMs({
          roomState: s,
          localPeer: "new",
          remotePeer: "new",
          consecutiveErrors: 0,
        }),
      ).toBeNull();
    }
  });
});

// ===========================================================================
// Task 1.5 — Mode, token scope, rate limit, projection (Properties 10, 12, 13, 14)
// ===========================================================================
describe("Property 10: consultation mode is a closed set and room sync follows the change", () => {
  it("normalizeConsultationMode accepts only the two canonical values", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = normalizeConsultationMode(s);
        if (r.ok) expect(CONSULTATION_MODES).toContain(r.mode);
      }),
    );
    expect(
      normalizeConsultationMode("  VIDEO ").ok && normalizeConsultationMode("  VIDEO "),
    ).toMatchObject({
      mode: "video",
    });
    expect(normalizeConsultationMode("In_Person")).toMatchObject({ ok: true, mode: "in_person" });
    expect(normalizeConsultationMode("phone").ok).toBe(false);
    expect(normalizeConsultationMode(42).ok).toBe(false);
    expect(normalizeConsultationMode(null).ok).toBe(false);
  });

  it("planRoomSyncForModeChange is correct and idempotent", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"in_person" | "video">("in_person", "video"),
        fc.boolean(),
        arbRoomState,
        (to, hasRoom, roomState) => {
          const action = planRoomSyncForModeChange({
            from: null,
            to,
            hasRoom,
            roomState: hasRoom ? roomState : null,
          });
          if (to === "video") {
            expect(action).toBe(hasRoom ? "none" : "create");
          } else {
            const nonTerminal = hasRoom && !TERMINAL_ROOM_STATES.includes(roomState);
            expect(action).toBe(nonTerminal ? "cancel" : "none");
          }
        },
      ),
    );
    // idempotent re-save: video with an existing room does nothing
    expect(
      planRoomSyncForModeChange({
        from: "video",
        to: "video",
        hasRoom: true,
        roomState: "waiting",
      }),
    ).toBe("none");
  });
});

describe("Property 12: token authority is narrow", () => {
  it("scoped only to the bound room and only when unrevoked", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.boolean(), (bound, requested, revoked) => {
        const ok = isTokenScopedTo(bound, requested, revoked);
        expect(ok).toBe(!revoked && bound === requested);
      }),
    );
  });
});

describe("Property 13: rate limiter honours its window", () => {
  it("never permits the 11th failed attempt within 60s", () => {
    let state: RateLimitState = { hits: [] };
    const now = 1_000_000;
    const results: boolean[] = [];
    for (let k = 0; k < 15; k++) {
      const r = evaluateRateLimit(state, now + k); // all within the window
      state = r.state;
      results.push(r.allowed);
    }
    // first RATE_LIMIT_MAX_ATTEMPTS allowed, the rest denied
    for (let k = 0; k < RATE_LIMIT_MAX_ATTEMPTS; k++) expect(results[k]).toBe(true);
    for (let k = RATE_LIMIT_MAX_ATTEMPTS; k < 15; k++) expect(results[k]).toBe(false);
  });

  it("permits again once the window passes", () => {
    let state: RateLimitState = { hits: [] };
    for (let k = 0; k < RATE_LIMIT_MAX_ATTEMPTS; k++)
      state = evaluateRateLimit(state, 1000 + k).state;
    // far in the future, window has slid past all prior hits
    const r = evaluateRateLimit(state, 1000 + 10 * 60_000);
    expect(r.allowed).toBe(true);
  });

  it("property: allowed count within any window never exceeds the cap", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 300_000 }), { maxLength: 40 }), (offsets) => {
        let state: RateLimitState = { hits: [] };
        const base = 5_000_000;
        for (const off of offsets) {
          const now = base + off;
          const r = evaluateRateLimit(state, now);
          state = r.state;
          const windowCount = state.hits.filter((t) => t > now - 60_000).length;
          if (r.allowed) expect(windowCount).toBeLessThanOrEqual(RATE_LIMIT_MAX_ATTEMPTS);
        }
      }),
    );
  });
});

describe("Property 14: the patient projection cannot leak", () => {
  const KEYS = ["status", "clinicName", "doctorName", "appointmentAt", "noticeVersion"].sort();

  // `fc.string()` deliberately biases toward shared corner-case values (e.g.
  // "toString", "constructor", ""). Drawing the disclosed fields and the
  // "secret" fields from the same unconstrained generator lets them
  // collide on one of those corner cases by pure chance, which would fail
  // this test for a reason that has nothing to do with `projectForPatient`.
  // Tagging every secret with a marker no generic string generator produces
  // makes the two domains disjoint by construction, so a failure here can
  // only mean a real leak.
  const arbSecret = fc.string({ minLength: 5 }).map((s) => `secret-${s}`);

  it("has exactly the projection keys and no PII/internal values", () => {
    fc.assert(
      fc.property(
        fc.record({
          status: fc.constantFrom(
            "waiting",
            "admitted",
            "declined",
            "active",
            "ended",
            "expired",
            "invalid",
            "rate_limited",
          ),
          clinicName: fc.string(),
          doctorName: fc.string(),
          appointmentAt: fc.string(),
          noticeVersion: fc.string(),
          // secrets that must never appear:
          phone: arbSecret,
          email: arbSecret,
          reason: arbSecret,
          patientId: arbSecret,
          tenantId: arbSecret,
          appointmentId: arbSecret,
          roomId: arbSecret,
        }),
        (i) => {
          const p = projectForPatient(i as any);
          expect(Object.keys(p).sort()).toEqual(KEYS);
          const values = Object.values(p);
          for (const secret of [
            i.phone,
            i.email,
            i.reason,
            i.patientId,
            i.tenantId,
            i.appointmentId,
            i.roomId,
          ]) {
            expect(values).not.toContain(secret);
          }
        },
      ),
    );
  });

  it("invalid and rate_limited disclose nothing beyond status", () => {
    for (const status of ["invalid", "rate_limited"] as const) {
      const p = projectForPatient({
        status,
        clinicName: "Acme Clinic",
        doctorName: "Dr Who",
        appointmentAt: "2026-01-01T00:00:00Z",
        noticeVersion: "v1",
      });
      expect(p.clinicName).toBeNull();
      expect(p.doctorName).toBeNull();
      expect(p.appointmentAt).toBeNull();
    }
  });
});
