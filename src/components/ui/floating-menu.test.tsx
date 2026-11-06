// @vitest-environment jsdom
//
// FloatingMenu renders dropdown panels in a fixed layer on document.body so a
// table's `overflow-x-auto` (or a modal's `overflow-y-auto`) can never clip them.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { FloatingMenu, FLOATING_MENU_Z_INDEX } from "./floating-menu";

function rect(top: number, left: number, width: number, height: number): DOMRect {
  return {
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function StatusCell({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div data-testid="scroller" style={{ overflowX: "auto" }}>
      <table>
        <tbody>
          <tr>
            <td style={{ position: "relative" }}>
              <button type="button" onClick={() => setOpen((v) => !v)}>
                Pending
              </button>
              <FloatingMenu
                open={open}
                matchWidth={false}
                menuWidth={128}
                onClose={() => {
                  onClose?.();
                  setOpen(false);
                }}
              >
                <div role="menu">
                  <button type="button">Confirmed</button>
                </div>
              </FloatingMenu>
            </td>
          </tr>
        </tbody>
      </table>
      <p>Outside</p>
    </div>
  );
}

let triggerRect = rect(100, 40, 80, 24);

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
  triggerRect = rect(100, 40, 80, 24);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === "BUTTON" && this.textContent === "Pending"
      ? triggerRect
      : rect(0, 0, 0, 0);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FloatingMenu", () => {
  it("renders on document.body, outside the clipping table, above every modal", () => {
    render(<StatusCell />);
    const menu = screen.getByRole("menu").parentElement as HTMLElement;

    expect(screen.getByTestId("scroller").contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(menu.classList.contains("dropdown-container")).toBe(true);
    expect(menu.style.position).toBe("fixed");
    expect(Number(menu.style.zIndex)).toBe(FLOATING_MENU_Z_INDEX);
    expect(FLOATING_MENU_Z_INDEX).toBeGreaterThan(130); // highest app modal is z-[130]
  });

  it("anchors below the trigger it follows, with the requested width", () => {
    render(<StatusCell />);
    const menu = screen.getByRole("menu").parentElement as HTMLElement;
    expect(menu.style.top).toBe(`${100 + 24 + 6}px`);
    expect(menu.style.left).toBe("40px");
    expect(menu.style.width).toBe("128px");
    expect(menu.style.visibility).toBe("visible");
  });

  it("opens above the trigger when there is no room below", () => {
    triggerRect = rect(740, 40, 80, 24); // near the bottom of a 768px viewport
    render(<StatusCell />);
    const menu = screen.getByRole("menu").parentElement as HTMLElement;
    // estimatedHeight (240) does not fit below, so it is placed above.
    expect(Number.parseInt(menu.style.top, 10)).toBe(740 - 6 - 240);
  });

  it("stays inside the viewport near the right edge", () => {
    triggerRect = rect(100, 1000, 20, 24);
    render(<StatusCell />);
    const menu = screen.getByRole("menu").parentElement as HTMLElement;
    expect(Number.parseInt(menu.style.left, 10)).toBe(1024 - 8 - 128);
  });

  it("closes on an outside press and on Escape, but not when pressing inside or on the trigger", () => {
    const onClose = vi.fn();
    render(<StatusCell onClose={onClose} />);

    fireEvent.pointerDown(screen.getByText("Confirmed"));
    fireEvent.pointerDown(screen.getByText("Pending"));
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a press outside the menu", () => {
    const onClose = vi.fn();
    render(<StatusCell onClose={onClose} />);
    act(() => {
      fireEvent.pointerDown(screen.getByText("Outside"));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
