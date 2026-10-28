// ─────────────────────────────────────────────────────────────────────────────
// wa-template-api.ts  (server)
//
// The admin-gated registry for the template management capabilities (§12).
// Every entry is wrapped in adminOnly(validate, handler): it calls
// verifyAdminSession() FIRST and returns a safe typed {ok:false,error} on auth
// failure — never a stack, token or secret. The createServerFn wrappers in
// admin.ts delegate to these entries (GET reads, POST writes). Each write
// records a WaTemplateActivity row via the service layer it calls.
// ─────────────────────────────────────────────────────────────────────────────
import * as svc from "./wa-templates";
import { waAccountHealth, waRefreshHealth } from "./wa-template-health";
import { waSyncAll, waSyncOne } from "./wa-template-sync";

export interface AdminActor {
  id: string | null;
}

export type ApiResult = { ok: false; error: string } | ({ ok: true } & Record<string, unknown>);

/**
 * Wraps a handler so it only runs for an authenticated Super Admin. The
 * validate step shapes/sanitises the input; a thrown validation error becomes a
 * safe {ok:false,error}. verifyAdminSession() is always called first.
 */
export function adminOnly<I, O extends ApiResult>(
  validate: (raw: unknown) => I,
  handler: (input: I, actor: AdminActor) => Promise<O>,
) {
  return async (raw: unknown): Promise<O | { ok: false; error: string }> => {
    const { verifyAdminSession } = await import("./admin.server");
    let admin: any = null;
    try {
      admin = await verifyAdminSession();
    } catch {
      admin = null;
    }
    if (!admin) return { ok: false, error: "Unauthorized" };
    let input: I;
    try {
      input = validate(raw ?? {});
    } catch (e: any) {
      return { ok: false, error: e?.message || "Invalid request" };
    }
    try {
      const actorId =
        (admin && (admin.id ?? admin.adminId ?? admin.email)) != null
          ? String(admin.id ?? admin.adminId ?? admin.email)
          : null;
      return await handler(input, { id: actorId });
    } catch (e: any) {
      return { ok: false, error: e?.message || "Request failed" };
    }
  };
}

// ── Validators (server-side; never trust the client, R-SEC-01) ──────────────
function asObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}
function reqId(raw: unknown): { id: string } {
  const id = asObject(raw).id;
  if (typeof id !== "string" || id === "") throw new Error("id is required");
  return { id };
}
function reqDraft(raw: unknown): svc.DraftPayload {
  const o = asObject(raw);
  if (typeof o.name !== "string" || o.name === "") throw new Error("name is required");
  if (typeof o.language !== "string" || o.language === "") throw new Error("language is required");
  if (typeof o.bodyText !== "string") throw new Error("bodyText is required");
  return o as unknown as svc.DraftPayload;
}
function reqDraftWithId(raw: unknown): svc.DraftPayload & { id: string } {
  const d = reqDraft(raw);
  const { id } = reqId(raw);
  return { ...d, id };
}

// ─────────────────────────────────────────────────────────────────────────────
// The registry. Reads are GET-wrapped in admin.ts; writes POST-wrapped.
// ─────────────────────────────────────────────────────────────────────────────
export const waTemplateApi = {
  // Reads
  dashboard: adminOnly(
    () => ({}),
    () => svc.waTemplateDashboard(),
  ),
  list: adminOnly(
    (raw) => asObject(raw) as svc.ListInput,
    (input) => svc.waTemplateList(input),
  ),
  details: adminOnly(reqId, (input) => svc.waTemplateDetails(input.id)),
  revisions: adminOnly(reqId, (input) => svc.waTemplateRevisions(input.id)),
  activity: adminOnly(
    (raw) => ({ id: typeof asObject(raw).id === "string" ? (asObject(raw).id as string) : null }),
    (input) => svc.waTemplateActivity(input.id),
  ),
  syncRuns: adminOnly(
    () => ({}),
    () => svc.waTemplateSyncRuns(),
  ),
  accountHealth: adminOnly(
    () => ({}),
    () => waAccountHealth(),
  ),
  notifyMappings: adminOnly(
    () => ({}),
    () => svc.waNotifyMappings(),
  ),

  // Writes
  createDraft: adminOnly(reqDraft, (input, actor) => svc.waCreateDraft(input, actor.id)),
  updateDraft: adminOnly(reqDraftWithId, (input, actor) => svc.waUpdateDraft(input, actor.id)),
  validateDraft: adminOnly(reqDraft, (input) => svc.waValidateDraft(input)),
  installPresets: adminOnly(
    () => ({}),
    (_input, actor) => svc.waInstallPresets(actor.id),
  ),
  submitTemplate: adminOnly(reqId, (input, actor) => svc.waSubmitTemplate(input.id, actor.id)),
  reconcileTemplate: adminOnly(reqId, (input, actor) =>
    svc.waReconcileTemplate(input.id, actor.id),
  ),
  editTemplate: adminOnly(reqDraftWithId, (input, actor) =>
    svc.waEditTemplate(input.id, input, actor.id),
  ),
  cloneTemplate: adminOnly(reqId, (input, actor) => svc.waCloneTemplate(input.id, actor.id)),
  archiveDraft: adminOnly(reqId, (input, actor) => svc.waArchiveDraft(input.id, actor.id)),
  unarchiveDraft: adminOnly(reqId, (input, actor) => svc.waUnarchiveDraft(input.id, actor.id)),
  deleteDraft: adminOnly(reqId, (input, actor) => svc.waDeleteDraft(input.id, actor.id)),
  deleteMetaTemplate: adminOnly(reqId, (input, actor) =>
    svc.waDeleteMetaTemplate(input.id, actor.id),
  ),
  syncAll: adminOnly(
    () => ({}),
    async (): Promise<ApiResult> => {
      const r = await waSyncAll();
      if (!r.ok) return { ok: false, error: r.error || "Sync failed" };
      const { ok: _ok, error: _error, ...rest } = r;
      return { ok: true, ...rest };
    },
  ),
  syncOne: adminOnly(reqId, async (input): Promise<ApiResult> => {
    const r = await waSyncOne(input.id);
    if (!r.ok) return { ok: false, error: r.error || "Sync failed" };
    const { ok: _ok, error: _error, ...rest } = r;
    return { ok: true, ...rest };
  }),
  refreshHealth: adminOnly(
    () => ({}),
    async () => {
      const r = await waRefreshHealth();
      return r.ok
        ? { ok: true as const, health: r.health }
        : { ok: false as const, error: r.error };
    },
  ),
  assignMapping: adminOnly(
    (raw) => {
      const o = asObject(raw);
      if (typeof o.notifyKind !== "string") throw new Error("notifyKind is required");
      if (typeof o.templateId !== "string") throw new Error("templateId is required");
      return {
        notifyKind: o.notifyKind,
        templateId: o.templateId,
        businessCategory: optCategory(o.businessCategory),
      };
    },
    (input, actor) => svc.waAssignMapping(input, actor.id),
  ),
  setMappingEnabled: adminOnly(
    (raw) => {
      const o = asObject(raw);
      if (typeof o.notifyKind !== "string") throw new Error("notifyKind is required");
      return {
        notifyKind: o.notifyKind,
        enabled: o.enabled === true,
        optInAck: o.optInAck === true,
        businessCategory: optCategory(o.businessCategory),
      };
    },
    (input, actor) => svc.waSetMappingEnabled(input, actor.id),
  ),
  removeMapping: adminOnly(
    (raw) => {
      const o = asObject(raw);
      if (typeof o.notifyKind !== "string") throw new Error("notifyKind is required");
      return { notifyKind: o.notifyKind, businessCategory: optCategory(o.businessCategory) };
    },
    (input, actor) => svc.waRemoveMapping(input, actor.id),
  ),
};

// ─────────────────────────────────────────────────────────────────────────────
// Notification engine administration (Overview, Logs, Automation, Catalog).
// ─────────────────────────────────────────────────────────────────────────────
const str = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : undefined;

export const notifyAdminApi = {
  overview: adminOnly(
    () => ({}),
    async () => (await import("./notify-admin")).notifyOverview(),
  ),
  logs: adminOnly(
    (raw) => {
      const o = asObject(raw);
      return {
        tenantId: str(o.tenantId),
        businessCategory: str(o.businessCategory),
        appointmentId: str(o.appointmentId),
        eventType: str(o.eventType),
        notifyKind: str(o.notifyKind),
        templateName: str(o.templateName),
        status: str(o.status),
        errorClass: str(o.errorClass),
        from: str(o.from),
        to: str(o.to),
        search: str(o.search, 100),
        limit: Number(o.limit) || 50,
        offset: Number(o.offset) || 0,
      };
    },
    async (input) => (await import("./notify-admin")).notifyLogs(input),
  ),
  eventDetail: adminOnly(reqId, async (input) =>
    (await import("./notify-admin")).notifyEventDetail(input.id),
  ),
  retry: adminOnly(reqId, async (input, actor) =>
    (await import("./notify-admin")).notifyRetry(input.id, actor.id),
  ),
  settingsGet: adminOnly(
    () => ({}),
    async () => (await import("./notify-admin")).notifySettingsGet(),
  ),
  settingsSave: adminOnly(
    (raw) => asObject(asObject(raw).settings),
    async (input, actor) => (await import("./notify-admin")).notifySettingsSave(input, actor.id),
  ),
  routes: adminOnly(
    () => ({}),
    async () => (await import("./notify-admin")).notifyRoutes(),
  ),
  routeSet: adminOnly(
    (raw) => {
      const o = asObject(raw);
      const businessCategory = str(o.businessCategory);
      const kind = str(o.kind);
      if (!businessCategory || !kind) throw new Error("businessCategory and kind are required");
      return {
        businessCategory,
        kind,
        templateId: str(o.templateId) ?? null,
        enabled: typeof o.enabled === "boolean" ? o.enabled : undefined,
        optInAck: o.optInAck === true,
        remove: o.remove === true,
      };
    },
    async (input, actor) => (await import("./notify-admin")).notifyRouteSet(input, actor.id),
  ),
  catalogPlan: adminOnly(
    () => ({}),
    async () => (await import("./notify-admin")).notifyCatalogPlan(),
  ),
  catalogSubmit: adminOnly(
    (raw) => {
      const o = asObject(raw);
      const names = Array.isArray(o.names)
        ? o.names.filter((n): n is string => typeof n === "string" && /^[a-z0-9_]{1,128}$/.test(n))
        : null;
      return { names, confirm: o.confirm === true };
    },
    async (input, actor) => (await import("./notify-admin")).notifyCatalogSubmit(input, actor.id),
  ),
  catalogActivate: adminOnly(
    () => ({}),
    async (_input, actor) => (await import("./notify-admin")).notifyCatalogActivate(actor.id),
  ),
  testSend: adminOnly(
    (raw) => {
      const o = asObject(raw);
      const templateId = str(o.templateId);
      const phone = str(o.phone, 32);
      if (!templateId || !phone) throw new Error("templateId and phone are required");
      return { templateId, phone };
    },
    async (input, actor) => (await import("./notify-admin")).notifyTestSend(input, actor.id),
  ),
  resolveAlert: adminOnly(
    (raw) => {
      const key = str(asObject(raw).key, 191);
      if (!key) throw new Error("key is required");
      return { key };
    },
    async (input) => (await import("./notify-admin")).notifyResolveAlert(input.key),
  ),
};

/** Optional business category for mapping writes ('*' when omitted). */
function optCategory(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("businessCategory must be a string");
  return value;
}
