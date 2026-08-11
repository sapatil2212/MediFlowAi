// ─────────────────────────────────────────────────────────────────────────────
// video.ts — the video consultation server function surface.
//
// This module contains ONLY `createServerFn` declarations. Every helper lives in
// `./video.server` (persistence, guards, view shaping) or `./video-consultation`
// (pure decision logic), because the TanStack compiler extracts each handler
// body into a separate split module — keeping shared helpers out of this file
// keeps that extraction trivial.
//
// Two authorization paths:
//   • Doctor / staff — verifySession + canOperateFeature, via requireVideoOperator.
//   • Patient        — Join_Token only; verifySession is NEVER called, and the
//                      tenantId comes from the room the token resolved to.
// ─────────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";

import { nextPollDelayMs, projectForPatient, shouldStopPolling, type PatientStatus, type PeerState } from "./video-consultation";
import {
  activeLinkCount,
  buildDoctorRoomView,
  cancelRoomForHost,
  createInstantVideoRoom,
  doctorParticipantKey,
  endRoomAsDoctor,
  ensureVideoRoom,
  hasConsent,
  insertSignal,
  issueJoinToken,
  listInstantRooms,
  loadAppointmentForVideo,
  loadAuditEvents,
  loadParticipants,
  loadPatientParticipant,
  loadRoomByAppointment,
  loadRoomExtras,
  loadRoomForRead,
  markAdmitted,
  markParticipantGone,
  maybeEndForDisconnect,
  notifyInstantMeetingLink,
  notifyVideoLink,
  patientFactsFor,
  patientParticipantKey,
  patientStatusFrom,
  publicParticipant,
  readSignalsAfter,
  recordAudit,
  recordConsent,
  registerHostParticipant,
  requireRoomForDoctor,
  requireVideoOperator,
  resolveJoinTokenOrThrow,
  revokeJoinTokens,
  safeHostOf,
  sanitizeEventKind,
  toIso,
  transitionRoom,
  updateParticipantState,
  upsertParticipant,
  clientKeyFromRequest,
  loadParticipantById,
  resolveJoinTokenSoft,
  isTerminalStateName,
} from "./video.server";
import { buildIceConfiguration, isTurnConfigured, readTurnConfig, type IceConfiguration } from "./video-turn.server";

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
    const fresh = await loadRoomForRead(room.id, user.tenantId);
    const view = await buildDoctorRoomView(fresh, user);
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
    if (user.role === "doctor" && user.doctorId && appt.doctorId && appt.doctorId !== user.doctorId) {
      throw new Error("You are not assigned to this consultation.");
    }
    const room = await ensureVideoRoom(data.appointmentId, user.tenantId);
    const { link } = await issueJoinToken(room.id, user.tenantId, "created");
    void notifyVideoLink(data.appointmentId, user.tenantId, link, "videoLinkIssued").catch(() => {});
    const fresh = await loadRoomForRead(room.id, user.tenantId);
    const view = await buildDoctorRoomView(fresh, user);
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
    if (room.appointmentId) {
      void notifyVideoLink(room.appointmentId, user.tenantId, link, "videoLinkReissued").catch(() => {});
    }
    await recordAudit(room.id, "state_change", "token_regenerated", undefined, user.tenantId, room.appointmentId);
    return { joinLink: link };
  });

/**
 * Returns a usable share link, minting an ADDITIONAL token.
 *
 * Plaintext tokens are never stored (only SHA-256 hashes), so a previously
 * issued link cannot be read back. Rather than force a destructive rotation
 * every time the host wants to copy the link, this issues another room-scoped,
 * window-bound, individually revocable token; prior links keep working — the
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
    return {
      roomState: room.state,
      waiting: participants.filter((p) => p.role === "patient" && p.status === "requested").map(publicParticipant),
      participants: participants.map(publicParticipant),
      signals,
      cursor: newCursor,
      stopPolling: shouldStopPolling(room.state, localPeer, remotePeer),
      nextPollMs: nextPollDelayMs({ roomState: room.state, localPeer, remotePeer, consecutiveErrors: 0 }),
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
    return await insertSignal(room.id, user.tenantId, "doctor", data.kind, data.payload);
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
    const participant = await loadParticipantById(data.participantId, room.id, user.tenantId);
    if (!participant) throw new Error("Participant not found");

    if (data.decision === "decline") {
      await markParticipantGone(data.participantId, user.tenantId, "removed");
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

/**
 * POST despite being read-shaped: it mints a credential and writes an audit row,
 * so it must not be cacheable or replayable as a navigation.
 */
export const getIceConfigurationServerFn = createServerFn({ method: "POST" })
  .validator((data: { roomId: string }) => {
    if (!data?.roomId) throw new Error("roomId is required");
    return data;
  })
  .handler(async ({ data }): Promise<IceConfiguration> => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    if (room.state !== "active") throw new Error("The consultation is not active.");
    try {
      return buildIceConfiguration(readTurnConfig(), doctorParticipantKey(user.id), Date.now());
    } catch {
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
    return await endRoomAsDoctor(room, user.tenantId, data.reason);
  });

export const reportCallEventServerFn = createServerFn({ method: "POST" })
  .validator((data: { roomId: string; kind: string; detail?: string; peerState?: string; connectedMs?: number }) => {
    if (!data?.roomId || !data?.kind) throw new Error("roomId and kind are required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    const participant = await loadParticipantById(null, room.id, user.tenantId, doctorParticipantKey(user.id));
    if (participant) {
      await updateParticipantState(participant.id, user.tenantId, {
        peerState: data.peerState,
        addConnectedMs: data.connectedMs,
      });
    }
    await recordAudit(room.id, sanitizeEventKind(data.kind), data.detail ?? null, "doctor", user.tenantId, room.appointmentId);
    const roomState = await maybeEndForDisconnect(room, data.kind, user.tenantId);
    return { ok: true, roomState };
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
    return {
      exists: true as const,
      state: room.state,
      outcome: room.outcome,
      endReason: room.endReason,
      connectedSeconds: room.connectedSeconds,
      events: await loadAuditEvents(room.id, user.tenantId),
    };
  });

// ═════════════════════════════════════════════════════════════════════════════
// AD-HOC MEETINGS — instant "start now" and "schedule a link for later"
// ═════════════════════════════════════════════════════════════════════════════

export const createInstantMeetingServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      title?: string;
      scheduledAt?: string | null;
      guestName?: string;
      guestPhone?: string;
      guestEmail?: string;
      autoAdmit?: boolean;
      notify?: boolean;
    }) => {
      if (data.scheduledAt && !Number.isFinite(new Date(data.scheduledAt).getTime())) {
        throw new Error("Invalid meeting date/time");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
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
      // Instant meetings default to auto-admit: the host is on the call now, so
      // a waiting room is pure friction. Scheduled links keep the waiting room.
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

export const listInstantMeetingsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireVideoOperator();
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
 * The host joining their own meeting. For an auto-admit room this also promotes
 * a guest who is already waiting, so they connect immediately.
 */
export const startMeetingServerFn = createServerFn({ method: "POST" })
  .validator((data: { roomId: string }) => {
    if (!data?.roomId) throw new Error("roomId is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    const roomState = await registerHostParticipant(room, user);
    return { roomState, turnConfigured: isTurnConfigured(readTurnConfig()) };
  });

export const getMeetingServerFn = createServerFn({ method: "GET" })
  .validator((data: { roomId: string }) => {
    if (!data?.roomId) throw new Error("roomId is required");
    return data;
  })
  .handler(async ({ data }) => {
    const user = await requireVideoOperator();
    const room = await requireRoomForDoctor(data.roomId, user);
    const extras = await loadRoomExtras(room.id, user.tenantId);
    const participants = await loadParticipants(room.id, user.tenantId);
    const linkCount = await activeLinkCount(room.id, user.tenantId);
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
    return await cancelRoomForHost(room, user.tenantId);
  });

// ═════════════════════════════════════════════════════════════════════════════
// RELAY DIAGNOSTICS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Reports the deployment's relay configuration so the dashboard can show an
 * accurate, actionable status. Returns no secrets — only presence flags and the
 * non-sensitive endpoint hosts.
 */
export const getRelayStatusServerFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireVideoOperator();
  const cfg = readTurnConfig();
  return {
    turnConfigured: isTurnConfigured(cfg),
    hasTurnUrls: cfg.turnUrls.length > 0,
    hasStunUrls: cfg.stunUrls.length > 0,
    hasSharedSecret: !!cfg.sharedSecret,
    realmSet: !!cfg.realm,
    ttlSeconds: cfg.ttlSeconds,
    turnHosts: cfg.turnUrls.map(safeHostOf).filter(Boolean),
    stunHosts: cfg.stunUrls.map(safeHostOf).filter(Boolean),
  };
});

/**
 * Issues an ICE configuration purely for a browser connectivity self-test, so
 * the operator can verify relay reachability before a real consultation.
 */
export const getDiagnosticIceServerFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireVideoOperator();
  return buildIceConfiguration(readTurnConfig(), `diag-${doctorParticipantKey(user.id).slice(0, 16)}`, Date.now());
});

// ═════════════════════════════════════════════════════════════════════════════
// PATIENT PATH — Join_Token only; verifySession is never called.
// ═════════════════════════════════════════════════════════════════════════════

export const getJoinContextServerFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => {
    if (!data?.token) throw new Error("token is required");
    return data;
  })
  .handler(async ({ data }) => {
    const res = await resolveJoinTokenSoft(data.token, await clientKeyFromRequest());
    if (!res.ok) {
      const status: PatientStatus =
        res.status === "rate_limited" ? "rate_limited" : res.status === "expired" ? "expired" : "invalid";
      return projectForPatient({ status });
    }
    const { room } = res.value;
    const participant = await loadPatientParticipant(room.id, room.tenantId);
    const facts = await patientFactsFor(room);
    return projectForPatient({
      status: patientStatusFrom(room, participant),
      clinicName: facts.clinicName,
      doctorName: facts.doctorName,
      appointmentAt: facts.appointmentAt,
      noticeVersion: room.noticeVersion,
    });
  });

export const acceptConsentServerFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; noticeVersion?: string }) => {
    if (!data?.token) throw new Error("token is required");
    return data;
  })
  .handler(async ({ data }) => {
    const { room } = await resolveJoinTokenOrThrow(data.token, await clientKeyFromRequest());
    await recordConsent(room);
    await recordAudit(room.id, "consent_accepted", room.noticeVersion, "patient", room.tenantId, room.appointmentId);
    return { ok: true };
  });

export const requestEntryServerFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => {
    if (!data?.token) throw new Error("token is required");
    return data;
  })
  .handler(async ({ data }) => {
    const { room } = await resolveJoinTokenOrThrow(data.token, await clientKeyFromRequest());
    if (!(await hasConsent(room))) throw new Error("CONSENT_REQUIRED");

    // Appointment rooms name the patient from the booking; ad-hoc rooms use the
    // guest name the host supplied.
    let displayName = "Patient";
    if (room.appointmentId) {
      const appt = await loadAppointmentForVideo(room.appointmentId, room.tenantId);
      displayName = appt?.name ?? "Patient";
    } else {
      const extras = await loadRoomExtras(room.id, room.tenantId);
      displayName = extras?.guestName ?? "Guest";
    }

    await upsertParticipant({
      tenantId: room.tenantId,
      roomId: room.id,
      role: "patient",
      participantKey: patientParticipantKey(room.id),
      displayName,
      status: "requested",
    });
    await recordAudit(room.id, "joined", "patient_requested_entry", "patient", room.tenantId, room.appointmentId);

    if (room.state === "scheduled") {
      try {
        await transitionRoom(room.id, "patient_arrived", {
          tenantId: room.tenantId,
          appointmentId: room.appointmentId,
          actorRole: "patient",
          detail: "patient_arrived",
        });
      } catch {
        /* concurrent transition */
      }
    }

    // Auto-admit rooms skip the waiting room, but only once the host is actually
    // present — otherwise the guest would land in an "active" room alone.
    const extras = await loadRoomExtras(room.id, room.tenantId);
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
          /* concurrent transition */
        }
      }
    }

    const fresh = await loadRoomForRead(room.id, room.tenantId);
    return { status: patientStatusFrom(fresh, await loadPatientParticipant(room.id, room.tenantId)) };
  });

export const getJoinStatusServerFn = createServerFn({ method: "GET" })
  .validator((data: { token: string; afterSeq?: number; peerState?: string }) => {
    if (!data?.token) throw new Error("token is required");
    return data;
  })
  .handler(async ({ data }) => {
    const res = await resolveJoinTokenSoft(data.token, await clientKeyFromRequest());
    if (!res.ok) {
      const status: PatientStatus =
        res.status === "rate_limited" ? "rate_limited" : res.status === "expired" ? "expired" : "invalid";
      return { status, signals: [], cursor: Number(data.afterSeq ?? 0), stopPolling: true, nextPollMs: null, noticeVersion: "v1" };
    }

    const room = await loadRoomForRead(res.value.room.id, res.value.room.tenantId);
    const participant = await loadPatientParticipant(room.id, room.tenantId);
    const status = patientStatusFrom(room, participant);

    const cursor = Number(data.afterSeq ?? 0);
    let signals: Array<{ seq: number; kind: string; senderRole: string; payload: string }> = [];
    let newCursor = cursor;
    if (room.state === "active" && participant?.status === "admitted") {
      const recs = await readSignalsAfter(room.id, room.tenantId, cursor, "patient");
      signals = recs;
      for (const s of recs) if (s.seq > newCursor) newCursor = s.seq;
    }

    if (participant && data.peerState) {
      await updateParticipantState(participant.id, room.tenantId, { peerState: data.peerState });
    }

    const doctor = (await loadParticipants(room.id, room.tenantId)).find((p) => p.role === "doctor");
    const remotePeer = (doctor?.peerState as PeerState) ?? "new";
    const localPeer = (data.peerState as PeerState) ?? "new";
    return {
      status,
      signals,
      cursor: newCursor,
      stopPolling: shouldStopPolling(room.state, localPeer, remotePeer),
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
    const { room } = await resolveJoinTokenOrThrow(data.token, await clientKeyFromRequest());
    const participant = await loadPatientParticipant(room.id, room.tenantId);
    if (!participant || participant.status !== "admitted" || room.state !== "active") {
      throw new Error("You have not been admitted yet.");
    }
    return await insertSignal(room.id, room.tenantId, "patient", data.kind, data.payload);
  });

export const patientIceConfigServerFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => {
    if (!data?.token) throw new Error("token is required");
    return data;
  })
  .handler(async ({ data }): Promise<IceConfiguration> => {
    const { room } = await resolveJoinTokenOrThrow(data.token, await clientKeyFromRequest());
    const participant = await loadPatientParticipant(room.id, room.tenantId);
    if (!participant || participant.status !== "admitted" || room.state !== "active") {
      throw new Error("You have not been admitted yet.");
    }
    try {
      return buildIceConfiguration(readTurnConfig(), patientParticipantKey(room.id), Date.now());
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
    const { room } = await resolveJoinTokenOrThrow(data.token, await clientKeyFromRequest());
    const participant = await loadPatientParticipant(room.id, room.tenantId);
    if (participant) {
      await updateParticipantState(participant.id, room.tenantId, {
        peerState: data.peerState,
        addConnectedMs: data.connectedMs,
      });
    }
    await recordAudit(room.id, sanitizeEventKind(data.kind), data.detail ?? null, "patient", room.tenantId, room.appointmentId);
    const roomState = await maybeEndForDisconnect(room, data.kind, room.tenantId);
    return { ok: true, roomState };
  });

export const patientLeaveServerFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; reason?: string }) => {
    if (!data?.token) throw new Error("token is required");
    return data;
  })
  .handler(async ({ data }) => {
    const { room } = await resolveJoinTokenOrThrow(data.token, await clientKeyFromRequest());
    const participant = await loadPatientParticipant(room.id, room.tenantId);
    if (participant) await markParticipantGone(participant.id, room.tenantId, "left");
    await recordAudit(room.id, "left", "patient_left", "patient", room.tenantId, room.appointmentId);

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
        /* concurrent transition */
      }
    }
    return { status: isTerminalStateName(state) ? state : "ended" };
  });
