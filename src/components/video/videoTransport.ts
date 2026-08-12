// ─────────────────────────────────────────────────────────────────────────────
// videoTransport.ts — wires the video server functions into the VideoTransport
// interface consumed by the framework-free VideoPeer controller.
//
// Two builders: one for the authenticated doctor (roomId), one for the
// unauthenticated patient (token). Both expose the same shape so VideoPeer is
// identical on either side.
// ─────────────────────────────────────────────────────────────────────────────
import type { VideoTransport, IceConfigLike, PollResult } from "../../lib/video-peer";
import type { PeerState, SignalKind } from "../../lib/video-consultation";
import {
  pollVideoRoomServerFn,
  publishSignalServerFn,
  getIceConfigurationServerFn,
  reportCallEventServerFn,
  endVideoRoomServerFn,
  getJoinStatusServerFn,
  patientPublishSignalServerFn,
  patientIceConfigServerFn,
  patientReportEventServerFn,
  patientLeaveServerFn,
} from "../../lib/video";

export function buildDoctorTransport(roomId: string): VideoTransport {
  return {
    async publishSignal(kind: SignalKind, payload: string) {
      await publishSignalServerFn({ data: { roomId, kind, payload } });
    },
    async poll(afterSeq: number, peerState: PeerState): Promise<PollResult> {
      const r = await pollVideoRoomServerFn({ data: { roomId, afterSeq, peerState } });
      return {
        signals: r.signals as PollResult["signals"],
        cursor: r.cursor,
        stopPolling: r.stopPolling,
        nextPollMs: r.nextPollMs,
        roomState: r.roomState,
        remotePresent: r.remotePresent,
      };
    },
    async fetchIce(): Promise<IceConfigLike> {
      return (await getIceConfigurationServerFn({ data: { roomId } })) as IceConfigLike;
    },
    async reportEvent(kind, extra) {
      await reportCallEventServerFn({
        data: { roomId, kind, detail: extra?.detail, peerState: extra?.peerState, connectedMs: extra?.connectedMs },
      });
    },
    async end(reason: string) {
      await endVideoRoomServerFn({ data: { roomId, reason } });
    },
  };
}

export function buildPatientTransport(token: string): VideoTransport {
  return {
    async publishSignal(kind: SignalKind, payload: string) {
      await patientPublishSignalServerFn({ data: { token, kind, payload } });
    },
    async poll(afterSeq: number, peerState: PeerState): Promise<PollResult> {
      const r = await getJoinStatusServerFn({ data: { token, afterSeq, peerState } });
      return {
        signals: (r.signals ?? []) as PollResult["signals"],
        cursor: r.cursor,
        stopPolling: r.stopPolling,
        nextPollMs: r.nextPollMs,
        status: r.status,
        remotePresent: r.remotePresent,
      };
    },
    async fetchIce(): Promise<IceConfigLike> {
      return (await patientIceConfigServerFn({ data: { token } })) as IceConfigLike;
    },
    async reportEvent(kind, extra) {
      await patientReportEventServerFn({
        data: { token, kind, detail: extra?.detail, peerState: extra?.peerState, connectedMs: extra?.connectedMs },
      });
    },
    async end(reason: string) {
      await patientLeaveServerFn({ data: { token, reason } });
    },
  };
}
