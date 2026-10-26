// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const waTemplateActivityServerFn = vi.fn();

vi.mock("../../../lib/admin", () => ({
  waTemplateActivityServerFn: (...a: any[]) => waTemplateActivityServerFn(...a),
}));

import { ActivityHistory } from "./ActivityHistory";

beforeEach(() => waTemplateActivityServerFn.mockReset());
afterEach(() => cleanup());

describe("ActivityHistory", () => {
  it("renders activity rows from the service", async () => {
    waTemplateActivityServerFn.mockResolvedValue({
      ok: true,
      rows: [
        {
          id: "a1",
          templateId: "t1",
          action: "SUBMITTED",
          detail: { metaTemplateId: "123" },
          actorId: "admin",
          createdAt: "2026-01-01T10:00:00Z",
        },
      ],
    });
    render(<ActivityHistory templateId="t1" />);
    await waitFor(() => expect(screen.getByText("SUBMITTED")).toBeInTheDocument());
  });

  it("shows an empty state when there is no activity", async () => {
    waTemplateActivityServerFn.mockResolvedValue({ ok: true, rows: [] });
    render(<ActivityHistory templateId={null} />);
    await waitFor(() => expect(screen.getByText("No activity recorded yet.")).toBeInTheDocument());
    // null id asks for global activity
    expect(waTemplateActivityServerFn).toHaveBeenCalledWith({ data: { id: null } });
  });
});
