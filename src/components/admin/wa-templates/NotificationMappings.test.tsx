// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const waNotifyMappingsServerFn = vi.fn();
const waTemplateListServerFn = vi.fn();
const waAssignMappingServerFn = vi.fn();
const waSetMappingEnabledServerFn = vi.fn();
const waRemoveMappingServerFn = vi.fn();

vi.mock("../../../lib/admin", () => ({
  waNotifyMappingsServerFn: (...a: any[]) => waNotifyMappingsServerFn(...a),
  waTemplateListServerFn: (...a: any[]) => waTemplateListServerFn(...a),
  waAssignMappingServerFn: (...a: any[]) => waAssignMappingServerFn(...a),
  waSetMappingEnabledServerFn: (...a: any[]) => waSetMappingEnabledServerFn(...a),
  waRemoveMappingServerFn: (...a: any[]) => waRemoveMappingServerFn(...a),
}));

import { NotificationMappings } from "./NotificationMappings";

beforeEach(() => {
  waNotifyMappingsServerFn.mockReset();
  waTemplateListServerFn.mockReset();
  waSetMappingEnabledServerFn.mockReset();
  waTemplateListServerFn.mockResolvedValue({ ok: true, rows: [] });
});
afterEach(() => cleanup());

describe("NotificationMappings", () => {
  it("disables the enable button until the opt-in acknowledgement is ticked (DP-01)", async () => {
    waNotifyMappingsServerFn.mockResolvedValue({
      ok: true,
      rows: [
        {
          id: "m1",
          notifyKind: "booked",
          templateId: "t1",
          language: "en_US",
          isEnabled: false,
          optInAckAt: null,
        },
      ],
    });
    render(<NotificationMappings />);
    await waitFor(() => expect(screen.getByTestId("notification-mappings")).toBeInTheDocument());

    const enableBtn = screen.getByRole("button", { name: "Enable" });
    expect(enableBtn).toBeDisabled();
    expect(screen.getByTestId("disabled-reason")).toHaveTextContent(/opt-in acknowledgement/i);

    // Tick the acknowledgement checkbox → Enable becomes active.
    fireEvent.click(screen.getByLabelText(/obtained the recipient's opt-in/i));
    expect(enableBtn).toBeEnabled();
  });

  it("sends optInAck:true when enabling a mapping", async () => {
    waNotifyMappingsServerFn.mockResolvedValue({
      ok: true,
      rows: [
        {
          id: "m1",
          notifyKind: "booked",
          templateId: "t1",
          language: "en_US",
          isEnabled: false,
          optInAckAt: null,
        },
      ],
    });
    waSetMappingEnabledServerFn.mockResolvedValue({ ok: true, mapping: {} });
    render(<NotificationMappings />);
    await waitFor(() => expect(screen.getByTestId("notification-mappings")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/obtained the recipient's opt-in/i));
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() =>
      expect(waSetMappingEnabledServerFn).toHaveBeenCalledWith({
        data: { notifyKind: "booked", enabled: true, optInAck: true },
      }),
    );
  });
});
