// ─────────────────────────────────────────────────────────────────────────────
// video-peer.ts — browser WebRTC controller (client-only).
//
// A framework-free class wrapping ONE RTCPeerConnection, driven by the pure
// `./video-consultation` module. Uses only browser-native WebRTC APIs (Req 11.5):
// getUserMedia, enumerateDevices, RTCPeerConnection, RTCRtpSender.replaceTrack,
// setSinkId, getStats. No third-party SDK, no server imports.
//
// Signalling transport is injected by the caller (doctor or patient page), so
// this controller is identical on both sides; only the fixed role differs.
//
// Perfect negotiation with FIXED roles removes glare tiebreaks entirely:
//   doctor  = impolite, offerer
//   patient = polite, answerer
// ─────────────────────────────────────────────────────────────────────────────
import {
  classifyQuality,
  shouldEndForDisconnect,
  type ParticipantRole,
  type PeerState,
  type QualityLevel,
  type SignalKind,
} from "./video-consultation";

export interface IceConfigLike {
  iceServers: Array<{ urls: string[]; username?: string; credential?: string }>;
  iceTransportPolicy?: "all";
  turnConfigured?: boolean;
  expiresAtUnix?: number | null;
}

export interface IncomingSignal {
  seq: number;
  kind: SignalKind;
  senderRole: ParticipantRole;
  payload: string;
}

export interface PollResult {
  signals: IncomingSignal[];
  cursor: number;
  stopPolling: boolean;
  nextPollMs: number | null;
  /** Room/patient status string; the controller only reacts to terminal values. */
  status?: string;
  roomState?: string;
  /**
   * True once the OTHER participant is in the room and permitted to signal.
   * The controller holds back its offer and ICE candidates until this is true,
   * so a host waiting alone in the lobby produces no wasted negotiation and no
   * spurious connection failure.
   */
  remotePresent?: boolean;
}

/** The server calls the caller wires in; the controller stays transport-agnostic. */
export interface VideoTransport {
  publishSignal(kind: SignalKind, payload: string): Promise<void>;
  poll(afterSeq: number, peerState: PeerState): Promise<PollResult>;
  fetchIce(): Promise<IceConfigLike>;
  reportEvent(kind: string, extra?: { peerState?: PeerState; connectedMs?: number; detail?: string }): Promise<void>;
  end(reason: string): Promise<void>;
}

export interface VideoPeerCallbacks {
  onLocalStream?(stream: MediaStream): void;
  onRemoteStream?(stream: MediaStream | null): void;
  onPeerState?(state: PeerState): void;
  onQuality?(level: QualityLevel): void;
  onReconnecting?(active: boolean): void;
  onRemoteMedia?(state: { audio: boolean; video: boolean }): void;
  onEnded?(reason: string): void;
  onError?(code: string, message: string): void;
  onRoomStatus?(status: string): void;
  /** true while we are alone in the room; false once the other side is present. */
  onWaitingForPeer?(waiting: boolean): void;
}

export interface VideoPeerOptions {
  role: ParticipantRole;
  transport: VideoTransport;
  callbacks?: VideoPeerCallbacks;
  /** audio-only when no camera is available/granted. */
  audioOnly?: boolean;
}

const QUALITY_SAMPLE_MS = 5000;
const CONNECT_DEADLINE_MS = 45_000;
const RECONNECT_SPACING_MS = [2000, 4000, 8000];

export class VideoPeer {
  private readonly role: ParticipantRole;
  private readonly polite: boolean;
  private readonly transport: VideoTransport;
  private readonly cb: VideoPeerCallbacks;
  private audioOnly: boolean;

  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private audioSender: RTCRtpSender | null = null;
  private videoSender: RTCRtpSender | null = null;

  private makingOffer = false;
  private ignoreOffer = false;
  /** Set once the server reports the other participant is in the room. */
  private remotePresent = false;
  /** A negotiation was requested while we were still alone; run it on arrival. */
  private negotiationPending = false;
  /** Local ICE candidates gathered before the peer arrived. */
  private queuedLocalCandidates: string[] = [];
  private cursor = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private qualityTimer: ReturnType<typeof setInterval> | null = null;
  private connectDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  private closed = false;
  private connectedSince: number | null = null;
  private reportedConnectedMs = 0;
  private disconnectedSince: number | null = null;
  private disconnectedTotalMs = 0;
  private consecutivePollErrors = 0;

  private prevStats: { packetsReceived: number; packetsLost: number; ts: number } | null = null;

  constructor(opts: VideoPeerOptions) {
    this.role = opts.role;
    this.polite = opts.role === "patient";
    this.transport = opts.transport;
    this.cb = opts.callbacks ?? {};
    this.audioOnly = !!opts.audioOnly;
  }

  // ── Media acquisition ─────────────────────────────────────────────────────

  /** Acquires local media. Returns false when no usable device exists. */
  async initLocalMedia(deviceIds?: { audio?: string; video?: string }): Promise<boolean> {
    const constraints: MediaStreamConstraints = {
      audio: deviceIds?.audio ? { deviceId: { exact: deviceIds.audio } } : true,
      video: this.audioOnly
        ? false
        : deviceIds?.video
          ? { deviceId: { exact: deviceIds.video } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
    };
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: any) {
      // Retry audio-only if the camera was the problem.
      if (!this.audioOnly) {
        try {
          this.audioOnly = true;
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (err2: any) {
          this.cb.onError?.(mapMediaError(err2), err2?.message ?? "Media access failed");
          return false;
        }
      } else {
        this.cb.onError?.(mapMediaError(err), err?.message ?? "Media access failed");
        return false;
      }
    }
    this.cb.onLocalStream?.(this.localStream);
    return true;
  }

  static async hasWebRTC(): Promise<boolean> {
    return typeof RTCPeerConnection !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  static async enumerateDevices(): Promise<MediaDeviceInfo[]> {
    try {
      return await navigator.mediaDevices.enumerateDevices();
    } catch {
      return [];
    }
  }

  // ── Peer connection lifecycle ─────────────────────────────────────────────

  /** Builds the RTCPeerConnection with the supplied ICE config and starts signalling. */
  async connect(ice: IceConfigLike): Promise<void> {
    if (this.closed) return;
    this.pc = new RTCPeerConnection({
      iceServers: ice.iceServers ?? [],
      iceTransportPolicy: ice.iceTransportPolicy ?? "all",
    });

    this.remoteStream = new MediaStream();
    this.cb.onRemoteStream?.(this.remoteStream);

    // Transceivers up-front so an audio-only side still negotiates a video m-line
    // and can enable a camera later without a fresh offer (Req 16.2).
    const audioTrack = this.localStream?.getAudioTracks()[0] ?? null;
    const videoTrack = this.localStream?.getVideoTracks()[0] ?? null;
    const audioTx = this.pc.addTransceiver("audio", { direction: "sendrecv" });
    const videoTx = this.pc.addTransceiver("video", { direction: "sendrecv" });
    this.audioSender = audioTx.sender;
    this.videoSender = videoTx.sender;
    if (audioTrack) await this.audioSender.replaceTrack(audioTrack);
    if (videoTrack) await this.videoSender.replaceTrack(videoTrack);

    this.pc.ontrack = (ev) => {
      if (!this.remoteStream) this.remoteStream = new MediaStream();
      this.remoteStream.addTrack(ev.track);
      this.cb.onRemoteStream?.(this.remoteStream);
    };

    this.pc.onnegotiationneeded = () => {
      // Only the impolite offerer (doctor) drives offers.
      if (this.role !== "doctor") return;
      // Alone in the room: remember that an offer is owed and produce it the
      // moment the guest arrives. Offering into an empty room would burn a TURN
      // allocation and leave stale candidates behind for the guest to try.
      if (!this.remotePresent) {
        this.negotiationPending = true;
        return;
      }
      void this.negotiate();
    };

    this.pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const payload = JSON.stringify(candidate);
      if (!this.remotePresent) {
        this.queuedLocalCandidates.push(payload);
        return;
      }
      void this.transport.publishSignal("ice_candidate", payload);
    };

    this.pc.onconnectionstatechange = () => this.handleConnectionState();
    this.pc.oniceconnectionstatechange = () => {
      if (this.pc?.iceConnectionState === "disconnected" || this.pc?.iceConnectionState === "failed") {
        this.onDisconnected();
      }
    };

    this.emitPeerState();
    this.cb.onWaitingForPeer?.(!this.remotePresent);
    // Do NOT start the connect deadline yet — Meet/Zoom wait indefinitely for the
    // other participant. The deadline starts only once we have a remote SDP
    // (negotiation with a peer has begun).
    this.startQualitySampling();
    this.startPolling();
  }

  /** Creates and publishes an offer. Doctor-only; guarded by `remotePresent`. */
  private async negotiate(): Promise<void> {
    if (!this.pc || this.closed) return;
    this.negotiationPending = false;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      await this.transport.publishSignal("offer", JSON.stringify(this.pc.localDescription));
    } catch (err: any) {
      this.cb.onError?.("negotiation", err?.message ?? "Negotiation failed");
    } finally {
      this.makingOffer = false;
    }
  }

  /**
   * Reacts to the server's view of who is in the room. On the arrival edge the
   * held-back offer is produced and any queued local candidates are flushed, so
   * negotiation starts against a peer that can actually answer.
   */
  private setRemotePresent(present: boolean): void {
    if (present === this.remotePresent) return;
    this.remotePresent = present;
    this.cb.onWaitingForPeer?.(!present);
    if (!present) return;

    const flushCandidates = () => {
      const queued = this.queuedLocalCandidates;
      this.queuedLocalCandidates = [];
      for (const payload of queued) void this.transport.publishSignal("ice_candidate", payload);
    };

    // The doctor owes an offer when one was requested while alone, when no local
    // description exists yet, or when a peer arrives into an unconnected but
    // stable connection (a guest re-entering after leaving).
    const owesOffer =
      this.negotiationPending ||
      !this.pc?.localDescription ||
      (this.pc.signalingState === "stable" && this.currentPeerState() !== "connected");
    if (this.role === "doctor" && owesOffer) {
      void this.negotiate().then(flushCandidates);
      return;
    }
    flushCandidates();
  }

  // ── Signalling ────────────────────────────────────────────────────────────

  private startPolling(): void {
    const tick = async () => {
      if (this.closed) return;
      let result: PollResult | null = null;
      try {
        result = await this.transport.poll(this.cursor, this.currentPeerState());
        this.consecutivePollErrors = 0;
      } catch {
        // Control-plane failure never tears down an established peer (Req 16.7).
        this.consecutivePollErrors++;
      }

      if (result) {
        if (result.status) this.cb.onRoomStatus?.(result.status);
        const terminal = result.roomState ?? result.status;
        if (terminal === "ended" || terminal === "expired" || terminal === "cancelled") {
          this.cb.onEnded?.(terminal);
          this.stopPolling();
          return;
        }
        // Presence is applied BEFORE the signal batch so a held-back offer goes
        // out in the same tick that reveals the peer.
        if (result.remotePresent !== undefined) this.setRemotePresent(result.remotePresent);
        for (const sig of result.signals) {
          await this.handleSignal(sig);
          if (sig.seq > this.cursor) this.cursor = sig.seq;
        }
        if (result.cursor > this.cursor) this.cursor = result.cursor;

        if (result.stopPolling) {
          this.stopPolling();
          return;
        }
      }

      const base = result?.nextPollMs ?? 2000;
      const delay = this.consecutivePollErrors > 0 ? Math.min(base * Math.pow(2, Math.min(this.consecutivePollErrors, 3)), 15000) : base;
      this.pollTimer = setTimeout(tick, delay);
    };
    void tick();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Resumes polling after it was stopped (used on reconnect). */
  private resumePolling(): void {
    if (!this.pollTimer && !this.closed) this.startPolling();
  }

  private async handleSignal(sig: IncomingSignal): Promise<void> {
    if (!this.pc) return;
    // Signals are role-filtered server-side, so receiving one is proof the peer
    // is present even if the presence flag has not caught up yet.
    if (!this.remotePresent) this.setRemotePresent(true);
    try {
      if (sig.kind === "offer" || sig.kind === "answer") {
        const desc = JSON.parse(sig.payload) as RTCSessionDescriptionInit;
        const offerCollision = sig.kind === "offer" && (this.makingOffer || this.pc.signalingState !== "stable");
        this.ignoreOffer = !this.polite && offerCollision;
        if (this.ignoreOffer) return;

        await this.pc.setRemoteDescription(desc);
        // Peer is present — now it's fair to expect ICE to complete soon.
        this.startConnectDeadline();
        if (sig.kind === "offer") {
          await this.pc.setLocalDescription();
          await this.transport.publishSignal("answer", JSON.stringify(this.pc.localDescription));
        }
      } else if (sig.kind === "ice_candidate") {
        const cand = JSON.parse(sig.payload);
        try {
          await this.pc.addIceCandidate(cand);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      } else if (sig.kind === "renegotiate") {
        // The patient asks the doctor to re-offer (used on ICE restart).
        if (this.role === "doctor") await this.restartIce();
      }
    } catch (err: any) {
      this.cb.onError?.("signal", err?.message ?? "Signal handling failed");
    }
  }

  // ── Connection state, quality, recovery ───────────────────────────────────

  private currentPeerState(): PeerState {
    const s = this.pc?.connectionState;
    switch (s) {
      case "new":
      case "connecting":
      case "connected":
      case "disconnected":
      case "failed":
      case "closed":
        return s;
      default:
        return "new";
    }
  }

  private emitPeerState(): void {
    this.cb.onPeerState?.(this.currentPeerState());
  }

  private handleConnectionState(): void {
    const state = this.currentPeerState();
    this.emitPeerState();

    if (state === "connected") {
      this.clearConnectDeadline();
      if (this.connectedSince === null) this.connectedSince = Date.now();
      // Recovered from a disconnect?
      if (this.disconnectedSince !== null) {
        this.disconnectedTotalMs += Date.now() - this.disconnectedSince;
        this.disconnectedSince = null;
        this.reconnectAttempt = 0;
        this.cb.onReconnecting?.(false);
        void this.transport.reportEvent("reconnected", { peerState: state });
      }
    }

    if (state === "failed") {
      this.onDisconnected();
    }
    if (state === "closed") {
      this.emitPeerState();
    }
  }

  private onDisconnected(): void {
    if (this.closed) return;
    if (this.connectedSince !== null) {
      this.reportedConnectedMs += Date.now() - this.connectedSince;
      this.connectedSince = null;
    }
    if (this.disconnectedSince === null) this.disconnectedSince = Date.now();

    this.cb.onReconnecting?.(true);
    void this.transport.reportEvent("reconnecting", { peerState: this.currentPeerState(), connectedMs: this.reportedConnectedMs });
    this.resumePolling();

    // End if we've exhausted the cumulative disconnect budget (Req 10.5).
    const totalDisc = this.disconnectedTotalMs + (this.disconnectedSince ? Date.now() - this.disconnectedSince : 0);
    if (shouldEndForDisconnect(totalDisc)) {
      void this.transport.end("connection_lost");
      this.cb.onEnded?.("connection_lost");
      this.destroy();
      return;
    }

    this.scheduleIceRestart();
  }

  private scheduleIceRestart(): void {
    if (this.reconnectTimer) return;
    const spacing = RECONNECT_SPACING_MS[Math.min(this.reconnectAttempt, RECONNECT_SPACING_MS.length - 1)];
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.reconnectAttempt++;
      if (this.closed) return;
      if (this.currentPeerState() === "connected") return;
      await this.restartIce();
      // Keep trying while still disconnected.
      if (this.currentPeerState() !== "connected") this.scheduleIceRestart();
    }, spacing);
  }

  private async restartIce(): Promise<void> {
    if (!this.pc) return;
    // Nothing to renegotiate with while we are alone in the room.
    if (!this.remotePresent) return;
    try {
      await this.transport.reportEvent("ice_restart", { peerState: this.currentPeerState() });
      if (this.role === "doctor") {
        const offer = await this.pc.createOffer({ iceRestart: true });
        await this.pc.setLocalDescription(offer);
        await this.transport.publishSignal("offer", JSON.stringify(this.pc.localDescription));
      } else {
        // Patient asks the doctor to re-offer.
        await this.transport.publishSignal("renegotiate", JSON.stringify({ reason: "ice_restart" }));
      }
      // Refresh ICE servers (credentials may have expired).
      try {
        const ice = await this.transport.fetchIce();
        this.pc.setConfiguration({ iceServers: ice.iceServers ?? [], iceTransportPolicy: ice.iceTransportPolicy ?? "all" });
      } catch {
        /* keep existing config */
      }
    } catch (err: any) {
      this.cb.onError?.("ice_restart", err?.message ?? "Reconnect failed");
    }
  }

  private startConnectDeadline(): void {
    // Idempotent — may be called again on renegotiation / ICE restart.
    this.clearConnectDeadline();
    this.connectDeadlineTimer = setTimeout(() => {
      if (this.closed) return;
      if (this.currentPeerState() !== "connected") {
        this.cb.onError?.("connection_failed", "Could not connect within the expected time.");
        void this.transport.reportEvent("connection_failed", { peerState: this.currentPeerState() });
      }
    }, CONNECT_DEADLINE_MS);
  }

  private clearConnectDeadline(): void {
    if (this.connectDeadlineTimer) {
      clearTimeout(this.connectDeadlineTimer);
      this.connectDeadlineTimer = null;
    }
  }

  private startQualitySampling(): void {
    this.qualityTimer = setInterval(async () => {
      if (!this.pc || this.closed) return;
      // No media flows while we are alone in the lobby — sampling then would only
      // report a meaningless "good" and write an audit row every 5 seconds.
      if (this.currentPeerState() !== "connected") return;
      try {
        const stats = await this.pc.getStats();
        let rtt: number | null = null;
        let jitterMs: number | null = null;
        let packetsReceived = 0;
        let packetsLost = 0;
        stats.forEach((report: any) => {
          if (report.type === "candidate-pair" && report.state === "succeeded" && report.currentRoundTripTime != null) {
            rtt = report.currentRoundTripTime * 1000;
          }
          if (report.type === "inbound-rtp" && !report.isRemote) {
            if (report.jitter != null) jitterMs = report.jitter * 1000;
            if (report.packetsReceived != null) packetsReceived += report.packetsReceived;
            if (report.packetsLost != null) packetsLost += report.packetsLost;
          }
        });

        let lossPct: number | null = null;
        if (this.prevStats) {
          const dRecv = packetsReceived - this.prevStats.packetsReceived;
          const dLost = packetsLost - this.prevStats.packetsLost;
          const total = dRecv + dLost;
          if (total > 0) lossPct = (dLost / total) * 100;
        }
        this.prevStats = { packetsReceived, packetsLost, ts: Date.now() };

        const level = classifyQuality({ rttMs: rtt, packetLossPct: lossPct, jitterMs });
        this.cb.onQuality?.(level);
        void this.transport.reportEvent("quality", { detail: level, connectedMs: this.totalConnectedMs() });
      } catch {
        /* stats unavailable this tick */
      }
    }, QUALITY_SAMPLE_MS);
  }

  private totalConnectedMs(): number {
    return this.reportedConnectedMs + (this.connectedSince ? Date.now() - this.connectedSince : 0);
  }

  // ── Controls ──────────────────────────────────────────────────────────────

  toggleMic(enabled: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = enabled));
    void this.transport.reportEvent("mic_toggle", { detail: enabled ? "on" : "off" });
  }

  toggleCamera(enabled: boolean): void {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = enabled));
    void this.transport.reportEvent("camera_toggle", { detail: enabled ? "on" : "off" });
  }

  /** Switches input device without renegotiating (Req 9.5). */
  async switchDevice(kind: "audio" | "video", deviceId: string): Promise<void> {
    try {
      const constraints: MediaStreamConstraints =
        kind === "audio"
          ? { audio: { deviceId: { exact: deviceId } } }
          : { video: { deviceId: { exact: deviceId } } };
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newTrack = kind === "audio" ? newStream.getAudioTracks()[0] : newStream.getVideoTracks()[0];
      if (!newTrack) return;
      const sender = kind === "audio" ? this.audioSender : this.videoSender;
      await sender?.replaceTrack(newTrack);
      // Swap into the local stream for preview and stop the old track.
      const old = kind === "audio" ? this.localStream?.getAudioTracks()[0] : this.localStream?.getVideoTracks()[0];
      if (old && this.localStream) {
        this.localStream.removeTrack(old);
        old.stop();
        this.localStream.addTrack(newTrack);
        this.cb.onLocalStream?.(this.localStream);
      }
    } catch (err: any) {
      this.cb.onError?.("device_switch", err?.message ?? "Could not switch device");
    }
  }

  /** Speaker selection where supported; degrades silently otherwise (Req 9.5). */
  async setSpeaker(videoEl: HTMLMediaElement, deviceId: string): Promise<boolean> {
    const el = videoEl as any;
    if (typeof el.setSinkId !== "function") return false;
    try {
      await el.setSinkId(deviceId);
      return true;
    } catch {
      return false;
    }
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  /** Ends the call: notifies the server, then releases everything. */
  async endCall(reason: string): Promise<void> {
    try {
      await this.transport.end(reason);
    } catch {
      /* still tear down locally */
    }
    this.destroy();
  }

  /** Releases media, closes the connection, stops all timers (Req 9.6, 12.5). */
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopPolling();
    if (this.qualityTimer) clearInterval(this.qualityTimer);
    this.clearConnectDeadline();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.localStream?.getTracks().forEach((t) => t.stop());
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.localStream = null;
    this.remoteStream = null;
    this.pc = null;
    this.cb.onRemoteStream?.(null);
  }
}

/** Maps a getUserMedia DOMException to the design's error taxonomy. */
function mapMediaError(err: any): string {
  const name = err?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "device_denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no_device";
  if (name === "NotReadableError") return "device_busy";
  return "media_error";
}
