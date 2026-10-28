// ─────────────────────────────────────────────────────────────────────────────
// notify-tenant.ts  (server-only)
//
// Tenant Admin view of WhatsApp booking notifications: the tenant's own
// settings, delivery statuses, recent failures, which approved templates their
// business category uses, and customer opt-out management.
//
// Isolation: every read and write is bound to the tenantId of the VERIFIED
// session (never client input). Tenants never see WABA credentials, Meta IDs,
// other tenants' data, or template mutation APIs. Only the workspace owner
// (role "admin") can change settings or a customer's consent; viewing needs the
// plan's WhatsApp feature.
// ─────────────────────────────────────────────────────────────────────────────
import {
  BUSINESS_CATEGORY_LABELS,
  businessCategoryFromProfession,
  CATEGORY_KINDS,
  catalogRouteFor,
  KIND_SWITCH,
  TENANT_SWITCH_LABELS,
  type TenantNotifySwitch,
} from "./notify-catalog";
import { getNotifyRepo, PLATFORM_CONSENT_SCOPE, type TenantSettingsPatch } from "./notify-repo";
import { toPublicEvent } from "./notify-admin";
import { isValidTimeZone } from "./notify-time";
import { NOTIFY_KIND_LABELS, normalizeStatus } from "./wa-template-model";
import type { AptNotifyKind } from "./appointment-notify";

export interface TenantSessionUser {
  id?: string | null;
  tenantId?: string | null;
  role?: string | null;
  profession?: string | null;
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
  subscriptionExpiresAt?: string | null;
}

const DAY = 86_400_000;

async function whatsappAccess(user: TenantSessionUser) {
  const { resolveFeatureAccess } = await import("./feature-access");
  const role =
    user.role === "reception" || user.role === "doctor" || user.role === "location"
      ? user.role
      : "admin";
  return resolveFeatureAccess({
    subscriptionPlan: user.subscriptionPlan ?? null,
    subscriptionStatus: user.subscriptionStatus ?? null,
    subscriptionExpiresAt: user.subscriptionExpiresAt ?? null,
    role,
    profession: user.profession ?? null,
  } as any).whatsapp;
}

function switchesFor(kinds: readonly AptNotifyKind[]): TenantNotifySwitch[] {
  const out: TenantNotifySwitch[] = [];
  for (const k of kinds) {
    const sw = KIND_SWITCH[k];
    if (sw && !out.includes(sw)) out.push(sw);
  }
  return out;
}

export async function tenantNotificationCenter(user: TenantSessionUser) {
  const tenantId = String(user.tenantId ?? "");
  if (!tenantId) return { ok: false as const, error: "Unauthorized" };
  const access = await whatsappAccess(user);
  const category = businessCategoryFromProfession(user.profession);
  if (!access.available) {
    return {
      ok: true as const,
      available: false,
      category,
      categoryLabel: BUSINESS_CATEGORY_LABELS[category],
      message: "WhatsApp notifications are not included in your current plan.",
    };
  }
  const repo = getNotifyRepo();
  const nowMs = Date.now();
  const kinds = CATEGORY_KINDS[category];
  const [settings, recent, failures, counts] = await Promise.all([
    repo.getTenantSettings(tenantId),
    repo.listEvents({ tenantId, limit: 50 }),
    repo.listEvents({
      tenantId,
      statuses: ["failed", "dead", "blocked", "ambiguous"],
      fromMs: nowMs - 7 * DAY,
      limit: 20,
    }),
    repo.statusCounts(tenantId, nowMs - 7 * DAY),
  ]);

  // Which approved templates this business category uses (no Meta IDs).
  const { getTemplateRepo } = await import("./wa-template-repo");
  const tplRepo = getTemplateRepo();
  const mappings = await tplRepo.listMappings();
  const templates = [];
  for (const kind of kinds) {
    const mapping =
      mappings.find((m) => m.notifyKind === kind && m.businessCategory === category) ??
      mappings.find((m) => m.notifyKind === kind && m.businessCategory === "*") ??
      null;
    const tpl = mapping ? await tplRepo.getById(mapping.templateId) : null;
    const status = tpl ? normalizeStatus(tpl.metaStatus).normalized : null;
    const active =
      !!mapping?.isEnabled &&
      status === "APPROVED" &&
      String(tpl?.metaCategory || "").toUpperCase() === "UTILITY";
    const route = catalogRouteFor(category, kind);
    templates.push({
      kind,
      label: (NOTIFY_KIND_LABELS as Record<string, string>)[kind] ?? kind,
      switch: KIND_SWITCH[kind],
      templateName: tpl?.name ?? route?.templateName ?? null,
      language: tpl?.language ?? route?.language ?? null,
      state: active
        ? "active"
        : tpl && status === "PENDING"
          ? "pending_approval"
          : route
            ? "awaiting_template"
            : "not_available",
      bodyPreview: tpl?.bodyText ?? null,
    });
  }

  return {
    ok: true as const,
    available: true,
    canEdit: user.role !== "reception" && user.role !== "doctor" && user.role !== "location",
    category,
    categoryLabel: BUSINESS_CATEGORY_LABELS[category],
    settings: {
      whatsappEnabled: settings.whatsappEnabled,
      confirmations: settings.confirmations,
      reschedules: settings.reschedules,
      cancellations: settings.cancellations,
      completions: settings.completions,
      reminderDayBefore: settings.reminderDayBefore,
      reminder2h: settings.reminder2h,
      queueUpdates: settings.queueUpdates,
      timezone: settings.timezone,
    },
    switches: switchesFor(kinds).map((s) => ({ id: s, label: TENANT_SWITCH_LABELS[s] })),
    templates,
    counts,
    recent: recent.rows.map(toPublicEvent),
    failures: failures.rows.map(toPublicEvent),
  };
}

const SETTING_KEYS = [
  "whatsappEnabled",
  "confirmations",
  "reschedules",
  "cancellations",
  "completions",
  "reminderDayBefore",
  "reminder2h",
  "queueUpdates",
] as const;

/** Validates an untrusted settings patch. Throws on invalid input. */
export function parseTenantSettingsPatch(raw: unknown): TenantSettingsPatch {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const patch: TenantSettingsPatch = {};
  for (const key of SETTING_KEYS) {
    if (o[key] === undefined) continue;
    if (typeof o[key] !== "boolean") throw new Error(`${key} must be true or false`);
    patch[key] = o[key] as boolean;
  }
  if (o.timezone !== undefined) {
    if (o.timezone === null || o.timezone === "") patch.timezone = null;
    else if (typeof o.timezone === "string" && isValidTimeZone(o.timezone))
      patch.timezone = o.timezone;
    else throw new Error("Unknown timezone");
  }
  return patch;
}

export async function saveTenantNotificationSettings(user: TenantSessionUser, raw: unknown) {
  const tenantId = String(user.tenantId ?? "");
  if (!tenantId) return { ok: false as const, error: "Unauthorized" };
  if (user.role === "reception" || user.role === "doctor" || user.role === "location") {
    return {
      ok: false as const,
      error: "Only the workspace owner can change notification settings.",
    };
  }
  const access = await whatsappAccess(user);
  if (!access.available || access.permission !== "operate") {
    return {
      ok: false as const,
      error: "WhatsApp notifications are not included in your current plan.",
    };
  }
  const patch = parseTenantSettingsPatch(raw);
  const repo = getNotifyRepo();
  const saved = await repo.saveTenantSettings(tenantId, patch, user.id ? String(user.id) : null);
  await repo.addAudit({
    tenantId,
    action: "tenant_settings_updated",
    actor: user.id ? `tenant:${user.id}` : "tenant",
    detail: { changed: Object.keys(patch) },
    atMs: Date.now(),
  });
  return { ok: true as const, settings: saved };
}

/** Records a customer's WhatsApp opt-out (or renewed opt-in) for this tenant only. */
export async function setTenantCustomerConsent(
  user: TenantSessionUser,
  input: { phone: string; optedIn: boolean },
) {
  const tenantId = String(user.tenantId ?? "");
  if (!tenantId || tenantId === PLATFORM_CONSENT_SCOPE)
    return { ok: false as const, error: "Unauthorized" };
  if (user.role === "reception" || user.role === "doctor" || user.role === "location") {
    return { ok: false as const, error: "Only the workspace owner can change customer consent." };
  }
  const { recordConsent } = await import("./notify-consent");
  const ok = await recordConsent({
    tenantId,
    phone: input.phone,
    optedIn: input.optedIn,
    source: "tenant_admin",
  });
  return ok ? { ok: true as const } : { ok: false as const, error: "Enter a valid phone number." };
}
