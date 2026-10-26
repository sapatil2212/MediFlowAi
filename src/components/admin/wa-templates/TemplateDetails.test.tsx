// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const waTemplateDetailsServerFn = vi.fn();
const waTemplateRevisionsServerFn = vi.fn();
const waTemplateActivityServerFn = vi.fn();

vi.mock("../../../lib/admin", () => ({
  waTemplateDetailsServerFn: (...a: any[]) => waTemplateDetailsServerFn(...a),
  waTemplateRevisionsServerFn: (...a: any[]) => waTemplateRevisionsServerFn(...a),
  waTemplateActivityServerFn: (...a: any[]) => waTemplateActivityServerFn(...a),
}));

import { TemplateDetails } from "./TemplateDetails";

beforeEach(() => {
  waTemplateDetailsServerFn.mockReset();
  waTemplateRevisionsServerFn.mockReset();
  waTemplateActivityServerFn.mockReset();
  waTemplateActivityServerFn.mockResolvedValue({ ok: true, rows: [] });
  waTemplateRevisionsServerFn.mockResolvedValue({
    ok: true,
    rows: [
      {
        id: "r1",
        revisionNo: 1,
        metaStatusAtSnapshot: "PENDING",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
  });
});
afterEach(() => cleanup());

describe("TemplateDetails", () => {
  it("renders stored fields, Meta id/status, mappings and revisions", async () => {
    waTemplateDetailsServerFn.mockResolvedValue({
      ok: true,
      row: {
        id: "t1",
        name: "bmt_confirmed",
        language: "en_US",
        category: "UTILITY",
        metaCategory: "UTILITY",
        bodyText: "Hello {{1}}",
        parameterFormat: "POSITIONAL",
        footerText: null,
        headerType: "NONE",
        headerText: null,
        buttons: [],
        variableMappings: { "body.1": "name" },
        sampleValues: { "body.1": "Asha" },
        source: "LOCAL",
        localState: "SUBMITTED",
        opState: null,
        status: "PENDING",
        metaStatus: "PENDING",
        metaTemplateId: "99887766",
        notifyKind: null,
        qualityScore: "GREEN",
        rejectionDetail: null,
        rejectionReason: null,
        updatedAt: new Date("2026-01-02"),
        createdAt: new Date("2026-01-01"),
      },
    });
    render(<TemplateDetails templateId="t1" />);
    await waitFor(() => expect(screen.getByTestId("template-details")).toBeInTheDocument());
    expect(screen.getByText("99887766")).toBeInTheDocument();
    expect(screen.getByText("body.1")).toBeInTheDocument();
    expect(screen.getByText(/#1 — PENDING/)).toBeInTheDocument();
    // preview substitutes the stored sample
    expect(screen.getByTestId("preview-body")).toHaveTextContent("Hello Asha");
  });
});
