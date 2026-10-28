// ─────────────────────────────────────────────────────────────────────────────
// notify-consent.ts  (server-only)
//
// WhatsApp notification consent for transactional (UTILITY) booking updates.
//
//   • Booking forms record an explicit choice (opted_in / opted_out) with its
//     source, the notice version shown and the booking it came from.
//   • Replying STOP to the shared WhatsApp number records a platform-wide opt
//     out ('*' scope) that blocks every tenant; START lifts it.
//   • At dispatch the decision is: platform opt-out → deny; tenant opt-out →
//     deny; tenant opt-in → allow (explicit); no record → allow only when the
//     platform consent mode is "implied_by_booking" (the customer gave this
//     number to this business for this booking), otherwise deny.
//
// This consent never covers marketing: the engine only sends UTILITY templates
// tied to the customer's own booking.
// ─────────────────────────────────────────────────────────────────────────────
import { normalizeWaPhone } from "./whatsapp-cloud";
import {
  getNotifyRepo,
  PLATFORM_CONSENT_SCOPE,
  type ConsentMode,
  type ConsentRow,
} from "./notify-repo";

/** Version of the opt-in wording shown on booking forms (bump when it changes). */
export const WHATSAPP_NOTICE_VERSION = "2026-10-27.v1";

export type ConsentSource =
  | "public_booking_form"
  | "public_restaurant_form"
  | "staff_booking"
  | "whatsapp_keyword"
  | "tenant_admin"
  | "super_admin";

export type ConsentDecision =
  | { allowed: true; basis: "explicit_opt_in" | "booking_provided_number" }
  | { allowed: false; reason: "opted_out_platform" | "opted_out" | "consent_missing" };

/** Normalized E.164 digits, or null when the value cannot be a phone number. */
export function consentPhone(raw: string | null | undefined): string | null {
  const phone = normalizeWaPhone(raw);
  return phone.length >= 10 && phone.length <= 15 ? phone : null;
}

/** Records an explicit choice for one tenant (or '*' for platform scope). */
export async function recordConsent(input: {
  tenantId: string;
  phone: string | null | undefined;
  optedIn: boolean;
  source: ConsentSource;
  appointmentId?: string | null;
  noticeVersion?: string | null;
  nowMs?: number;
}): Promise<boolean> {
  const phone = consentPhone(input.phone);
  if (!phone || !input.tenantId) return false;
  const nowMs = input.nowMs ?? Date.now();
  const repo = getNotifyRepo();
  await repo.upsertConsent({
    tenantId: input.tenantId,
    phone,
    status: input.optedIn ? "opted_in" : "opted_out",
    source: input.source,
    noticeVersion: input.noticeVersion ?? WHATSAPP_NOTICE_VERSION,
    appointmentId: input.appointmentId ?? null,
    capturedAtMs: nowMs,
    withdrawnAtMs: input.optedIn ? null : nowMs,
  });
  await repo.addAudit({
    tenantId: input.tenantId === PLATFORM_CONSENT_SCOPE ? null : input.tenantId,
    action: input.optedIn ? "consent_opt_in" : "consent_opt_out",
    actor: input.source,
    detail: {
      source: input.source,
      scope: input.tenantId === PLATFORM_CONSENT_SCOPE ? "platform" : "tenant",
      appointmentId: input.appointmentId ?? null,
      noticeVersion: input.noticeVersion ?? WHATSAPP_NOTICE_VERSION,
    },
    atMs: nowMs,
  });
  return true;
}

/** Pure decision from the stored records (exported for tests). */
export function decideConsent(
  platform: ConsentRow | null,
  tenant: ConsentRow | null,
  mode: ConsentMode,
): ConsentDecision {
  if (platform?.status === "opted_out") return { allowed: false, reason: "opted_out_platform" };
  if (tenant?.status === "opted_out") return { allowed: false, reason: "opted_out" };
  if (tenant?.status === "opted_in") return { allowed: true, basis: "explicit_opt_in" };
  if (mode === "implied_by_booking") return { allowed: true, basis: "booking_provided_number" };
  return { allowed: false, reason: "consent_missing" };
}

export async function evaluateConsent(input: {
  tenantId: string;
  phone: string;
  mode: ConsentMode;
}): Promise<ConsentDecision> {
  const repo = getNotifyRepo();
  const [platform, tenant] = await Promise.all([
    repo.getConsent(PLATFORM_CONSENT_SCOPE, input.phone),
    repo.getConsent(input.tenantId, input.phone),
  ]);
  return decideConsent(platform, tenant, input.mode);
}

const STOP_WORDS = new Set(["stop", "unsubscribe", "stop all", "opt out", "optout", "cancel all"]);
const START_WORDS = new Set(["start", "subscribe", "unstop", "opt in", "optin"]);

/** Recognises an opt-out / opt-in keyword message (whole message only). */
export function parseConsentKeyword(text: string | null | undefined): "stop" | "start" | null {
  if (!text) return null;
  const t = String(text)
    .trim()
    .toLowerCase()
    .replace(/[.!\s]+$/g, "")
    .replace(/\s+/g, " ");
  if (STOP_WORDS.has(t)) return "stop";
  if (START_WORDS.has(t)) return "start";
  return null;
}

export const OPT_OUT_REPLY =
  "You will no longer receive WhatsApp booking notifications sent through BookMyTime. Reply START to receive them again.";
export const OPT_IN_REPLY =
  "WhatsApp booking notifications sent through BookMyTime are turned back on for this number. Reply STOP to opt out.";

/** Applies a STOP/START keyword at platform scope. Returns the reply text. */
export async function applyConsentKeyword(input: {
  from: string;
  keyword: "stop" | "start";
  nowMs?: number;
}): Promise<string | null> {
  const ok = await recordConsent({
    tenantId: PLATFORM_CONSENT_SCOPE,
    phone: input.from,
    optedIn: input.keyword === "start",
    source: "whatsapp_keyword",
    nowMs: input.nowMs,
  });
  if (!ok) return null;
  return input.keyword === "stop" ? OPT_OUT_REPLY : OPT_IN_REPLY;
}
