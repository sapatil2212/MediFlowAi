// ─────────────────────────────────────────────────────────────────────────────
// TemplateCatalogPanel.tsx — Super Admin → WhatsApp → Templates (catalog view).
//
// The BookMyTime Utility template catalog against what Meta reports for the
// connected WABA: name, applicable categories, language, Meta template ID,
// approval status, variable schema, linked events and last sync. Actions:
// sync from Meta, submit missing templates for review (confirmed), activate
// approved routes, test-send an approved template to a number you enter, and
// view rejection details. Approval is Meta's decision — the UI never implies it.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, PlayCircle, RefreshCw, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  notifyCatalogActivateServerFn,
  notifyCatalogPlanServerFn,
  notifyCatalogSubmitServerFn,
  notifyTestSendServerFn,
  waSyncAllServerFn,
} from "../../../lib/admin";
import { BUSINESS_CATEGORY_LABELS } from "../../../lib/notify-catalog";
import { NOTIFY_KIND_LABELS } from "../../../lib/wa-template-model";
import { ConfirmDialog } from "../wa-templates/shared";

const STATE_TONE: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
  paused: "bg-orange-100 text-orange-700",
  disabled: "bg-red-100 text-red-700",
  reclassified: "bg-orange-100 text-orange-700",
  content_mismatch: "bg-orange-100 text-orange-700",
  draft: "bg-zinc-100 text-zinc-700",
  uncertain: "bg-orange-100 text-orange-700",
  missing: "bg-zinc-100 text-zinc-500",
  unknown: "bg-zinc-100 text-zinc-500",
};

const STATE_LABEL: Record<string, string> = {
  approved: "Approved",
  pending: "Pending Meta review",
  rejected: "Rejected",
  paused: "Paused",
  disabled: "Disabled",
  reclassified: "Reclassified (not Utility)",
  content_mismatch: "Wording differs from catalog",
  draft: "Local draft",
  uncertain: "Submission uncertain",
  missing: "Not on WABA",
  unknown: "Unknown",
};

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function TemplateCatalogPanel() {
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState<string[] | null>(null);
  const [results, setResults] = useState<any[] | null>(null);
  const [testFor, setTestFor] = useState<any | null>(null);
  const [testPhone, setTestPhone] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await notifyCatalogPlanServerFn({ data: {} });
      if (!res?.ok) throw new Error(res?.error || "Could not load the catalog.");
      setPlan(res);
    } catch (e: any) {
      toast.error(e?.message || "Could not load the catalog.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submittable = useMemo(
    () =>
      (plan?.rows ?? [])
        .filter(
          (r: any) =>
            r.origin === "catalog_new" &&
            (r.state === "missing" || r.state === "draft") &&
            r.validationErrors.length === 0,
        )
        .map((r: any) => r.name as string),
    [plan],
  );

  const sync = async () => {
    setBusy("sync");
    try {
      const res: any = await waSyncAllServerFn({ data: {} });
      if (res?.ok) toast.success(`Synced ${res.scanned ?? 0} templates from Meta.`);
      else toast.error(res?.error || "Sync failed.");
      await load();
    } finally {
      setBusy(null);
    }
  };

  const submit = async (names: string[]) => {
    setBusy("submit");
    try {
      const res: any = await notifyCatalogSubmitServerFn({ data: { names, confirm: true } });
      if (!res?.ok) {
        toast.error(res?.error || "Submission failed.");
        return;
      }
      setResults(res.results);
      const n = res.results.filter((r: any) => r.outcome === "submitted").length;
      toast.success(`${n} template(s) submitted to Meta for review.`);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const activate = async () => {
    setBusy("activate");
    try {
      const res: any = await notifyCatalogActivateServerFn({ data: {} });
      if (!res?.ok) {
        toast.error(res?.error || "Activation failed.");
        return;
      }
      const applied = res.changes.filter((c: any) => c.action !== "skipped");
      toast.success(
        applied.length
          ? `${applied.length} route change(s) applied.`
          : "All approved routes are already active.",
      );
      await load();
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    if (!testFor?.localTemplateId) return;
    setBusy("test");
    try {
      const res: any = await notifyTestSendServerFn({
        data: { templateId: testFor.localTemplateId, phone: testPhone },
      });
      if (res?.ok)
        toast.success(`Accepted by Meta (${res.messageId}). Delivery is confirmed by webhook.`);
      else toast.error(res?.error || "Test send failed.");
      setTestFor(null);
    } finally {
      setBusy(null);
    }
  };

  if (loading && !plan) {
    return (
      <div className="flex items-center gap-2 py-8 text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading catalog…
      </div>
    );
  }
  if (!plan) return null;

  const s = plan.summary;
  return (
    <div className="space-y-4" data-testid="template-catalog">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={sync}
          disabled={!!busy}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 cursor-pointer"
        >
          {busy === "sync" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Sync from Meta
        </button>
        <button
          type="button"
          onClick={() => setConfirmSubmit(submittable)}
          disabled={!!busy || submittable.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0059C6] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
        >
          {busy === "submit" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Submit {submittable.length} missing template{submittable.length === 1 ? "" : "s"}
        </button>
        <button
          type="button"
          onClick={activate}
          disabled={!!busy}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 cursor-pointer"
        >
          {busy === "activate" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="h-4 w-4" />
          )}
          Activate approved routes
        </button>
        <span className="text-xs text-zinc-500">
          {s.total} in catalog · {s.approved} approved · {s.pending} pending · {s.rejected} rejected
          · {s.missing} not submitted
        </span>
      </div>

      {results && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
          <div className="mb-1 font-semibold">Submission results</div>
          <ul className="space-y-0.5 text-xs">
            {results.map((r: any) => (
              <li key={`${r.name}-${r.language}`}>
                <span className="font-mono">{r.name}</span> ({r.language}):{" "}
                {r.outcome.replace(/_/g, " ")}
                {r.metaStatus ? ` · ${r.metaStatus}` : ""}
                {r.metaTemplateId ? ` · id ${r.metaTemplateId}` : ""}
                {r.detail ? ` · ${r.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Template</th>
              <th className="px-3 py-2 text-left font-semibold">Categories</th>
              <th className="px-3 py-2 text-left font-semibold">Events</th>
              <th className="px-3 py-2 text-left font-semibold">Meta</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-left font-semibold">Variables</th>
              <th className="px-3 py-2 text-left font-semibold">Routes</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((r: any) => (
              <tr key={`${r.name}-${r.language}`} className="border-t border-zinc-100 align-top">
                <td className="px-3 py-2">
                  <div className="font-mono text-xs font-semibold text-zinc-900">{r.name}</div>
                  <div className="text-xs text-zinc-500">
                    {r.language} · UTILITY ·{" "}
                    {r.origin === "approved_existing" ? "existing (reused)" : "catalog"}
                  </div>
                  <details className="mt-1 text-xs text-zinc-600">
                    <summary className="cursor-pointer text-zinc-500">Body</summary>
                    <pre className="mt-1 whitespace-pre-wrap font-sans">{r.bodyText}</pre>
                    {r.footerText && <div className="mt-1 text-zinc-400">{r.footerText}</div>}
                  </details>
                </td>
                <td className="px-3 py-2 text-xs text-zinc-600">
                  {r.appliesTo
                    .map((c: string) => (BUSINESS_CATEGORY_LABELS as any)[c] ?? c)
                    .join(", ")}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-600">
                  {r.kinds.map((k: string) => (NOTIFY_KIND_LABELS as any)[k] ?? k).join(", ")}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-600">
                  <div className="font-mono">{r.metaTemplateId ?? "—"}</div>
                  <div className="text-zinc-400">synced {fmt(r.lastSyncedAt)}</div>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${STATE_TONE[r.state] ?? ""}`}
                  >
                    {STATE_LABEL[r.state] ?? r.state}
                  </span>
                  {r.metaStatus && (
                    <div className="mt-0.5 text-xs text-zinc-400">
                      {r.metaStatus} / {r.metaCategory ?? "—"}
                    </div>
                  )}
                  {r.rejectionDetail && (
                    <div className="mt-0.5 max-w-[14rem] text-xs text-red-600">
                      {r.rejectionDetail}
                    </div>
                  )}
                  {r.validationErrors.length > 0 && (
                    <div className="mt-0.5 max-w-[14rem] text-xs text-red-600">
                      {r.validationErrors.join(" ")}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-600">
                  {r.variables.map((v: any) => (
                    <div key={v.key}>
                      <span className="font-mono">{`{{${v.key.split(".").pop()}}}`}</span> →{" "}
                      {v.field}
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-600">
                  {r.routes.map((rt: any) => (
                    <div key={`${rt.businessCategory}-${rt.kind}`}>
                      {rt.businessCategory}/{rt.kind}:{" "}
                      {rt.usesCatalogTemplate
                        ? rt.enabled
                          ? "active"
                          : "mapped (off)"
                        : rt.mappedTemplateName
                          ? `uses ${rt.mappedTemplateName}`
                          : "not mapped"}
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2 space-y-1">
                  {r.origin === "catalog_new" &&
                    (r.state === "missing" || r.state === "draft") &&
                    r.validationErrors.length === 0 && (
                      <button
                        type="button"
                        onClick={() => setConfirmSubmit([r.name])}
                        disabled={!!busy}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#0059C6] hover:underline disabled:opacity-50 cursor-pointer"
                      >
                        <Upload className="h-3 w-3" /> Submit
                      </button>
                    )}
                  {r.state === "approved" && r.localTemplateId && (
                    <button
                      type="button"
                      onClick={() => setTestFor(r)}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#0059C6] hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      <Send className="h-3 w-3" /> Test
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="rounded-lg border border-zinc-200 p-3 text-sm">
        <summary className="cursor-pointer font-semibold text-zinc-800">
          Candidates intentionally not submitted ({plan.excluded.length})
        </summary>
        <ul className="mt-2 space-y-1 text-xs text-zinc-600">
          {plan.excluded.map((x: any) => (
            <li key={x.name}>
              <span className="font-mono">{x.name}</span> — {x.reason}
            </li>
          ))}
        </ul>
      </details>

      <ConfirmDialog
        open={!!confirmSubmit}
        title={`Submit ${confirmSubmit?.length ?? 0} template(s) to Meta for review?`}
        description={
          <div className="space-y-2 text-sm">
            <p>
              Each template is created on the connected WhatsApp Business Account as category
              UTILITY and becomes PENDING until Meta reviews it. Existing templates are never
              recreated or changed. Meta may approve, reject or reclassify them.
            </p>
            <p className="font-mono text-xs">{confirmSubmit?.join(", ")}</p>
          </div>
        }
        confirmLabel="Submit to Meta"
        onConfirm={() => {
          const names = confirmSubmit ?? [];
          setConfirmSubmit(null);
          void submit(names);
        }}
        onCancel={() => setConfirmSubmit(null)}
      />

      {testFor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Test template"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
        >
          <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold">Test {testFor.name}</h3>
            <p className="text-sm text-zinc-600">
              Sends this approved template with its fictional sample values to the number you enter.
              Only use a number that has agreed to receive test messages.
            </p>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-zinc-600">
                WhatsApp number (with country code)
              </span>
              <input
                className="input"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="+91 98xxxxxxxx"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTestFor(null)}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy === "test" || testPhone.replace(/\D/g, "").length < 10}
                onClick={sendTest}
                className="rounded bg-[#0059C6] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
              >
                {busy === "test" ? "Sending…" : "Send test"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TemplateCatalogPanel;
