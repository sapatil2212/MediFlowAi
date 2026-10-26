// ─────────────────────────────────────────────────────────────────────────────
// NotificationMappings.tsx — assign an approved UTILITY template to a notify
// kind and gate the enable toggle behind the opt-in acknowledgement (DP-01).
//
// Each AptNotifyKind gets a row. Assigning picks from the approved+UTILITY
// templates only (the server re-checks eligibility). The enable toggle is
// DISABLED with a visible reason until the Super Admin ticks the opt-in
// acknowledgement; enabling sends optInAck:true to the server, which stores the
// acknowledgement and re-checks eligibility.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  waNotifyMappingsServerFn,
  waTemplateListServerFn,
  waAssignMappingServerFn,
  waSetMappingEnabledServerFn,
  waRemoveMappingServerFn,
} from "../../../lib/admin";
import { NOTIFY_KIND_LABELS, NOTIFY_KINDS } from "../../../lib/wa-template-model";
import { DisabledReason } from "./shared";

const OPT_IN_ACK_TEXT =
  "Every tenant using this notification has obtained the recipient's opt-in to receive WhatsApp " +
  "messages from that business, as required by the WhatsApp Business Messaging Policy; BookMyTime " +
  "does not record patient-level opt-in.";

interface MappingRow {
  id: string;
  notifyKind: string;
  templateId: string;
  language: string;
  isEnabled: boolean;
  optInAckAt: string | null;
}

interface TemplateOption {
  id: string;
  name: string;
  language: string;
  metaStatus: string | null;
  metaCategory: string | null;
}

export function NotificationMappings() {
  const [loading, setLoading] = useState(true);
  const [mappings, setMappings] = useState<Record<string, MappingRow>>({});
  const [options, setOptions] = useState<TemplateOption[]>([]);
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mapRes, listRes] = await Promise.all([
        waNotifyMappingsServerFn({ data: {} }) as Promise<{
          ok: boolean;
          rows?: MappingRow[];
          error?: string;
        }>,
        waTemplateListServerFn({
          data: { metaStatus: "APPROVED", category: "UTILITY" },
        }) as Promise<{
          ok: boolean;
          rows?: TemplateOption[];
        }>,
      ]);
      if (mapRes.ok && mapRes.rows) {
        const byKind: Record<string, MappingRow> = {};
        for (const m of mapRes.rows) byKind[m.notifyKind] = m;
        setMappings(byKind);
      } else if (!mapRes.ok) {
        toast.error(mapRes.error || "Could not load mappings.");
      }
      if (listRes.ok && listRes.rows) {
        setOptions(
          listRes.rows.filter(
            (t) =>
              (t.metaStatus || "").toUpperCase() === "APPROVED" &&
              (t.metaCategory || "").toUpperCase() === "UTILITY",
          ),
        );
      }
    } catch (e: any) {
      toast.error(e?.message || "Could not load mappings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const assign = async (kind: string, templateId: string) => {
    if (!templateId) return;
    setBusy(kind);
    try {
      const res = (await waAssignMappingServerFn({
        data: { notifyKind: kind, templateId },
      })) as { ok: boolean; error?: string; fieldErrors?: string[] };
      if (res.ok) {
        toast.success("Template assigned.");
        await load();
      } else {
        toast.error(res.fieldErrors?.join(" ") || res.error || "Could not assign.");
      }
    } finally {
      setBusy(null);
    }
  };

  const toggleEnabled = async (kind: string, enabled: boolean) => {
    setBusy(kind);
    try {
      const res = (await waSetMappingEnabledServerFn({
        data: { notifyKind: kind, enabled, optInAck: enabled ? ack[kind] === true : undefined },
      })) as { ok: boolean; error?: string; fieldErrors?: string[] };
      if (res.ok) {
        toast.success(enabled ? "Notification enabled." : "Notification disabled.");
        await load();
      } else {
        toast.error(res.fieldErrors?.join(" ") || res.error || "Could not update.");
      }
    } finally {
      setBusy(null);
    }
  };

  const remove = async (kind: string) => {
    setBusy(kind);
    try {
      const res = (await waRemoveMappingServerFn({ data: { notifyKind: kind } })) as {
        ok: boolean;
        error?: string;
      };
      if (res.ok) {
        toast.success("Mapping removed.");
        await load();
      } else {
        toast.error(res.error || "Could not remove.");
      }
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading mappings…
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="notification-mappings">
      <h3 className="text-sm font-semibold text-zinc-700">Notification mappings</h3>
      <p className="text-xs text-zinc-500">
        Assign an approved UTILITY template to a notification event. Sends stay off until you enable
        the mapping and confirm the opt-in acknowledgement.
      </p>
      <div className="space-y-3">
        {NOTIFY_KINDS.map((kind) => {
          const mapping = mappings[kind];
          const canEnable = !!mapping && ack[kind] === true;
          const rowBusy = busy === kind;
          const ackId = `ack-${kind}`;
          return (
            <div key={kind} className="rounded-lg border border-zinc-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-zinc-800">
                  {NOTIFY_KIND_LABELS[kind]}
                </div>
                {mapping && (
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${
                      mapping.isEnabled
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {mapping.isEnabled ? "Enabled" : "Disabled"}
                  </span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`tpl-${kind}`}>
                  Template for {NOTIFY_KIND_LABELS[kind]}
                </label>
                <select
                  id={`tpl-${kind}`}
                  className="input max-w-xs"
                  value={mapping?.templateId || ""}
                  disabled={rowBusy}
                  onChange={(e) => assign(kind, e.target.value)}
                >
                  <option value="">— Select an approved UTILITY template —</option>
                  {options.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.language})
                    </option>
                  ))}
                </select>
                {mapping && (
                  <button
                    type="button"
                    onClick={() => remove(kind)}
                    disabled={rowBusy}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 disabled:opacity-60 cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </div>

              {mapping && !mapping.isEnabled && (
                <div className="mt-2 space-y-1">
                  <label className="flex items-start gap-2 text-xs text-zinc-700" htmlFor={ackId}>
                    <input
                      id={ackId}
                      type="checkbox"
                      className="mt-0.5"
                      checked={ack[kind] === true}
                      onChange={(e) => setAck((a) => ({ ...a, [kind]: e.target.checked }))}
                    />
                    <span>{OPT_IN_ACK_TEXT}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => toggleEnabled(kind, true)}
                    disabled={!canEnable || rowBusy}
                    aria-describedby={canEnable ? undefined : `${ackId}-reason`}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#0059C6] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 cursor-pointer"
                  >
                    {rowBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Enable
                  </button>
                  {!canEnable && (
                    <DisabledReason
                      id={`${ackId}-reason`}
                      reason="Confirm the opt-in acknowledgement to enable this notification."
                    />
                  )}
                </div>
              )}

              {mapping && mapping.isEnabled && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => toggleEnabled(kind, false)}
                    disabled={rowBusy}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 disabled:opacity-60 cursor-pointer"
                  >
                    Disable
                  </button>
                </div>
              )}

              {!mapping && (
                <p className="mt-1 text-xs text-zinc-400">
                  No template assigned — this notification uses the plain-text / WhatsApp Web path.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default NotificationMappings;
