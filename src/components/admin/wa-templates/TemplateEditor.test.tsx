// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const waCreateDraftServerFn = vi.fn();
const waUpdateDraftServerFn = vi.fn();
const waValidateDraftServerFn = vi.fn();
const waSubmitTemplateServerFn = vi.fn();

vi.mock("../../../lib/admin", () => ({
  waCreateDraftServerFn: (...a: any[]) => waCreateDraftServerFn(...a),
  waUpdateDraftServerFn: (...a: any[]) => waUpdateDraftServerFn(...a),
  waValidateDraftServerFn: (...a: any[]) => waValidateDraftServerFn(...a),
  waSubmitTemplateServerFn: (...a: any[]) => waSubmitTemplateServerFn(...a),
}));

import { TemplateEditor } from "./TemplateEditor";

beforeEach(() => {
  waCreateDraftServerFn.mockReset();
  waValidateDraftServerFn.mockReset();
  waSubmitTemplateServerFn.mockReset();
});
afterEach(() => cleanup());

describe("TemplateEditor", () => {
  it("shows the media-header disabled reason and disables media radios (DP-02)", () => {
    render(<TemplateEditor />);
    expect(screen.getByText(/Resumable Upload flow/)).toBeInTheDocument();
    const imageRadio = screen.getByRole("radio", { name: "IMAGE" });
    expect(imageRadio).toBeDisabled();
    const textRadio = screen.getByRole("radio", { name: "TEXT" });
    expect(textRadio).toBeEnabled();
  });

  it("surfaces inline validation errors for an empty draft and disables Submit", () => {
    render(<TemplateEditor />);
    expect(screen.getByTestId("editor-errors")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit to Meta/ })).toBeDisabled();
  });

  it("opens the review dialog with the server payload for a valid draft", async () => {
    render(<TemplateEditor />);
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "bmt_test" },
    });
    fireEvent.change(screen.getByLabelText("Body"), {
      target: { value: "Hello there, your code." },
    });
    waValidateDraftServerFn.mockResolvedValue({
      ok: true,
      payload: { name: "bmt_test", category: "UTILITY" },
      warnings: [],
    });
    const submit = screen.getByRole("button", { name: /Submit to Meta/ });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() =>
      expect(screen.getByTestId("submit-payload").textContent).toContain('"bmt_test"'),
    );
  });
});
