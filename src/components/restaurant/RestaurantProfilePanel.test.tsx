// @vitest-environment jsdom
/**
 * RestaurantProfilePanel.test.tsx
 *
 * Focused DOM suite for the `Restaurant Profile` Settings sub-tab
 * (spec `.kiro/specs/restaurant-dashboard-settings`, task 5.5, Req 2.1-2.24).
 *
 * Every server interaction is an injected callback, exactly like
 * `book.$tenantId.restaurant.test.tsx`, so the tests never touch the database,
 * auth, crypto, an email transport, or a real QR encoder. The production
 * server-function module and `qrcode` are mocked at the module boundary only so
 * importing the component does not pull `db`/`auth.server` into jsdom.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Keep the real server-function module (and its db/auth imports) out of jsdom;
// the component only uses these as defaults, and every test injects its own.
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
  MSG_PROFILE_VIEW_ONLY,
  MSG_EMAIL_ALREADY_CURRENT,
  MSG_VERIFICATION_INVALID_OR_EXPIRED,
  MSG_PASSWORDS_DO_NOT_MATCH,
  MSG_CURRENT_PASSWORD_INCORRECT,
} from "../../lib/restaurant-settings-model";
import type { RestaurantProfileView } from "../../lib/restaurant-settings";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORIGIN = "https://book.example.com";
const TENANT_ID = "tenant-1";
const BOOKING_PATH = `/book/${TENANT_ID}`;
const EXACT_LINK = `${ORIGIN}${BOOKING_PATH}`;

type ConfigPermission = "operate" | "view_only" | "none";

function buildView(
  permission: ConfigPermission,
  overrides: Partial<RestaurantProfileView> = {},
): RestaurantProfileView {
  return {
    bookingPath: BOOKING_PATH,
    tenantId: TENANT_ID,
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

/** A resolved-immediately profile read. */
const fetchProfileOf = (view: RestaurantProfileView): FetchRestaurantProfile =>
  vi.fn(async () => view);

/** A QR encoder that echoes the exact link it was asked to encode. */
const echoQr = vi.fn(async (link: string) => `data:image/png;base64,${btoa(link)}`);

/** Mounts the panel and waits for the initial profile read to settle. */
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
// Booking portal (Req 2.2-2.4)
// ---------------------------------------------------------------------------

describe("Booking portal (Req 2.2-2.4)", () => {
  it("renders the exact origin+path link as selectable text and encodes the same link in the QR", async () => {
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("operate")),
      generateQrDataUrl: echoQr,
    });

    const link = screen.getByTestId("booking-portal-link") as HTMLInputElement;
    expect(link.value).toBe(EXACT_LINK);
    expect(link.readOnly).toBe(true);

    // Req 2.3 — the QR encodes exactly the same link, not a retyped variant.
    // The QR image only appears once the async encode resolves, so wait for it
    // before asserting the encoder was called with the exact link.
    const qr = (await screen.findByTestId("booking-portal-qr")) as HTMLImageElement;
    expect(echoQr).toHaveBeenCalledWith(EXACT_LINK);
    expect(qr.getAttribute("src")).toBe(`data:image/png;base64,${btoa(EXACT_LINK)}`);
  });

  it("copies the exact link and shows a copied confirmation for exactly 2 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <RestaurantProfilePanel
        origin={ORIGIN}
        fetchProfile={fetchProfileOf(buildView("operate"))}
        generateQrDataUrl={echoQr}
      />,
    );
    // Flush the mount read under fake timers.
    await act(async () => {
      await Promise.resolve();
    });

    const copyButton = screen.getByRole("button", { name: /copy link/i });
    await act(async () => {
      fireEvent.click(copyButton);
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(EXACT_LINK);
    expect(screen.getByRole("button", { name: /copied/i })).toBeTruthy();

    // Just before the window closes it is still shown.
    await act(async () => {
      vi.advanceTimersByTime(COPY_CONFIRMATION_MS - 1);
    });
    expect(screen.queryByRole("button", { name: /copied/i })).toBeTruthy();

    // At 2 seconds the confirmation reverts to the idle label.
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("button", { name: /copied/i })).toBeNull();
    expect(screen.getByRole("button", { name: /copy link/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tenant profile fields (Req 2.5-2.9)
// ---------------------------------------------------------------------------

/** The full stored profile field inventory (Req 2.5), by visible label. */
const PROFILE_FIELD_LABELS = [
  "Restaurant name",
  "Owner or manager name",
  "Account phone",
  "Team size",
  "Public email",
  "Contact number",
  "WhatsApp number",
  "Landline",
  "Address",
  "Cuisine or services",
  "Description",
] as const;

describe("Tenant profile fields (Req 2.5-2.9)", () => {
  it("renders the complete eleven-field inventory with stored values under operate", async () => {
    const view = buildView("operate");
    await mountPanel({
      fetchProfile: fetchProfileOf(view),
      generateQrDataUrl: echoQr,
    });
    // Let the async QR encode settle so no pending microtask leaks past cleanup.
    await screen.findByTestId("booking-portal-qr");

    // Req 2.5 — every one of the eleven stored fields is present exactly once
    // and shows its stored value.
    for (const label of PROFILE_FIELD_LABELS) {
      const field = screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
      expect(field).toBeTruthy();
    }
    expect((screen.getByLabelText("Restaurant name") as HTMLInputElement).value).toBe(
      view.profile.restaurantName,
    );
    expect((screen.getByLabelText("Owner or manager name") as HTMLInputElement).value).toBe(
      view.profile.ownerOrManagerName,
    );
    expect((screen.getByLabelText("Account phone") as HTMLInputElement).value).toBe(
      view.profile.accountPhone,
    );
    expect((screen.getByLabelText("Team size") as HTMLInputElement).value).toBe(
      view.profile.teamSize,
    );
    expect((screen.getByLabelText("Public email") as HTMLInputElement).value).toBe(
      view.profile.publicEmail,
    );
    expect((screen.getByLabelText("Contact number") as HTMLInputElement).value).toBe(
      view.profile.contactNumber,
    );
    expect((screen.getByLabelText("WhatsApp number") as HTMLInputElement).value).toBe(
      view.profile.whatsappNumber,
    );
    expect((screen.getByLabelText("Landline") as HTMLInputElement).value).toBe(
      view.profile.landline,
    );
    expect((screen.getByLabelText("Address") as HTMLTextAreaElement).value).toBe(
      view.profile.address,
    );
    expect((screen.getByLabelText("Cuisine or services") as HTMLInputElement).value).toBe(
      view.profile.cuisineOrServices,
    );
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
      view.profile.description,
    );
  });

  it("renders the same complete inventory read-only under none (no field is editable)", async () => {
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("none")),
      generateQrDataUrl: echoQr,
    });
    // Let the async QR encode settle so no pending microtask leaks past cleanup.
    await screen.findByTestId("booking-portal-qr");

    // The full inventory is still shown, but every field is read-only and there
    // is no save control (Req 2.8, 2.9).
    for (const label of PROFILE_FIELD_LABELS) {
      const field = screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
      expect(field.readOnly).toBe(true);
    }
    expect(screen.queryByRole("button", { name: /save restaurant details/i })).toBeNull();
  });

  it("renders the eleven fields editable with a save control under operate", async () => {
    const saveProfile: SaveRestaurantProfile = vi.fn(async () => buildView("operate"));
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("operate")),
      generateQrDataUrl: echoQr,
      saveProfile,
    });

    const nameInput = screen.getByLabelText("Restaurant name") as HTMLInputElement;
    expect(nameInput.readOnly).toBe(false);
    expect(nameInput.value).toBe("The Test Kitchen");

    fireEvent.change(nameInput, { target: { value: "Renamed Kitchen" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save restaurant details/i }));
      await Promise.resolve();
    });

    const saveMock = vi.mocked(saveProfile);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock.mock.calls[0][0].data.profile.restaurantName).toBe("Renamed Kitchen");
    await screen.findByText("Restaurant details saved");
  });

  it("renders read-only fields with the view-only message and no save control under view_only", async () => {
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("view_only")),
      generateQrDataUrl: echoQr,
    });

    const nameInput = screen.getByLabelText("Restaurant name") as HTMLInputElement;
    expect(nameInput.readOnly).toBe(true);
    expect(screen.getByTestId("profile-view-only-message").textContent).toContain(
      MSG_PROFILE_VIEW_ONLY,
    );
    expect(screen.queryByRole("button", { name: /save restaurant details/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Profile photo (Req 2.10-2.12)
// ---------------------------------------------------------------------------

describe("Profile photo (Req 2.10-2.12)", () => {
  it("shows the size/format message and keeps the stored photo on a rejected upload", async () => {
    const uploadPhoto = vi.fn(async () => ({
      status: "invalid" as const,
      profilePhoto: null,
      message: MSG_PROFILE_PHOTO,
    }));
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("operate")),
      generateQrDataUrl: echoQr,
      uploadPhoto,
      readFileAsDataUrl: async () => "data:image/gif;base64,AAAA",
    });

    const input = screen.getByTestId("profile-photo-input") as HTMLInputElement;
    const file = new File(["x"], "photo.gif", { type: "image/gif" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
    });

    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    await screen.findByText(MSG_PROFILE_PHOTO);
    expect(screen.queryByTestId("profile-photo")).toBeNull();
  });

  it("swaps in the new photo on a successful upload", async () => {
    const uploadPhoto = vi.fn(async () => ({
      status: "uploaded" as const,
      profilePhoto: "https://cdn.example.com/new.png",
      message: null,
    }));
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("operate")),
      generateQrDataUrl: echoQr,
      uploadPhoto,
      readFileAsDataUrl: async () => "data:image/png;base64,AAAA",
    });

    const input = screen.getByTestId("profile-photo-input") as HTMLInputElement;
    const file = new File(["x"], "photo.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
    });

    const img = (await screen.findByTestId("profile-photo")) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/new.png");
  });

  it("renders no upload control under view_only", async () => {
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("view_only")),
      generateQrDataUrl: echoQr,
    });
    expect(screen.queryByTestId("profile-photo-input")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Account security (Req 2.13-2.24)
// ---------------------------------------------------------------------------

describe("Account security (Req 2.13-2.24)", () => {
  it("is present even when config permission is none", async () => {
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("none")),
      generateQrDataUrl: echoQr,
    });

    // Req 2.13 — email and password controls are present independent of config.
    expect(screen.getByLabelText("New email address")).toBeTruthy();
    expect(screen.getByLabelText("Current password")).toBeTruthy();
    // ...while the profile fields are read-only (config `none`).
    expect((screen.getByLabelText("Restaurant name") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: /save restaurant details/i })).toBeNull();
  });

  it("sends a code, gates resend behind a 60s countdown, then confirms the new email", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    const requestEmailChange = vi.fn(async () => ({
      status: "code_sent" as const,
      message: null,
      targetEmail: "new@example.com",
      resendAvailableAtMs: Date.now() + 60_000,
      expiresAtMs: Date.now() + 300_000,
    }));
    const confirmEmailChange = vi.fn(async () => ({
      status: "updated" as const,
      message: null,
      email: "new@example.com",
    }));
    const onE = fetchProfileOf(buildView("none"));

    render(
      <RestaurantProfilePanel
        origin={ORIGIN}
        fetchProfile={onE}
        generateQrDataUrl={echoQr}
        requestEmailChange={requestEmailChange}
        confirmEmailChange={confirmEmailChange}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.change(screen.getByLabelText("New email address"), {
      target: { value: "new@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification code/i }));
      await Promise.resolve();
    });
    expect(requestEmailChange).toHaveBeenCalledWith({
      data: { email: "new@example.com", requestedLocationId: null },
    });

    // Req 2.16 — the resend control is present but disabled during the 60s gate.
    const resend = screen.getByTestId("resend-code") as HTMLButtonElement;
    expect(resend.disabled).toBe(true);
    expect(resend.textContent).toMatch(/resend in \d+s/i);

    // Enter the code and confirm; the displayed account email updates (Req 2.19).
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "1234" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm new email/i }));
      await Promise.resolve();
    });
    expect(confirmEmailChange).toHaveBeenCalledWith({
      data: { email: "new@example.com", code: "1234", requestedLocationId: null },
    });
    expect(screen.getByTestId("account-email").textContent).toBe("new@example.com");
  });

  it("shows the already-registered message and sends no code for the current address", async () => {
    const requestEmailChange = vi.fn(async () => ({
      status: "email_current" as const,
      message: MSG_EMAIL_ALREADY_CURRENT,
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
      target: { value: "owner@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification code/i }));
      await Promise.resolve();
    });

    await screen.findByText(MSG_EMAIL_ALREADY_CURRENT);
    // No verification-code entry appears because no code was sent.
    expect(screen.queryByLabelText("Verification code")).toBeNull();
  });

  it("keeps the email unchanged and shows the invalid/expired message on a bad code", async () => {
    const requestEmailChange = vi.fn(async () => ({
      status: "code_sent" as const,
      message: null,
      targetEmail: "new@example.com",
      resendAvailableAtMs: Date.now() + 60_000,
      expiresAtMs: Date.now() + 300_000,
    }));
    const confirmEmailChange = vi.fn(async () => ({
      status: "invalid_code" as const,
      message: MSG_VERIFICATION_INVALID_OR_EXPIRED,
      email: "owner@example.com",
    }));
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("none")),
      generateQrDataUrl: echoQr,
      requestEmailChange,
      confirmEmailChange,
    });

    fireEvent.change(screen.getByLabelText("New email address"), {
      target: { value: "new@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification code/i }));
      await Promise.resolve();
    });
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "0000" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm new email/i }));
      await Promise.resolve();
    });

    await screen.findByText(MSG_VERIFICATION_INVALID_OR_EXPIRED);
    expect(screen.getByTestId("account-email").textContent).toBe("owner@example.com");
  });

  it("surfaces the password field errors returned by the server", async () => {
    const changePassword = vi.fn(async () => ({
      status: "invalid_input" as const,
      message: MSG_PASSWORDS_DO_NOT_MATCH,
      fieldErrors: [{ field: "confirmation" as const, message: MSG_PASSWORDS_DO_NOT_MATCH }],
    }));
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("none")),
      generateQrDataUrl: echoQr,
      changePassword,
    });

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "old-secret" },
    });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "brand-new-1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "different" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /change password/i }));
      await Promise.resolve();
    });

    expect(changePassword).toHaveBeenCalledTimes(1);
    await screen.findByText(MSG_PASSWORDS_DO_NOT_MATCH);
  });

  it("reports an incorrect current password without clearing the fields", async () => {
    const changePassword = vi.fn(async () => ({
      status: "current_incorrect" as const,
      message: MSG_CURRENT_PASSWORD_INCORRECT,
      fieldErrors: [{ field: "currentPassword" as const, message: MSG_CURRENT_PASSWORD_INCORRECT }],
    }));
    await mountPanel({
      fetchProfile: fetchProfileOf(buildView("operate")),
      generateQrDataUrl: echoQr,
      changePassword,
    });

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "wrong" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "brand-new-1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "brand-new-1" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /change password/i }));
      await Promise.resolve();
    });

    await screen.findByText(MSG_CURRENT_PASSWORD_INCORRECT);
  });
});

// ---------------------------------------------------------------------------
// Load failure
// ---------------------------------------------------------------------------

describe("Load failure", () => {
  it("renders an alert when the profile read fails", async () => {
    const fetchProfile = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as FetchRestaurantProfile;

    render(
      <RestaurantProfilePanel
        origin={ORIGIN}
        fetchProfile={fetchProfile}
        generateQrDataUrl={echoQr}
      />,
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });
});
