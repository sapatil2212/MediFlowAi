// ─────────────────────────────────────────────────────────────────────────────
// NotifyAutomation.tsx — Super Admin → WhatsApp → Automation Settings.
//
// Platform-wide notification policy (engine on/off, consent mode, catalog
// auto-activation, industry switches, reminder window, retry/rate limits,
// alert thresholds, retention, template sync cadence) and the (business
// category × event) routing matrix. Every control calls an admin-gated
// server function; nothing here is decorative.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import {
  notifyRouteSetServerFn,
  notifyRoutesServerFn,
  notifySettingsGetServerFn,
  notifySettingsSaveServerFn,
  waTemplateListServerFn,
} from "../../../lib/admin";
import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_LABELS } from "../../../lib/notify-catalog";

type Settings = Record<string, any>;

const NUMBER_FIELDS: Array<[string, string, string]> = [
  ["reminderEarliestHour", "Day-before reminders: earliest local hour", "0–23"],
  ["reminderLatestHour", "Day-before reminders: latest local hour", "1–24"],
  ["sameDayReminderHours", "Same-day reminder lead time (hours)", "1–6"],
  ["maxAttempts", "Max delivery attempts", "1–10"],
  ["sendRatePerSecond", "Send rate per process (messages/second)", "1–80"],
  ["concurrency", "Concurrent sends per process", "1–16"],
  ["alertFailureRatePct", "Alert when hourly failure rate ≥ (%)", "1–100"],
  ["alertMinSample", "…with at least this many sends", "1–1000"],
  ["alertBacklogThreshold", "Alert when due backlog ≥", "1–100000"],
  ["retentionDays", "Keep notification logs for (days)", "30–3650"],
  ["templateSyncMinutes", "Template sync every (minutes)", "30–1440"],
  ["pendingTemplateSyncMinutes", "…while templates await review (minutes)", "10–720"],
];

export function NotifyAutomation() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [routes, setRoutes] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [category, setCategory] = useState<string>("clinic");
  const [ack, setAck] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r, t]: any[] = await Promise.all([
        notifySettingsGetServerFn({ data: {} }),
        notifyRoutesServerFn({ data: {} }),
        waTemplateListServerFn({ data: { limit: 200 } }),
      ]);
      if (s?.ok) {
        setSettings(s.settings);
        setTestMode(!!s.testModeProcess);
      } else toast.error(s?.error || "Could not load settings.");
      if (r?.ok) setRoutes(r.rows);
      if (t?.ok) setTemplates(t.rows ?? []);
    } catch (e: any) {
      toast.error(e?.message || "Could not load automation settings.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const approved = useMemo(
    () =>
      templates.filter(
        (t) =>
          String(t.metaStatus || "").toUpperCase() === "APPROVED" &&
          String(t.metaCategory || "").toUpperCase() === "UTILITY",
      ),
    [templates],
  );

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res: any = await notifySettingsSaveServerFn({ data: { settings } });
      if (res?.ok) {
        setSettings(res.settings);
        toast.success("Automation settings saved.");
      } else toast.error(res?.error || "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const setRoute = async (row: any, patch: Record<string, unknown>) => {
    const res: any = await notifyRouteSetServerFn({
      data: { businessCategory: row.businessCategory, kind: row.kind, ...patch },
    });
    if (res?.ok) {
      toast.success("Route updated.");
      const r: any = await notifyRoutesServerFn({ data: {} });
      if (r?.ok) setRoutes(r.rows);
    } else toast.error(res?.error || "Could not update the route.");
  };

  if (!settings) {
    return (
      <div className="flex items-center gap-2 py-8 text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const toggle = (key: string, label: string, help?: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-1"
        checked={!!settings[key]}
        onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
      />
      <span>
        <span className="font-medium text-zinc-800">{label}</span>
        {help && <span className="block text-xs text-zinc-500">{help}</span>}
      </span>
    </label>
  );

  const categoryRows = routes.filter((r) => r.businessCategory === category);

  return (
    <div className="space-y-6" data-testid="notify-automation">
      {testMode && (
        <div
          role="note"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
        >
          This server runs in WhatsApp test mode (WA_CLOUD_TEST_RECIPIENTS is set): it only delivers
          to allow-listed numbers and does not run reminder backfill, template sync or retention.
          Settings saved here apply to every server.
        </div>
      )}

      <section className="space-y-3 rounded-lg border border-zinc-200 p-4">
        <h3 className="text-sm font-bold text-zinc-900">Delivery policy</h3>
        {toggle(
          "engineEnabled",
          "Notification engine enabled",
          "When off, events are kept and sent after you turn it back on.",
        )}
        {toggle(
          "autoActivateCatalog",
          "Auto-activate approved catalog templates",
          "Maps a catalog template to its business category and event as soon as Meta approves it.",
        )}
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-zinc-800">Customer consent basis</span>
          <select
            className="input max-w-md"
            value={settings.consentMode}
            onChange={(e) => setSettings({ ...settings, consentMode: e.target.value })}
          >
            <option value="implied_by_booking">
              Booking updates allowed when the customer gave their WhatsApp number for the booking
              (opt-outs always honoured)
            </option>
            <option value="explicit_only">Only customers who ticked the WhatsApp opt-in</option>
          </select>
          <span className="block text-xs text-zinc-500">
            Covers transactional booking updates only — never marketing. STOP replies and
            booking-form opt-outs are always respected.
          </span>
        </label>
        <div>
          <div className="mb-1 text-sm font-medium text-zinc-800">
            Industries with WhatsApp notifications
          </div>
          <div className="flex flex-wrap gap-4">
            {BUSINESS_CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.categoryEnabled?.[c] !== false}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      categoryEnabled: { ...settings.categoryEnabled, [c]: e.target.checked },
                    })
                  }
                />
                {BUSINESS_CATEGORY_LABELS[c]}
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {NUMBER_FIELDS.map(([key, label, range]) => (
            <label key={key} className="block space-y-1 text-sm">
              <span className="font-medium text-zinc-800">{label}</span>
              <input
                type="number"
                className="input"
                value={settings[key]}
                onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
              />
              <span className="block text-xs text-zinc-400">Allowed: {range}</span>
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0059C6] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save policy
        </button>
      </section>

      <section className="space-y-3 rounded-lg border border-zinc-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-zinc-900">Event → template routing</h3>
          <select
            aria-label="Business category"
            className="input max-w-xs"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {BUSINESS_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {BUSINESS_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
          <span>
            I confirm customers of these businesses have agreed to receive booking updates on
            WhatsApp (required to enable a route).
          </span>
        </label>
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Event</th>
                <th className="px-3 py-2 text-left font-semibold">Catalog template</th>
                <th className="px-3 py-2 text-left font-semibold">Mapped template</th>
                <th className="px-3 py-2 text-left font-semibold">State</th>
                <th className="px-3 py-2 text-left font-semibold">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {categoryRows.map((row) => (
                <tr
                  key={`${row.businessCategory}-${row.kind}`}
                  className="border-t border-zinc-100 align-top"
                >
                  <td className="px-3 py-2 text-zinc-800">{row.kindLabel}</td>
                  <td className="px-3 py-2 text-xs text-zinc-600 font-mono">
                    {row.catalogTemplate
                      ? `${row.catalogTemplate.name} (${row.catalogTemplate.language})`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`Template for ${row.kindLabel}`}
                      className="input"
                      value={
                        row.mapping?.scope === row.businessCategory ? row.mapping.templateId : ""
                      }
                      onChange={(e) =>
                        e.target.value
                          ? void setRoute(row, { templateId: e.target.value })
                          : void setRoute(row, { remove: true })
                      }
                    >
                      <option value="">
                        {row.mapping && row.mapping.scope === "*"
                          ? `(all-categories mapping: ${row.mapping.templateName})`
                          : "Not mapped"}
                      </option>
                      {approved.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.language})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {row.mapping ? (
                      <span
                        className={row.mapping.sendable ? "text-emerald-700" : "text-amber-700"}
                      >
                        {row.mapping.sendable
                          ? "Sending"
                          : `${row.mapping.templateStatus ?? "?"}${row.mapping.enabled ? "" : " · off"}`}
                      </span>
                    ) : (
                      <span className="text-zinc-400">Blocked — no template</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.mapping && row.mapping.scope === row.businessCategory ? (
                      <input
                        type="checkbox"
                        aria-label={`Enable ${row.kindLabel}`}
                        checked={!!row.mapping.enabled}
                        disabled={!row.mapping.enabled && !ack}
                        onChange={(e) =>
                          void setRoute(row, { enabled: e.target.checked, optInAck: ack })
                        }
                      />
                    ) : (
                      <span className="text-xs text-zinc-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default NotifyAutomation;
