import { useEffect, useState, useCallback } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  getWaCloudConfigServerFn,
  saveWaCloudConfigServerFn,
  testWaCloudConfigServerFn,
  listWaCloudTemplatesServerFn,
  saveWaCloudTemplateServerFn,
  submitWaCloudTemplateServerFn,
  syncWaCloudTemplateStatusServerFn,
  getWaCloudLogsServerFn,
} from "../../lib/admin";
import { uploadWATemplateHeaderImageServerFn } from "../../lib/auth";

// notifyKind options exclude the two video kinds (HIGH-1 — always WhatsApp Web).
const NOTIFY_KIND_OPTIONS = [
  "",
  "booked",
  "confirmed",
  "cancelled",
  "completed",
  "tokenUpdated",
  "reminderDayBefore",
  "reminderDayOf",
  "reminder2h",
  "reminder1h",
];

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600",
  PENDING: "bg-amber-100 text-amber-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
};

type SubTab = "credentials" | "templates" | "monitoring";

// Same path the server mounts in src/server.ts. Kept local: lib/whatsapp-webhook
// is server-only (crypto/db) and must not be imported into the client bundle.
const WA_WEBHOOK_PATH = "/api/whatsapp/webhook";
const DEFAULT_TEST_MESSAGE = "Test message from BookMyTime";

interface VerifiedInfo {
  verifiedName: string | null;
  displayPhoneNumber: string | null;
  qualityRating: string | null;
}

interface TestResult {
  ok: boolean;
  messageId?: string;
  code?: string;
  message?: string;
  hint?: string;
}

export function WaCloudAdminPanel() {
  const [subTab, setSubTab] = useState<SubTab>("credentials");

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-zinc-200">
        {(
          [
            ["credentials", "Credentials"],
            ["templates", "Templates"],
            ["monitoring", "Monitoring"],
          ] as [SubTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              subTab === id
                ? "border-[#0059C6] text-[#0059C6]"
                : "border-transparent text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === "credentials" && <CredentialsTab />}
      {subTab === "templates" && <TemplatesTab />}
      {subTab === "monitoring" && <MonitoringTab />}
    </div>
  );
}

// ── Credentials ────────────────────────────────────────────────────────────

function CredentialsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [cfg, setCfg] = useState<any>(null);
  const [form, setForm] = useState({
    phoneNumberId: "",
    wabaId: "",
    apiVersion: "v21.0",
    verifyToken: "",
    accessToken: "",
    appSecret: "",
    isEnabled: false,
  });
  const [test, setTest] = useState({ toPhone: "", message: DEFAULT_TEST_MESSAGE });
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [verified, setVerified] = useState<VerifiedInfo | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");

  // window is only available in the browser (SSR-safe).
  useEffect(() => {
    setWebhookUrl(`${window.location.origin}${WA_WEBHOOK_PATH}`);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getWaCloudConfigServerFn();
      setCfg(data);
      setForm((f) => ({
        ...f,
        phoneNumberId: data.phoneNumberId || "",
        wabaId: data.wabaId || "",
        apiVersion: data.apiVersion || "v21.0",
        isEnabled: !!data.isEnabled,
        verifyToken: "",
        accessToken: "",
        appSecret: "",
      }));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await saveWaCloudConfigServerFn({
        data: {
          phoneNumberId: form.phoneNumberId || undefined,
          wabaId: form.wabaId || undefined,
          apiVersion: form.apiVersion || undefined,
          verifyToken: form.verifyToken || undefined,
          accessToken: form.accessToken || undefined,
          appSecret: form.appSecret || undefined,
          isEnabled: form.isEnabled,
        },
      });
      setVerified(res?.verified ?? null);
      toast.success("Configuration saved");
      await load();
    } catch (e: any) {
      setVerified(null);
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success("Webhook URL copied");
    } catch {
      toast.error("Could not copy. Select the URL and copy it manually.");
    }
  };

  const runTest = async () => {
    if (!test.toPhone.trim() || !test.message.trim()) {
      toast.error("Enter a phone number and a message");
      return;
    }
    const confirmed = window.confirm(
      `This sends a real WhatsApp message to ${test.toPhone} and spends WABA send budget. Continue?`,
    );
    if (!confirmed) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testWaCloudConfigServerFn({ data: test });
      setTestResult(res);
      if (res.ok) toast.success("Test message sent");
      else toast.error(`Test failed${res.code ? ` (${res.code})` : ""}: ${res.message || ""}`);
    } catch (e: any) {
      toast.error(e?.message || "Test failed");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {!cfg?.encKeyConfigured && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Encryption key <code>WA_CLOUD_ENC_KEY</code> is not configured. Access token and app
            secret cannot be saved until a 32-byte key is set in the environment.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Phone Number ID">
          <input
            className="input"
            value={form.phoneNumberId}
            onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })}
          />
        </Field>
        <Field label="WABA ID">
          <input
            className="input"
            value={form.wabaId}
            onChange={(e) => setForm({ ...form, wabaId: e.target.value })}
          />
        </Field>
        <Field label="API Version">
          <input
            className="input"
            value={form.apiVersion}
            onChange={(e) => setForm({ ...form, apiVersion: e.target.value })}
          />
        </Field>
        <Field label={`Verify Token ${cfg?.verifyTokenConfigured ? "(configured)" : ""}`}>
          <input
            className="input"
            placeholder={cfg?.verifyTokenConfigured ? "•••• (leave blank to keep)" : ""}
            value={form.verifyToken}
            onChange={(e) => setForm({ ...form, verifyToken: e.target.value })}
          />
        </Field>
        <Field
          label={`Access Token ${
            cfg?.tokenConfigured ? `(••••${cfg.tokenLast4 || ""})` : "(not configured)"
          }`}
        >
          <input
            className="input"
            type="password"
            placeholder={cfg?.tokenConfigured ? "•••• (leave blank to keep)" : ""}
            value={form.accessToken}
            onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
          />
        </Field>
        <Field
          label={`App Secret ${
            cfg?.appSecretConfigured ? `(••••${cfg.appSecretLast4 || ""})` : "(not configured)"
          }`}
        >
          <input
            className="input"
            type="password"
            placeholder={cfg?.appSecretConfigured ? "•••• (leave blank to keep)" : ""}
            value={form.appSecret}
            onChange={(e) => setForm({ ...form, appSecret: e.target.value })}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
        <input
          type="checkbox"
          checked={form.isEnabled}
          onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
        />
        Enable official WhatsApp Cloud API (primary channel)
      </label>

      <div className="flex gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0059C6] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 cursor-pointer"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
      </div>

      {verified && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800"
        >
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
          <div className="space-y-0.5">
            <div className="font-semibold">Verified with Meta</div>
            <div>Verified name: {verified.verifiedName || "—"}</div>
            <div>Display phone number: {verified.displayPhoneNumber || "—"}</div>
            <div>Quality rating: {verified.qualityRating || "—"}</div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 p-4 space-y-2">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Webhook Callback URL">
              <input className="input" readOnly value={webhookUrl} />
            </Field>
          </div>
          <button
            type="button"
            onClick={copyWebhookUrl}
            aria-label="Copy webhook callback URL"
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 cursor-pointer"
          >
            <Copy className="h-4 w-4" aria-hidden="true" /> Copy
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Paste this URL in Meta → WhatsApp → Configuration → Webhook, use your Verify Token, and
          subscribe to the &quot;messages&quot; field. Verify the webhook and the App Secret before
          enabling the Cloud API: Meta reports most delivery failures through it.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
          <ShieldCheck className="h-4 w-4 text-[#0059C6]" /> Send a test message
        </div>
        <p className="text-xs text-zinc-500">
          Meta only delivers free-form text to a number that messaged your business WhatsApp number
          in the last 24 hours.
        </p>
        <div className="grid grid-cols-1 gap-3">
          <Field label="To phone (with country code)">
            <input
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="e.g. 918830553868"
              value={test.toPhone}
              onChange={(e) => setTest({ ...test, toPhone: e.target.value })}
            />
          </Field>
          <Field label="Message">
            <textarea
              className="input min-h-[96px]"
              maxLength={4096}
              value={test.message}
              onChange={(e) => setTest({ ...test, message: e.target.value })}
            />
          </Field>
        </div>
        <button
          onClick={runTest}
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-60 cursor-pointer"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send test message
        </button>
        <div aria-live="polite" className="text-sm">
          {testResult?.ok && (
            <div className="text-emerald-700">
              Accepted by Meta. Message ID: {testResult.messageId || "—"}. Check Monitoring for
              delivery.
            </div>
          )}
          {testResult && !testResult.ok && (
            <div className="text-red-600 space-y-1">
              <div>
                Failed{testResult.code ? ` (${testResult.code})` : ""}: {testResult.message || ""}
              </div>
              {testResult.hint && <div>{testResult.hint}</div>}
            </div>
          )}
        </div>
      </div>

      <StyleTag />
    </div>
  );
}

// ── Templates ──────────────────────────────────────────────────────────────

function TemplatesTab() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await listWaCloudTemplatesServerFn()) as any[]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const blank = () => ({
    name: "",
    language: "en_US",
    category: "UTILITY",
    bodyText: "",
    headerType: "NONE",
    headerImageUrl: "",
    notifyKind: "",
  });

  const save = async () => {
    try {
      await saveWaCloudTemplateServerFn({
        data: {
          id: editing.id,
          name: editing.name,
          language: editing.language,
          category: editing.category,
          bodyText: editing.bodyText,
          headerType: editing.headerType,
          headerImageUrl: editing.headerImageUrl || null,
          notifyKind: editing.notifyKind || null,
        },
      });
      toast.success("Template saved");
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    }
  };

  const submit = async (row: any) => {
    try {
      const res = await submitWaCloudTemplateServerFn({
        data: {
          id: row.id,
          name: row.name,
          language: row.language,
          category: row.category,
          bodyText: row.bodyText,
          headerType: row.headerType,
          headerImageUrl: row.headerImageUrl || null,
          notifyKind: row.notifyKind || null,
        },
      });
      if (res.ok) toast.success("Submitted to Meta for review");
      else toast.error(`Submit failed${res.code ? ` (${res.code})` : ""}: ${res.message || ""}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Submit failed");
    }
  };

  const sync = async (row: any) => {
    try {
      const res = await syncWaCloudTemplateStatusServerFn({ data: { id: row.id } });
      if (res.ok) toast.success(`Status: ${res.status}`);
      else toast.error(res.message || "Sync failed");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Sync failed");
    }
  };

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await uploadWATemplateHeaderImageServerFn({ data: { base64 } });
      setEditing((e: any) => ({ ...e, headerImageUrl: res.url }));
      toast.success("Image uploaded");
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setEditing(blank())}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0059C6] px-4 py-2 text-sm font-semibold text-white cursor-pointer"
        >
          <Plus className="h-4 w-4" /> New template
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Name</th>
              <th className="text-left px-3 py-2 font-semibold">Kind</th>
              <th className="text-left px-3 py-2 font-semibold">Lang</th>
              <th className="text-left px-3 py-2 font-semibold">Vars</th>
              <th className="text-left px-3 py-2 font-semibold">Status</th>
              <th className="text-right px-3 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-400">
                  No templates yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100">
                <td className="px-3 py-2 font-medium text-zinc-800">{r.name}</td>
                <td className="px-3 py-2 text-zinc-600">{r.notifyKind || "—"}</td>
                <td className="px-3 py-2 text-zinc-600">{r.language}</td>
                <td className="px-3 py-2 text-zinc-600">{r.varCount}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                      STATUS_BADGE[r.status] || "bg-zinc-100 text-zinc-600"
                    }`}
                    title={r.rejectionReason || ""}
                  >
                    {r.status}
                  </span>
                  {r.status === "REJECTED" && r.rejectionReason && (
                    <div className="text-xs text-red-500 mt-1">{r.rejectionReason}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                  <button
                    onClick={() => setEditing({ ...r, headerType: r.headerType || "NONE" })}
                    className="text-[#0059C6] hover:underline cursor-pointer"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => submit(r)}
                    className="text-emerald-600 hover:underline cursor-pointer"
                  >
                    Submit
                  </button>
                  <button
                    onClick={() => sync(r)}
                    className="text-zinc-500 hover:underline cursor-pointer inline-flex items-center gap-1"
                  >
                    <RefreshCw className="h-3 w-3" /> Sync
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-zinc-900">
                {editing.id ? "Edit template" : "New template"}
              </h3>
              <button onClick={() => setEditing(null)} className="text-zinc-400 cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>

            <Field label="Name (a-z, 0-9, _)">
              <input
                className="input"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Language">
                <input
                  className="input"
                  value={editing.language}
                  onChange={(e) => setEditing({ ...editing, language: e.target.value })}
                />
              </Field>
              <Field label="Category">
                <select
                  className="input"
                  value={editing.category}
                  onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                >
                  <option>UTILITY</option>
                  <option>MARKETING</option>
                  <option>AUTHENTICATION</option>
                </select>
              </Field>
            </div>
            <Field label="Notify kind (maps this template to an event)">
              <select
                className="input"
                value={editing.notifyKind || ""}
                onChange={(e) => setEditing({ ...editing, notifyKind: e.target.value })}
              >
                {NOTIFY_KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {k || "— none —"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Body text (use {{1}}, {{2}} … placeholders)">
              <textarea
                className="input min-h-[120px]"
                value={editing.bodyText}
                onChange={(e) => setEditing({ ...editing, bodyText: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Header type">
                <select
                  className="input"
                  value={editing.headerType}
                  onChange={(e) => setEditing({ ...editing, headerType: e.target.value })}
                >
                  <option>NONE</option>
                  <option>IMAGE</option>
                </select>
              </Field>
              {editing.headerType === "IMAGE" && (
                <Field label="Header image">
                  <label className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm cursor-pointer">
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    Upload
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
                    />
                  </label>
                </Field>
              )}
            </div>
            {editing.headerImageUrl && (
              <div className="text-xs text-zinc-500 break-all">{editing.headerImageUrl}</div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setEditing(null)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={save}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0059C6] px-4 py-2 text-sm font-semibold text-white cursor-pointer"
              >
                <Save className="h-4 w-4" /> Save
              </button>
            </div>
          </div>
        </div>
      )}

      <StyleTag />
    </div>
  );
}

// ── Monitoring ─────────────────────────────────────────────────────────────

function MonitoringTab() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getWaCloudLogsServerFn({ data: { limit: 100 } }));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const b = data?.breakdown || {};
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Total" value={b.total || 0} />
        <Stat label="Official ✓" value={b.officialOk || 0} tone="emerald" />
        <Stat label="Official ✗" value={b.officialFailed || 0} tone="red" />
        <Stat label="Web ✓" value={b.webOk || 0} tone="emerald" />
        <Stat label="Web ✗" value={b.webFailed || 0} tone="red" />
      </div>

      <div className="flex justify-end">
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm cursor-pointer"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Tenant</th>
              <th className="text-left px-3 py-2 font-semibold">Recipient</th>
              <th className="text-left px-3 py-2 font-semibold">Kind</th>
              <th className="text-left px-3 py-2 font-semibold">Channel</th>
              <th className="text-left px-3 py-2 font-semibold">Status</th>
              <th className="text-left px-3 py-2 font-semibold">Error</th>
            </tr>
          </thead>
          <tbody>
            {(data?.recent || []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-400">
                  No messages logged yet.
                </td>
              </tr>
            )}
            {(data?.recent || []).map((r: any) => (
              <LogRow key={r.id} r={r} />
            ))}
          </tbody>
        </table>
      </div>
      <StyleTag />
    </div>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

export function LogRow({ r }: { r: any }) {
  return (
    <tr className="border-t border-zinc-100">
      <td className="px-3 py-2 text-zinc-600">{r.tenantId}</td>
      <td className="px-3 py-2 text-zinc-600">{r.recipient}</td>
      <td className="px-3 py-2 text-zinc-600">{r.kind}</td>
      <td className="px-3 py-2">
        <span
          className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
            r.channel === "official"
              ? "bg-[#0059C6]/10 text-[#0059C6]"
              : "bg-zinc-100 text-zinc-600"
          }`}
        >
          {r.channel || "—"}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className="inline-flex items-center gap-1 text-zinc-700">
          {r.status === "failed" ? (
            <AlertCircle className="h-3.5 w-3.5 text-red-500" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          )}
          {r.status}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-red-500">
        {r.errorCode ? `${r.errorCode}: ${r.errorMessage || ""}` : "—"}
      </td>
    </tr>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  const color =
    tone === "emerald" ? "text-emerald-600" : tone === "red" ? "text-red-600" : "text-zinc-900";
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-xl font-black ${color}`}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-zinc-600">{label}</span>
      {children}
    </label>
  );
}

function StyleTag() {
  return (
    <style>{`
      .input {
        width: 100%;
        border: 1px solid #d4d4d8;
        border-radius: 0.5rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
        outline: none;
      }
      .input:focus { border-color: #0059C6; box-shadow: 0 0 0 2px rgba(0,89,198,0.15); }
    `}</style>
  );
}

export default WaCloudAdminPanel;
