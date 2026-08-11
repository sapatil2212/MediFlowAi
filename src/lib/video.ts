// ─────────────────────────────────────────────────────────────────────────────
// video.ts — the video consultation server function surface.
//
// Two authorization paths:
//   • Doctor / staff  — verifySession + canOperateFeature (via requireVideoOperator).
//   • Patient         — Join_Token only; verifySession is NEVER called, and the
//                       tenantId is taken from the room the token resolved to.
//
// All decision logic is the pure `./video-consultation` module; persistence and
// enforcement are `./video.server`; ICE/TURN is `./video-turn.server`. This file
// is glue: validate, authorize, call, shape the response.
// ─────────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";

import {
  nextPollDelayMs,
  projectForPatient,
  shouldStopPolling,
  shouldEndForDisconnect,
  type PatientRoomProjection,
  type PatientStatus,
  type PeerState,
  type ParticipantRole,
} from "./video-consultation";
import {
  ensureVideoRoom,
  issueJoinToken,
  revokeJoinTokens,
  resolveJoinToken,
  loadRoomForRead,
  loadRoomByAppointment,
  loadAppointmentForVideo,
  loadParticipants,
  loadAuditEvents,
  transitionRoom,
  insertSignal,
  readSignalsAfter,
  upsertParticipant,
  updateParticipantState,
  markParticipantGone,
  recordAudit,
  requireVideoOperator,
  requireRoomForDoctor,
  patientParticipantKey,
  doctorParticipantKey,
  notifyVideoLink,
  type VideoRoomRow,
  type VideoParticipantRow,
  type SessionUser,
} from "./video.server";
import {
  readTurnConfig,
  buildIceConfiguration,
  isTurnConfigured,
  type IceConfiguration,
} from "./video-turn.server";
import { queryOne } from "./db";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Best-effort client key for rate limiting the patient token path (Req 6.12). */
async function clientKeyFromRequest(): Promise<string> {
  try {
    const { getHeaders } = await import("@tanstack/react-start/server");
    const h = getHeaders();
    const fwd = (h["x-forwarded-for"] || "").toString();
    const ip = fwd.split(",")[0].trim() || (h["x-real-ip"] || "").toString().trim();
    return ip || "unknown";
  } catch {
    return "unknown";
  }
}

async function activeLinkCount(roomId: string, tenantId: string): Promise<number> {
  const row = await queryOne<any>(
    `SELECT COUNT(*) AS c FROM VideoJoinToken WHERE roomId = ? AND tenantId = ? AND revokedAt IS NULL`,
    [roomId, tenantId],
  );
  return Number(row?.c ?? 0);
}

/** Shapes a participant row for the doctor UI (no signalling internals). */
function publicParticipant(p: VideoParticipantRow) {
  return {
    id: p.id,
    role: p.role,
    displayName: p.displayName,
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
async function buildDoctorRoomView(room: VideoRoomRow, user: SessionUser) {
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

// ═════════════════════════════════════════════════════════════════════════════
// DOCTOR / STAFF PATH
// ═════════════════════════════════════════════════════════════════════════════

export const getVideoRoomServerFn = createServerFn({ method: "GET" })
  .validator((data: { appointmentId: string }) => {
    if (!data?.appointmentId) throw new Error("appointmentId is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await loadRoomByAppointment(data.appointmentId, user.tenantId);
    if (!room) return { exists: false as const };
    await requireRoomForDoctor(room.id, user);
    const view = await buildDoctorRoomView(await loadRoomForRead(room.id, user.tenantId), user);
    return { exists: true as const, ...view };
  });

export const createVideoRoomServerFn = createServerFn({ method: "POST" })
  .validator((data: { appointmentId: string }) => {
    if (!data?.appointmentId) throw new Error("appointmentId is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const appt = await loadAppointmentForVideo(data.appointmentId, user.tenantId);
    if (!appt) throw new Error("Appointment not found");

    // Assigned-doctor / admin scoping mirrors requireRoomForDoctor semantics.
    if (user.role === "doctor" && user.doctorId && appt.doctorId && appt.doctorId !== user.doctorId) {
      throw new Error("You are not assigned to this consultation.");
    }

    const room = await ensureVideoRoom(data.appointmentId, user.tenantId);
    const { link } = await issueJoinToken(room.id, user.tenantId, "created");
    // Deliver link to the patient (best-effort, never blocks).
    void notifyVideoLink(data.appointmentId, user.tenantId, link, "videoLinkIssued").catch(() => {});
    const view = await buildDoctorRoomView(await loadRoomForRead(room.id, user.tenantId), user);
    return { ...view, joinLink: link };
  });

export const regenerateJoinTokenServerFn = createServerFn({ method: "POST" })
  .validator((data: { roomId: string }) => {
    if (!data?.roomId) throw new Error("roomId is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    await revokeJoinTokens(room.id);
    const { link } = await issueJoinToken(room.id, user.tenantId, "regenerated");
    void notifyVideoLink(room.appointmentId, user.tenantId, link, "videoLinkReissued").catch(() => {});
    await recordAudit(room.id, "state_change", "token_regenerated", undefined, user.tenantId, room.appointmentId);
    return { joinLink: link };
  });

export const pollVideoRoomServerFn = createServerFn({ method: "GET" })
  .validator((data: { roomId: string; afterSeq?: number; peerState?: string }) => {
    if (!data?.roomId) throw new Error("roomId is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    const participants = await loadParticipants(room.id, user.tenantId);
    const admittedPatient = participants.find((p) => p.role === "patient" && p.status === "admitted");

    // Signals only flow once a patient is admitted (waiting-room gating, Req 5.2).
    const cursor = Number(data.afterSeq ?? 0);
    let signals: Array<{ seq: number; kind: string; senderRole: string; payload: string }> = [];
    let newCursor = cursor;
    if (room.state === "active") {
      const recs = await readSignalsAfter(room.id, user.tenantId, cursor, "doctor");
      signals = recs;
      for (const s of recs) if (s.seq > newCursor) newCursor = s.seq;
    }

    const remotePeer = (admittedPatient?.peerState as PeerState) ?? "new";
    const localPeer = (data.peerState as PeerState) ?? "new";
    const stop = shouldStopPolling(room.state, localPeer, remotePeer);
    const nextMs = nextPollDelayMs({ roomState: room.state, localPeer, remotePeer, consecutiveErrors: 0 });

    return {
      roomState: room.state,
      waiting: participants.filter((p) => p.role === "patient" && p.status === "requested").map(publicParticipant),
      participants: participants.map(publicParticipant),
      signals,
      cursor: newCursor,
      stopPolling: stop,
      nextPollMs: nextMs,
      turnConfigured: isTurnConfigured(readTurnConfig()),
    };
  });

export const publishSignalServerFn = createServerFn({ method: "POST" })
  .validator((data: { roomId: string; kind: string; payload: string }) => {
    if (!data?.roomId || !data?.kind || typeof data?.payload !== "string") {
      throw new Error("roomId, kind and payload are required");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    if (room.state !== "active") throw new Error("The consultation is not active.");
    const { seq } = await insertSignal(room.id, user.tenantId, "doctor", data.kind, data.payload);
    return { seq };
  });

export const admitParticipantServerFn = createServerFn({ method: "POST" })
  .validator((data: { roomId: string; participantId: string; decision: "admit" | "decline" }) => {
    if (!data?.roomId || !data?.participantId) throw new Error("roomId and participantId are required");
    if (data.decision !== "admit" && data.decision !== "decline") throw new Error("Invalid decision");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    const participant = await queryOne<any>(
      `SELECT * FROM VideoParticipant WHERE id = ? AND roomId = ? AND tenantId = ? LIMIT 1`,
      [data.participantId, room.id, user.tenantId],
    );
    if (!participant) throw new Error("Participant not found");

    if (data.decision === "decline") {
      await markParticipantGone(data.participantId, user.tenantId, "removed");
      await updateParticipantState(data.participantId, user.tenantId, {});
      const updated = await transitionRoom(room.id, "decline", {
        tenantId: user.tenantId,
        appointmentId: room.appointmentId,
        actorRole: "doctor",
        detail: "declined",
        participantId: data.participantId,
      });
      await recordAudit(room.id, "declined", null, "doctor", user.tenantId, room.appointmentId);
      return { roomState: updated.state };
    }

    // admit — enforce single admitted patient
    if (room.admittedParticipantId && room.admittedParticipantId !== data.participantId) {
      throw new Error("Another patient is already admitted.");
    }
    const updated = await transitionRoom(room.id, "admit", {
      tenantId: user.tenantId,
      appointmentId: room.appointmentId,
      actorRole: "doctor",
      detail: "admitted",
      participantId: data.participantId,
    });
    await markAdmitted(data.participantId, user.tenantId);
    await recordAudit(room.id, "admitted", null, "doctor", user.tenantId, room.appointmentId);
    return { roomState: updated.state };
  });

async function markAdmitted(participantId: string, tenantId: string): Promise<void> {
  const { execute } = await import("./db");
  await execute(
    `UPDATE VideoParticipant SET status = 'admitted', admittedAt = COALESCE(admittedAt, NOW(3)) WHERE id = ? AND tenantId = ?`,
    [participantId, tenantId],
  );
}

export const removeParticipantServerFn = createServerFn({ method: "POST" })
  .validator((data: { roomId: string; participantId: string }) => {
    if (!data?.roomId || !data?.participantId) throw new Error("roomId and participantId are required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    await markParticipantGone(data.participantId, user.tenantId, "removed");
    await recordAudit(room.id, "removed", null, "doctor", user.tenantId, room.appointmentId);
    // Ending the room when the admitted patient is removed.
    let state = room.state;
    if (room.admittedParticipantId === data.participantId && room.state === "active") {
      const updated = await transitionRoom(room.id, "end", {
        tenantId: user.tenantId,
        appointmentId: room.appointmentId,
        actorRole: "doctor",
        endReason: "participant_removed",
        detail: "participant_removed",
      });
      state = updated.state;
    }
    return { roomState: state };
  });

export const getIceConfigurationServerFn = createServerFn({ method: "POST" })
  .validator((data: { roomId: string }) => {
    if (!data?.roomId) throw new Error("roomId is required");
    return data;
  })
  .handler(async ({ data }): Promise<IceConfiguration> => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    if (room.state !== "active") throw new Error("The consultation is not active.");
    const cfg = readTurnConfig();
    try {
      const key = doctorParticipantKey(user.id);
      return buildIceConfiguration(cfg, key, Date.now());
    } catch (err: any) {
      await recordAudit(room.id, "turn_credential_failure", "doctor", "doctor", user.tenantId, room.appointmentId);
      throw new Error("Could not prepare a secure connection.");
    }
  });

export const endVideoRoomServerFn = createServerFn({ method: "POST" })
  .validator((data: { roomId: string; reason?: string }) => {
    if (!data?.roomId) throw new Error("roomId is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    if (room.state !== "active" && room.state !== "waiting") {
      return { roomState: room.state, connectedSeconds: room.connectedSeconds, outcome: room.outcome };
    }
    const reason = data.reason === "connection_lost" ? "connection_lost" : "doctor_ended";
    const updated = await transitionRoom(room.id, "end", {
      tenantId: user.tenantId,
      appointmentId: room.appointmentId,
      actorRole: "doctor",
      endReason: reason,
      detail: reason,
    });
    return { roomState: updated.state, connectedSeconds: updated.connectedSeconds, outcome: updated.outcome };
  });

export const reportCallEventServerFn = createServerFn({ method: "POST" })
  .validator((data: { roomId: string; kind: string; detail?: string; peerState?: string; connectedMs?: number }) => {
    if (!data?.roomId || !data?.kind) throw new Error("roomId and kind are required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    const key = doctorParticipantKey(user.id);
    const participant = await queryOne<any>(
      `SELECT id FROM VideoParticipant WHERE roomId = ? AND participantKey = ? LIMIT 1`,
      [room.id, key],
    );
    if (participant) {
      await updateParticipantState(participant.id, user.tenantId, {
        peerState: data.peerState,
        addConnectedMs: data.connectedMs,
      });
    }
    await recordAudit(room.id, sanitizeEventKind(data.kind), data.detail ?? null, "doctor", user.tenantId, room.appointmentId);
    const ended = await maybeEndForDisconnect(room, data.kind, user.tenantId);
    return { ok: true, roomState: ended };
  });

export const getCallAuditServerFn = createServerFn({ method: "GET" })
  .validator((data: { appointmentId: string }) => {
    if (!data?.appointmentId) throw new Error("appointmentId is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await loadRoomByAppointment(data.appointmentId, user.tenantId);
    if (!room) return { exists: false as const };
    await requireRoomForDoctor(room.id, user);
    const events = await loadAuditEvents(room.id, user.tenantId);
    return {
      exists: true as const,
      state: room.state,
      outcome: room.outcome,
      endReason: room.endReason,
      connectedSeconds: room.connectedSeconds,
      events, // join/leave/etc — no media, no signal payloads (Req 15.8)
    };
  });

// ═════════════════════════════════════════════════════════════════════════════
// PATIENT PATH — Join_Token only, verifySession is never called.
// ═════════════════════════════════════════════════════════════════════════════

/** Resolves a token or throws a redacted client-facing error. */
async function resolveOrThrow(token: string) {
  const clientKey = await clientKeyFromRequest();
  const res = await resolveJoinToken(token, clientKey);
  if (!res.ok) {
    if (res.status === "rate_limited") throw new Error("RATE_LIMITED");
    if (res.status === "expired") throw new Error("EXPIRED_LINK");
    throw new Error("INVALID_LINK");
  }
  return res.value;
}

/** Derives the patient's status label from the room + participant. */
function patientStatusFrom(room: VideoRoomRow, participant: VideoParticipantRow | null): PatientStatus {
  if (room.state === "ended") return "ended";
  if (room.state === "expired" || room.state === "cancelled") return "expired";
  if (participant?.status === "admitted" || room.state === "active") {
    return room.state === "active" && participant?.status === "admitted" ? "active" : "admitted";
  }
  if (participant?.status === "removed") return "declined";
  if (participant?.status === "requested") return "waiting";
  return "waiting";
}

export const getJoinContextServerFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => {
    if (!data?.token) throw new Error("token is required");
    return data;
  })
  .handler(async ({ data }): Promise<PatientRoomProjection> => {
    const clientKey = await clientKeyFromRequest();
    const res = await resolveJoinToken(data.token, clientKey);
    if (!res.ok) {
      const status: PatientStatus = res.status === "rate_limited" ? "rate_limited" : res.status === "expired" ? "expired" : "invalid";
      return projectForPatient({ status });
    }
    const { room } = res.value;
    const pKey = patientParticipantKey(room.id);
    const participant = await queryOne<any>(
      `SELECT * FROM VideoParticipant WHERE roomId = ? AND participantKey = ? LIMIT 1`,
      [room.id, pKey],
    );
    const facts = await patientFactsFor(room);
    return projectForPatient({
      status: patientStatusFrom(room, participant ? (participant as VideoParticipantRow) : null),
      clinicName: facts.clinicName,
      doctorName: facts.doctorName,
      appointmentAt: facts.appointmentAt,
      noticeVersion: room.noticeVersion,
    });
  });

/**
 * The four facts a patient may see, resolved for either room kind.
 *
 * Appointment rooms read them from the booking; ad-hoc rooms have no
 * Appointment row, so the clinic comes from the tenant and the time from the
 * room's own `scheduledAt` (null for an instant meeting).
 */
async function patientFactsFor(room: VideoRoomRow): Promise<{
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
  const { loadRoomExtras } = await import("./video.server");
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

export const acceptConsentServerFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; noticeVersion: string }) => {
    if (!data?.token) throw new Error("token is required");
    return data;
  })
  .handler(async ({ data }) => {
    const { room } = await resolveOrThrow(data.token);
    const { execute } = await import("./db");
    const { randomUUID, createHash } = await import("node:crypto");
    const uaHash = await userAgentHash();
    await execute(
      `INSERT INTO VideoConsent (id, tenantId, roomId, appointmentId, noticeVersion, tokenVersion, userAgentHash)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE acknowledgedAt = NOW(3), userAgentHash = VALUES(userAgentHash)`,
      [randomUUID(), room.tenantId, room.id, room.appointmentId, room.noticeVersion, 1, uaHash],
    );
    void createHash;
    await recordAudit(room.id, "consent_accepted", room.noticeVersion, "patient", room.tenantId, room.appointmentId);
    return { ok: true };
  });

async function userAgentHash(): Promise<string | null> {
  try {
    const { getHeaders } = await import("@tanstack/react-start/server");
    const { createHash } = await import("node:crypto");
    const ua = (getHeaders()["user-agent"] || "").toString();
    return ua ? createHash("sha256").update(ua).digest("hex") : null;
  } catch {
    return null;
  }
}

export const requestEntryServerFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => {
    if (!data?.token) throw new Error("token is required");
    return data;
  })
  .handler(async ({ data }) => {
    const { room } = await resolveOrThrow(data.token);
    // Consent gate (Req 12.3): no consent row => entry withheld.
    const consent = await queryOne<any>(
      `SELECT id FROM VideoConsent WHERE roomId = ? AND tenantId = ? LIMIT 1`,
      [room.id, room.tenantId],
    );
    if (!consent) throw new Error("CONSENT_REQUIRED");

    const pKey = patientParticipantKey(room.id);
    // Appointment rooms name the patient from the booking; ad-hoc rooms use the
    // guest name the host supplied (if any).
    let displayName = "Patient";
    if (room.appointmentId) {
      const appt = await loadAppointmentForVideo(room.appointmentId, room.tenantId);
      displayName = appt?.name ?? "Patient";
    } else {
      const { loadRoomExtras } = await import("./video.server");
      const extras = await loadRoomExtras(room.id, room.tenantId);
      displayName = extras?.guestName ?? "Guest";
    }
    await upsertParticipant({
      tenantId: room.tenantId,
      roomId: room.id,
      role: "patient",
      participantKey: pKey,
      displayName,
      status: "requested",
    });
    await recordAudit(room.id, "joined", "patient_requested_entry", "patient", room.tenantId, room.appointmentId);

    // scheduled -> waiting; already waiting/active is fine.
    if (room.state === "scheduled") {
      try {
        await transitionRoom(room.id, "patient_arrived", {
          tenantId: room.tenantId,
          appointmentId: room.appointmentId,
          actorRole: "patient",
          detail: "patient_arrived",
        });
      } catch {
        /* concurrent transition; ignore */
      }
    }

    // Auto-admit rooms (instant meetings) skip the waiting room, but only once
    // the host is actually present — otherwise a guest would land in an "active"
    // room with nobody on the other side. The waiting room is still the default
    // for scheduled links.
    const extras = await (await import("./video.server")).loadRoomExtras(room.id, room.tenantId);
    if (extras?.autoAdmit) {
      const parts = await loadParticipants(room.id, room.tenantId);
      const hostPresent = parts.some((p) => p.role === "doctor" && p.status === "admitted");
      const guest = await loadPatientParticipant(room.id, room.tenantId);
      const current = await loadRoomForRead(room.id, room.tenantId);
      if (hostPresent && guest && current.state === "waiting") {
        try {
          await transitionRoom(room.id, "admit", {
            tenantId: room.tenantId,
            appointmentId: room.appointmentId,
            actorRole: "doctor",
            detail: "auto_admitted",
            participantId: guest.id,
          });
          await markAdmitted(guest.id, room.tenantId);
        } catch {
          /* concurrent transition; ignore */
        }
      }
    }

    const fresh = await loadRoomForRead(room.id, room.tenantId);
    const participant = await loadPatientParticipant(room.id, room.tenantId);
    return { status: patientStatusFrom(fresh, participant) };
  });

async function loadPatientParticipant(roomId: string, tenantId: string): Promise<VideoParticipantRow | null> {
  const pKey = patientParticipantKey(roomId);
  const row = await queryOne<any>(
    `SELECT * FROM VideoParticipant WHERE roomId = ? AND tenantId = ? AND participantKey = ? LIMIT 1`,
    [roomId, tenantId, pKey],
  );
  return row ? (row as VideoParticipantRow) : null;
}

export const getJoinStatusServerFn = createServerFn({ method: "GET" })
  .validator((data: { token: string; afterSeq?: number; peerState?: string }) => {
    if (!data?.token) throw new Error("token is required");
    return data;
  })
  .handler(async ({ data }) => {
    const clientKey = await clientKeyFromRequest();
    const res = await resolveJoinToken(data.token, clientKey);
    if (!res.ok) {
      const status: PatientStatus =
        res.status === "rate_limited" ? "rate_limited" : res.status === "expired" ? "expired" : "invalid";
      return { status, signals: [], cursor: Number(data.afterSeq ?? 0), stopPolling: true, nextPollMs: null };
    }
    const room = await loadRoomForRead(res.value.room.id, res.value.room.tenantId);
    const participant = await loadPatientParticipant(room.id, room.tenantId);
    const status = patientStatusFrom(room, participant);

    // Signals flow only once admitted and active (Req 5.2).
    const cursor = Number(data.afterSeq ?? 0);
    let signals: Array<{ seq: number; kind: string; senderRole: string; payload: string }> = [];
    let newCursor = cursor;
    if (room.state === "active" && participant?.status === "admitted") {
      const recs = await readSignalsAfter(room.id, room.tenantId, cursor, "patient");
      signals = recs;
      for (const s of recs) if (s.seq > newCursor) newCursor = s.seq;
    }

    // Report the patient's own peer state upward.
    if (participant && data.peerState) {
      await updateParticipantState(participant.id, room.tenantId, { peerState: data.peerState });
    }

    const doctor = (await loadParticipants(room.id, room.tenantId)).find((p) => p.role === "doctor");
    const remotePeer = (doctor?.peerState as PeerState) ?? "new";
    const localPeer = (data.peerState as PeerState) ?? "new";
    const stop = shouldStopPolling(room.state, localPeer, remotePeer);
    return {
      status,
      signals,
      cursor: newCursor,
      stopPolling: stop,
      nextPollMs: nextPollDelayMs({ roomState: room.state, localPeer, remotePeer, consecutiveErrors: 0 }),
      noticeVersion: room.noticeVersion,
    };
  });

export const patientPublishSignalServerFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; kind: string; payload: string }) => {
    if (!data?.token || !data?.kind || typeof data?.payload !== "string") {
      throw new Error("token, kind and payload are required");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const { room } = await resolveOrThrow(data.token);
    const participant = await loadPatientParticipant(room.id, room.tenantId);
    if (!participant || participant.status !== "admitted" || room.state !== "active") {
      throw new Error("You have not been admitted yet.");
    }
    const { seq } = await insertSignal(room.id, room.tenantId, "patient", data.kind, data.payload);
    return { seq };
  });

export const patientIceConfigServerFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => {
    if (!data?.token) throw new Error("token is required");
    return data;
  })
  .handler(async ({ data }): Promise<IceConfiguration> => {
    const { room } = await resolveOrThrow(data.token);
    const participant = await loadPatientParticipant(room.id, room.tenantId);
    if (!participant || participant.status !== "admitted" || room.state !== "active") {
      throw new Error("You have not been admitted yet.");
    }
    const cfg = readTurnConfig();
    try {
      return buildIceConfiguration(cfg, patientParticipantKey(room.id), Date.now());
    } catch {
      await recordAudit(room.id, "turn_credential_failure", "patient", "patient", room.tenantId, room.appointmentId);
      throw new Error("Could not prepare a secure connection.");
    }
  });

export const patientReportEventServerFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; kind: string; peerState?: string; connectedMs?: number; detail?: string }) => {
    if (!data?.token || !data?.kind) throw new Error("token and kind are required");
    return data;
  })
  .handler(async ({ data }) => {
    const { room } = await resolveOrThrow(data.token);
    const participant = await loadPatientParticipant(room.id, room.tenantId);
    if (participant) {
      await updateParticipantState(participant.id, room.tenantId, {
        peerState: data.peerState,
        addConnectedMs: data.connectedMs,
      });
    }
    await recordAudit(room.id, sanitizeEventKind(data.kind), data.detail ?? null, "patient", room.tenantId, room.appointmentId);
    const ended = await maybeEndForDisconnect(room, data.kind, room.tenantId);
    return { ok: true, roomState: ended };
  });

export const patientLeaveServerFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; reason?: string }) => {
    if (!data?.token) throw new Error("token is required");
    return data;
  })
  .handler(async ({ data }) => {
    const { room } = await resolveOrThrow(data.token);
    const participant = await loadPatientParticipant(room.id, room.tenantId);
    if (participant) {
      await markParticipantGone(participant.id, room.tenantId, "left");
    }
    await recordAudit(room.id, "left", "patient_left", "patient", room.tenantId, room.appointmentId);
    // If the patient leaves an active call, end it.
    let state = room.state;
    if (room.state === "active") {
      try {
        const updated = await transitionRoom(room.id, "end", {
          tenantId: room.tenantId,
          appointmentId: room.appointmentId,
          actorRole: "patient",
          endReason: "patient_ended",
          detail: "patient_left",
        });
        state = updated.state;
      } catch {
        /* ignore */
      }
    }
    return { status: state === "active" ? "ended" : (state as string) };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Shared internal helpers for call events
// ─────────────────────────────────────────────────────────────────────────────

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

/** Whitelists the audit kind so arbitrary strings can never reach the audit row. */
function sanitizeEventKind(kind: string): string {
  return ALLOWED_EVENT_KINDS.has(kind) ? kind : "state_change";
}

/**
 * Tracks the cumulative disconnected budget on the room and ends the call once
 * it exceeds the 60s ceiling (Req 10.5). Returns the resulting room state.
 */
async function maybeEndForDisconnect(room: VideoRoomRow, kind: string, tenantId: string): Promise<string> {
  const { execute } = await import("./db");
  const now = Date.now();

  if (kind === "reconnecting" || kind === "connection_lost" || kind === "connection_failed") {
    // Start (or continue) a disconnected interval.
    const fresh = await loadRoomForRead(room.id, tenantId);
    const since = fresh.disconnectedSinceAt ? new Date(fresh.disconnectedSinceAt as any).getTime() : null;
    const total = fresh.disconnectedTotalMs + (since ? now - since : 0);
    if (since === null) {
      await execute(`UPDATE VideoRoom SET disconnectedSinceAt = NOW(3) WHERE id = ? AND tenantId = ?`, [room.id, tenantId]);
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

// Keep unused-role import honest for strict lint configs.
export type { ParticipantRole };


// ═════════════════════════════════════════════════════════════════════════════
// AD-HOC MEETINGS — instant "start now" and "schedule a link for later".
// Doctor/staff path only; guests join through the same tokenized patient route.
// ═════════════════════════════════════════════════════════════════════════════

export const createInstantMeetingServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      title?: string;
      /** ISO datetime. Omit / null => start immediately. */
      scheduledAt?: string | null;
      guestName?: string;
      guestPhone?: string;
      guestEmail?: string;
      /** Skip the waiting room — the host is already present. */
      autoAdmit?: boolean;
      /** Also deliver the link over WhatsApp / email when contacts are given. */
      notify?: boolean;
    }) => {
      if (data.scheduledAt) {
        const t = new Date(data.scheduledAt).getTime();
        if (!Number.isFinite(t)) throw new Error("Invalid meeting date/time");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const { createInstantVideoRoom, notifyInstantMeetingLink, loadRoomExtras } = await import("./video.server");

    const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
    const { room, joinLink, meetingCode } = await createInstantVideoRoom({
      tenantId: user.tenantId,
      hostAccountId: user.id,
      doctorId: user.role === "doctor" ? user.doctorId ?? null : null,
      title: data.title?.trim() || null,
      scheduledAt,
      guestName: data.guestName?.trim() || null,
      guestPhone: data.guestPhone?.trim() || null,
      guestEmail: data.guestEmail?.trim() || null,
      // An instant meeting defaults to auto-admit: the host is on the call now,
      // so a waiting room would just add friction. Scheduled links keep the
      // waiting room unless the host explicitly opts out.
      autoAdmit: data.autoAdmit ?? !scheduledAt,
    });

    if (data.notify !== false && (data.guestPhone || data.guestEmail)) {
      void notifyInstantMeetingLink(
        user.tenantId,
        room,
        joinLink,
        { name: data.guestName, phone: data.guestPhone, email: data.guestEmail },
        scheduledAt,
      ).catch(() => {});
    }

    const extras = await loadRoomExtras(room.id, user.tenantId);
    return {
      roomId: room.id,
      meetingCode,
      joinLink,
      state: room.state,
      title: extras?.title ?? null,
      scheduledAt: toIso(extras?.scheduledAt ?? null),
      autoAdmit: extras?.autoAdmit ?? false,
      turnConfigured: isTurnConfigured(readTurnConfig()),
    };
  });

export const listInstantMeetingsServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await requireVideoOperator();
    const { listInstantRooms } = await import("./video.server");
    const rooms = await listInstantRooms(user.tenantId, user.id, user.role === "admin");
    return rooms.map((r: any) => ({
      id: r.id,
      state: r.state,
      title: r.title,
      meetingCode: r.meetingCode,
      scheduledAt: toIso(r.scheduledAt),
      guestName: r.guestName,
      guestPhone: r.guestPhone,
      guestEmail: r.guestEmail,
      autoAdmit: r.autoAdmit === 1,
      joinOpensAt: toIso(r.joinOpensAt),
      joinClosesAt: toIso(r.joinClosesAt),
      outcome: r.outcome,
      connectedSeconds: r.connectedSeconds,
      createdAt: toIso(r.createdAt),
    }));
  });

/**
 * Returns a usable share link for a room, minting an ADDITIONAL token.
 *
 * Plaintext tokens are never stored (only SHA-256 hashes), so a previously
 * issued link cannot be read back. Rather than force a destructive rotation
 * every time the host wants to copy the link, this issues another room-scoped,
 * window-bound, individually revocable token. Prior links keep working — the
 * same trade-off already made for reminder links. Use
 * `regenerateJoinTokenServerFn` when the intent is to INVALIDATE prior links.
 */
export const getShareLinkServerFn = createServerFn({ method: "POST" })
  .validator((data: { roomId: string }) => {
    if (!data?.roomId) throw new Error("roomId is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    const { link } = await issueJoinToken(room.id, user.tenantId, "created");
    return { joinLink: link };
  });

/**
 * The host joining their own meeting. For an auto-admit room this also flips the
 * room to `active` so a guest who is already waiting connects immediately.
 */
export const startMeetingServerFn = createServerFn({ method: "POST" })
  .validator((data: { roomId: string }) => {
    if (!data?.roomId) throw new Error("roomId is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    const { loadRoomExtras, upsertParticipant, doctorParticipantKey: dKey } = await import("./video.server");
    const extras = await loadRoomExtras(room.id, user.tenantId);

    // Register the host as the doctor participant so presence and audit are complete.
    await upsertParticipant({
      tenantId: user.tenantId,
      roomId: room.id,
      role: "doctor",
      participantKey: dKey(user.id),
      accountId: user.id,
      displayName: user.name ?? "Doctor",
      status: "admitted",
    });
    await recordAudit(room.id, "joined", "host_joined", "doctor", user.tenantId, room.appointmentId);

    // Promote a waiting guest when the room is set to auto-admit.
    let state = room.state;
    if (extras?.autoAdmit) {
      const participants = await loadParticipants(room.id, user.tenantId);
      const waitingGuest = participants.find((p) => p.role === "patient" && p.status === "requested");
      if (waitingGuest && room.state === "waiting") {
        try {
          const updated = await transitionRoom(room.id, "admit", {
            tenantId: user.tenantId,
            appointmentId: room.appointmentId,
            actorRole: "doctor",
            detail: "auto_admitted",
            participantId: waitingGuest.id,
          });
          state = updated.state;
          await markAdmitted(waitingGuest.id, user.tenantId);
        } catch {
          /* concurrent transition */
        }
      }
    }
    return { roomState: state, turnConfigured: isTurnConfigured(readTurnConfig()) };
  });

export const getMeetingServerFn = createServerFn({ method: "GET" })
  .validator((data: { roomId: string }) => {
    if (!data?.roomId) throw new Error("roomId is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    const { loadRoomExtras } = await import("./video.server");
    const [extras, participants, linkCount] = await Promise.all([
      loadRoomExtras(room.id, user.tenantId),
      loadParticipants(room.id, user.tenantId),
      activeLinkCount(room.id, user.tenantId),
    ]);
    return {
      room: {
        id: room.id,
        state: room.state,
        joinOpensAt: toIso(room.joinOpensAt),
        joinClosesAt: toIso(room.joinClosesAt),
        connectedSeconds: room.connectedSeconds,
        outcome: room.outcome,
        endReason: room.endReason,
      },
      title: extras?.title ?? null,
      meetingCode: extras?.meetingCode ?? null,
      scheduledAt: toIso(extras?.scheduledAt ?? null),
      guestName: extras?.guestName ?? null,
      autoAdmit: extras?.autoAdmit ?? false,
      participants: participants.map(publicParticipant),
      waiting: participants.filter((p) => p.role === "patient" && p.status === "requested").map(publicParticipant),
      linkActive: linkCount > 0,
      turnConfigured: isTurnConfigured(readTurnConfig()),
    };
  });

export const cancelMeetingServerFn = createServerFn({ method: "POST" })
  .validator((data: { roomId: string }) => {
    if (!data?.roomId) throw new Error("roomId is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    if (isTerminal(room.state)) return { roomState: room.state };
    const updated = await transitionRoom(room.id, "cancel", {
      tenantId: user.tenantId,
      appointmentId: room.appointmentId,
      actorRole: "doctor",
      endReason: "cancelled",
      detail: "host_cancelled",
    });
    return { roomState: updated.state };
  });

function isTerminal(s: string): boolean {
  return s === "ended" || s === "expired" || s === "cancelled";
}

// ═════════════════════════════════════════════════════════════════════════════
// TURN / relay diagnostics
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Reports the deployment's relay configuration so the dashboard can show an
 * accurate, actionable status instead of a bare warning. Returns no secrets:
 * only whether each piece is present and the (non-sensitive) endpoint hosts.
 */
export const getRelayStatusServerFn = createServerFn({ method: "GET" })
  .handler(async () => {
    await requireVideoOperator();
    const cfg = readTurnConfig();
    return {
      turnConfigured: isTurnConfigured(cfg),
      hasTurnUrls: cfg.turnUrls.length > 0,
      hasStunUrls: cfg.stunUrls.length > 0,
      hasSharedSecret: !!cfg.sharedSecret,
      realmSet: !!cfg.realm,
      ttlSeconds: cfg.ttlSeconds,
      // Hosts only — no credentials, no secret.
      turnHosts: cfg.turnUrls.map(safeHostOf).filter(Boolean),
      stunHosts: cfg.stunUrls.map(safeHostOf).filter(Boolean),
    };
  });

/** Extracts just the host[:port] from a turn:/turns:/stun: URL for display. */
function safeHostOf(url: string): string {
  const m = /^(?:stun|stuns|turn|turns):([^?]+)/i.exec(url.trim());
  return m ? m[1] : "";
}

/**
 * Issues an ICE configuration purely for a connectivity self-test, so the host
 * can verify relay reachability from their browser BEFORE a real consultation.
 * Bound to the calling account and short-lived, exactly like a call credential.
 */
export const getDiagnosticIceServerFn = createServerFn({ method: "POST" })
  .handler(async () => {
    const user = await requireVideoOperator();
    const cfg = readTurnConfig();
    return buildIceConfiguration(cfg, `diag-${doctorParticipantKey(user.id).slice(0, 16)}`, Date.now());
  });
