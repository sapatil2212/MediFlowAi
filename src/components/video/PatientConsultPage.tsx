// ─────────────────────────────────────────────────────────────────────────────
// PatientConsultPage.tsx — the unauthenticated patient consultation flow.
//
// consent → preflight → request entry → waiting → in-call → ended.
// Discloses only the four permitted facts (clinic, doctor, appointment time,
// status); invalid / expired / rate-limited links show terminal pages with no
// appointment, patient, or tenant detail.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from "react";
import { HeartPulse, Loader2, ShieldCheck, Clock, XCircle, CheckCircle2 } from "lucide-react";
import {
  getJoinContextServerFn,
  acceptConsentServerFn,
  requestEntryServerFn,
  getJoinStatusServerFn,
} from "../../lib/video";
import type { PatientRoomProjection } from "../../lib/video-consultation";
import { buildPatientTransport } from "./videoTransport";
import { VideoCallShell } from "./VideoCallShell";
import { patientIceConfigServerFn } from "../../lib/video";

type Phase =
  | "loading"
  | "consent"
  | "preflight"
  | "waiting"
  | "active"
  | "ended"
  | "declined"
  | "invalid"
  | "expired"
  | "rate_limited"
  /** The server or network failed. Distinct from `invalid`: the link may be fine. */
  | "unavailable";

export function PatientConsultPage({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [ctx, setCtx] = useState<PatientRoomProjection | null>(null);
  const [audioOnly, setAudioOnly] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial context load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getJoinContextServerFn({ data: { token } });
        if (cancelled) return;
        setCtx(c);
        mapStatusToPhase(c.status, setPhase, true);
      } catch (e: any) {
        // A thrown call is a transport or server fault. Reporting it as an
        // invalid link sent us chasing the wrong bug once already.
        console.error("[consult] could not load join context:", e?.message);
        if (!cancelled) setPhase("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Poll for status while waiting (until admitted / terminal).
  const startStatusPolling = useCallback(() => {
    const tick = async () => {
      try {
        const r = await getJoinStatusServerFn({ data: { token, afterSeq: 0, peerState: "new" } });
        const s = r.status;
        if (s === "active" || (s === "admitted" as string)) {
          setPhase("active");
          return; // VideoCallShell takes over polling
        }
        if (s === "ended") return setPhase("ended");
        if (s === "expired") return setPhase("expired");
        if (s === "invalid") return setPhase("invalid");
        if (s === "rate_limited") return setPhase("rate_limited");
        if (s === "declined") return setPhase("declined");
        pollTimer.current = setTimeout(tick, 2500);
      } catch {
        pollTimer.current = setTimeout(tick, 4000);
      }
    };
    void tick();
  }, [token]);

  useEffect(() => {
    if (phase === "waiting") startStatusPolling();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [phase, startStatusPolling]);

  const acceptConsent = useCallback(async () => {
    try {
      await acceptConsentServerFn({ data: { token, noticeVersion: ctx?.noticeVersion ?? "v1" } });
      setPhase("preflight");
    } catch {
      setPreflightError("Could not record your consent. Please retry.");
    }
  }, [token, ctx]);

  const proceedFromPreflight = useCallback(
    async (opts: { audioOnly: boolean }) => {
      setAudioOnly(opts.audioOnly);
      try {
        const r = await requestEntryServerFn({ data: { token } });
        if (r.status === "active" || r.status === "admitted") setPhase("active");
        else setPhase("waiting");
      } catch (e: any) {
        const msg = String(e?.message ?? "");
        if (msg.includes("CONSENT_REQUIRED")) setPhase("consent");
        else if (msg.includes("EXPIRED")) setPhase("expired");
        else if (msg.includes("RATE_LIMITED")) setPhase("rate_limited");
        else setPhase("invalid");
      }
    },
    [token],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  if (phase === "active") {
    return (
      <div className="fixed inset-0 z-50">
        <VideoCallShell
          role="patient"
          transport={buildPatientTransport(token)}
          fetchIce={async () => (await patientIceConfigServerFn({ data: { token } })) as any}
          audioOnly={audioOnly}
          peerName={ctx?.doctorName ?? "your doctor"}
          onEnded={() => setPhase("ended")}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-b from-blue-50 to-white p-4">
      <div className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-2">
          <HeartPulse className="h-6 w-6 text-blue-600" />
          <span className="text-lg font-bold text-zinc-900">Video Consultation</span>
        </div>

        {phase === "loading" && <Centered><Loader2 className="h-7 w-7 animate-spin text-blue-600" /></Centered>}

        {phase === "consent" && ctx && (
          <ConsentBody ctx={ctx} onAccept={acceptConsent} error={preflightError} />
        )}

        {phase === "preflight" && (
          <PreflightBody
            onProceed={proceedFromPreflight}
            error={preflightError}
            setError={setPreflightError}
          />
        )}

        {phase === "waiting" && ctx && (
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
            <h2 className="mt-4 text-lg font-bold text-zinc-900">You're in the waiting room</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {ctx.doctorName ? `${ctx.doctorName} will admit you shortly.` : "The doctor will admit you shortly."}
            </p>
            <AppointmentMeta ctx={ctx} />
          </div>
        )}

        {phase === "declined" && (
          <Terminal icon={<XCircle className="h-8 w-8 text-amber-500" />} title="Not admitted">
            The doctor was unable to admit you to this consultation. Please contact the clinic to reschedule.
          </Terminal>
        )}

        {phase === "ended" && (
          <Terminal icon={<CheckCircle2 className="h-8 w-8 text-emerald-500" />} title="Consultation ended">
            Thank you. Your video consultation has ended. The clinic has your visit on record.
          </Terminal>
        )}

        {phase === "expired" && (
          <Terminal icon={<Clock className="h-8 w-8 text-zinc-400" />} title="This link has expired">
            Your consultation link is no longer valid. Please contact the clinic if you still need to be seen.
          </Terminal>
        )}

        {phase === "rate_limited" && (
          <Terminal icon={<Clock className="h-8 w-8 text-amber-500" />} title="Too many attempts">
            Please wait a moment and try opening your link again.
          </Terminal>
        )}

        {phase === "invalid" && (
          <Terminal icon={<XCircle className="h-8 w-8 text-red-500" />} title="This link is not valid">
            We couldn't open this consultation. Please check the link the clinic sent you.
          </Terminal>
        )}

        {phase === "unavailable" && (
          <div className="py-4 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-50">
              <XCircle className="h-8 w-8 text-amber-500" />
            </div>
            <h2 className="text-lg font-bold text-zinc-900">We couldn't reach the clinic</h2>
            <p className="mx-auto mt-2 max-w-xs text-sm text-zinc-500">
              Your link looks fine — the service did not respond. Please retry in a moment.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mx-auto mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function mapStatusToPhase(status: string, setPhase: (p: Phase) => void, initial: boolean) {
  switch (status) {
    case "invalid":
      return setPhase("invalid");
    case "expired":
      return setPhase("expired");
    case "rate_limited":
      return setPhase("rate_limited");
    case "ended":
      return setPhase("ended");
    case "declined":
      return setPhase("declined");
    case "active":
    case "admitted":
      return setPhase("active");
    case "waiting":
      return setPhase(initial ? "consent" : "waiting");
    default:
      return setPhase("consent");
  }
}

function ConsentBody({
  ctx,
  onAccept,
  error,
}: {
  ctx: PatientRoomProjection;
  onAccept: () => void;
  error: string | null;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div>
      <h2 className="text-lg font-bold text-zinc-900">Before you join</h2>
      <AppointmentMeta ctx={ctx} />
      <div className="mt-4 space-y-2 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600">
        <p className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          This is a private teleconsultation. Audio and video travel directly between you and your clinician and are
          <strong className="font-semibold"> not recorded</strong>.
        </p>
        <p>You'll be asked for camera and microphone access, then wait briefly until the doctor admits you.</p>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-zinc-700">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="h-4 w-4 rounded" />
        I understand and consent to a remote consultation.
      </label>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      <button
        disabled={!checked}
        onClick={onAccept}
        className="mt-5 w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Continue
      </button>
    </div>
  );
}

function PreflightBody({
  onProceed,
  error,
  setError,
}: {
  onProceed: (opts: { audioOnly: boolean }) => void;
  error: string | null;
  setError: (s: string | null) => void;
}) {
  const [checking, setChecking] = useState(true);
  const [supported, setSupported] = useState(true);
  const [hasCamera, setHasCamera] = useState(true);
  const [hasMic, setHasMic] = useState(true);
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof RTCPeerConnection === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setSupported(false);
        setChecking(false);
        return;
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cam = devices.some((d) => d.kind === "videoinput");
        const mic = devices.some((d) => d.kind === "audioinput");
        if (cancelled) return;
        setHasCamera(cam);
        setHasMic(mic);
        if (!cam && !mic) {
          setError("No camera or microphone was found on this device.");
          setChecking(false);
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: mic, video: cam });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (previewRef.current) previewRef.current.srcObject = stream;
        setError(null);
      } catch (e: any) {
        if (e?.name === "NotAllowedError") setError("Camera and microphone access was blocked. Allow access in your browser and retry.");
        else if (e?.name === "NotFoundError") setError("No camera or microphone was found.");
        else setError("Could not access your camera or microphone.");
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [setError]);

  if (!supported) {
    return (
      <Terminal icon={<XCircle className="h-8 w-8 text-red-500" />} title="Browser not supported">
        Your browser does not support video calls. Please use the latest Chrome, Edge, Safari, or Firefox.
      </Terminal>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-zinc-900">Check your camera & mic</h2>
      <div className="mt-3 aspect-video overflow-hidden rounded-xl bg-zinc-900">
        <video ref={previewRef} autoPlay playsInline muted className="h-full w-full object-cover" />
      </div>
      {checking && (
        <p className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking devices…
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      <div className="mt-5 flex flex-col gap-2">
        <button
          disabled={checking || (!hasCamera && !hasMic)}
          onClick={() => {
            streamRef.current?.getTracks().forEach((t) => t.stop());
            onProceed({ audioOnly: !hasCamera });
          }}
          className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {hasCamera ? "Join consultation" : "Join with audio only"}
        </button>
        {error && (
          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-xl border border-zinc-300 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

function AppointmentMeta({ ctx }: { ctx: PatientRoomProjection }) {
  return (
    <div className="mt-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3 text-sm">
      {ctx.clinicName && <p className="font-semibold text-zinc-800">{ctx.clinicName}</p>}
      {ctx.doctorName && <p className="text-zinc-600">{ctx.doctorName}</p>}
      {ctx.appointmentAt && (
        <p className="mt-1 text-zinc-500">
          {new Date(ctx.appointmentAt).toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
    </div>
  );
}

function Terminal({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="py-4 text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-50">{icon}</div>
      <h2 className="text-lg font-bold text-zinc-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-xs text-sm text-zinc-500">{children}</p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center py-10">{children}</div>;
}
