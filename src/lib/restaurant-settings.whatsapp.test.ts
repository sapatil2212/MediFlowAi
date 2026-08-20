import { describe, expect, it } from "vitest";

import type { AccountContext, FeatureAccess, FeatureId, ResolvedAccess } from "./feature-access";
import { MSG_NOT_AUTHORISED_WHATSAPP, type Permission } from "./restaurant-settings-model";
import {
  MSG_RESTAURANT_SETTINGS_UNAUTHORIZED,
  MSG_WHATSAPP_CONFIG_SAVE_FAILED,
  MSG_WHATSAPP_DISCONNECT_FAILED,
  MSG_WHATSAPP_INITIALIZE_FAILED,
  MSG_WHATSAPP_STATUS_READ_FAILED,
  MSG_WHATSAPP_TEST_MESSAGE_FAILED,
  createWhatsAppSettingsService,
  type AuthenticatedRestaurantSettingsContext,
  type WhatsAppSettingsServiceDependencies,
} from "./restaurant-settings";
import {
  createWhatsAppSettingsAdapter,
  type SaveWhatsAppAlertConfigInput,
  type WhatsAppAlertConfig,
  type WhatsAppMicroserviceClient,
  type WhatsAppSettingsStatus,
} from "./restaurant-settings.server";
import type { WAStatus } from "./whatsapp";

// ---------------------------------------------------------------------------
// Strict WhatsApp settings server-function tests (task 9.1)
//
// These exercise the guarded WhatsApp Settings service with fully injected
// fakes (no cookies, SQL, or microservice). They prove:
//   * reads require the `whatsapp` feature to be visible (Req 7.1, 10.9),
//   * every state-changing action requires `whatsapp: operate` and is refused
//     before any repository/adapter call (Req 10.10),
//   * a status transport failure surfaces as `ERROR` while the separately loaded
//     stored config is still returned (Req 7.4, 7.13),
//   * a failed config save or test-message queue returns an error, shows no
//     success, and preserves the prior stored config (Req 7.11, 7.12, 11.2),
//   * the strict adapter never conflates transport failure with success.
// ---------------------------------------------------------------------------

const TENANT = "tenant-a";

const ALL_FEATURE_IDS: readonly FeatureId[] = [
  "restaurant_config",
  "restaurant_bookings",
  "whatsapp",
  "analytics",
  "users",
  "locations",
  "video",
];

/** Builds a full resolved-access record, then stamps `whatsapp` with a permission. */
function accessWithWhatsApp(permission: Permission): ResolvedAccess {
  const access = {} as ResolvedAccess;
  for (const id of ALL_FEATURE_IDS) {
    access[id] = { available: false, permission: "none", visible: false } as FeatureAccess;
  }
  access.whatsapp = {
    available: permission !== "none",
    permission,
    visible: permission !== "none",
  } as FeatureAccess;
  return access;
}

/** A minimal but valid authenticated context carrying the given whatsapp permission. */
function contextWith(permission: Permission): AuthenticatedRestaurantSettingsContext {
  const featureContext: AccountContext = {
    role: "admin",
    profession: "Restaurant and dining",
    subscriptionPlan: "Premium",
    subscriptionStatus: "Active",
    subscriptionExpiresAt: "2027-01-01T00:00:00.000Z",
    isActive: true,
    now: new Date("2026-04-01T00:00:00.000Z"),
  };
  return {
    session: { id: "owner-a", tenantId: TENANT, role: "admin" },
    accountId: "owner-a",
    tenantId: TENANT,
    role: "admin",
    featureContext,
    access: accessWithWhatsApp(permission),
    scope: { tenantId: TENANT, locationId: null },
  };
}

function config(overrides: Partial<WhatsAppAlertConfig> = {}): WhatsAppAlertConfig {
  return {
    id: "cfg-1",
    tenantId: TENANT,
    phoneNumber: "+15550001111",
    isEnabled: true,
    ...overrides,
  };
}

function connectedStatus(overrides: Partial<WhatsAppSettingsStatus> = {}): WhatsAppSettingsStatus {
  return {
    state: "CONNECTED",
    qrDataUrl: "",
    connectedNumber: "+15550009999",
    queueCount: 2,
    sentCount: 3,
    sentLog: [],
    ...overrides,
  };
}

/**
 * A fake set of service dependencies backed by an in-memory config store and
 * call counters, so a test can prove a refused action never reached the
 * repository/adapter and that the stored config is byte-identical afterwards.
 */
function createFakeDeps(
  options: {
    permission?: Permission;
    initialConfig?: WhatsAppAlertConfig | null;
    readStatus?: () => Promise<WhatsAppSettingsStatus>;
    saveShouldFail?: boolean;
    initializeOk?: boolean;
    disconnectOk?: boolean;
    testMessageOk?: boolean;
    configReadShouldFail?: boolean;
  } = {},
) {
  const {
    permission = "operate",
    initialConfig = config(),
    saveShouldFail = false,
    initializeOk = true,
    disconnectOk = true,
    testMessageOk = true,
    configReadShouldFail = false,
  } = options;

  let stored: WhatsAppAlertConfig | null = initialConfig ? { ...initialConfig } : null;
  const calls = {
    resolveContext: 0,
    getConfig: 0,
    saveConfig: 0,
    readStatus: 0,
    initialize: 0,
    disconnect: 0,
    sendTestMessage: 0,
  };
  const context = contextWith(permission);

  const deps: WhatsAppSettingsServiceDependencies = {
    async resolveContext() {
      calls.resolveContext += 1;
      return context;
    },
    async getWhatsAppConfig() {
      calls.getConfig += 1;
      if (configReadShouldFail) throw new Error("config read failed");
      return stored ? { ...stored } : null;
    },
    async saveWhatsAppConfig(_tenantId: string, input: SaveWhatsAppAlertConfigInput) {
      calls.saveConfig += 1;
      if (saveShouldFail) throw new Error("storage failed");
      stored = {
        id: stored?.id ?? "cfg-1",
        tenantId: TENANT,
        phoneNumber: input.phoneNumber,
        isEnabled: input.isEnabled,
      };
      return { ...stored };
    },
    async readStatus() {
      calls.readStatus += 1;
      return options.readStatus ? options.readStatus() : connectedStatus();
    },
    async initialize() {
      calls.initialize += 1;
      return initializeOk ? { status: "ok" } : { status: "error" };
    },
    async disconnect() {
      calls.disconnect += 1;
      return disconnectOk ? { status: "ok" } : { status: "error" };
    },
    async sendTestMessage() {
      calls.sendTestMessage += 1;
      return testMessageOk ? { status: "ok" } : { status: "error" };
    },
  };

  return {
    deps,
    calls,
    snapshot: (): WhatsAppAlertConfig | null => (stored ? { ...stored } : null),
  };
}

describe("WhatsApp settings service — authorization (Req 10.9, 10.10)", () => {
  it("refuses the status read when the whatsapp feature is not visible", async () => {
    const { deps } = createFakeDeps({ permission: "none" });
    const service = createWhatsAppSettingsService(deps);
    await expect(service.status({})).rejects.toThrow(MSG_RESTAURANT_SETTINGS_UNAUTHORIZED);
  });

  it("allows the status read for a view_only account", async () => {
    const { deps } = createFakeDeps({ permission: "view_only" });
    const service = createWhatsAppSettingsService(deps);
    const view = await service.status({});
    expect(view.canOperate).toBe(false);
    expect(view.config).toEqual(config());
  });

  it("refuses every state-changing action for view_only without touching the store or adapter", async () => {
    const { deps, calls, snapshot } = createFakeDeps({ permission: "view_only" });
    const service = createWhatsAppSettingsService(deps);
    const before = snapshot();

    await expect(
      service.saveConfig({ phoneNumber: "+1999", isEnabled: false }),
    ).rejects.toThrow(MSG_NOT_AUTHORISED_WHATSAPP);
    await expect(service.initialize({})).rejects.toThrow(MSG_NOT_AUTHORISED_WHATSAPP);
    await expect(service.disconnect({})).rejects.toThrow(MSG_NOT_AUTHORISED_WHATSAPP);
    await expect(service.sendTestMessage({ phone: "+1999" })).rejects.toThrow(
      MSG_NOT_AUTHORISED_WHATSAPP,
    );

    // No state-changing dependency was reached, and the stored config is unchanged.
    expect(calls.saveConfig).toBe(0);
    expect(calls.initialize).toBe(0);
    expect(calls.disconnect).toBe(0);
    expect(calls.sendTestMessage).toBe(0);
    expect(snapshot()).toEqual(before);
  });
});

describe("WhatsApp settings service — strict status read (Req 7.2, 7.4, 7.13)", () => {
  it("returns the stored config alongside a connected status", async () => {
    const { deps } = createFakeDeps({ permission: "operate" });
    const service = createWhatsAppSettingsService(deps);
    const view = await service.status({});
    expect(view.config).toEqual(config());
    expect(view.status.state).toBe("CONNECTED");
    expect(view.statusMessage).toBeNull();
    expect(view.canOperate).toBe(true);
  });

  it("surfaces a status transport failure as ERROR while still returning the separately loaded config", async () => {
    const { deps } = createFakeDeps({
      permission: "operate",
      readStatus: async () => ({
        state: "ERROR",
        qrDataUrl: "",
        connectedNumber: "",
        queueCount: 0,
        sentCount: 0,
        sentLog: [],
      }),
    });
    const service = createWhatsAppSettingsService(deps);
    const view = await service.status({});

    expect(view.status.state).toBe("ERROR");
    expect(view.statusMessage).toBe(MSG_WHATSAPP_STATUS_READ_FAILED);
    // The stored config is loaded separately, so it survives a status failure.
    expect(view.config).toEqual(config());
  });
});

describe("WhatsApp settings service — config save (Req 7.3, 7.11, 11.2)", () => {
  it("stores the trimmed phone number and coerced enabled flag on success", async () => {
    const { deps, snapshot } = createFakeDeps({ permission: "operate", initialConfig: null });
    const service = createWhatsAppSettingsService(deps);

    const result = await service.saveConfig({ phoneNumber: "  +15551230000 ", isEnabled: "1" });
    expect(result.status).toBe("saved");
    if (result.status === "saved") {
      expect(result.config.phoneNumber).toBe("+15551230000");
      expect(result.config.isEnabled).toBe(true);
    }
    expect(snapshot()).toMatchObject({ phoneNumber: "+15551230000", isEnabled: true });
  });

  it("returns an error, reports no success, and preserves the prior config when storage fails", async () => {
    const prior = config({ phoneNumber: "+15550001111", isEnabled: true });
    const { deps, snapshot } = createFakeDeps({
      permission: "operate",
      initialConfig: prior,
      saveShouldFail: true,
    });
    const service = createWhatsAppSettingsService(deps);

    const result = await service.saveConfig({ phoneNumber: "+15559998888", isEnabled: false });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toBe(MSG_WHATSAPP_CONFIG_SAVE_FAILED);
      // The prior stored config is returned unchanged (Req 7.11).
      expect(result.config).toEqual(prior);
    }
    expect(snapshot()).toEqual(prior);
  });

  it("is idempotent: saving the same config twice leaves the stored values equal (Req 11.2)", async () => {
    const { deps, snapshot } = createFakeDeps({ permission: "operate", initialConfig: null });
    const service = createWhatsAppSettingsService(deps);

    await service.saveConfig({ phoneNumber: "+15551112222", isEnabled: true });
    const first = snapshot();
    await service.saveConfig({ phoneNumber: "+15551112222", isEnabled: true });
    expect(snapshot()).toEqual(first);
  });
});

describe("WhatsApp settings service — pairing and disconnect (Req 7.6, 7.8, 10.10)", () => {
  it("maps a confirmed initialize/disconnect to ok", async () => {
    const { deps } = createFakeDeps({ permission: "operate" });
    const service = createWhatsAppSettingsService(deps);
    expect(await service.initialize({})).toEqual({ status: "ok" });
    expect(await service.disconnect({})).toEqual({ status: "ok" });
  });

  it("maps an unconfirmed initialize to an error", async () => {
    const { deps } = createFakeDeps({ permission: "operate", initializeOk: false });
    const service = createWhatsAppSettingsService(deps);
    expect(await service.initialize({})).toEqual({
      status: "error",
      message: MSG_WHATSAPP_INITIALIZE_FAILED,
    });
  });

  it("maps an unconfirmed disconnect to an error", async () => {
    const { deps } = createFakeDeps({ permission: "operate", disconnectOk: false });
    const service = createWhatsAppSettingsService(deps);
    expect(await service.disconnect({})).toEqual({
      status: "error",
      message: MSG_WHATSAPP_DISCONNECT_FAILED,
    });
  });
});

describe("WhatsApp settings service — test message (Req 7.9, 7.12)", () => {
  it("queues a test message on success", async () => {
    const { deps } = createFakeDeps({ permission: "operate" });
    const service = createWhatsAppSettingsService(deps);
    expect(await service.sendTestMessage({ phone: "+15550007777" })).toEqual({ status: "queued" });
  });

  it("returns an error with no queued outcome and never touches the stored config on failure", async () => {
    const prior = config();
    const { deps, calls, snapshot } = createFakeDeps({
      permission: "operate",
      initialConfig: prior,
      testMessageOk: false,
    });
    const service = createWhatsAppSettingsService(deps);

    const result = await service.sendTestMessage({ phone: "+15550007777" });
    expect(result).toEqual({ status: "error", message: MSG_WHATSAPP_TEST_MESSAGE_FAILED });
    // Queueing never reads or writes the alert config, so the prior config is retained.
    expect(calls.saveConfig).toBe(0);
    expect(snapshot()).toEqual(prior);
  });
});

// ---------------------------------------------------------------------------
// Strict adapter tests: the adapter must never conflate a transport failure or
// an unconfirmed response with success, and a status transport failure must map
// to an explicit ERROR state (Req 7.4, 7.13, 10.10).
// ---------------------------------------------------------------------------

function fakeClient(overrides: Partial<WhatsAppMicroserviceClient> = {}): WhatsAppMicroserviceClient {
  const connected: WAStatus = {
    state: "CONNECTED",
    qrDataUrl: "",
    connectedNumber: "+15550009999",
    queueCount: 1,
    sentLog: [
      { timestamp: "t1", recipient: "+1", message: "hi", status: "sent" },
      { timestamp: "t2", recipient: "+2", message: "bye", status: "failed" },
    ],
  };
  return {
    getStatus: async () => connected,
    initialize: async () => ({ success: true }),
    disconnect: async () => ({ success: true }),
    enqueue: async () => ({ success: true }),
    ...overrides,
  };
}

describe("strict WhatsApp adapter (Req 7.4, 7.13, 10.10)", () => {
  it("maps a status transport failure to an ERROR state instead of DISCONNECTED", async () => {
    const adapter = createWhatsAppSettingsAdapter(
      fakeClient({
        getStatus: async () => {
          throw new Error("transport down");
        },
      }),
    );
    const status = await adapter.readStatus(TENANT);
    expect(status.state).toBe("ERROR");
    expect(status.connectedNumber).toBe("");
  });

  it("derives sent count from successful sent-log entries", async () => {
    const adapter = createWhatsAppSettingsAdapter(fakeClient());
    const status = await adapter.readStatus(TENANT);
    expect(status.state).toBe("CONNECTED");
    expect(status.sentCount).toBe(1);
    expect(status.queueCount).toBe(1);
  });

  it("never reports success when a state-changing call rejects", async () => {
    const adapter = createWhatsAppSettingsAdapter(
      fakeClient({
        initialize: async () => {
          throw new Error("boom");
        },
        enqueue: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(await adapter.initialize(TENANT)).toEqual({ status: "error" });
    expect(await adapter.sendTestMessage(TENANT, "+1", "hi")).toEqual({ status: "error" });
  });

  it("never reports success when a state-changing call returns success:false", async () => {
    const adapter = createWhatsAppSettingsAdapter(
      fakeClient({
        disconnect: async () => ({ success: false }),
        enqueue: async () => ({ success: false }),
      }),
    );
    expect(await adapter.disconnect(TENANT)).toEqual({ status: "error" });
    expect(await adapter.sendTestMessage(TENANT, "+1", "hi")).toEqual({ status: "error" });
  });
});
