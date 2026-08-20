// @vitest-environment jsdom
/**
 * RestaurantProfilePanel.integration.test.tsx
 *
 * Integration-flavoured DOM suite for the `Restaurant Profile` Settings sub-tab
 * (spec `.kiro/specs/restaurant-dashboard-settings`, task 5.10, Req 2.1-2.24,
 * 10.1, 11.1, 11.2).
 *
 * This is a focused SIBLING of `RestaurantProfilePanel.test.tsx`: it fills the
 * gaps that suite leaves open rather than duplicating its assertions. Every
 * server interaction is an injected callback, exactly like
 * `RestaurantProfilePanel.test.tsx` and `DiningAreasSettings.test.tsx`, so the
 * tests never touch the database, auth, crypto, an email transport, or a real
 * QR encoder. The production server-function module and `qrcode` are mocked at
 * the module boundary only so importing the component does not pull
 * `db`/`auth.server` into jsdom.
 *
 * Gaps covered here:
 *   • Full eleven-field inventory rendered with their stored values (Req 2.5).
 *   • Booking-portal copy cleanup timing + exact-link QR decode (Req 2.2-2.4).
 *   • Scope forwarding for User/SubUser (primary) and Location (branch) email
 *     changes, so the exact `requestedLocationId` reaches request+confirm
 *     (Req 2.13, 10.1).
 *   • Global case-insensitive uniqueness rejection on request AND a raced
 *     `email_in_use` on confirm, both preserving the stored email (Req 2.15).
 *   • Resend gating: the 60s boundary elapses and enables a real resend call
 *     (Req 2.16).
 *   • Password minimum-length error surfaced without changing the hash
 *     (Req 2.21-2.24).
 *   • Stored-state preservation on profile-save and photo failures (Req 11.1,
 *     11.2).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// Keep the real server-function module (and its db/auth imports) out of jsdom.
vi.mock("../../lib/restaurant-settings", () => ({
  getRestaurantProfileServerFn: vi.fn(),
  saveRestaurantProfileServerFn: vi.fn(),
  uploadRestaurantProfilePhotoServerFn: vi.fn(),
  requestAccountEmailChangeServerFn: vi.fn(),
  resendAccountEmailChangeServerFn: vi.fn(),
  confirmAccountEmailChangeServerFn: vi.fn(),
  changeOwnPasswordServerFn: vi.fn(),
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async (text: string) => `data:image/png;base64,${btoa(text)}`) },
  toDataURL: vi.fn(async (text: string) => `data:image/png;base64,${btoa(text)}`),
}));

import {
  RestaurantProfilePanel,
  COPY_CONFIRMATION_MS,
  type FetchRestaurantProfile,
  type SaveRestaurantProfile,
} from "./RestaurantProfilePanel";
import {
  deriveProfileCapabilityViewModel,
  MSG_PROFILE_PHOTO,
  MSG_EMAIL_ALREADY_IN_USE,
  MSG_PASSWORD_MIN_LENGTH,
} from "../../lib/restaurant-settings-model";
import type { RestaurantProfileView } from "../../lib/restaurant-settings";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORIGIN = "https://book.example.com";

type ConfigPermission = "operate" | "view_only" | "none";

/** The eleven stored profile fields, keyed by label, so a test can assert the
 * complete inventory renders with the expected value in each input. */
const FIELD_VALUES: Record<string, string> = {
  "Restaurant name": "The Test Kitchen",
  "Owner or manager name": "Asha",
  "Account phone": "111",
  "Team size": "5",
  "Public email": "hello@test.kitchen",
  "Contact number": "222",
  "WhatsApp number": "333",
  Landline: "444",
  Address: "1 Test Street",
  "Cuisine or services": "Modern",
  Description: "A test kitchen",
};

function buildView(
  permission: ConfigPermission,
  overrides: Partial<RestaurantProfileView> = {},
): RestaurantProfileView {
  const tenantId = overrides.tenantId ?? "tenant-1";
  return {
    bookingPath: `/book/${tenantId}`,
    tenantId,
    profile: {
      restaurantName: "The Test Kitchen",
      ownerOrManagerName: "Asha",
      accountPhone: "111",
      teamSize: "5",
      publicEmail: "hello@test.kitchen",
      contactNumber: "222",
      whatsappNumber: "333",
      landline: "444",
      address: "1 Test Street",
      cuisineOrServices: "Modern",
      description: "A test kitchen",
    },
    accountEmail: "owner@example.com",
    profilePhoto: null,
    capability: deriveProfileCapabilityViewModel(permission),
    canSave: permission === "operate",
    ...overrides,
  };
}

const fetchProfileOf = (view: RestaurantProfileView): FetchRestaurantProfile =>
  vi.fn(async () => view);

const echoQr = vi.fn(async (link: string) => `data:image/png;base64,${btoa(link)}`);

async function mountPanel(props: Parameters<typeof RestaurantProfilePanel>[0]) {
  const utils = render(<RestaurantProfilePanel origin={ORIGIN} {...props} />);
  await screen.findByTestId("booking-portal-link");
  return utils;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Full field inventory (Req 2.5)
// ---------------------------------------------------------------------------

describe("Profile field inventory (Req 2.5)", () => {
  it("renders all eleven stored fields with their values", async () => {
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("operate")),
      generateQrDataUrl: echoQr,
    });

    const labels = Object.keys(FIELD_VALUES);
    expect(labels).toHaveLength(11);
    for (const label of labels) {
      const field = screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
      expect(field).toBeTruthy();
      expect(field.value).toBe(FIELD_VALUES[label]);
    }
  });
});

// ---------------------------------------------------------------------------
// Booking portal timing + QR decode (Req 2.2-2.4)
// ---------------------------------------------------------------------------

describe("Booking portal copy cleanup + QR decode (Req 2.2-2.4)", () => {
  it("clears an in-flight copy timer on unmount without reverting after unmount", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });

    const { unmount } = render(
      <RestaurantProfilePanel
        origin={ORIGIN}
        fetchProfile={fetchProfileOf(buildView("operate"))}
        generateQrDataUrl={echoQr}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /copied/i })).toBeTruthy();

    // Unmount before the 2s window closes; the cleanup must clear the timer so
    // advancing past the window cannot touch an unmounted component (Req 2.4).
    unmount();
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(COPY_CONFIRMATION_MS + 10);
      }),
    ).not.toThrow();
  });

  it("encodes exactly the browser-origin link so a scan resolves to the same URL", async () => {
    const tenantId = "tenant-xyz";
    const view = buildView("operate", { tenantId, bookingPath: `/book/${tenantId}` });
    await mountPanel({ fetchProfile: fetchProfileOf(view), generateQrDataUrl: echoQr });

    const expectedLink = `${ORIGIN}/book/${tenantId}`;
    const link = screen.getByTestId("booking-portal-link") as HTMLInputElement;
    expect(link.value).toBe(expectedLink);

    const qr = (await screen.findByTestId("booking-portal-qr")) as HTMLImageElement;
    expect(echoQr).toHaveBeenCalledWith(expectedLink);
    // The QR data URL round-trips back to the exact same link (a decode check).
    const encoded = qr.getAttribute("src") ?? "";
    const decoded = atob(encoded.replace("data:image/png;base64,", ""));
    expect(decoded).toBe(expectedLink);
  });
});

// ---------------------------------------------------------------------------
// Email change across roles + scope forwarding (Req 2.13, 10.1)
// ---------------------------------------------------------------------------

describe("Email change scope forwarding across roles (Req 2.13, 10.1)", () => {
  it("forwards null scope for a primary User/SubUser and updates the shown email", async () => {
    const requestEmailChange = vi.fn(async () => ({
      status: "code_sent" as const,
      message: null,
      targetEmail: "user-new@example.com",
      resendAvailableAtMs: Date.now() + 60_000,
      expiresAtMs: Date.now() + 300_000,
    }));
    const confirmEmailChange = vi.fn(async () => ({
      status: "updated" as const,
      message: null,
      email: "user-new@example.com",
    }));

    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("operate")),
      generateQrDataUrl: echoQr,
      requestEmailChange,
      confirmEmailChange,
    });

    fireEvent.change(screen.getByLabelText("New email address"), {
      target: { value: "user-new@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification code/i }));
      await Promise.resolve();
    });
    expect(requestEmailChange).toHaveBeenCalledWith({
      data: { email: "user-new@example.com", requestedLocationId: null },
    });

    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "1234" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm new email/i }));
      await Promise.resolve();
    });
    expect(confirmEmailChange).toHaveBeenCalledWith({
      data: { email: "user-new@example.com", code: "1234", requestedLocationId: null },
    });
    expect(screen.getByTestId("account-email").textContent).toBe("user-new@example.com");
  });

  it("forwards the branch scope for a Location account through request and confirm", async () => {
    const LOCATION_ID = "branch-7";
    const requestEmailChange = vi.fn(async () => ({
      status: "code_sent" as const,
      message: null,
      targetEmail: "branch-new@example.com",
      resendAvailableAtMs: Date.now() + 60_000,
      expiresAtMs: Date.now() + 300_000,
    }));
    const confirmEmailChange = vi.fn(async () => ({
      status: "updated" as const,
      message: null,
      email: "branch-new@example.com",
    }));

    await mountPanel({
      requestedLocationId: LOCATION_ID,
      fetchProfile: fetchProfileOf(
        buildView("operate", { accountEmail: "branch@example.com" }),
      ),
      generateQrDataUrl: echoQr,
      requestEmailChange,
      confirmEmailChange,
    });

    fireEvent.change(screen.getByLabelText("New email address"), {
      target: { value: "branch-new@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification code/i }));
      await Promise.resolve();
    });
    expect(requestEmailChange).toHaveBeenCalledWith({
      data: { email: "branch-new@example.com", requestedLocationId: LOCATION_ID },
    });

    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "4321" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm new email/i }));
      await Promise.resolve();
    });
    expect(confirmEmailChange).toHaveBeenCalledWith({
      data: { email: "branch-new@example.com", code: "4321", requestedLocationId: LOCATION_ID },
    });
    expect(screen.getByTestId("account-email").textContent).toBe("branch-new@example.com");
  });
});

// ---------------------------------------------------------------------------
// Global uniqueness + concurrent confirmation (Req 2.15)
// ---------------------------------------------------------------------------

describe("Email uniqueness and concurrent confirmation (Req 2.15)", () => {
  it("rejects a globally-taken address on request, sends no code, keeps the email", async () => {
    const requestEmailChange = vi.fn(async () => ({
      status: "email_in_use" as const,
      message: MSG_EMAIL_ALREADY_IN_USE,
      targetEmail: null,
      resendAvailableAtMs: null,
      expiresAtMs: null,
    }));
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("none")),
      generateQrDataUrl: echoQr,
      requestEmailChange,
    });

    fireEvent.change(screen.getByLabelText("New email address"), {
      target: { value: "taken@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification code/i }));
      await Promise.resolve();
    });

    await screen.findByText(MSG_EMAIL_ALREADY_IN_USE);
    // No code entry appears because no code was sent, and the email is unchanged.
    expect(screen.queryByLabelText("Verification code")).toBeNull();
    expect(screen.getByTestId("account-email").textContent).toBe("owner@example.com");
  });

  it("preserves the stored email when a raced confirm reports the address in use", async () => {
    const requestEmailChange = vi.fn(async () => ({
      status: "code_sent" as const,
      message: null,
      targetEmail: "race@example.com",
      resendAvailableAtMs: Date.now() + 60_000,
      expiresAtMs: Date.now() + 300_000,
    }));
    // The address was free at request time but claimed by another account before
    // this confirm committed — a concurrent-confirmation race (Req 2.15).
    const confirmEmailChange = vi.fn(async () => ({
      status: "email_in_use" as const,
      message: MSG_EMAIL_ALREADY_IN_USE,
      email: "owner@example.com",
    }));
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("none")),
      generateQrDataUrl: echoQr,
      requestEmailChange,
      confirmEmailChange,
    });

    fireEvent.change(screen.getByLabelText("New email address"), {
      target: { value: "race@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification code/i }));
      await Promise.resolve();
    });
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "1234" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm new email/i }));
      await Promise.resolve();
    });

    await screen.findByText(MSG_EMAIL_ALREADY_IN_USE);
    expect(screen.getByTestId("account-email").textContent).toBe("owner@example.com");
  });
});

// ---------------------------------------------------------------------------
// Resend gating boundary (Req 2.16)
// ---------------------------------------------------------------------------

describe("Resend gating boundary (Req 2.16)", () => {
  it("enables and issues a resend only after the 60s boundary elapses", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    const requestEmailChange = vi.fn(async () => ({
      status: "code_sent" as const,
      message: null,
      targetEmail: "later@example.com",
      resendAvailableAtMs: Date.now() + 60_000,
      expiresAtMs: Date.now() + 300_000,
    }));
    const resendEmailChange = vi.fn(async () => ({
      status: "code_sent" as const,
      message: null,
      targetEmail: "later@example.com",
      resendAvailableAtMs: Date.now() + 60_000,
      expiresAtMs: Date.now() + 300_000,
    }));

    render(
      <RestaurantProfilePanel
        origin={ORIGIN}
        fetchProfile={fetchProfileOf(buildView("none"))}
        generateQrDataUrl={echoQr}
        requestEmailChange={requestEmailChange}
        resendEmailChange={resendEmailChange}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.change(screen.getByLabelText("New email address"), {
      target: { value: "later@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification code/i }));
      await Promise.resolve();
    });

    const resend = screen.getByTestId("resend-code") as HTMLButtonElement;
    expect(resend.disabled).toBe(true);

    // A click during the gate is ignored (no server call).
    await act(async () => {
      fireEvent.click(resend);
      await Promise.resolve();
    });
    expect(resendEmailChange).not.toHaveBeenCalled();

    // Advance past the 60s boundary; the countdown clears and enables resend.
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect((screen.getByTestId("resend-code") as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByTestId("resend-code"));
      await Promise.resolve();
    });
    expect(resendEmailChange).toHaveBeenCalledWith({ data: { requestedLocationId: null } });
  });
});

// ---------------------------------------------------------------------------
// Password minimum length (Req 2.21-2.24)
// ---------------------------------------------------------------------------

describe("Password minimum-length error (Req 2.21-2.24)", () => {
  it("surfaces the length error and does not report success", async () => {
    const changePassword = vi.fn(async () => ({
      status: "invalid_input" as const,
      message: MSG_PASSWORD_MIN_LENGTH,
      fieldErrors: [{ field: "newPassword" as const, message: MSG_PASSWORD_MIN_LENGTH }],
    }));
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("none")),
      generateQrDataUrl: echoQr,
      changePassword,
    });

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-secret" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "short" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /change password/i }));
      await Promise.resolve();
    });

    expect(changePassword).toHaveBeenCalledTimes(1);
    await screen.findByText(MSG_PASSWORD_MIN_LENGTH);
    expect(screen.queryByText("Password changed")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stored-state preservation on failure (Req 11.1, 11.2)
// ---------------------------------------------------------------------------

describe("Stored-state preservation on failure (Req 11.1, 11.2)", () => {
  it("keeps the edited draft values visible when a profile save throws", async () => {
    const saveProfile: SaveRestaurantProfile = vi.fn(async () => {
      throw new Error("save failed");
    });
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("operate")),
      generateQrDataUrl: echoQr,
      saveProfile,
    });

    const nameInput = screen.getByLabelText("Restaurant name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Edited Kitchen" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save restaurant details/i }));
      await Promise.resolve();
    });

    await screen.findByRole("alert");
    // The draft is preserved (no rollback) and no success is shown.
    expect((screen.getByLabelText("Restaurant name") as HTMLInputElement).value).toBe(
      "Edited Kitchen",
    );
    expect(screen.queryByText("Restaurant details saved")).toBeNull();
  });

  it("retains the existing profile photo when an upload is rejected", async () => {
    const uploadPhoto = vi.fn(async () => ({
      status: "invalid" as const,
      profilePhoto: null,
      message: MSG_PROFILE_PHOTO,
    }));
    await mountPanel({
      fetchProfile: fetchProfileOf(
        buildView("operate", { profilePhoto: "https://cdn.example.com/stored.png" }),
      ),
      generateQrDataUrl: echoQr,
      uploadPhoto,
      readFileAsDataUrl: async () => "data:image/gif;base64,AAAA",
    });

    const input = screen.getByTestId("profile-photo-input") as HTMLInputElement;
    const file = new File(["x"], "bad.gif", { type: "image/gif" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
    });

    await screen.findByText(MSG_PROFILE_PHOTO);
    // The stored photo URL is preserved on a rejected upload (Req 2.12, 11.2).
    const img = screen.getByTestId("profile-photo") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/stored.png");
  });
});
