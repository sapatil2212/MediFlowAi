// ─────────────────────────────────────────────────────────────────────────────
// AccountHealthPanel.tsx — read-only Messaging-account health (R-HLTH).
//
// Renders ONLY values returned by waAccountHealth (API version + expiry warning,
// WABA / phone / health_status nodes, subscribed apps, token scopes). It NEVER
// renders a token or secret — the service already strips the token value and
// surfaces scopes/flags only (DP-16). External links use rel="noopener
// noreferrer". A restricted/blocked health state shows an explanation and the
// next action with a WhatsApp Manager link.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { waAccountHealthServerFn, waRefreshHealthServerFn } from "../../../lib/admin";
import { RESOLUTION_LINKS } from "../../../lib/wa-template-model";
import { ExternalLink, InfoBox } from "./shared";

interface AccountHealth {
  apiVersion: { value: string; expiresOn: string | null; warning: string | null };
  waba: Record<string, unknown> | null;
  phone: Record<string, unknown> | null;
  health: Record<string, unknown> | null;
  subscribedApps: unknown | null;
  token: {
    valid: boolean | null;
    appId: string | null;
    type: string | null;
    expiresAt: number | null;
    scopes: string[];
    hasManagement: boolean | null;
    hasMessaging: boolean | null;
    note: string | null;
  };
  accountTypeOk: boolean | null;
  fetchedAt: string;
  notes: string[];
}

function canSend(health: Record<string, unknown> | null): string | null {
  if (!health) return null;
  const v = (health as any).can_send_message;
  return typeof v === "string" ? v : null;
}

export function AccountHealthPanel() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [health, setHealth] = useState<AccountHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force?: boolean) => {
    setLoading(true);
    try {
      const fn = force ? waRefreshHealthServerFn : waAccountHealthServerFn;
      const res = (await fn({ data: {} })) as {
        ok: boolean;
        health?: AccountHealth;
        error?: string;
      };
      if (res.ok && res.health) {
        setHealth(res.health);
        setError(null);
      } else {
        setError(res.error || "Could not load account health.");
      }
    } catch (e: any) {
      setError(e?.message || "Could not load account health.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
    toast.success("Account health refreshed.");
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading account health…
      </div>
    );
  }

  const sendState = canSend(health?.health ?? null);
  const restricted = sendState === "BLOCKED" || sendState === "LIMITED";

  return (
    <div className="space-y-4" data-testid="account-health">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700">Account health</h3>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-60 cursor-pointer"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </button>
      </div>

      {error && (
        <InfoBox>
          {error} Account health reads are rate-limited; try again shortly or open{" "}
          <ExternalLink href={RESOLUTION_LINKS.whatsappManager}>WhatsApp Manager</ExternalLink>.
        </InfoBox>
      )}

      {restricted && (
        <div
          role="alert"
          className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          data-testid="restricted-health"
        >
          <div className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Messaging account {sendState === "BLOCKED" ? "blocked" : "restricted"}</span>
          </div>
          <p>
            Meta reports this account cannot send normally ({sendState}). Template sends may fail
            until the restriction is resolved.
          </p>
          <p className="text-red-700">
            Review the account status and resolve the restriction in WhatsApp Manager.
          </p>
          <ExternalLink
            href={RESOLUTION_LINKS.whatsappManager}
            className="text-sm font-medium text-red-700 hover:underline"
          >
            Open WhatsApp Manager
          </ExternalLink>
        </div>
      )}

      {health && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <HealthCard title="API version">
            <Row label="Version" value={health.apiVersion.value} />
            <Row label="Expires" value={health.apiVersion.expiresOn ?? "—"} />
            {health.apiVersion.warning && (
              <p className="mt-1 text-xs text-amber-700">{health.apiVersion.warning}</p>
            )}
          </HealthCard>

          <HealthCard title="Token">
            <Row label="Valid" value={yesNo(health.token.valid)} />
            <Row label="App ID" value={health.token.appId ?? "—"} />
            <Row label="Scopes" value={health.token.scopes.join(", ") || "—"} />
            <Row label="Management" value={yesNo(health.token.hasManagement)} />
            <Row label="Messaging" value={yesNo(health.token.hasMessaging)} />
            {health.token.note && <p className="mt-1 text-xs text-zinc-500">{health.token.note}</p>}
          </HealthCard>

          <HealthCard title="Messaging account">
            <Row label="Name" value={str(health.waba, "name")} />
            <Row label="Review status" value={str(health.waba, "account_review_status")} />
            <Row label="Account type verified" value={yesNo(health.accountTypeOk)} />
          </HealthCard>

          <HealthCard title="Phone number">
            <Row label="Display" value={str(health.phone, "display_phone_number")} />
            <Row label="Quality" value={str(health.phone, "quality_rating")} />
            <Row label="Status" value={str(health.phone, "status")} />
            <Row label="Can send" value={sendState ?? "—"} />
          </HealthCard>
        </div>
      )}

      {health && health.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 rounded-lg border border-zinc-200 bg-zinc-50 p-3 pl-7 text-xs text-zinc-600">
          {health.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {!restricted && sendState === "AVAILABLE" && (
        <div className="flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Messaging account can send.
        </div>
      )}
    </div>
  );
}

function HealthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </div>
      <div className="space-y-0.5 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right font-medium text-zinc-800">{value}</span>
    </div>
  );
}

function yesNo(v: boolean | null): string {
  return v == null ? "—" : v ? "Yes" : "No";
}

function str(node: Record<string, unknown> | null, key: string): string {
  const v = node?.[key];
  return typeof v === "string" || typeof v === "number" ? String(v) : "—";
}

export default AccountHealthPanel;
