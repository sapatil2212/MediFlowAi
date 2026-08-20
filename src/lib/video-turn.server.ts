// ─────────────────────────────────────────────────────────────────────────────
// video-turn.server.ts — ICE configuration and ephemeral TURN credentials.
//
// Server-only (`.server.ts` house convention, cf. `auth.server.ts`): the TURN
// shared secret is read from the environment here and must never reach the
// browser. Only the derived `username` / `credential` pair crosses the wire
// (Req 8.4).
//
// Every function is deterministic: the clock arrives as an explicit `nowMs`
// argument and the environment as an injectable `env` parameter, so the whole
// module is property-testable without stubbing globals.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac } from "node:crypto";

/** Maximum lifetime of an ephemeral credential, in seconds (Req 8.3). */
export const MAX_TURN_CREDENTIAL_TTL_SECONDS = 3600;
/** Lifetime used when `TURN_CREDENTIAL_TTL_SECONDS` is unset or unparsable. */
export const DEFAULT_TURN_CREDENTIAL_TTL_SECONDS = 3600;

export interface TurnConfig {
  stunUrls: string[];
  turnUrls: string[];
  realm: string | null;
  sharedSecret: string | null;
  ttlSeconds: number;
}

export interface EphemeralTurnCredential {
  username: string;
  credential: string;
  expiresAtUnix: number;
  ttlSeconds: number;
}

export interface IceConfiguration {
  iceServers: Array<{ urls: string[]; username?: string; credential?: string }>;
  iceTransportPolicy: "all";
  expiresAtUnix: number | null;
  /** Drives the "restrictive networks may fail" doctor notice (Req 8.7). */
  turnConfigured: boolean;
}

/** Comma-separated list → trimmed entries with empties dropped. */
function parseUrlList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function trimmedOrNull(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * Reads the TURN endpoints, realm, shared secret, and credential TTL from
 * environment configuration (Req 8.5). `env` is injectable so tests never
 * mutate `process.env`.
 */
export function readTurnConfig(env: Record<string, string | undefined> = process.env): TurnConfig {
  const rawTtl = trimmedOrNull(env.TURN_CREDENTIAL_TTL_SECONDS);
  const parsedTtl = rawTtl === null ? Number.NaN : Number.parseInt(rawTtl, 10);

  return {
    stunUrls: parseUrlList(env.TURN_STUN_URLS),
    turnUrls: parseUrlList(env.TURN_URLS),
    realm: trimmedOrNull(env.TURN_REALM),
    sharedSecret: trimmedOrNull(env.TURN_SHARED_SECRET),
    ttlSeconds: Number.isFinite(parsedTtl) ? parsedTtl : DEFAULT_TURN_CREDENTIAL_TTL_SECONDS,
  };
}

/**
 * TURN is usable only when we have at least one relay URL *and* the shared
 * secret needed to mint a credential for it. Anything less is an unconfigured
 * deployment, never a reason to fall back to a third-party server (Req 11.3).
 */
export function isTurnConfigured(cfg: TurnConfig): boolean {
  return cfg.turnUrls.length > 0 && (cfg.sharedSecret ?? "").length > 0;
}

/** coturn REST scheme: username = "<unixExpiry>:<id>". */
export function buildTurnUsername(expiryUnix: number, id: string): string {
  return `${expiryUnix}:${id}`;
}

/**
 * Inverse of `buildTurnUsername`. Splits on the FIRST `:` only, so ids are
 * handled predictably. Returns `null` for anything malformed.
 */
export function parseTurnUsername(u: string): { expiryUnix: number; id: string } | null {
  if (typeof u !== "string") return null;
  const separator = u.indexOf(":");
  if (separator <= 0 || separator === u.length - 1) return null;

  const expiryPart = u.slice(0, separator);
  const id = u.slice(separator + 1);
  if (!/^\d+$/.test(expiryPart)) return null;

  const expiryUnix = Number.parseInt(expiryPart, 10);
  if (!Number.isSafeInteger(expiryUnix)) return null;

  return { expiryUnix, id };
}

/**
 * base64( HMAC-SHA1( username, sharedSecret ) ).
 *
 * SHA-1 and base64 are NOT a choice here: coturn's `use-auth-secret` /
 * TURN REST API scheme mandates exactly this construction, and the TURN server
 * recomputes it the same way to authenticate the credential. "Upgrading" this
 * to SHA-256 or to hex output silently breaks every coturn deployment.
 */
export function deriveTurnPassword(username: string, sharedSecret: string): string {
  return createHmac("sha1", sharedSecret).update(username).digest("base64");
}

/**
 * Mints a short-lived credential for one participant. The configured TTL is
 * clamped to `[1, 3600]`: 3600 is a hard ceiling regardless of what the
 * environment asks for (Req 8.3).
 *
 * Throws when TURN is not configured — callers gate on `isTurnConfigured` (or
 * use `buildIceConfiguration`, which handles the unconfigured case). The error
 * message deliberately carries no secret material (Req 8.4).
 */
export function mintTurnCredential(
  cfg: TurnConfig,
  participantId: string,
  nowMs: number,
): EphemeralTurnCredential {
  const sharedSecret = cfg.sharedSecret;
  if (!sharedSecret) {
    throw new Error("TURN shared secret is not configured");
  }

  const ttlSeconds = clamp(
    cfg.ttlSeconds ?? DEFAULT_TURN_CREDENTIAL_TTL_SECONDS,
    1,
    MAX_TURN_CREDENTIAL_TTL_SECONDS,
  );
  const expiresAtUnix = Math.floor(nowMs / 1000) + ttlSeconds;
  const username = buildTurnUsername(expiresAtUnix, participantId);

  return {
    username,
    credential: deriveTurnPassword(username, sharedSecret),
    expiresAtUnix,
    ttlSeconds,
  };
}

/**
 * Builds the ICE configuration handed to a browser. `iceServers` is populated
 * exclusively from the deployment's own STUN/TURN variables (Req 8.1, 11.3).
 *
 * When TURN is not configured the list is empty (Req 8.6): `RTCPeerConnection`
 * still gathers host candidates, which is what local development needs. No
 * public STUN or TURN service is ever substituted as a fallback.
 */
export function buildIceConfiguration(
  cfg: TurnConfig,
  participantId: string,
  nowMs: number,
): IceConfiguration {
  if (!isTurnConfigured(cfg)) {
    return {
      iceServers: [],
      iceTransportPolicy: "all",
      expiresAtUnix: null,
      turnConfigured: false,
    };
  }

  const credential = mintTurnCredential(cfg, participantId, nowMs);
  const iceServers: IceConfiguration["iceServers"] = [];

  if (cfg.stunUrls.length > 0) {
    iceServers.push({ urls: [...cfg.stunUrls] });
  }
  iceServers.push({
    urls: [...cfg.turnUrls],
    username: credential.username,
    credential: credential.credential,
  });

  return {
    iceServers,
    iceTransportPolicy: "all",
    expiresAtUnix: credential.expiresAtUnix,
    turnConfigured: true,
  };
}
