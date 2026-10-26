// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const waTemplateDashboardServerFn = vi.fn();
const waSyncAllServerFn = vi.fn();

vi.mock("../../../lib/admin", () => ({
  waTemplateDashboardServerFn: (...a: any[]) => waTemplateDashboardServerFn(...a),
  waSyncAllServerFn: (...a: any[]) => waSyncAllServerFn(...a),
}));

import { TemplateDashboard } from "./TemplateDashboard";

beforeEach(() => {
  waTemplateDashboardServerFn.mockReset();
  waSyncAllServerFn.mockReset();
});
afterEach(() => cleanup());

describe("TemplateDashboard", () => {
  it("renders the summary cards from the service", async () => {
    waTemplateDashboardServerFn.mockResolvedValue({
      ok: true,
      summary: {
        total: 7,
        byBucket: { approved: 3, pending: 2, actionRequired: 1, inactive: 1, unknown: 0 },
        byStatus: {},
        lastSyncOkAt: null,
        lastApiOkAt: null,
      },
    });
    render(<TemplateDashboard />);
    await waitFor(() => expect(screen.getByText("Total templates")).toBeInTheDocument());
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getAllByText("Never").length).toBeGreaterThan(0);
  });
});
