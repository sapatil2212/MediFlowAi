// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

afterEach(() => cleanup());

describe("StatusBadge", () => {
  it("renders a known status with a human label", () => {
    render(<StatusBadge status="APPROVED" />);
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toHaveAttribute("data-known", "true");
  });

  it("renders an unknown status safely as its raw value", () => {
    render(<StatusBadge status="SOME_NEW_STATE" />);
    const badge = screen.getByText("SOME_NEW_STATE");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-known", "false");
  });

  it("renders Draft when there is no status", () => {
    render(<StatusBadge status={null} />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });
});
