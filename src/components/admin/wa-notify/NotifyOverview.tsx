// ─────────────────────────────────────────────────────────────────────────────
// NotifyOverview.tsx — Super Admin → WhatsApp → Overview.
//
// Provider connection, template sync health, queue/worker health, webhook
// health, open alerts, notification health by business category and recent
// failures. Every value comes from notifyOverviewServerFn (admin-gated); no
// secret or full recipient number is ever rendered.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { notifyOverviewServerFn, notifyResolveAlertServerFn } from "../../../lib/admin";

type Overview = any;

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function Pill({ ok, label }: { ok: boolean | null | undefined; label: string }) {
  const tone =
    ok === true
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : ok === false
        ? "bg-red-50 text-red-700 border-red-200"
        : "bg-zinc-50 text-zinc-600 border-zinc-200";
  const Icon = ok === true ? CheckCircle2 : ok === false ? XCircle : AlertTriangle;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold ${tone}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
      <h3 className="text-sm font-bold text-zinc-900">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right font-medium text-zinc-800 break-all">{value}</span>
    </div>
  );
}

const STATUS_ORDER = [
  "pending",
  "retry",
  "processing",
  "submitted",
  "sent",
  "delivered",
  "read",
  "failed",
  "dead",
  "ambiguous",
  "blocked",
  "skipped",
  "cancelled",
  "superseded",
  "expired",
];

export function NotifyOverview({ onOpenEvent }: { onOpenEvent?: (id: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await notifyOverviewServerFn({ data: {} });
      if (!res?.ok) throw new Error(res?.error || "Could not load the overview.");
      setData(res);
    } catch (e: any) {
      toast.error(e?.message || "Could not load the overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resolveAlert = async (key: string) => {
    const res: any = await notifyResolveAlertServerFn({ data: { key } });
    if (res?.ok) {
      toast.success("Alert resolved.");
      void load();
    } else toast.error(res?.error || "Could not resolve the alert.");
  };

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-8 text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!data) return <p className="text-sm text-zinc-500">No data.</p>;

  const p = data.provider;
  const q24 = data.queue.last24h;
  const by: Record<string, number> = q24.byStatus || {};
  return (
    <div className="space-y-5" data-testid="notify-overview">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Business notifications are sent only as Meta-approved Utility templates. A Meta “accepted”
          response is not delivery — delivered/read/failed come from signed webhooks.
        </p>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm cursor-pointer"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {data.alerts.length > 0 && (
        <section className="space-y-2" aria-label="Open alerts">
          {data.alerts.map((a: any) => (
            <div
              key={a.key}
              role="alert"
              className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${
                a.severity === "critical"
                  ? "border-red-200 bg-red-50 text-red-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              <div>
                <div className="font-semibold">{a.title}</div>
                {a.detail && <div className="mt-0.5">{a.detail}</div>}
                <div className="mt-0.5 text-xs opacity-75">
                  Since {fmtTime(a.firstSeen)} · seen {a.occurrences}×
                  {a.tenantId ? ` · tenant ${a.tenantId}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => resolveAlert(a.key)}
                className="shrink-0 rounded border border-current px-2 py-1 text-xs font-semibold cursor-pointer"
              >
                Resolve
              </button>
            </div>
          ))}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Provider connection">
          <div className="flex flex-wrap gap-2">
            <Pill ok={p.configured} label={p.configured ? "Configured" : "Not configured"} />
            <Pill ok={p.enabled} label={p.enabled ? "Enabled" : "Disabled"} />
            <Pill ok={p.idsDistinct} label={p.idsDistinct ? "WABA ≠ Phone ID" : "Check IDs"} />
            <Pill
              ok={p.tokenValid}
              label={
                p.tokenValid
                  ? "Token valid"
                  : p.tokenValid === false
                    ? "Token invalid"
                    : "Token unverified"
              }
            />
            <Pill
              ok={p.tokenScopesOk}
              label={p.tokenScopesOk ? "Scopes OK" : "Scopes unverified"}
            />
          </div>
          <Row label="WhatsApp Business Account ID" value={p.wabaId ?? "—"} />
          <Row label="Sender number" value={p.senderNumber ?? "—"} />
          <Row label="Verified name" value={p.verifiedName ?? "—"} />
          <Row
            label="Phone status"
            value={`${p.phoneStatus ?? "—"} · ${p.codeVerification ?? "—"}`}
          />
          <Row label="Quality rating" value={p.qualityRating ?? "—"} />
          <Row label="Can send messages" value={p.canSendMessage ?? "—"} />
          <Row
            label="Graph API version"
            value={`${p.apiVersion ?? "—"}${p.apiVersionExpiresOn ? ` (expires ${p.apiVersionExpiresOn})` : ""}`}
          />
          <Row label="Last successful Meta API call" value={fmtTime(p.lastApiOkAt)} />
          {p.healthError && <p className="text-xs text-red-600">{p.healthError}</p>}
        </Card>

        <Card title="Templates & sync">
          <Row label="Templates synced" value={data.templates.total} />
          <Row
            label="By status"
            value={
              Object.entries(data.templates.byStatus || {})
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ") || "—"
            }
          />
          <Row label="Last successful sync" value={fmtTime(data.templates.lastSyncOkAt)} />
          <Row
            label="Last sync run"
            value={
              data.templates.lastSyncRun
                ? `${data.templates.lastSyncRun.status} (${data.templates.lastSyncRun.trigger}, ${data.templates.lastSyncRun.scanned} scanned)`
                : "—"
            }
          />
          {data.templates.lastSyncRun?.error && (
            <p className="text-xs text-red-600">{data.templates.lastSyncRun.error}</p>
          )}
        </Card>

        <Card title="Queue & worker (last 24 h)">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Accepted", (by.submitted ?? 0) + (by.sent ?? 0)],
              ["Delivered", (by.delivered ?? 0) + (by.read ?? 0)],
              ["Read", by.read ?? 0],
              ["Failed", (by.failed ?? 0) + (by.dead ?? 0)],
              ["Blocked", by.blocked ?? 0],
              ["Queued", (by.pending ?? 0) + (by.retry ?? 0)],
            ].map(([label, n]) => (
              <div key={String(label)} className="rounded border border-zinc-100 p-2">
                <div className="text-[11px] text-zinc-500">{label}</div>
                <div className="text-lg font-black text-zinc-900">{n as number}</div>
              </div>
            ))}
          </div>
          <Row label="Engine" value={data.queue.engineEnabled ? "Running" : "Paused by admin"} />
          <Row
            label="Due backlog"
            value={`${q24.dueBacklog}${q24.oldestDueMs ? ` (oldest due ${fmtTime(new Date(q24.oldestDueMs).toISOString())})` : ""}`}
          />
          <Row label="Retries" value={q24.retries} />
          <Row label="Avg dispatch latency" value={fmtDuration(q24.avgDispatchLatencyMs)} />
          <Row label="Avg delivery latency" value={fmtDuration(q24.avgDeliveryLatencyMs)} />
          <details className="text-xs text-zinc-500">
            <summary className="cursor-pointer">All statuses</summary>
            <div className="mt-1">
              {STATUS_ORDER.filter((s) => by[s])
                .map((s) => `${s}: ${by[s]}`)
                .join(" · ") || "No events yet."}
            </div>
          </details>
        </Card>

        <Card title="Delivery webhooks (last 24 h)">
          <Row label="Callbacks received" value={data.webhook.received24h} />
          <Row label="Processing errors" value={data.webhook.errors24h} />
          <Row label="Last callback" value={fmtTime(data.webhook.lastReceivedAt)} />
          <p className="text-xs text-zinc-500">
            Callback URL: <code>/api/whatsapp/webhook</code> — subscribe the <code>messages</code>{" "}
            and template status fields in the Meta app dashboard.
          </p>
        </Card>
      </div>

      <Card title="Notification health by business category (last 24 h)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 text-left font-semibold">Category</th>
                <th className="py-1 text-right font-semibold">Events</th>
                <th className="py-1 text-right font-semibold">Delivered</th>
                <th className="py-1 text-right font-semibold">Failed</th>
                <th className="py-1 text-right font-semibold">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {data.byCategory.map((c: any) => (
                <tr key={c.category} className="border-t border-zinc-100">
                  <td className="py-1.5">{c.label}</td>
                  <td className="py-1.5 text-right">{c.total}</td>
                  <td className="py-1.5 text-right text-emerald-700">{c.delivered}</td>
                  <td className="py-1.5 text-right text-red-700">{c.failed}</td>
                  <td className="py-1.5 text-right">{c.enabled ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Recent delivery problems (7 days)">
        {data.recentFailures.length === 0 ? (
          <p className="text-sm text-zinc-500">No failed, blocked or ambiguous notifications.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {data.recentFailures.map((e: any) => (
              <li key={e.id} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <div className="font-medium text-zinc-800">
                    {e.kindLabel} · {e.tenantId} · {e.status}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {e.statusReason ?? ""} {e.errorCode ? `· code ${e.errorCode}` : ""} ·{" "}
                    {fmtTime(e.createdAt)}
                  </div>
                </div>
                {onOpenEvent && (
                  <button
                    type="button"
                    onClick={() => onOpenEvent(e.id)}
                    className="shrink-0 text-xs font-semibold text-[#0059C6] hover:underline cursor-pointer"
                  >
                    Details
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default NotifyOverview;
