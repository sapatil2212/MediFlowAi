// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SubmitReviewDialog } from "./SubmitReviewDialog";

afterEach(() => cleanup());

const PAYLOAD = {
  name: "bmt_confirmed",
  language: "en_US",
  category: "UTILITY",
  components: [{ type: "BODY", text: "Hi {{1}}" }],
};

describe("SubmitReviewDialog", () => {
  it("shows the exact payload and requires an explicit confirm", () => {
    const onConfirm = vi.fn();
    render(
      <SubmitReviewDialog
        open
        payload={PAYLOAD}
        warnings={[]}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("submit-payload").textContent).toContain('"bmt_confirmed"');
    fireEvent.click(screen.getByRole("button", { name: /Confirm & submit to Meta/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows the returned PENDING status after a successful create and never implies approval", () => {
    render(
      <SubmitReviewDialog
        open
        payload={PAYLOAD}
        submittedStatus="PENDING"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    const result = screen.getByTestId("submit-result");
    expect(result).toHaveTextContent("Pending");
    expect(screen.getByText(/pending Meta review/i)).toBeInTheDocument();
    expect(screen.queryByText(/approved/i)).not.toBeInTheDocument();
  });
});
