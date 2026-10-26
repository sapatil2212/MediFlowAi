// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const waTemplateSyncRunsServerFn = vi.fn();
const waSyncAllServerFn = vi.fn();

vi.mock("../../../lib/admin", () => ({
  waTemplateSyncRunsServerFn: (...a: any[]) => waTemplateSyncRunsServerFn(...a),
  waSyncAllServerFn: (...a: any[]) => waSyncAllServerFn(...a),
}));

import { SyncRuns } from "./SyncRuns";

beforeEach(() => {
  waTemplateSyncRunsServerFn.mockReset();
  waSyncAllServerFn.mockReset();
});
afterEach(() => cleanup());

describe("SyncRuns", () => {
  it("renders sync run rows from the service", async () => {
    waTemplateSyncRunsServerFn.mockResolvedValue({
      ok: true,
      rows: [
        {
          id: "s1",
          trigger: "manual",
          status: "ok",
          scanned: 10,
          updated: 2,
          created: 1,
          skipped: 0,
          errorCode: null,
          errorMessage: null,
          startedAt: "2026-01-01T00:00:00Z",
          finishedAt: "2026-01-01T00:01:00Z",
        },
      ],
    });
    render(<SyncRuns />);
    await waitFor(() => expect(screen.getByTestId("sync-runs")).toBeInTheDocument());
    expect(screen.getByText("manual")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
