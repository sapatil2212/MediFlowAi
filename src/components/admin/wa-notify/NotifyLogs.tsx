// ─────────────────────────────────────────────────────────────────────────────
// NotifyLogs.tsx — Super Admin → WhatsApp → Notification Logs.
//
// Searchable, filterable notification events (tenant, category, booking,
// event, template, date, status, error class) with a per-event timeline
// (creation → dispatch attempts → Meta acceptance → webhook statuses) and a
// safe retry for failed / blocked / ambiguous events that Meta never accepted.
// Recipients are masked server-side; message bodies are never shown.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import {
  notifyEventDetailServerFn,
  notifyLogsServerFn,
  notifyRetryServerFn,
} from "../../../lib/admin";
import {
  BUSINESS_CATEGORIES,
  BUSINESS_CATEGORY_LABELS,
  EVENT_TYPE_LABELS,
} from "../../../lib/notify-catalog";

const STATUS_OPTIONS = [
  ["", "Any status"],
  ["problems", "Problems (failed / blocked / ambiguous)"],
  ["pending", "Pending"],
  ["retry", "Retry scheduled"],
  ["submitted", "Accepted by Meta"],
  ["sent", "Sent"],
  ["delivered", "Delivered"],
  ["read", "Read"],
  ["failed", "Failed"],
  ["dead", "Retries exhausted"],
  ["blocked", "Blocked (no template)"],
  ["ambiguous", "Outcome unknown"],
  ["skipped", "Skipped"],
  ["cancelled", "Cancelled"],
  ["superseded", "Superseded"],
  ["expired", "Expired"],
] as const;

const ERROR_CLASSES = [
  "",
  "retryable",
  "permanent",
  "configuration",
  "template",
  "consent",
  "provider_restriction",
  "unknown",
];

const STATUS_TONE: Record<string, string> = {
  delivered: "bg-emerald-100 text-emerald-700",
  read: "bg-emerald-100 text-emerald-700",
  submitted: "bg-sky-100 text-sky-700",
  sent: "bg-sky-100 text-sky-700",
  pending: "bg-zinc-100 text-zinc-700",
  retry: "bg-amber-100 text-amber-700",
  processing: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
  dead: "bg-red-100 text-red-700",
  ambiguous: "bg-orange-100 text-orange-700",
  blocked: "bg-orange-100 text-orange-700",
};

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

const PAGE = 50;

export function NotifyLogs({ initialEventId }: { initialEventId?: string | null }) {
  const [filters, setFilters] = useState({
    tenantId: "",
    businessCategory: "",
    appointmentId: "",
    eventType: "",
    templateName: "",
    status: "",
    errorClass: "",
    from: "",
    to: "",
    search: "",
  });
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(initialEventId ?? null);

  const load = useCallback(
    async (nextOffset = 0) => {
      setLoading(true);
      try {
        const res: any = await notifyLogsServerFn({
          data: {
            ...filters,
            from: filters.from ? new Date(filters.from).toISOString() : "",
            to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : "",
            limit: PAGE,
            offset: nextOffset,
          },
        });
        if (!res?.ok) throw new Error(res?.error || "Could not load logs.");
        setRows(res.rows);
        setTotal(res.total);
        setOffset(nextOffset);
      } catch (e: any) {
        toast.error(e?.message || "Could not load logs.");
      } finally {
        setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (initialEventId) setDetailId(initialEventId);
  }, [initialEventId]);

  const set =
    (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-4" data-testid="notify-logs">
      <form
        className="grid gap-2 md:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          void load(0);
        }}
      >
        <input
          aria-label="Tenant ID"
          placeholder="Tenant ID"
          className="input"
          value={filters.tenantId}
          onChange={set("tenantId")}
        />
        <select
          aria-label="Business category"
          className="input"
          value={filters.businessCategory}
          onChange={set("businessCategory")}
        >
          <option value="">Any category</option>
          {BUSINESS_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {BUSINESS_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <input
          aria-label="Booking ID"
          placeholder="Booking ID"
          className="input"
          value={filters.appointmentId}
          onChange={set("appointmentId")}
        />
        <select
          aria-label="Event"
          className="input"
          value={filters.eventType}
          onChange={set("eventType")}
        >
          <option value="">Any event</option>
          {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          aria-label="Template name"
          placeholder="Template name"
          className="input"
          value={filters.templateName}
          onChange={set("templateName")}
        />
        <select
          aria-label="Delivery status"
          className="input"
          value={filters.status}
          onChange={set("status")}
        >
          {STATUS_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="Error class"
          className="input"
          value={filters.errorClass}
          onChange={set("errorClass")}
        >
          {ERROR_CLASSES.map((c) => (
            <option key={c} value={c}>
              {c ? c.replace("_", " ") : "Any error class"}
            </option>
          ))}
        </select>
        <input
          aria-label="From date"
          type="date"
          className="input"
          value={filters.from}
          onChange={set("from")}
        />
        <input
          aria-label="To date"
          type="date"
          className="input"
          value={filters.to}
          onChange={set("to")}
        />
        <div className="flex gap-2">
          <input
            aria-label="Search by event or booking ID"
            placeholder="Event / booking ID"
            className="input"
            value={filters.search}
            onChange={set("search")}
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-lg bg-[#0059C6] px-3 text-sm font-semibold text-white cursor-pointer"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Apply
          </button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Created</th>
              <th className="px-3 py-2 text-left font-semibold">Tenant / category</th>
              <th className="px-3 py-2 text-left font-semibold">Event</th>
              <th className="px-3 py-2 text-left font-semibold">Template</th>
              <th className="px-3 py-2 text-left font-semibold">Recipient</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-left font-semibold">Reason</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-400">
                  {loading ? "Loading…" : "No notifications match these filters."}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 align-top">
                <td className="px-3 py-2 text-zinc-600 whitespace-nowrap">{fmt(r.createdAt)}</td>
                <td className="px-3 py-2 text-zinc-600">
                  <div>{r.tenantId}</div>
                  <div className="text-xs text-zinc-400">{r.businessCategory}</div>
                </td>
                <td className="px-3 py-2 text-zinc-700">
                  <div>{r.kindLabel}</div>
                  <div className="text-xs text-zinc-400">{r.eventLabel}</div>
                </td>
                <td className="px-3 py-2 text-zinc-600">
                  {r.templateName ? `${r.templateName} (${r.templateLanguage})` : "—"}
                </td>
                <td className="px-3 py-2 text-zinc-600 font-mono text-xs">{r.recipient ?? "—"}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status] ?? "bg-zinc-100 text-zinc-600"}`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-zinc-500 max-w-[16rem]">
                  {r.statusReason ?? ""}
                  {r.errorCode ? ` · code ${r.errorCode}` : ""}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setDetailId(r.id)}
                    className="text-xs font-semibold text-[#0059C6] hover:underline cursor-pointer"
                  >
                    Timeline
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>
          {total === 0
            ? "0 results"
            : `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}`}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={offset === 0 || loading}
            onClick={() => load(Math.max(0, offset - PAGE))}
            className="rounded border border-zinc-300 px-3 py-1 disabled:opacity-40 cursor-pointer"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={offset + PAGE >= total || loading}
            onClick={() => load(offset + PAGE)}
            className="rounded border border-zinc-300 px-3 py-1 disabled:opacity-40 cursor-pointer"
          >
            Next
          </button>
        </div>
      </div>

      {detailId && (
        <EventTimeline
          eventId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => void load(offset)}
        />
      )}
    </div>
  );
}

function EventTimeline({
  eventId,
  onClose,
  onChanged,
}: {
  eventId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res: any = await notifyEventDetailServerFn({ data: { id: eventId } });
    if (!res?.ok) {
      toast.error(res?.error || "Could not load the notification.");
      onClose();
      return;
    }
    setData(res);
  }, [eventId, onClose]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = async () => {
    setBusy(true);
    try {
      const res: any = await notifyRetryServerFn({ data: { id: eventId } });
      if (res?.ok) {
        toast.success("Queued for another attempt.");
        await load();
        onChanged();
      } else toast.error(res?.error || "Could not retry.");
    } finally {
      setBusy(false);
    }
  };

  const e = data?.event;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Notification timeline"
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
    >
      <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-zinc-900">Notification timeline</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 hover:bg-zinc-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {!e ? (
          <div className="flex items-center gap-2 text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-1 text-sm">
              {[
                ["Event", `${e.kindLabel} (${e.eventType})`],
                ["Status", `${e.status}${e.statusReason ? ` — ${e.statusReason}` : ""}`],
                ["Tenant", `${e.tenantId} · ${e.businessCategory}`],
                ["Booking", e.appointmentId ?? "—"],
                ["Recipient", e.recipient ?? "—"],
                ["Template", e.templateName ? `${e.templateName} (${e.templateLanguage})` : "—"],
                ["Attempts", `${e.attempts} / ${e.maxAttempts}`],
                ["Scheduled for", fmt(e.scheduledFor)],
                ["Next attempt", fmt(e.nextAttemptAt)],
                ["Meta message ID", e.providerMessageId ?? "—"],
                ["Accepted", fmt(e.submittedAt)],
                ["Delivered", fmt(e.deliveredAt)],
                ["Read", fmt(e.readAt)],
                ["Failed", fmt(e.failedAt)],
                [
                  "Error",
                  e.errorCode
                    ? `${e.errorClass ?? ""} · ${e.errorCode}: ${e.errorMessage ?? ""}`
                    : "—",
                ],
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-zinc-500">{k}</dt>
                  <dd className="col-span-2 break-all text-zinc-800">{v}</dd>
                </div>
              ))}
            </dl>
            {e.retryable && (
              <button
                type="button"
                disabled={busy}
                onClick={retry}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0059C6] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" /> Retry safely
              </button>
            )}
            {e.status === "ambiguous" && (
              <p className="text-xs text-orange-700">
                The send outcome is unknown (the connection dropped after the request was sent).
                Check with the recipient before retrying to avoid a duplicate message.
              </p>
            )}
            <section>
              <h4 className="mb-2 text-sm font-semibold text-zinc-900">Timeline</h4>
              <ol className="space-y-2 border-l border-zinc-200 pl-4 text-sm">
                {data.timeline.map((t: any, i: number) => (
                  <li key={i}>
                    <div className="font-medium text-zinc-800">{t.action.replace(/_/g, " ")}</div>
                    <div className="text-xs text-zinc-500">
                      {fmt(t.at)} · {t.actor ?? "system"}
                      {t.detail ? ` · ${JSON.stringify(t.detail)}` : ""}
                    </div>
                  </li>
                ))}
                {data.timeline.length === 0 && (
                  <li className="text-zinc-400">No timeline entries.</li>
                )}
              </ol>
            </section>
            <section>
              <h4 className="mb-2 text-sm font-semibold text-zinc-900">Provider attempts</h4>
              {data.attempts.length === 0 ? (
                <p className="text-sm text-zinc-400">No request reached Meta.</p>
              ) : (
                <ul className="space-y-2 text-xs text-zinc-600">
                  {data.attempts.map((a: any) => (
                    <li key={a.logId} className="rounded border border-zinc-100 p-2">
                      <div>
                        {a.status} · provider {a.providerStatus ?? "—"} ·{" "}
                        {a.providerMessageId ?? "no wamid"}
                      </div>
                      <div>
                        sent {fmt(a.sentAt)} · delivered {fmt(a.deliveredAt)} · read {fmt(a.readAt)}{" "}
                        · failed {fmt(a.failedAt)}
                      </div>
                      {a.errorCode && (
                        <div className="text-red-600">
                          {a.errorCode}: {a.errorMessage}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default NotifyLogs;
