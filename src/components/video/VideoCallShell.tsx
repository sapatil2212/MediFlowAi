// ─────────────────────────────────────────────────────────────────────────────
// VideoCallShell.tsx — the in-call UI shared by doctor and patient.
//
// Owns a VideoPeer instance for its lifetime: local preview + remote video,
// mic/camera toggles, device pickers, quality badge, a persistent "not recorded"
// indicator, reconnecting banner, and the end-call control. Media errors are
// surfaced via the design's taxonomy.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  PhoneOff,
  Settings,
  Loader2,
  Wifi,
  ShieldCheck,
  Check,
  Copy,
  Users,
  Link as LinkIcon,
} from "lucide-react";
import { VideoPeer, type IceConfigLike, type VideoTransport } from "../../lib/video-peer";
import type { ParticipantRole, PeerState, QualityLevel } from "../../lib/video-consultation";
import { cn } from "../../lib/utils";

interface VideoCallShellProps {
  role: ParticipantRole;
  transport: VideoTransport;
  /** Fetches the initial ICE config (doctor: roomId scoped; patient: token scoped). */
  fetchIce: () => Promise<IceConfigLike>;
  audioOnly?: boolean;
  deviceIds?: { audio?: string; video?: string };
  peerName?: string;
  onEnded?: (reason: string) => void;
  /** Optional side panel (doctor documentation drawer). */
  sidePanel?: React.ReactNode;
  /** Shown in the meeting-info chip, Google-Meet style. */
  meetingCode?: string | null;
  /** When present, the info chip offers a one-click copy of the invite link. */
  shareLink?: string | null;
}

const QUALITY_STYLES: Record<QualityLevel, string> = {
  good: "bg-emerald-500/15 text-emerald-600",
  fair: "bg-amber-500/15 text-amber-600",
  poor: "bg-red-500/15 text-red-600",
};

export function VideoCallShell({
  role,
  transport,
  fetchIce,
  audioOnly,
  deviceIds,
  peerName,
  onEnded,
  sidePanel,
  meetingCode,
  shareLink,
}: VideoCallShellProps) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<VideoPeer | null>(null);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(!audioOnly);
  const [peerState, setPeerState] = useState<PeerState>("new");
  const [quality, setQuality] = useState<QualityLevel>("good");
  const [reconnecting, setReconnecting] = useState(false);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [linkCopied, setLinkCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  /** True until the server confirms the other participant is in the room. */
  const [waitingForPeer, setWaitingForPeer] = useState(true);
  /** Bumped by Retry to rebuild the peer in place instead of reloading the page. */
  const [attempt, setAttempt] = useState(0);

  // Call timer, started once the peer connection is up.
  useEffect(() => {
    if (peerState !== "connected") return;
    const started = Date.now() - elapsed * 1000;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerState]);

  const copyInvite = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  useEffect(() => {
    let cancelled = false;
    const peer = new VideoPeer({
      role,
      transport,
      audioOnly,
      callbacks: {
        onLocalStream: (s) => {
          if (localRef.current) localRef.current.srcObject = s;
        },
        onRemoteStream: (s) => {
          if (remoteRef.current) remoteRef.current.srcObject = s;
          setRemoteConnected(!!s && s.getTracks().length > 0);
        },
        onPeerState: setPeerState,
        onQuality: setQuality,
        onReconnecting: setReconnecting,
        onWaitingForPeer: setWaitingForPeer,
        onEnded: (reason) => onEnded?.(reason),
        onError: (code, message) => setError({ code, message }),
      },
    });
    peerRef.current = peer;

    (async () => {
      const ok = await peer.initLocalMedia(deviceIds);
      if (cancelled || !ok) return;
      try {
        const ice = await fetchIce();
        if (cancelled) return;
        await peer.connect(ice);
        VideoPeer.enumerateDevices().then((d) => !cancelled && setDevices(d));
      } catch (e: any) {
        setError({ code: "connection_failed", message: e?.message ?? "Could not connect." });
      }
    })();

    return () => {
      cancelled = true;
      peer.destroy();
      peerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  /** Rebuilds the peer connection without losing the surrounding dashboard. */
  const retry = useCallback(() => {
    setError(null);
    setRemoteConnected(false);
    setPeerState("new");
    setWaitingForPeer(true);
    setElapsed(0);
    setAttempt((n) => n + 1);
  }, []);

  const toggleMic = useCallback(() => {
    setMicOn((v) => {
      peerRef.current?.toggleMic(!v);
      return !v;
    });
  }, []);

  const toggleCam = useCallback(() => {
    setCamOn((v) => {
      peerRef.current?.toggleCamera(!v);
      return !v;
    });
  }, []);

  const endCall = useCallback(() => {
    const reason = role === "doctor" ? "doctor_ended" : "patient_ended";
    peerRef.current?.endCall(reason).finally(() => onEnded?.(reason));
  }, [role, onEnded]);

  const switchDevice = useCallback((kind: "audio" | "video", id: string) => {
    void peerRef.current?.switchDevice(kind, id);
  }, []);

  // "Waiting" and "connecting" are genuinely different states: alone in the room
  // versus negotiating with someone who has arrived.
  const connecting = !waitingForPeer && peerState !== "connected" && !error;
  const showLobby = waitingForPeer && !remoteConnected && !error;

  return (
    <div className="relative flex h-full w-full flex-col bg-zinc-950 text-white">
      {/* Remote video (main stage) */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          className={cn("h-full w-full object-cover", !remoteConnected && "opacity-0")}
        />
        {!remoteConnected && !showLobby && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-400">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm font-medium">
              {connecting ? `Connecting${peerName ? ` to ${peerName}` : ""}…` : `Waiting for ${peerName ?? "the other participant"}…`}
            </p>
          </div>
        )}

        {/* Lobby — the host is in the room alone. Meet-style: stay here as long
            as it takes and keep the invite one click away. */}
        {showLobby && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="w-full max-w-md rounded-2xl bg-zinc-900/80 p-6 text-center backdrop-blur">
              <Users className="mx-auto h-8 w-8 text-zinc-500" />
              <p className="mt-3 text-base font-semibold text-white">
                {role === "doctor" ? "You're the only one here" : "Waiting for the doctor to join"}
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                {role === "doctor"
                  ? `Share the link below and the call starts as soon as ${peerName ?? "your patient"} joins.`
                  : "This will connect automatically. Please keep this tab open."}
              </p>

              {role === "doctor" && shareLink && (
                <div className="mt-5 text-left">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Patient join link</p>
                  <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-2">
                    <code className="min-w-0 flex-1 truncate text-xs text-zinc-300">{shareLink}</code>
                    <button
                      onClick={copyInvite}
                      className="flex shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-200"
                    >
                      {linkCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {linkCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  {meetingCode && (
                    <p className="mt-2 text-xs text-zinc-500">
                      Meeting code <span className="font-mono text-zinc-300">{meetingCode}</span>
                    </p>
                  )}
                </div>
              )}

              <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-zinc-500">
                <Loader2 className="h-3 w-3 animate-spin" /> Waiting…
              </p>
            </div>
          </div>
        )}

        {/* Local preview (PiP) */}
        <div className="absolute bottom-4 right-4 h-32 w-24 overflow-hidden rounded-xl border border-white/20 bg-zinc-900 shadow-lg sm:h-40 sm:w-32">
          <video ref={localRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          {!camOn && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
              <VideoOff className="h-5 w-5 text-zinc-500" />
            </div>
          )}
        </div>

        {/* Top status bar */}
        <div className="absolute left-0 right-0 top-0 flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", QUALITY_STYLES[quality])}>
              <Wifi className="h-3 w-3" /> {quality}
            </span>
            <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-zinc-200">
              <ShieldCheck className="h-3 w-3" /> Not recorded
            </span>
            {peerState === "connected" && (
              <span className="rounded-full bg-white/10 px-2.5 py-1 font-mono text-xs text-zinc-200">
                {formatElapsed(elapsed)}
              </span>
            )}
          </div>
          {shareLink && (
            <button
              onClick={copyInvite}
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-zinc-100 backdrop-blur transition hover:bg-white/20"
            >
              {linkCopied ? <Check className="h-3 w-3" /> : <LinkIcon className="h-3 w-3" />}
              {linkCopied ? "Link copied" : "Copy invite"}
            </button>
          )}
        </div>

        {/* Reconnecting banner */}
        {reconnecting && (
          <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-amber-500/90 px-4 py-1.5 text-xs font-semibold text-white shadow-lg">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Reconnecting…
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 p-6">
            <div className="max-w-sm rounded-2xl bg-zinc-900 p-6 text-center shadow-xl">
              <p className="text-sm font-semibold text-red-400">{errorTitle(error.code)}</p>
              <p className="mt-2 text-sm text-zinc-300">{errorHelp(error.code, error.message)}</p>
              <div className="mt-4 flex justify-center gap-2">
                <button
                  onClick={retry}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-200"
                >
                  Retry
                </button>
                <button
                  onClick={endCall}
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-white/10"
                >
                  Leave
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Device settings */}
      {showSettings && (
        <div className="border-t border-white/10 bg-zinc-900 p-3">
          <DevicePicker devices={devices} onPick={switchDevice} />
        </div>
      )}

      {/* Controls — meeting code on the left, controls centred (Meet layout) */}
      <div className="relative flex items-center justify-center gap-3 border-t border-white/10 bg-zinc-900 px-4 py-4">
        {meetingCode && (
          <span className="absolute left-4 hidden font-mono text-xs text-zinc-500 sm:block">{meetingCode}</span>
        )}
        <ControlButton active={micOn} onClick={toggleMic} label={micOn ? "Mute" : "Unmute"}>
          {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </ControlButton>
        <ControlButton active={camOn} onClick={toggleCam} label={camOn ? "Camera off" : "Camera on"} disabled={audioOnly}>
          {camOn ? <VideoIcon className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </ControlButton>
        <ControlButton active={showSettings} onClick={() => setShowSettings((v) => !v)} label="Devices">
          <Settings className="h-5 w-5" />
        </ControlButton>
        <button
          onClick={endCall}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-700"
          aria-label="End call"
        >
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>

      {sidePanel}
    </div>
  );
}

function ControlButton({
  active,
  onClick,
  label,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-12 w-12 items-center justify-center rounded-full transition",
        active ? "bg-white/15 text-white hover:bg-white/25" : "bg-red-600/20 text-red-400 hover:bg-red-600/30",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
    </button>
  );
}

function DevicePicker({
  devices,
  onPick,
}: {
  devices: MediaDeviceInfo[];
  onPick: (kind: "audio" | "video", id: string) => void;
}) {
  const mics = devices.filter((d) => d.kind === "audioinput");
  const cams = devices.filter((d) => d.kind === "videoinput");
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <label className="flex-1 text-xs text-zinc-400">
        Microphone
        <select
          onChange={(e) => onPick("audio", e.target.value)}
          className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-800 px-2 py-1.5 text-sm text-white"
        >
          {mics.map((m) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || "Microphone"}
            </option>
          ))}
        </select>
      </label>
      <label className="flex-1 text-xs text-zinc-400">
        Camera
        <select
          onChange={(e) => onPick("video", e.target.value)}
          className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-800 px-2 py-1.5 text-sm text-white"
        >
          {cams.map((c) => (
            <option key={c.deviceId} value={c.deviceId}>
              {c.label || "Camera"}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function errorTitle(code: string): string {
  switch (code) {
    case "device_denied":
      return "Camera / microphone blocked";
    case "no_device":
      return "No camera or microphone found";
    case "connection_failed":
      return "Could not connect";
    case "turn_unavailable":
      return "Could not prepare a secure connection";
    default:
      return "Something went wrong";
  }
}

function errorHelp(code: string, message: string): string {
  switch (code) {
    case "device_denied":
      return "Please allow camera and microphone access in your browser's address bar, then retry.";
    case "no_device":
      return "Connect a camera or microphone and retry.";
    case "connection_failed":
      return "Check your network connection and retry. If this keeps happening, contact the clinic.";
    default:
      return message || "Please retry.";
  }
}
