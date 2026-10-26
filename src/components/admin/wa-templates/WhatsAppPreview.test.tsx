// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WhatsAppPreview } from "./WhatsAppPreview";
import type { TemplateDraft } from "../../../lib/wa-template-model";

afterEach(() => cleanup());

function draft(over: Partial<TemplateDraft> = {}): TemplateDraft {
  return {
    name: "t",
    language: "en_US",
    category: "UTILITY",
    parameterFormat: "POSITIONAL",
    headerType: "NONE",
    headerText: "",
    bodyText: "Hello {{1}}",
    footerText: "",
    buttons: [],
    sampleValues: { "body.1": "World" },
    variableMappings: {},
    ...over,
  };
}

describe("WhatsAppPreview", () => {
  it("is labelled as a non-sent preview", () => {
    render(<WhatsAppPreview draft={draft()} />);
    expect(screen.getByText("Preview — not sent")).toBeInTheDocument();
  });

  it("substitutes sample values into the body", () => {
    render(<WhatsAppPreview draft={draft()} />);
    expect(screen.getByTestId("preview-body")).toHaveTextContent("Hello World");
  });

  it("HTML-escapes an injected sample value instead of rendering markup", () => {
    render(
      <WhatsAppPreview
        draft={draft({ sampleValues: { "body.1": "<img src=x onerror=alert(1)>" } })}
      />,
    );
    const body = screen.getByTestId("preview-body");
    // The value is HTML-escaped by the model; the "<" renders as the entity
    // &lt; (shown literally in textContent) and no <img> element is created.
    expect(body.textContent).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(body.querySelector("img")).toBeNull();
  });

  it("renders header, footer and buttons when present", () => {
    render(
      <WhatsAppPreview
        draft={draft({
          headerType: "TEXT",
          headerText: "Header",
          footerText: "Footer",
          buttons: [{ type: "QUICK_REPLY", text: "Yes" }],
        })}
      />,
    );
    expect(screen.getByTestId("preview-header")).toHaveTextContent("Header");
    expect(screen.getByTestId("preview-footer")).toHaveTextContent("Footer");
    expect(screen.getByTestId("preview-buttons")).toHaveTextContent("Yes");
  });
});
