// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The module and its child views all import from ../../../lib/admin; mock the
// whole surface so no auth/SQL/Meta call is made. The factory is hoisted, so it
// defines its own helpers and exposes the two spies we assert on via globals.
vi.mock("../../../lib/admin", () => {
  const mkOk = (extra: any = {}) => vi.fn(async () => ({ ok: true, ...extra }));
  const listFn = vi.fn(async () => ({ ok: true, rows: [], total: 0 }));
  const submitFn = vi.fn(async () => ({ ok: true, metaStatus: "PENDING" }));
  (globalThis as any).__waListFn = listFn;
  (globalThis as any).__waSubmitFn = submitFn;
  return {
    waTemplateDashboardServerFn: mkOk({
      summary: { total: 0, byBucket: {}, byStatus: {}, lastSyncOkAt: null, lastApiOkAt: null },
    }),
    waSyncAllServerFn: mkOk(),
    waTemplateListServerFn: listFn,
    waTemplateDetailsServerFn: mkOk({ row: null }),
    waTemplateRevisionsServerFn: mkOk({ rows: [] }),
    waTemplateActivityServerFn: mkOk({ rows: [] }),
    waTemplateSyncRunsServerFn: mkOk({ rows: [] }),
    waAccountHealthServerFn: mkOk({
      health: {
        apiVersion: { value: "v26.0", expiresOn: null, warning: null },
        waba: null,
        phone: null,
        health: null,
        subscribedApps: null,
        token: {
          valid: true,
          appId: null,
          type: null,
          expiresAt: null,
          scopes: [],
          hasManagement: true,
          hasMessaging: true,
          note: null,
        },
        accountTypeOk: true,
        fetchedAt: "2026-01-01T00:00:00Z",
        notes: [],
      },
    }),
    waRefreshHealthServerFn: mkOk(),
    waNotifyMappingsServerFn: mkOk({ rows: [] }),
    waCreateDraftServerFn: mkOk({ id: "new" }),
    waUpdateDraftServerFn: mkOk({ id: "new" }),
    waValidateDraftServerFn: mkOk({ payload: {}, warnings: [] }),
    waSubmitTemplateServerFn: submitFn,
    waCloneTemplateServerFn: mkOk({ id: "clone" }),
    waArchiveDraftServerFn: mkOk(),
    waDeleteDraftServerFn: mkOk(),
    waDeleteMetaTemplateServerFn: mkOk(),
    waReconcileTemplateServerFn: mkOk(),
    waAssignMappingServerFn: mkOk({ mapping: {} }),
    waSetMappingEnabledServerFn: mkOk({ mapping: {} }),
    waRemoveMappingServerFn: mkOk(),
  };
});

import { TemplatesModule } from "./TemplatesModule";

const waTemplateListServerFn = () => (globalThis as any).__waListFn as ReturnType<typeof vi.fn>;
const waSubmitTemplateServerFn = () => (globalThis as any).__waSubmitFn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  waTemplateListServerFn().mockClear();
  waSubmitTemplateServerFn().mockClear();
});
afterEach(() => cleanup());

describe("TemplatesModule", () => {
  it("mounts the dashboard by default and exposes in-panel view tabs (no new routes)", async () => {
    render(<TemplatesModule />);
    expect(screen.getByTestId("templates-module")).toBeInTheDocument();
    // view tabs are plain buttons inside the panel — no <a href> navigation.
    for (const label of [
      "Dashboard",
      "Templates",
      "New template",
      "Mappings",
      "Account health",
      "Sync",
      "Activity",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByText("Total templates")).toBeInTheDocument());
  });

  it("switches to each view via panel state only", async () => {
    render(<TemplatesModule />);

    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    await waitFor(() => expect(screen.getByTestId("template-list")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    await waitFor(() => expect(screen.getByLabelText("Template name")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Mappings" }));
    await waitFor(() => expect(screen.getByTestId("notification-mappings")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Account health" }));
    await waitFor(() => expect(screen.getByTestId("account-health")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    await waitFor(() => expect(screen.getByTestId("sync-runs")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    await waitFor(() => expect(screen.getByTestId("activity-history")).toBeInTheDocument());
  });

  it("asks for confirmation before a destructive list action and runs it on confirm", async () => {
    waTemplateListServerFn().mockResolvedValue({
      ok: true,
      total: 1,
      rows: [
        {
          id: "t1",
          name: "bmt_draft",
          language: "en_US",
          category: "UTILITY",
          metaCategory: null,
          bodyText: "Hi",
          parameterFormat: "POSITIONAL",
          footerText: null,
          headerType: "NONE",
          headerText: null,
          buttons: null,
          variableMappings: null,
          sampleValues: null,
          source: "LOCAL",
          localState: null,
          opState: null,
          status: "DRAFT",
          metaStatus: null,
          metaTemplateId: null,
          notifyKind: null,
          qualityScore: null,
          rejectionDetail: null,
          rejectionReason: null,
          lastSubmittedAt: null,
          lastSyncedAt: null,
          updatedAt: new Date("2026-01-02"),
          createdAt: new Date("2026-01-01"),
        },
      ],
    });
    render(<TemplatesModule />);
    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    await waitFor(() => expect(screen.getByText("bmt_draft")).toBeInTheDocument());

    // "Submit" on a never-submitted local draft opens a confirm dialog.
    fireEvent.click(screen.getByRole("button", { name: /^Submit bmt_draft/ }));
    await waitFor(() => expect(screen.getByText("Submit to Meta?")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(waSubmitTemplateServerFn()).toHaveBeenCalledWith({ data: { id: "t1" } }),
    );
  });
});
