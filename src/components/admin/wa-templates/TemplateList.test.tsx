// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const waTemplateListServerFn = vi.fn();

vi.mock("../../../lib/admin", () => ({
  waTemplateListServerFn: (...a: any[]) => waTemplateListServerFn(...a),
}));

import { TemplateList } from "./TemplateList";

function row(over: any = {}) {
  return {
    id: "t1",
    name: "bmt_confirmed",
    language: "en_US",
    category: "UTILITY",
    metaCategory: "UTILITY",
    bodyText: "Hi",
    components: null,
    displayTitle: null,
    description: null,
    purpose: null,
    parameterFormat: "POSITIONAL",
    footerText: null,
    headerType: "NONE",
    headerText: null,
    headerImageUrl: null,
    buttons: null,
    variableMappings: null,
    sampleValues: null,
    source: "LOCAL",
    localState: null,
    opState: null,
    opKind: null,
    opClaimedAt: null,
    status: "DRAFT",
    metaStatus: null,
    metaTemplateId: null,
    notifyKind: null,
    qualityScore: null,
    rejectionDetail: null,
    rejectionReason: null,
    messagingAccountId: null,
    lastSubmittedAt: null,
    lastSyncedAt: null,
    metaUpdatedAt: null,
    archivedAt: null,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
    ...over,
  };
}

beforeEach(() => waTemplateListServerFn.mockReset());
afterEach(() => cleanup());

describe("TemplateList", () => {
  it("renders persisted rows with twelve column headers and a status badge", async () => {
    waTemplateListServerFn.mockResolvedValue({ ok: true, rows: [row()], total: 1 });
    render(<TemplateList />);
    await waitFor(() => expect(screen.getByText("bmt_confirmed")).toBeInTheDocument());
    // a never-submitted local draft shows the "Draft" badge (no meta status)
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Meta status")).toBeInTheDocument();
    expect(screen.getByText("1 template")).toBeInTheDocument();
  });

  it("shows a disabled action with its reason for a non-permitted state", async () => {
    // META-source row: edit is disallowed with the imported-read-only reason.
    waTemplateListServerFn.mockResolvedValue({
      ok: true,
      rows: [row({ source: "META", metaStatus: "APPROVED", metaTemplateId: "123" })],
      total: 1,
    });
    render(<TemplateList />);
    await waitFor(() => expect(screen.getByText("bmt_confirmed")).toBeInTheDocument());
    const editBtn = screen.getByRole("button", { name: /^Edit bmt_confirmed/ });
    expect(editBtn).toBeDisabled();
    expect(editBtn.getAttribute("aria-label")).toContain("Imported templates are read-only");
  });

  it("re-queries the server when the search box changes", async () => {
    waTemplateListServerFn.mockResolvedValue({ ok: true, rows: [], total: 0 });
    render(<TemplateList />);
    await waitFor(() => expect(waTemplateListServerFn).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText("Search by name"), {
      target: { value: "confirm" },
    });
    await waitFor(() =>
      expect(waTemplateListServerFn).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ search: "confirm" }) }),
      ),
    );
  });
});
