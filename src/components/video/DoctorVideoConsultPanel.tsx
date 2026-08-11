// ─────────────────────────────────────────────────────────────────────────────
// DoctorVideoConsultPanel.tsx — the doctor's video consultation console.
//
// Two sources of consultations, both driven by the same room machinery:
//   • Appointments booked with consultationMode = 'video'
//   • Ad-hoc meetings: instant "start now", share-a-link, or scheduled
//
// Also hosts the waiting room (admit / decline), share-link controls, the relay
// connection test, and the in-call shell + documentation drawer.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Video as VideoIcon,
  Loader2,
  Copy,
  RefreshCw,
  Check,
  UserCheck,
  UserX,
  AlertTriangle,
  Clock,
  PhoneCall,
  CalendarDays,
  Link2,
  Trash2,
} from "lucide-react";
import {
  getVideoRoomServerFn,
  createVideoRoomServerFn,
  regenerateJoinTokenServerFn,
  admitParticipantServerFn,
  getShareLinkServerFn,
  getIceConfigurationServerFn,
  listInstantMeetingsServerFn,
  getMeetingServerFn,
  startMeetingServerFn,
  cancelMeetingServerFn,
} from "../../lib/video";
import { buildDoctorTransport } from "./videoTransport";
import { VideoCallShell } from "./VideoCallShell";
import { CallDocumentationDrawer } from "./CallDocumentationDrawer";
import { NewMeetingPanel } from "./NewMeetingPanel";
import { ConnectionTest } from "./ConnectionTest";
import { cn } from "../../lib/utils";

interface VideoAppointment {
  id: string;
  name: string;
  dateTime: string;
  doctorName?: string;
  status: string;
  consultationMode?: string;
  patientId?: string;
}

interface DoctorVideoConsultPanelProps {
  appointments: VideoAppointment[];
}

/** Consecutive poll failures after which polling stops and prompts a refresh. */
const MAX_POLL_ERRORS = 4;

type Source =
  | { kind: "appointment"; appointmentId: string; label: string; when: string; patientId?: string }
  | { kind: "meeting"; roomId: string; label: string; when: string | null; state: string; meetingCode: string | null };

export function DoctorVideoConsultPanel({ appointments }: DoctorVideoConsultPanelProps) {
  const videoAppointments = appointments.filter((a) => a.consultationMode === "video");

  const [meetings, setMeetings] = useState<any[]>([]);
  const [selected, setSelected] = useState<Source | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inCallRoomId, setInCallRoomId] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [pollError, setPollError] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadMeetings = useCallback(async () => {
    try {
      const rows = await listInstantMeetingsServerFn();
      setMeetings(rows);
    } catch {
      setMeetings([]);
    }
  }, []);

  useEffect(() => {
    void loadMeetings();
  }, [loadMeetings]);

  // Default selection: first upcoming video appointment, else first meeting.
  useEffect(() => {
    if (selected) return;
    if (videoAppointments[0]) {
      const a = videoAppointments[0];
      setSelected({ kind: "appointment", appointmentId: a.id, label: a.name, when: a.dateTime, patientId: a.patientId });
    } else if (meetings[0]) {
      const m = meetings[0];
      setSelected({
        kind: "meeting",
        roomId: m.id,
        label: m.title || m.guestName || "Consultation",
        when: m.scheduledAt,
        state: m.state,
        meetingCode: m.meetingCode,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoAppointments.length, meetings.length]);

  const loadDetail = useCallback(async (src: Source) => {
    setLoading(true);
    try {
      if (src.kind === "appointment") {
        const r = await getVideoRoomServerFn({ data: { appointmentId: src.appointmentId } });
        setDetail(r);
      } else {
        const r = await getMeetingServerFn({ data: { roomId: src.roomId } });
        setDetail({ exists: true, ...r });
      }
    } catch {
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) {
      setShareLink(null);
      void loadDetail(selected);
    }
  }, [selected, loadDetail]);

  // Keep the waiting room fresh while not in a call.
  //
  // Failures back off and eventually stop rather than retrying forever: a tab
  // left open across a redeploy would otherwise poll a dead endpoint
  // indefinitely. `pollError` surfaces that state so the user can refresh.
  useEffect(() => {
    if (!selected || inCallRoomId) return;
    let errors = 0;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      try {
        if (selected.kind === "appointment") {
          const r = await getVideoRoomServerFn({ data: { appointmentId: selected.appointmentId } });
          setDetail(r);
        } else {
          const r = await getMeetingServerFn({ data: { roomId: selected.roomId } });
          setDetail({ exists: true, ...r });
        }
        errors = 0;
        setPollError(false);
      } catch {
        errors++;
        if (errors >= MAX_POLL_ERRORS) {
          setPollError(true);
          stopped = true;
          return;
        }
      }
      const delay = errors > 0 ? Math.min(4000 * 2 ** errors, 30000) : 4000;
      pollRef.current = setTimeout(tick, delay);
    };

    pollRef.current = setTimeout(tick, 4000);
    return () => {
      stopped = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [selected, inCallRoomId]);

  const roomId: string | null = detail?.room?.id ?? (selected?.kind === "meeting" ? selected.roomId : null);

  const createRoomForAppointment = async () => {
    if (selected?.kind !== "appointment") return;
    setBusy(true);
    try {
      const r = await createVideoRoomServerFn({ data: { appointmentId: selected.appointmentId } });
      setDetail({ exists: true, ...(r as any) });
      if ((r as any).joinLink) setShareLink((r as any).joinLink);
    } finally {
      setBusy(false);
    }
  };

  const getLink = async () => {
    if (!roomId) return;
    setBusy(true);
    try {
      const r = await getShareLinkServerFn({ data: { roomId } });
      setShareLink(r.joinLink);
    } finally {
      setBusy(false);
    }
  };

  const resetLink = async () => {
    if (!roomId) return;
    setBusy(true);
    try {
      const r = await regenerateJoinTokenServerFn({ data: { roomId } });
      setShareLink(r.joinLink);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const admit = async (participantId: string, decision: "admit" | "decline") => {
    if (!roomId) return;
    setBusy(true);
    try {
      await admitParticipantServerFn({ data: { roomId, participantId, decision } });
      if (decision === "admit") await joinCall(roomId);
      else if (selected) await loadDetail(selected);
    } finally {
      setBusy(false);
    }
  };

  const joinCall = async (id: string) => {
    try {
      await startMeetingServerFn({ data: { roomId: id } });
    } catch {
      /* room may already be active */
    }
    setInCallRoomId(id);
  };

  const cancelMeeting = async () => {
    if (!roomId) return;
    setBusy(true);
    try {
      await cancelMeetingServerFn({ data: { roomId } });
      await loadMeetings();
      if (selected) await loadDetail(selected);
    } finally {
      setBusy(false);
    }
  };

  // ── In-call overlay ─────────────────────────────────────────────────────
  if (inCallRoomId) {
    const activeId = inCallRoomId;
    return (
      <div className="fixed inset-0 z-50 flex">
        <div className="relative flex-1">
          <VideoCallShell
            role="doctor"
            transport={buildDoctorTransport(activeId)}
            fetchIce={async () => (await getIceConfigurationServerFn({ data: { roomId: activeId } })) as any}
            peerName={detail?.appointment?.name ?? detail?.guestName ?? "patient"}
            meetingCode={detail?.meetingCode ?? null}
            shareLink={shareLink}
            onEnded={() => {
              setInCallRoomId(null);
              if (selected?.kind === "appointment") setDocsOpen(true);
              void loadMeetings();
              if (selected) void loadDetail(selected);
            }}
          />
          {selected?.kind === "appointment" && (
            <button
              onClick={() => setDocsOpen((v) => !v)}
              className="absolute right-4 top-16 z-10 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-white/20"
            >
              Notes
            </button>
          )}
        </div>
        {selected?.kind === "appointment" && (
          <CallDocumentationDrawer
            open={docsOpen}
            onClose={() => setDocsOpen(false)}
            appointmentId={selected.appointmentId}
            patientId={detail?.appointment?.patientId ?? selected.patientId ?? null}
            patientName={detail?.appointment?.name ?? selected.label}
          />
        )}
      </div>
    );
  }

  // ── Console ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {pollError && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zinc-100 p-3">
          <p className="text-xs text-zinc-700">
            Lost contact with the server — this page may be out of date.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800"
          >
            Refresh
          </button>
        </div>
      )}

      <NewMeetingPanel onStartCall={(id) => void joinCall(id)} onCreated={loadMeetings} />

      {/* Relay status — actionable rather than a dead-end warning */}
      {detail?.turnConfigured === false && !showTest && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-3">
          <p className="flex items-start gap-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            No relay server configured — calls may fail when the patient is on a different network.
          </p>
          <button
            onClick={() => setShowTest(true)}
            className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
          >
            Diagnose & fix
          </button>
        </div>
      )}
      {showTest && (
        <div>
          <ConnectionTest />
          <button
            onClick={() => setShowTest(false)}
            className="mt-2 text-xs font-semibold text-zinc-500 hover:text-zinc-800"
          >
            Hide
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        {/* Left: consultations */}
        <div className="space-y-4">
          <ListCard
            title="Video appointments"
            icon={<CalendarDays className="h-4 w-4 text-blue-600" />}
            empty="No video appointments booked."
            items={videoAppointments.map((a) => ({
              key: a.id,
              active: selected?.kind === "appointment" && selected.appointmentId === a.id,
              primary: a.name,
              secondary: new Date(a.dateTime).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
              onClick: () =>
                setSelected({ kind: "appointment", appointmentId: a.id, label: a.name, when: a.dateTime, patientId: a.patientId }),
            }))}
          />
          <ListCard
            title="Meetings & links"
            icon={<Link2 className="h-4 w-4 text-blue-600" />}
            empty="No meeting links yet."
            items={meetings.map((m) => ({
              key: m.id,
              active: selected?.kind === "meeting" && selected.roomId === m.id,
              primary: m.title || m.guestName || "Consultation",
              secondary: m.scheduledAt
                ? new Date(m.scheduledAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : m.meetingCode || "Instant",
              badge: m.state,
              onClick: () =>
                setSelected({
                  kind: "meeting",
                  roomId: m.id,
                  label: m.title || m.guestName || "Consultation",
                  when: m.scheduledAt,
                  state: m.state,
                  meetingCode: m.meetingCode,
                }),
            }))}
          />
        </div>

        {/* Right: detail */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          {!selected ? (
            <div className="flex h-48 items-center justify-center text-sm text-zinc-400">
              Select a consultation, or start a new one above.
            </div>
          ) : loading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-zinc-900">{detail?.title || selected.label}</h2>
                  <p className="text-sm text-zinc-500">
                    {selected.when
                      ? new Date(selected.when).toLocaleString(undefined, {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Instant meeting"}
                  </p>
                  {detail?.meetingCode && (
                    <p className="mt-1 font-mono text-xs text-zinc-400">{detail.meetingCode}</p>
                  )}
                </div>
                {detail?.room?.state && <StateBadge state={detail.room.state} />}
              </div>

              {selected.kind === "appointment" && detail?.exists === false ? (
                <button
                  onClick={createRoomForAppointment}
                  disabled={busy}
                  className="mt-5 flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <VideoIcon className="h-4 w-4" />}
                  Create consultation room
                </button>
              ) : (
                <>
                  {/* Share link */}
                  <div className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Patient join link</p>
                    {shareLink ? (
                      <div className="mt-2 flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1.5 text-xs text-zinc-700 ring-1 ring-zinc-200">
                          {shareLink}
                        </code>
                        <button
                          onClick={copy}
                          className="flex shrink-0 items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800"
                        >
                          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-zinc-500">
                        {detail?.linkActive
                          ? "A link has already been sent to the patient."
                          : "No link has been issued yet."}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        onClick={getLink}
                        disabled={busy}
                        className="flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 disabled:opacity-50"
                      >
                        <Link2 className="h-3.5 w-3.5" /> {shareLink ? "New link" : "Get link"}
                      </button>
                      <button
                        onClick={resetLink}
                        disabled={busy}
                        title="Invalidate every previously shared link and issue a fresh one"
                        className="flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 disabled:opacity-50"
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} /> Reset & resend
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed text-zinc-400">
                      Links are stored hashed and can't be read back, so "Get link" issues an additional valid link.
                      Use "Reset" to invalidate everything shared previously.
                    </p>
                  </div>

                  {/* Waiting room */}
                  <div className="mt-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Waiting room</p>
                    {(detail?.waiting?.length ?? 0) === 0 ? (
                      <p className="mt-2 flex items-center gap-2 text-sm text-zinc-400">
                        <Clock className="h-4 w-4" /> No one is waiting yet.
                      </p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {detail.waiting.map((p: any) => (
                          <div key={p.id} className="flex items-center justify-between rounded-xl border border-zinc-100 p-3">
                            <span className="text-sm font-medium text-zinc-800">{p.displayName ?? "Patient"}</span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => admit(p.id, "admit")}
                                disabled={busy}
                                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                <UserCheck className="h-3.5 w-3.5" /> Admit
                              </button>
                              <button
                                onClick={() => admit(p.id, "decline")}
                                disabled={busy}
                                className="flex items-center gap-1 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-200 disabled:opacity-50"
                              >
                                <UserX className="h-3.5 w-3.5" /> Decline
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {roomId && !isTerminalState(detail?.room?.state) && (
                      <button
                        onClick={() => void joinCall(roomId)}
                        className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                      >
                        <PhoneCall className="h-4 w-4" />
                        {detail?.room?.state === "active" ? "Rejoin consultation" : "Join consultation"}
                      </button>
                    )}
                    {selected.kind === "meeting" && roomId && !isTerminalState(detail?.room?.state) && (
                      <button
                        onClick={cancelMeeting}
                        disabled={busy}
                        className="flex items-center gap-1.5 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" /> Cancel meeting
                      </button>
                    )}
                  </div>

                  {/* Outcome summary once finished */}
                  {isTerminalState(detail?.room?.state) && (
                    <div className="mt-4 rounded-xl bg-zinc-50 p-3 text-xs text-zinc-600">
                      <p>
                        <span className="font-semibold">Outcome:</span> {detail?.room?.outcome ?? "—"}
                      </p>
                      <p>
                        <span className="font-semibold">Duration:</span>{" "}
                        {formatDuration(detail?.room?.connectedSeconds ?? 0)}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {!showTest && detail?.turnConfigured !== false && (
        <details className="rounded-xl border border-zinc-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-zinc-600">
            Connection diagnostics
          </summary>
          <div className="border-t border-zinc-100 p-3">
            <ConnectionTest compact />
          </div>
        </details>
      )}
    </div>
  );
}

function isTerminalState(s?: string): boolean {
  return s === "ended" || s === "expired" || s === "cancelled";
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function ListCard({
  title,
  icon,
  empty,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  empty: string;
  items: Array<{
    key: string;
    active: boolean;
    primary: string;
    secondary: string;
    badge?: string;
    onClick: () => void;
  }>;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3">
      <div className="mb-2 flex items-center gap-2 px-2 py-1">
        {icon}
        <h3 className="text-sm font-bold text-zinc-900">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="px-2 py-5 text-center text-xs text-zinc-400">{empty}</p>
      ) : (
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {items.map((it) => (
            <button
              key={it.key}
              onClick={it.onClick}
              className={cn(
                "w-full rounded-xl px-3 py-2.5 text-left transition",
                it.active ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-zinc-50",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-semibold text-zinc-800">{it.primary}</p>
                {it.badge && <StateBadge state={it.badge} small />}
              </div>
              <p className="truncate text-xs text-zinc-500">{it.secondary}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StateBadge({ state, small }: { state: string; small?: boolean }) {
  const styles: Record<string, string> = {
    scheduled: "bg-zinc-100 text-zinc-600",
    waiting: "bg-amber-100 text-amber-700",
    active: "bg-emerald-100 text-emerald-700",
    ended: "bg-blue-100 text-blue-700",
    expired: "bg-zinc-100 text-zinc-500",
    cancelled: "bg-red-100 text-red-600",
  };
  return (
    <span
      className={cn(
        "shrink-0 rounded-full font-semibold capitalize",
        small ? "px-2 py-0.5 text-[9px]" : "px-3 py-1 text-xs",
        styles[state] ?? "bg-zinc-100 text-zinc-600",
      )}
    >
      {state}
    </span>
  );
}
