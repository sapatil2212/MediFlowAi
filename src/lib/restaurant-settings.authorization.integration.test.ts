import { describe, expect, it, vi } from "vitest";

import { resolveFeatureAccess, type AccountContext, type ResolvedAccess } from "./feature-access";
import {
  MSG_BRANCH_NOT_FOUND,
  MSG_BRANCH_SCOPE_OVERRIDE,
  MSG_BRANCH_SELECTION_NOT_ALLOWED,
  MSG_NOT_AUTHORISED_CONFIG,
  MSG_NOT_AUTHORISED_LOCATIONS,
  MSG_NOT_AUTHORISED_USERS,
  MSG_NOT_AUTHORISED_WHATSAPP,
  filterRestaurantResourcesToScope,
  type RestaurantResourceScope,
  type SettingsFeature,
  type TenantLocationRow,
} from "./restaurant-settings-model";
import {
  MSG_RESTAURANT_SETTINGS_UNAUTHORIZED,
  createRestaurantSettingsBoundary,
  createRestaurantSettingsFeatureGuards,
  type AuthenticatedRestaurantSettingsContext,
  type RestaurantSettingsScopeBranch,
  type RestaurantSettingsSession,
} from "./restaurant-settings";

// ---------------------------------------------------------------------------
// Authorization and scope integration tests (task 3.5)
//
// These exercise the *assembled* pipeline: verifySession -> inherited Feature
// Access -> server-derived scope -> feature read/write guard -> a scoped
// in-memory repository / external adapter. Everything is injected, so no
// cookies or SQL are required. The suite proves that:
//   * reads never return cross-tenant or cross-location rows,
//   * refused writes never reach the repository or external adapter and leave
//     both persistent and external state byte-identical, and
//   * spoofed, inactive, unresolved, and foreign-id callers fail closed before
//     any row or adapter access.
// Requirements: 1.9, 9.3-9.8, 10.1-10.12.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-04-01T00:00:00.000Z");

function session(overrides: Partial<RestaurantSettingsSession> = {}): RestaurantSettingsSession {
  return {
    id: "owner-a",
    tenantId: "tenant-a",
    role: "admin",
    profession: "Restaurant and dining",
    subscriptionPlan: "Premium",
    subscriptionStatus: "Active",
    subscriptionExpiresAt: "2027-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function branch(
  overrides: Partial<RestaurantSettingsScopeBranch> = {},
): RestaurantSettingsScopeBranch {
  return { id: "branch-a", tenantId: "tenant-a", isActive: true, ...overrides };
}

// A scoped resource row modelling any area/table/menu/closure record: it carries
// both a tenant owner and a nullable branch scope exactly like the persisted rows.
interface ScopedRow extends TenantLocationRow {
  id: string;
  name: string;
}

// A mixed-tenant, mixed-location seed used to prove reads are scope-confined.
function seedRows(): ScopedRow[] {
  return [
    { id: "a-primary", name: "Main", tenantId: "tenant-a", locationId: null },
    { id: "a-branch-a", name: "Terrace", tenantId: "tenant-a", locationId: "branch-a" },
    { id: "a-branch-b", name: "Patio", tenantId: "tenant-a", locationId: "branch-b" },
    { id: "b-primary", name: "Foreign", tenantId: "tenant-b", locationId: null },
    { id: "b-branch-a", name: "ForeignBranch", tenantId: "tenant-b", locationId: "branch-a" },
  ];
}

/**
 * An in-memory settings repository plus a stand-in external (WhatsApp) adapter.
 * Every state-changing entry point increments a call counter so a test can
 * prove a refused operation never reached it, and `snapshot`/`externalSnapshot`
 * capture persistent and external state for byte-identical comparisons.
 */
function createFakeRepository(rows: ScopedRow[] = []) {
  const store: ScopedRow[] = rows.map((row) => ({ ...row }));
  const external = { queuedTestMessages: [] as string[] };
  const calls = { create: 0, delete: 0, external: 0 };

  return {
    calls,
    listInScope(scope: RestaurantResourceScope): ScopedRow[] {
      return filterRestaurantResourcesToScope(scope, store);
    },
    createRow(scope: RestaurantResourceScope, input: { id: string; name: string }): ScopedRow {
      calls.create += 1;
      const stored: ScopedRow = {
        id: input.id,
        name: input.name,
        tenantId: scope.tenantId,
        locationId: scope.locationId,
      };
      store.push(stored);
      return stored;
    },
    deleteRow(scope: RestaurantResourceScope, id: string): boolean {
      calls.delete += 1;
      const index = store.findIndex(
        (row) =>
          row.id === id && row.tenantId === scope.tenantId && row.locationId === scope.locationId,
      );
      if (index === -1) return false;
      store.splice(index, 1);
      return true;
    },
    sendTestMessage(phone: string): { queued: true } {
      calls.external += 1;
      external.queuedTestMessages.push(phone);
      return { queued: true };
    },
    snapshot(): ScopedRow[] {
      return store.map((row) => ({ ...row }));
    },
    externalSnapshot(): string[] {
      return [...external.queuedTestMessages];
    },
  };
}

type FakeRepository = ReturnType<typeof createFakeRepository>;

interface PipelineOptions {
  session: RestaurantSettingsSession | null;
  branch?: RestaurantSettingsScopeBranch | null;
  /** Override Feature Access resolution; return null to model an unresolved account. */
  access?: (context: AccountContext) => ResolvedAccess | null;
}

/**
 * Wires the real authenticated boundary into the real feature guards. This is
 * the whole point of the integration suite: the guard resolves context through
 * the same session -> access -> scope pipeline used in production.
 */
function pipelineFor(options: PipelineOptions) {
  const verify = vi.fn(async () => options.session);
  const resolveAccess = vi.fn(
    (options.access ?? resolveFeatureAccess) as (context: AccountContext) => ResolvedAccess,
  );
  const findBranch = vi.fn(async () => options.branch ?? null);

  const boundary = createRestaurantSettingsBoundary({
    verifySession: verify,
    resolveFeatureAccess: resolveAccess,
    findBranchById: findBranch,
    now: () => NOW,
  });
  const guards = createRestaurantSettingsFeatureGuards({
    resolveContext: (input) => boundary.resolve(input),
  });

  return { boundary, guards, verify, resolveAccess, findBranch };
}

// A read that returns the caller's scoped rows, and a write/adapter callback.
const readAreas = (repo: FakeRepository) => (context: AuthenticatedRestaurantSettingsContext) =>
  repo.listInScope(context.scope);
const createArea =
  (repo: FakeRepository, input: { id: string; name: string }) =>
  (context: AuthenticatedRestaurantSettingsContext) =>
    repo.createRow(context.scope, input);

describe("restaurant settings authorization + scope integration", () => {
  describe("owner at primary scope", () => {
    it("reads only primary-scope rows of the caller tenant and writes at primary scope", async () => {
      const repo = createFakeRepository(seedRows());
      const { guards } = pipelineFor({ session: session() });

      const visible = await guards.read("restaurant_config", {}, readAreas(repo));
      expect(visible).toEqual([
        { id: "a-primary", name: "Main", tenantId: "tenant-a", locationId: null },
      ]);
      // No cross-tenant or cross-location row leaks into an owner primary read.
      expect(visible.every((row) => row.tenantId === "tenant-a" && row.locationId === null)).toBe(
        true,
      );

      const created = await guards.write(
        "restaurant_config",
        {},
        createArea(repo, { id: "new-primary", name: "Garden" }),
      );
      expect(created).toMatchObject({ tenantId: "tenant-a", locationId: null });
      expect(repo.calls.create).toBe(1);
    });
  });

  describe("owner at a selected branch scope", () => {
    it("confines reads and writes to the validated branch after a tenant lookup", async () => {
      const repo = createFakeRepository(seedRows());
      const { guards, findBranch } = pipelineFor({ session: session(), branch: branch() });
      const input = { requestedLocationId: "branch-a" };

      const visible = await guards.read("restaurant_config", input, readAreas(repo));
      expect(visible).toEqual([
        { id: "a-branch-a", name: "Terrace", tenantId: "tenant-a", locationId: "branch-a" },
      ]);
      expect(findBranch).toHaveBeenCalledWith("tenant-a", "branch-a");

      const created = await guards.write(
        "restaurant_config",
        input,
        createArea(repo, { id: "new-branch", name: "Rooftop" }),
      );
      expect(created).toMatchObject({ tenantId: "tenant-a", locationId: "branch-a" });
      // The other-branch (branch-b) and foreign-tenant rows never appear.
      const afterBranchB = await guards.read("restaurant_config", input, readAreas(repo));
      expect(afterBranchB.some((row) => row.locationId !== "branch-a")).toBe(false);
      expect(afterBranchB.some((row) => row.tenantId !== "tenant-a")).toBe(false);
    });
  });

  describe("branch session with a spoofed location", () => {
    it("refuses an override id before any branch lookup, repository, or adapter call", async () => {
      const repo = createFakeRepository(seedRows());
      const { guards, findBranch } = pipelineFor({
        session: session({ id: "branch-a", role: "location", locationId: "branch-a" }),
        branch: branch(),
      });

      const before = repo.snapshot();
      await expect(
        guards.write(
          "restaurant_config",
          { requestedLocationId: "branch-b" },
          createArea(repo, { id: "spoofed", name: "Spoofed" }),
        ),
      ).rejects.toThrow(MSG_BRANCH_SCOPE_OVERRIDE);

      // The override is rejected before the branch is even looked up.
      expect(findBranch).not.toHaveBeenCalled();
      expect(repo.calls.create).toBe(0);
      expect(repo.snapshot()).toEqual(before);
    });

    it("rejects a spoofed identity whose id and session location disagree", async () => {
      const repo = createFakeRepository(seedRows());
      const { guards, findBranch } = pipelineFor({
        session: session({ id: "branch-b", role: "location", locationId: "branch-a" }),
        branch: branch(),
      });

      await expect(guards.read("restaurant_config", {}, readAreas(repo))).rejects.toThrow(
        MSG_RESTAURANT_SETTINGS_UNAUTHORIZED,
      );
      expect(findBranch).not.toHaveBeenCalled();
    });

    it("forces a verified branch session to its own scope and never reads another branch", async () => {
      const repo = createFakeRepository(seedRows());
      const { guards } = pipelineFor({
        session: session({ id: "branch-a", role: "location", locationId: "branch-a" }),
        branch: branch(),
      });

      const visible = await guards.read("restaurant_config", {}, readAreas(repo));
      expect(visible).toEqual([
        { id: "a-branch-a", name: "Terrace", tenantId: "tenant-a", locationId: "branch-a" },
      ]);
    });
  });

  describe("reception at primary scope", () => {
    it("reads view_only config rows but is refused every state-changing write", async () => {
      const repo = createFakeRepository(seedRows());
      const { guards } = pipelineFor({ session: session({ id: "staff-a", role: "reception" }) });

      // reception has view_only restaurant_config: the read is visible and scoped.
      const visible = await guards.read("restaurant_config", {}, readAreas(repo));
      expect(visible).toEqual([
        { id: "a-primary", name: "Main", tenantId: "tenant-a", locationId: null },
      ]);

      const before = repo.snapshot();
      await expect(
        guards.write("restaurant_config", {}, createArea(repo, { id: "x", name: "x" })),
      ).rejects.toThrow(MSG_NOT_AUTHORISED_CONFIG);
      expect(repo.calls.create).toBe(0);
      expect(repo.snapshot()).toEqual(before);
    });

    it("cannot select a branch and is refused before any branch lookup", async () => {
      const repo = createFakeRepository(seedRows());
      const { guards, findBranch } = pipelineFor({
        session: session({ id: "staff-a", role: "reception" }),
      });

      await expect(
        guards.read("restaurant_config", { requestedLocationId: "branch-a" }, readAreas(repo)),
      ).rejects.toThrow(MSG_BRANCH_SELECTION_NOT_ALLOWED);
      expect(findBranch).not.toHaveBeenCalled();
    });
  });

  describe("inactive child session", () => {
    it("rejects an explicitly inactive session before access, scope, or row work", async () => {
      const repo = createFakeRepository(seedRows());
      const { guards, resolveAccess, findBranch } = pipelineFor({
        session: session({ id: "staff-a", role: "reception", isActive: false }),
      });

      const before = repo.snapshot();
      await expect(guards.read("restaurant_config", {}, readAreas(repo))).rejects.toThrow(
        MSG_RESTAURANT_SETTINGS_UNAUTHORIZED,
      );
      await expect(
        guards.write("restaurant_config", {}, createArea(repo, { id: "x", name: "x" })),
      ).rejects.toThrow(MSG_RESTAURANT_SETTINGS_UNAUTHORIZED);

      expect(resolveAccess).not.toHaveBeenCalled();
      expect(findBranch).not.toHaveBeenCalled();
      expect(repo.calls.create).toBe(0);
      expect(repo.snapshot()).toEqual(before);
    });

    it("rejects a branch account whose branch row is inactive", async () => {
      const repo = createFakeRepository(seedRows());
      const { guards } = pipelineFor({
        session: session({ id: "branch-a", role: "location", locationId: "branch-a" }),
        branch: branch({ isActive: false }),
      });

      const before = repo.snapshot();
      await expect(
        guards.write("restaurant_config", {}, createArea(repo, { id: "x", name: "x" })),
      ).rejects.toThrow(MSG_RESTAURANT_SETTINGS_UNAUTHORIZED);
      expect(repo.calls.create).toBe(0);
      expect(repo.snapshot()).toEqual(before);
    });
  });

  describe("unresolved feature access (Requirement 1.9)", () => {
    it("fails closed for both reads and writes without touching the repository", async () => {
      const repo = createFakeRepository(seedRows());
      const { guards } = pipelineFor({ session: session(), access: () => null });

      const before = repo.snapshot();
      // A read requires the feature to be visible; unresolved access is never visible.
      await expect(guards.read("restaurant_config", {}, readAreas(repo))).rejects.toThrow(
        MSG_RESTAURANT_SETTINGS_UNAUTHORIZED,
      );
      // A write requires operate; unresolved access resolves the feature message.
      await expect(
        guards.write("restaurant_config", {}, createArea(repo, { id: "x", name: "x" })),
      ).rejects.toThrow(MSG_NOT_AUTHORISED_CONFIG);
      expect(repo.calls.create).toBe(0);
      expect(repo.snapshot()).toEqual(before);
    });
  });

  describe("foreign tenant / branch ids", () => {
    it("maps an owner-selected branch from another tenant to not found before row access", async () => {
      const repo = createFakeRepository(seedRows());
      const { guards } = pipelineFor({
        session: session(),
        branch: branch({ tenantId: "tenant-b" }),
      });

      const before = repo.snapshot();
      await expect(
        guards.write(
          "restaurant_config",
          { requestedLocationId: "branch-a" },
          createArea(repo, { id: "x", name: "x" }),
        ),
      ).rejects.toThrow(MSG_BRANCH_NOT_FOUND);
      expect(repo.calls.create).toBe(0);
      expect(repo.snapshot()).toEqual(before);
    });

    it("maps a missing owner-selected branch to not found", async () => {
      const repo = createFakeRepository(seedRows());
      const { guards } = pipelineFor({ session: session(), branch: null });

      await expect(
        guards.read("restaurant_config", { requestedLocationId: "branch-a" }, readAreas(repo)),
      ).rejects.toThrow(MSG_BRANCH_NOT_FOUND);
      expect(repo.calls.create).toBe(0);
    });

    it("never returns foreign-tenant rows for any resolvable caller", async () => {
      const repo = createFakeRepository(seedRows());
      // Owner primary, owner branch, and a branch session must each exclude tenant-b.
      const owners: PipelineOptions[] = [
        { session: session() },
        { session: session(), branch: branch() },
        {
          session: session({ id: "branch-a", role: "location", locationId: "branch-a" }),
          branch: branch(),
        },
      ];
      const inputs = [{}, { requestedLocationId: "branch-a" }, {}];

      for (let index = 0; index < owners.length; index += 1) {
        const { guards } = pipelineFor(owners[index]);
        const visible = await guards.read("restaurant_config", inputs[index], readAreas(repo));
        expect(visible.some((row) => row.tenantId !== "tenant-a")).toBe(false);
      }
    });
  });

  describe("every feature refuses view_only and none writes", () => {
    // Non-operate permission cases reachable through Feature Access. `users` and
    // `locations` only ever resolve operate (owner) or none, so their view_only
    // slot is intentionally absent.
    const refusals: {
      title: string;
      feature: SettingsFeature;
      message: string;
      session: RestaurantSettingsSession;
    }[] = [
      {
        title: "restaurant_config view_only (reception)",
        feature: "restaurant_config",
        message: MSG_NOT_AUTHORISED_CONFIG,
        session: session({ id: "staff-a", role: "reception" }),
      },
      {
        title: "restaurant_config none (doctor)",
        feature: "restaurant_config",
        message: MSG_NOT_AUTHORISED_CONFIG,
        session: session({ id: "doc-a", role: "doctor" }),
      },
      {
        title: "whatsapp view_only (reception, Premium)",
        feature: "whatsapp",
        message: MSG_NOT_AUTHORISED_WHATSAPP,
        session: session({ id: "staff-a", role: "reception", subscriptionPlan: "Premium" }),
      },
      {
        title: "whatsapp none (reception, Basic — feature unavailable)",
        feature: "whatsapp",
        message: MSG_NOT_AUTHORISED_WHATSAPP,
        session: session({ id: "staff-a", role: "reception", subscriptionPlan: "Basic" }),
      },
      {
        title: "users none (reception)",
        feature: "users",
        message: MSG_NOT_AUTHORISED_USERS,
        session: session({ id: "staff-a", role: "reception" }),
      },
      {
        title: "users none (branch session)",
        feature: "users",
        message: MSG_NOT_AUTHORISED_USERS,
        session: session({ id: "branch-a", role: "location", locationId: "branch-a" }),
      },
      {
        title: "locations none (reception)",
        feature: "locations",
        message: MSG_NOT_AUTHORISED_LOCATIONS,
        session: session({ id: "staff-a", role: "reception" }),
      },
      {
        title: "locations none (doctor)",
        feature: "locations",
        message: MSG_NOT_AUTHORISED_LOCATIONS,
        session: session({ id: "doc-a", role: "doctor" }),
      },
    ];

    for (const scenario of refusals) {
      it(`refuses the ${scenario.title} write and preserves persistent + external state`, async () => {
        const repo = createFakeRepository(seedRows());
        const branchRow = scenario.session.role === "location" ? branch() : null;
        const { guards } = pipelineFor({ session: scenario.session, branch: branchRow });

        const before = repo.snapshot();
        const externalBefore = repo.externalSnapshot();

        await expect(
          guards.write(scenario.feature, {}, (context) => {
            // Reaching here would be an authorization escape: a write callback must
            // never run for a sub-operate permission.
            repo.createRow(context.scope, { id: "escape", name: "escape" });
            repo.sendTestMessage("+100000");
            return "reached";
          }),
        ).rejects.toThrow(scenario.message);

        expect(repo.calls.create).toBe(0);
        expect(repo.calls.external).toBe(0);
        expect(repo.snapshot()).toEqual(before);
        expect(repo.externalSnapshot()).toEqual(externalBefore);
      });
    }
  });

  describe("owner operate writes do reach the repository and adapter", () => {
    it("runs the config write and the whatsapp adapter for an authorized owner", async () => {
      const repo = createFakeRepository(seedRows());
      const { guards } = pipelineFor({ session: session() });

      await guards.write("restaurant_config", {}, createArea(repo, { id: "ok", name: "OK" }));
      await guards.write("whatsapp", {}, () => repo.sendTestMessage("+199999"));

      expect(repo.calls.create).toBe(1);
      expect(repo.calls.external).toBe(1);
      expect(repo.externalSnapshot()).toEqual(["+199999"]);
    });
  });
});
