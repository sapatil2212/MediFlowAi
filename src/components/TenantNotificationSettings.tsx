// ─────────────────────────────────────────────────────────────────────────────
// TenantNotificationSettings.tsx — tenant WhatsApp "Notifications" panel.
//
// Shown inside WhatsAppHub for every business category. The workspace owner
// can turn booking notifications and reminders on or off, see which approved
// templates their business uses, review delivery statuses and recent failures,
// and record a customer's WhatsApp opt-out. All data is scoped server-side to
// the signed-in tenant; nothing here can reach another tenant or Meta
// credentials.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
  getTenantNotificationCenterServerFn,
  saveTenantNotificationSettingsServerFn,
  setTenantCustomerConsentServerFn,
} from "../lib/tenant-notifications";

type Toast = (type: "success" | "error" | "info", message: string) => void;

const STATE_TEXT: Record<string, string> = {
  active: "Active",
  pending_approval: "Waiting for Meta approval",
  awaiting_template: "Template not approved yet",
  not_available: "Not available",
};

const STATUS_TEXT: Record<string, string> = {
  pending: "Queued",
  retry: "Retrying",
  processing: "Sending",
  submitted: "Accepted by WhatsApp",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
  dead: "Failed",
  ambiguous: "Unknown outcome",
  blocked: "Not sent (template unavailable)",
  skipped: "Not sent",
  cancelled: "Cancelled",
  superseded: "Replaced by a newer update",
  expired: "Expired",
};

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function TenantNotificationSettings({ showToast }: { showToast: Toast }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [optPhone, setOptPhone] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await getTenantNotificationCenterServerFn();
      if (!res?.ok) throw new Error(res?.error || "Could not load notification settings.");
      setData(res);
    } catch (e: any) {
      showToast("error", e?.message || "Could not load notification settings.");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res: any = await saveTenantNotificationSettingsServerFn({ data: patch });
      if (!res?.ok) throw new Error(res?.error || "Could not save.");
      showToast("success", "Notification settings saved.");
      await load();
    } catch (e: any) {
      showToast("error", e?.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const setConsent = async (optedIn: boolean) => {
    try {
      const res: any = await setTenantCustomerConsentServerFn({
        data: { phone: optPhone, optedIn },
      });
      if (!res?.ok) throw new Error(res?.error || "Could not update.");
      showToast(
        "success",
        optedIn
          ? "WhatsApp updates re-enabled for this number."
          : "This number will no longer receive WhatsApp updates from your business.",
      );
      setOptPhone("");
    } catch (e: any) {
      showToast("error", e?.message || "Could not update.");
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 p-6 text-xs text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!data) return null;
  if (!data.available) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
        {data.message}
      </div>
    );
  }

  const s = data.settings;
  const canEdit = !!data.canEdit;
  const counts: Record<string, number> = data.counts || {};
  return (
    <div className="space-y-5" data-testid="tenant-notifications">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Delivered (7 days)", (counts.delivered ?? 0) + (counts.read ?? 0), "text-emerald-600"],
          [
            "Accepted, awaiting delivery",
            (counts.submitted ?? 0) + (counts.sent ?? 0),
            "text-sky-600",
          ],
          ["Failed", (counts.failed ?? 0) + (counts.dead ?? 0), "text-red-600"],
          ["Not sent", (counts.blocked ?? 0) + (counts.skipped ?? 0), "text-amber-600"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="text-[10px] font-bold uppercase text-zinc-500">{label}</div>
            <div className={`text-2xl font-black ${color}`}>{value as number}</div>
          </div>
        ))}
      </div>

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-zinc-900">Automatic WhatsApp notifications</h3>
            <p className="text-[11px] text-zinc-500">
              Sent from the official BookMyTime WhatsApp number as Meta-approved booking updates (
              {data.categoryLabel}). Customers don't need to message you first, and can reply STOP
              at any time.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            aria-label="Refresh"
            className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        {!canEdit && (
          <p className="text-[11px] text-amber-700">
            Only the workspace owner can change these settings.
          </p>
        )}
        <label className="flex items-center gap-2 text-xs font-semibold text-zinc-800">
          <input
            type="checkbox"
            checked={!!s.whatsappEnabled}
            disabled={!canEdit || saving}
            onChange={(e) => void update({ whatsappEnabled: e.target.checked })}
          />
          Send WhatsApp booking notifications
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.switches.map((sw: any) => (
            <label key={sw.id} className="flex items-center gap-2 text-xs text-zinc-700">
              <input
                type="checkbox"
                checked={!!s[sw.id]}
                disabled={!canEdit || saving || !s.whatsappEnabled}
                onChange={(e) => void update({ [sw.id]: e.target.checked })}
              />
              {sw.label}
            </label>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500">
          Day-before reminders go out the day before the booking (between 8 AM and 9 PM local time);
          two-hour reminders go out about two hours before. Reminders stop automatically when a
          booking is cancelled, completed or rescheduled.
        </p>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h3 className="mb-2 text-xs font-bold text-zinc-900">
          Message templates used for your business
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 text-left font-semibold">Notification</th>
                <th className="py-1 text-left font-semibold">Template</th>
                <th className="py-1 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.templates.map((t: any) => (
                <tr key={t.kind} className="border-t border-zinc-100 align-top">
                  <td className="py-1.5 text-zinc-800">{t.label}</td>
                  <td className="py-1.5 text-zinc-600">
                    {t.templateName ? (
                      <details>
                        <summary className="cursor-pointer font-mono">{t.templateName}</summary>
                        {t.bodyPreview && (
                          <pre className="mt-1 whitespace-pre-wrap font-sans text-zinc-500">
                            {t.bodyPreview}
                          </pre>
                        )}
                      </details>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td
                    className={`py-1.5 ${t.state === "active" ? "text-emerald-700" : "text-amber-700"}`}
                  >
                    {STATE_TEXT[t.state] ?? t.state}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h3 className="mb-2 text-xs font-bold text-zinc-900">Recent notifications</h3>
        {data.recent.length === 0 ? (
          <p className="text-xs text-zinc-500">No notifications yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 text-left font-semibold">Time</th>
                  <th className="py-1 text-left font-semibold">Notification</th>
                  <th className="py-1 text-left font-semibold">Recipient</th>
                  <th className="py-1 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((e: any) => (
                  <tr key={e.id} className="border-t border-zinc-100">
                    <td className="py-1.5 text-zinc-600">{fmt(e.createdAt)}</td>
                    <td className="py-1.5 text-zinc-800">{e.kindLabel}</td>
                    <td className="py-1.5 font-mono text-zinc-600">{e.recipient ?? "—"}</td>
                    <td className="py-1.5 text-zinc-700" title={e.statusReason ?? ""}>
                      {STATUS_TEXT[e.status] ?? e.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.failures.length > 0 && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <h3 className="mb-2 text-xs font-bold text-red-800">Problems in the last 7 days</h3>
          <ul className="space-y-1 text-xs text-red-800">
            {data.failures.map((e: any) => (
              <li key={e.id}>
                {fmt(e.createdAt)} · {e.kindLabel} · {STATUS_TEXT[e.status] ?? e.status}
                {e.statusReason ? ` (${e.statusReason.replace(/_/g, " ")})` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canEdit && (
        <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-5">
          <h3 className="text-xs font-bold text-zinc-900">Customer opt-out</h3>
          <p className="text-[11px] text-zinc-500">
            If a customer asks not to receive WhatsApp updates from your business, record it here.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="Customer WhatsApp number"
              className="min-w-[12rem] flex-1 rounded-full border border-zinc-200 px-3 py-1.5 text-xs"
              placeholder="+91 98xxxxxxxx"
              value={optPhone}
              onChange={(e) => setOptPhone(e.target.value)}
            />
            <button
              type="button"
              disabled={optPhone.replace(/\D/g, "").length < 10}
              onClick={() => setConsent(false)}
              className="rounded-full bg-zinc-900 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40 cursor-pointer"
            >
              Stop WhatsApp updates
            </button>
            <button
              type="button"
              disabled={optPhone.replace(/\D/g, "").length < 10}
              onClick={() => setConsent(true)}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-[11px] font-bold text-zinc-700 disabled:opacity-40 cursor-pointer"
            >
              Re-enable
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
