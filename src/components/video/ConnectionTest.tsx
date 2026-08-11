// ─────────────────────────────────────────────────────────────────────────────
// ConnectionTest.tsx — verifies relay reachability from the browser.
//
// Runs real ICE gathering against the deployment's own STUN/TURN servers using
// native WebRTC only, and reports which candidate types came back:
//   host  — always present; same-network calls only
//   srflx — STUN works; direct P2P across NATs will usually succeed
//   relay — TURN works; calls survive restrictive/corporate networks
//
// This turns the "TURN is not configured" warning into something the operator
// can actually act on and then confirm.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useState } from "react";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Wifi, PlayCircle, ExternalLink } from "lucide-react";
import { getRelayStatusServerFn, getDiagnosticIceServerFn } from "../../lib/video";
import { cn } from "../../lib/utils";

interface Result {
  host: boolean;
  srflx: boolean;
  relay: boolean;
  error: string | null;
  candidateCount: number;
}

export function ConnectionTest({ compact }: { compact?: boolean }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [open, setOpen] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      const [relayStatus, ice] = await Promise.all([
        getRelayStatusServerFn(),
        getDiagnosticIceServerFn(),
      ]);
      setStatus(relayStatus);

      const found = { host: false, srflx: false, relay: false };
      let candidateCount = 0;

      const pc = new RTCPeerConnection({
        iceServers: (ice as any).iceServers ?? [],
        iceTransportPolicy: "all",
      });
      // A data channel is enough to trigger gathering without touching media.
      pc.createDataChannel("probe");

      await new Promise<void>((resolve) => {
        const done = () => {
          try {
            pc.close();
          } catch {
            /* ignore */
          }
          resolve();
        };
        // Gathering can hang on a misconfigured relay; cap it.
        const timer = setTimeout(done, 8000);

        pc.onicecandidate = (ev) => {
          if (!ev.candidate) {
            clearTimeout(timer);
            return done();
          }
          candidateCount++;
          const type = ev.candidate.type; // 'host' | 'srflx' | 'prflx' | 'relay'
          if (type === "host") found.host = true;
          if (type === "srflx") found.srflx = true;
          if (type === "relay") found.relay = true;
          // Once we have a relay candidate the question is answered.
          if (found.relay) {
            clearTimeout(timer);
            done();
          }
        };

        pc.createOffer()
          .then((o) => pc.setLocalDescription(o))
          .catch(() => {
            clearTimeout(timer);
            done();
          });
      });

      setResult({ ...found, error: null, candidateCount });
    } catch (e: any) {
      setResult({ host: false, srflx: false, relay: false, error: e?.message ?? "Test failed", candidateCount: 0 });
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wifi className="h-4 w-4 text-zinc-500" />
          <div>
            <p className="text-sm font-bold text-zinc-900">Connection test</p>
            <p className="text-xs text-zinc-500">Check whether calls will work across networks.</p>
          </div>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
          {running ? "Testing…" : "Run test"}
        </button>
      </div>

      {result && (
        <div className="mt-4 space-y-2">
          <Row
            ok={result.host}
            label="Local network"
            detail="Calls between two devices on the same Wi-Fi."
          />
          <Row
            ok={result.srflx}
            label="Direct connection (STUN)"
            detail={
              result.srflx
                ? "Most calls will connect directly, peer to peer."
                : "No STUN server reachable — set TURN_STUN_URLS."
            }
          />
          <Row
            ok={result.relay}
            label="Relay (TURN)"
            detail={
              result.relay
                ? "Calls will survive restrictive and corporate networks."
                : "No relay reachable — calls will fail on some patient networks."
            }
          />

          {result.error && <p className="text-xs text-red-500">{result.error}</p>}

          {!result.relay && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3">
              <p className="flex items-start gap-2 text-xs font-semibold text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Relay not available
              </p>
              <p className="mt-1 text-xs text-amber-700">
                {status && !status.hasTurnUrls
                  ? "No TURN server is configured. Video calls will only connect when both people are on the same network."
                  : "A TURN server is configured but did not return a relay candidate. Check that the relay UDP port range (10000–20000) is open and the shared secret matches."}
              </p>
              <button
                onClick={() => setOpen((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 underline"
              >
                {open ? "Hide setup steps" : "How do I fix this?"}
              </button>
              {open && <SetupSteps status={status} />}
            </div>
          )}
        </div>
      )}

      {!result && !running && status === null && !compact && (
        <p className="mt-3 text-xs text-zinc-400">
          Run this once after configuring your relay server to confirm it works.
        </p>
      )}
    </div>
  );
}

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300" />
      )}
      <div className="min-w-0">
        <p className={cn("text-xs font-semibold", ok ? "text-zinc-800" : "text-zinc-400")}>{label}</p>
        <p className="text-xs text-zinc-500">{detail}</p>
      </div>
    </div>
  );
}

function SetupSteps({ status }: { status: any }) {
  return (
    <div className="mt-3 space-y-2 rounded-lg bg-white p-3 text-xs text-zinc-600">
      <p className="font-semibold text-zinc-800">Set up your own relay server (one time)</p>
      <p>
        Video calls run peer-to-peer, so the only infrastructure needed is a STUN/TURN server on a machine you control.
        Nothing is sent to a third party.
      </p>
      <ol className="ml-4 list-decimal space-y-1">
        <li>
          On a server with a public IP, run the provisioning script from{" "}
          <code className="rounded bg-zinc-100 px-1">deploy/coturn/setup.sh</code>:
          <pre className="mt-1 overflow-x-auto rounded bg-zinc-900 p-2 text-[10px] text-zinc-100">
            bash setup.sh turn.yourdomain.com
          </pre>
        </li>
        <li>Point a DNS A record at that server.</li>
        <li>Paste the printed <code className="rounded bg-zinc-100 px-1">TURN_*</code> values into your <code className="rounded bg-zinc-100 px-1">.env</code>.</li>
        <li>Restart the app, then run this test again.</li>
      </ol>
      {status && (
        <div className="mt-2 border-t border-zinc-100 pt-2">
          <p className="font-semibold text-zinc-700">Current configuration</p>
          <ul className="mt-1 space-y-0.5">
            <li>TURN URLs: {status.hasTurnUrls ? status.turnHosts.join(", ") : <em>not set</em>}</li>
            <li>STUN URLs: {status.hasStunUrls ? status.stunHosts.join(", ") : <em>not set</em>}</li>
            <li>Shared secret: {status.hasSharedSecret ? "set" : <em>not set</em>}</li>
            <li>Realm: {status.realmSet ? "set" : <em>not set</em>}</li>
          </ul>
        </div>
      )}
      <p className="flex items-center gap-1 pt-1 text-zinc-500">
        <ExternalLink className="h-3 w-3" />
        Full guide: <code className="rounded bg-zinc-100 px-1">deploy/coturn/README.md</code>
      </p>
    </div>
  );
}
