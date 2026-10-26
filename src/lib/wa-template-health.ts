// ─────────────────────────────────────────────────────────────────────────────
// wa-template-health.ts  (server)
//
// Account-health reads from the §9 Graph ops (WABA node, phone node, health
// status, subscribed apps, debug_token), snapshot persistence with a cooldown
// (R-HLTH-08), and the Messaging-account-ID verification (DP-04). Read-only:
// GETs only, no writes to Meta. Never throws to the handler; never returns a
// token/secret (DP-16 stores scopes, never the token itself).
// ─────────────────────────────────────────────────────────────────────────────
import {
  API_VERSION_EXPIRY,
  DEFAULT_API_VERSION,
  debugToken,
  getHealthStatus,
  getPhoneNode,
  getSubscribedApps,
  getWabaNode,
  resolveCloudConfig,
} from "./whatsapp-cloud";

/** Health reads are cached for this long to respect the management rate limit. */
const HEALTH_COOLDOWN_MS = 60_000;

export interface AccountHealth {
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

let cached: { at: number; data: AccountHealth } | null = null;

function versionInfo(apiVersion: string): AccountHealth["apiVersion"] {
  const known = Object.prototype.hasOwnProperty.call(API_VERSION_EXPIRY, apiVersion);
  const expiresOn = known ? API_VERSION_EXPIRY[apiVersion] : null;
  let warning: string | null = null;
  if (!known) {
    warning = `API version ${apiVersion} is not recognised.`;
  } else if (expiresOn) {
    const days = Math.ceil((Date.parse(expiresOn) - Date.now()) / 86_400_000);
    if (days <= 120) {
      warning =
        days <= 0
          ? `API version ${apiVersion} has reached its Meta expiry (${expiresOn}).`
          : `API version ${apiVersion} expires on ${expiresOn} (${days} days).`;
    }
  }
  return { value: apiVersion, expiresOn, warning };
}

/**
 * Reads account health from Meta (read-only GETs) and caches it. A WABA-node
 * success also records accountTypeOk (DP-04: confirms the configured ID is a
 * Messaging account / WABA node, not a Phone Number ID). Never throws.
 */
export async function waAccountHealth(opts?: {
  force?: boolean;
}): Promise<{ ok: true; health: AccountHealth } | { ok: false; error: string }> {
  try {
    if (!opts?.force && cached && Date.now() - cached.at < HEALTH_COOLDOWN_MS) {
      return { ok: true, health: cached.data };
    }
    const cfg = await resolveCloudConfig();
    if (!cfg || !cfg.accessToken) {
      return { ok: false, error: "Cloud API is not configured." };
    }

    const notes: string[] = [];
    const [waba, phone, wabaHealth, apps, token] = await Promise.all([
      getWabaNode(),
      getPhoneNode(),
      cfg.wabaId ? getHealthStatus(cfg.wabaId) : Promise.resolve(null),
      getSubscribedApps(),
      debugToken(),
    ]);

    const tokenData = token && token.ok ? token.data?.data : null;
    const scopes: string[] = Array.isArray(tokenData?.scopes) ? tokenData.scopes.map(String) : [];
    const tokenInfo: AccountHealth["token"] = {
      valid: token ? (token.ok ? (tokenData?.is_valid ?? null) : null) : null,
      appId: tokenData?.app_id != null ? String(tokenData.app_id) : null,
      type: tokenData?.type != null ? String(tokenData.type) : null,
      expiresAt: tokenData?.expires_at != null ? Number(tokenData.expires_at) : null,
      scopes,
      hasManagement: token && token.ok ? scopes.includes("whatsapp_business_management") : null,
      hasMessaging: token && token.ok ? scopes.includes("whatsapp_business_messaging") : null,
      note: token && !token.ok ? "Not verifiable" : null,
    };

    const accountTypeOk = waba.ok ? true : null;
    if (!waba.ok) {
      notes.push("Could not verify the Messaging account ID; confirm it is not a Phone Number ID.");
    }

    const health: AccountHealth = {
      apiVersion: versionInfo(cfg.apiVersion || DEFAULT_API_VERSION),
      waba: waba.ok ? waba.data : null,
      phone: phone.ok ? phone.data : null,
      health: wabaHealth && wabaHealth.ok ? wabaHealth.data : null,
      subscribedApps: apps.ok ? apps.data : null,
      token: tokenInfo,
      accountTypeOk,
      fetchedAt: new Date().toISOString(),
      notes,
    };

    cached = { at: Date.now(), data: health };
    void persistSnapshot(health, accountTypeOk);
    return { ok: true, health };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not read account health." };
  }
}

/** Clears the health cooldown cache (used after a forced refresh). */
export async function waRefreshHealth(): Promise<
  { ok: true; health: AccountHealth } | { ok: false; error: string }
> {
  cached = null;
  return waAccountHealth({ force: true });
}

/** Test-only cache reset. */
export function __resetHealthCacheForTests(): void {
  cached = null;
}

/** Persists the last health snapshot + accountType check, best-effort. */
async function persistSnapshot(
  health: AccountHealth,
  accountTypeOk: boolean | null,
): Promise<void> {
  try {
    const { execute } = await import("./db");
    await execute("INSERT IGNORE INTO WaCloudRuntime (id) VALUES ('central')");
    await execute(
      `UPDATE WaCloudRuntime
          SET healthSnapshot = ?, healthFetchedAt = NOW(),
              accountTypeOk = ?, accountTypeCheckedAt = NOW()
        WHERE id = 'central'`,
      [JSON.stringify(health), accountTypeOk == null ? null : accountTypeOk ? 1 : 0],
    );
  } catch {
    /* no DB in this environment is fine; the snapshot is best-effort */
  }
}
