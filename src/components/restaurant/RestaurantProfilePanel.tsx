// ─────────────────────────────────────────────────────────────────────────────
// RestaurantProfilePanel.tsx — the `Restaurant Profile` Settings sub-tab
// (Req 2.1-2.24).
//
// This panel is ALWAYS reachable for any account that reached Settings (Req
// 2.1). It carries four concerns, each mapped to the approved requirements:
//
//   1. Booking portal (Req 2.2-2.4): the exact Booking_Portal_Link is rendered
//      as selectable text, copied to the clipboard on demand with a cleanup-safe
//      two-second confirmation, and encoded into a scannable QR code. The link
//      is built ONCE from the browser origin plus the server-provided
//      `/book/{tenantId}` path, and the SAME exact string feeds the selectable
//      text, the clipboard, and the QR encoder — never a retyped literal.
//
//   2. Tenant profile (Req 2.5-2.9): the eleven stored fields render editable
//      when `restaurant_config` resolves `operate`, and read-only with a
//      view-only message and NO save control otherwise.
//
//   3. Profile photo (Req 2.10-2.12): an `operate` account may upload a
//      JPEG/PNG/WEBP photo of at most 5 MB; a rejected upload shows the exact
//      size/format message and retains the stored photo. The server performs the
//      authoritative validation and returns the outcome.
//
//   4. Account security (Req 2.13-2.24): the email-change (verification code +
//      resend timing) and password-change controls are rendered for EVERY
//      account independent of config permission.
//
// Every server interaction is an injected callback with a production default, so
// the DOM suite drives request/response timing exactly like
// `book.$tenantId.restaurant.test.tsx` does for the public booking form.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  QrCode,
  Upload,
  User,
} from "lucide-react";
import QRCode from "qrcode";
import {
  changeOwnPasswordServerFn,
  confirmAccountEmailChangeServerFn,
  getRestaurantProfileServerFn,
  requestAccountEmailChangeServerFn,
  resendAccountEmailChangeServerFn,
  saveRestaurantProfileServerFn,
  uploadRestaurantProfilePhotoServerFn,
  type AccountEmailChangeConfirmResult,
  type AccountEmailChangeRequestResult,
  type AccountPasswordChangeResult,
  type RestaurantProfilePhotoResult,
  type RestaurantProfileView,
} from "../../lib/restaurant-settings";
import type {
  RestaurantProfile,
  RestaurantProfileInput,
} from "../../lib/restaurant-settings-model";
import { cn } from "../../lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Injectable callback contracts. Each mirrors the matching `createServerFn`
// signature so the production server functions drop in as the default and a
// fake drops in for the DOM suite.
// ─────────────────────────────────────────────────────────────────────────────

export type FetchRestaurantProfile = (opts?: {
  data?: { requestedLocationId?: string | null };
}) => Promise<RestaurantProfileView>;

export type SaveRestaurantProfile = (opts: {
  data: { profile: RestaurantProfileInput; requestedLocationId?: string | null };
}) => Promise<RestaurantProfileView>;

export type UploadRestaurantProfilePhoto = (opts: {
  data: { dataUrl: string; requestedLocationId?: string | null };
}) => Promise<RestaurantProfilePhotoResult>;

export type RequestAccountEmailChange = (opts: {
  data: { email: string; requestedLocationId?: string | null };
}) => Promise<AccountEmailChangeRequestResult>;

export type ResendAccountEmailChange = (opts?: {
  data?: { requestedLocationId?: string | null };
}) => Promise<AccountEmailChangeRequestResult>;

export type ConfirmAccountEmailChange = (opts: {
  data: { email: string; code: string; requestedLocationId?: string | null };
}) => Promise<AccountEmailChangeConfirmResult>;

export type ChangeOwnPassword = (opts: {
  data: {
    currentPassword: string;
    newPassword: string;
    confirmation: string;
    requestedLocationId?: string | null;
  };
}) => Promise<AccountPasswordChangeResult>;

/** Encodes the exact booking link into a scannable image data URL. */
export type GenerateQrDataUrl = (link: string) => Promise<string>;

/** Reads a selected file into a `data:<mime>;base64,...` URL for upload. */
export type ReadFileAsDataUrl = (file: File) => Promise<string>;

// ─────────────────────────────────────────────────────────────────────────────
// Field inventory (Req 2.5). The order is stable so the read-only and editable
// renders show the same eleven fields in the same places.
// ─────────────────────────────────────────────────────────────────────────────

const PROFILE_FIELDS: ReadonlyArray<{
  key: keyof RestaurantProfile;
  label: string;
  multiline?: boolean;
  type?: string;
}> = [
  { key: "restaurantName", label: "Restaurant name" },
  { key: "ownerOrManagerName", label: "Owner or manager name" },
  { key: "accountPhone", label: "Account phone" },
  { key: "teamSize", label: "Team size" },
  { key: "publicEmail", label: "Public email", type: "email" },
  { key: "contactNumber", label: "Contact number" },
  { key: "whatsappNumber", label: "WhatsApp number" },
  { key: "landline", label: "Landline" },
  { key: "address", label: "Address", multiline: true },
  { key: "cuisineOrServices", label: "Cuisine or services" },
  { key: "description", label: "Description", multiline: true },
];

/** The three image MIME types the profile photo control offers and accepts. */
const ACCEPTED_PHOTO_TYPES = "image/jpeg,image/png,image/webp";

const inputClass =
  "mt-1 block w-full rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 focus:border-brand focus:outline-none transition-all disabled:bg-zinc-50 disabled:text-zinc-500";
const labelClass = "text-[10px] font-bold uppercase tracking-wider text-zinc-400 pl-1";
const cardClass = "rounded-2xl border border-zinc-200 bg-white p-5";
const sectionHeadingClass =
  "flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400";

/** The clipboard-copied confirmation window (Req 2.4). */
export const COPY_CONFIRMATION_MS = 2000;

function errorText(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message.trim() || fallback;
}

/** Default browser origin; overridable so the DOM suite pins a known origin. */
function browserOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

const defaultGenerateQrDataUrl: GenerateQrDataUrl = (link) =>
  QRCode.toDataURL(link, { width: 160, margin: 1 });

const defaultReadFileAsDataUrl: ReadFileAsDataUrl = (file) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the selected file"));
    reader.readAsDataURL(file);
  });

export interface RestaurantProfilePanelProps {
  /** Owner-selected branch scope; forwarded verbatim to every server call. */
  requestedLocationId?: string | null;
  /** Browser origin used to build the exact booking link; defaults to the window. */
  origin?: string;
  fetchProfile?: FetchRestaurantProfile;
  saveProfile?: SaveRestaurantProfile;
  uploadPhoto?: UploadRestaurantProfilePhoto;
  requestEmailChange?: RequestAccountEmailChange;
  resendEmailChange?: ResendAccountEmailChange;
  confirmEmailChange?: ConfirmAccountEmailChange;
  changePassword?: ChangeOwnPassword;
  generateQrDataUrl?: GenerateQrDataUrl;
  readFileAsDataUrl?: ReadFileAsDataUrl;
}

export function RestaurantProfilePanel({
  requestedLocationId = null,
  origin,
  fetchProfile = getRestaurantProfileServerFn as unknown as FetchRestaurantProfile,
  saveProfile = saveRestaurantProfileServerFn as unknown as SaveRestaurantProfile,
  uploadPhoto = uploadRestaurantProfilePhotoServerFn as unknown as UploadRestaurantProfilePhoto,
  requestEmailChange = requestAccountEmailChangeServerFn as unknown as RequestAccountEmailChange,
  resendEmailChange = resendAccountEmailChangeServerFn as unknown as ResendAccountEmailChange,
  confirmEmailChange = confirmAccountEmailChangeServerFn as unknown as ConfirmAccountEmailChange,
  changePassword = changeOwnPasswordServerFn as unknown as ChangeOwnPassword,
  generateQrDataUrl = defaultGenerateQrDataUrl,
  readFileAsDataUrl = defaultReadFileAsDataUrl,
}: RestaurantProfilePanelProps) {
  const [view, setView] = useState<RestaurantProfileView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchProfile({ data: { requestedLocationId } });
      setView(res);
    } catch (err) {
      setLoadError(errorText(err, "Could not load the restaurant profile"));
    } finally {
      setLoading(false);
    }
  }, [fetchProfile, requestedLocationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
        <span className="sr-only">Loading the restaurant profile</span>
      </div>
    );
  }

  if (loadError || !view) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700"
      >
        <AlertCircle className="h-4 w-4" /> {loadError ?? "Could not load the restaurant profile"}
      </div>
    );
  }

  const resolvedOrigin = origin ?? browserOrigin();
  // The one exact Booking_Portal_Link — origin + server path. Everything the
  // panel copies, renders, and encodes uses THIS string (Req 2.2-2.4).
  const bookingLink = `${resolvedOrigin}${view.bookingPath}`;

  return (
    <div className="space-y-6">
      <BookingPortalSection bookingLink={bookingLink} generateQrDataUrl={generateQrDataUrl} />

      <hr className="border-zinc-105" />

      <ProfilePhotoSection
        view={view}
        requestedLocationId={requestedLocationId}
        uploadPhoto={uploadPhoto}
        readFileAsDataUrl={readFileAsDataUrl}
        onPhotoChange={(photo) => setView((v) => (v ? { ...v, profilePhoto: photo } : v))}
      />

      <hr className="border-zinc-105" />

      <ProfileFieldsSection
        view={view}
        requestedLocationId={requestedLocationId}
        saveProfile={saveProfile}
        onSaved={(next) => setView(next)}
      />

      <hr className="border-zinc-105" />

      <AccountSecuritySection
        view={view}
        requestedLocationId={requestedLocationId}
        requestEmailChange={requestEmailChange}
        resendEmailChange={resendEmailChange}
        confirmEmailChange={confirmEmailChange}
        changePassword={changePassword}
        onEmailChanged={(email) => setView((v) => (v ? { ...v, accountEmail: email } : v))}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Booking portal (Req 2.2-2.4)
// ─────────────────────────────────────────────────────────────────────────────

function BookingPortalSection({
  bookingLink,
  generateQrDataUrl,
}: {
  bookingLink: string;
  generateQrDataUrl: GenerateQrDataUrl;
}) {
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);
  // Cleanup-safe copied timer: the handle is cleared on unmount and before a
  // fresh copy, so a late timeout can never touch an unmounted component (Req 2.4).
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  // The QR encodes exactly the same link as the selectable text and clipboard.
  useEffect(() => {
    let cancelled = false;
    setQrError(false);
    generateQrDataUrl(bookingLink)
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingLink, generateQrDataUrl]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(bookingLink);
    } catch {
      // Clipboard permission failures still flash the confirmation so the user
      // is not left without feedback; the link stays selectable to copy by hand.
    }
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), COPY_CONFIRMATION_MS);
  }, [bookingLink]);

  return (
    <section className="space-y-4" aria-labelledby="booking-portal-heading">
      <div className={sectionHeadingClass}>
        <Building2 className="h-4 w-4 text-brand" />
        <h4 id="booking-portal-heading">Booking portal</h4>
      </div>

      <div className="space-y-1.5">
        <span className={labelClass}>Booking form URL</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            aria-label="Booking portal link"
            data-testid="booking-portal-link"
            value={bookingLink}
            readOnly
            className="w-full select-all rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-750 focus:outline-none"
          />
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-zinc-950 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-zinc-850 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> Copy link
              </>
            )}
          </button>
        </div>
        {/* Accessible confirmation of the copy action (Req 2.4). */}
        <span role="status" aria-live="polite" className="sr-only">
          {copied ? "Booking link copied to clipboard" : ""}
        </span>
      </div>

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-150 bg-zinc-50 p-4 sm:flex-row">
        <div className="shrink-0 rounded-xl border border-zinc-200 bg-white p-2.5">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="Booking portal QR code"
              data-testid="booking-portal-qr"
              className="h-24 w-24 object-contain"
            />
          ) : qrError ? (
            <div
              className="flex h-24 w-24 items-center justify-center text-center text-[10px] font-semibold text-zinc-400"
              role="img"
              aria-label="Booking portal QR code unavailable"
            >
              QR unavailable
            </div>
          ) : (
            <div className="flex h-24 w-24 items-center justify-center" aria-hidden="true">
              <QrCode className="h-8 w-8 text-zinc-300" />
            </div>
          )}
        </div>
        <div className="w-full space-y-1 text-left">
          <h5 className="text-xs font-bold text-zinc-850">Restaurant booking QR code</h5>
          <p className="text-[10px] leading-normal text-zinc-400">
            Display or print this QR code. Guests scan it with any phone to open your booking portal
            and reserve a table.
          </p>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile photo (Req 2.10-2.12)
//
// The upload control is present only for an `operate` account. The server
// validates decoded bytes and MIME and returns the outcome: `uploaded` swaps in
// the new URL, while `invalid`/`upload_failed` show the returned message and
// leave the stored photo unchanged.
// ─────────────────────────────────────────────────────────────────────────────

function ProfilePhotoSection({
  view,
  requestedLocationId,
  uploadPhoto,
  readFileAsDataUrl,
  onPhotoChange,
}: {
  view: RestaurantProfileView;
  requestedLocationId: string | null;
  uploadPhoto: UploadRestaurantProfilePhoto;
  readFileAsDataUrl: ReadFileAsDataUrl;
  onPhotoChange: (photo: string | null) => void;
}) {
  const canUpload = view.capability.canUploadProfilePhoto;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);
      setSuccess(null);
      setUploading(true);
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const result = await uploadPhoto({ data: { dataUrl, requestedLocationId } });
        if (result.status === "uploaded") {
          onPhotoChange(result.profilePhoto);
          setSuccess("Profile photo updated");
        } else {
          // Rejected upload: show the exact size/format message and keep the
          // stored photo unchanged (Req 2.12).
          setError(result.message ?? "The profile photo could not be uploaded");
        }
      } catch (err) {
        setError(errorText(err, "The profile photo could not be uploaded"));
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [onPhotoChange, readFileAsDataUrl, requestedLocationId, uploadPhoto],
  );

  return (
    <section className="space-y-3" aria-labelledby="profile-photo-heading">
      <div className={sectionHeadingClass}>
        <User className="h-4 w-4 text-brand" />
        <h4 id="profile-photo-heading">Profile photo</h4>
      </div>

      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-zinc-200 bg-zinc-100">
            {view.profilePhoto ? (
              <img
                src={view.profilePhoto}
                alt="Profile photo"
                data-testid="profile-photo"
                className="h-full w-full object-cover"
              />
            ) : (
              <User className="h-8 w-8 text-zinc-300" aria-hidden="true" />
            )}
          </div>
        </div>

        {canUpload ? (
          <div className="space-y-2">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_PHOTO_TYPES}
              aria-label="Upload profile photo"
              data-testid="profile-photo-input"
              disabled={uploading}
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2 text-[11px] font-bold text-white transition-all hover:bg-zinc-850 disabled:opacity-50 cursor-pointer"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Upload photo
            </button>
            <p className="text-[10px] font-semibold text-zinc-400">
              JPEG, PNG, or WEBP · up to 5 MB
            </p>
          </div>
        ) : (
          <p className="text-[11px] font-semibold text-zinc-400">
            Your role can view but not change the profile photo.
          </p>
        )}
      </div>

      <div aria-live="polite" role="status">
        {error && (
          <p className="flex items-center gap-1 text-[11px] font-bold text-rose-600" role="alert">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </p>
        )}
        {success && (
          <p className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> {success}
          </p>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant profile fields (Req 2.5-2.9)
//
// Editable with a save control only when `restaurant_config` resolves `operate`
// (`canSave`). Under `view_only`/`none` the same eleven fields render read-only
// with the view-only message and NO save control.
// ─────────────────────────────────────────────────────────────────────────────

function ProfileFieldsSection({
  view,
  requestedLocationId,
  saveProfile,
  onSaved,
}: {
  view: RestaurantProfileView;
  requestedLocationId: string | null;
  saveProfile: SaveRestaurantProfile;
  onSaved: (next: RestaurantProfileView) => void;
}) {
  const editable = view.capability.canEditProfile && view.canSave;
  const [draft, setDraft] = useState<RestaurantProfile>(view.profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Keep the draft in step with a fresh server view (e.g. after a branch change).
  useEffect(() => {
    setDraft(view.profile);
  }, [view.profile]);

  const update = (key: keyof RestaurantProfile, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSuccess(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editable) return;
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const next = await saveProfile({
        data: { profile: draft as RestaurantProfileInput, requestedLocationId },
      });
      onSaved(next);
      setDraft(next.profile);
      setSuccess("Restaurant details saved");
    } catch (err) {
      setError(errorText(err, "Could not save the restaurant details"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit} aria-labelledby="profile-fields-heading">
      <div className="flex items-center justify-between">
        <div className={sectionHeadingClass}>
          <Building2 className="h-4 w-4 text-brand" />
          <h4 id="profile-fields-heading">Restaurant details{!editable && " · view only"}</h4>
        </div>
      </div>

      {/* Req 2.9 — the view-only message when the role can view but not change. */}
      {view.capability.viewOnlyMessage && (
        <p
          data-testid="profile-view-only-message"
          className="flex items-center gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700"
        >
          <Lock className="h-3.5 w-3.5" /> {view.capability.viewOnlyMessage}
        </p>
      )}

      <div className={cn(cardClass, "grid grid-cols-1 gap-4 sm:grid-cols-2")}>
        {PROFILE_FIELDS.map((field) => {
          const value = draft[field.key] ?? "";
          const inputId = `profile-${field.key}`;
          return (
            <label
              key={field.key}
              htmlFor={inputId}
              className={cn("block", field.multiline && "sm:col-span-2")}
            >
              <span className={labelClass}>{field.label}</span>
              {field.multiline ? (
                <textarea
                  id={inputId}
                  value={value}
                  readOnly={!editable}
                  disabled={!editable}
                  rows={3}
                  onChange={(e) => update(field.key, e.target.value)}
                  className={cn(inputClass, "resize-y")}
                />
              ) : (
                <input
                  id={inputId}
                  type={field.type ?? "text"}
                  value={value}
                  readOnly={!editable}
                  disabled={!editable}
                  onChange={(e) => update(field.key, e.target.value)}
                  className={inputClass}
                />
              )}
            </label>
          );
        })}
      </div>

      <div aria-live="polite" role="status">
        {error && (
          <p className="flex items-center gap-1 text-[11px] font-bold text-rose-600" role="alert">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </p>
        )}
        {success && (
          <p className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> {success}
          </p>
        )}
      </div>

      {/* No save control at all unless config resolves `operate` (Req 2.9). */}
      {editable && (
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-[11px] font-bold text-white transition-all hover:bg-zinc-850 disabled:opacity-50 cursor-pointer"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save restaurant details
          </button>
        </div>
      )}
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Account security (Req 2.13-2.24)
//
// Always rendered, independent of config permission. Email change issues a
// verification code (Req 2.14-2.20) with a resend control that becomes usable
// 60 seconds after a send (Req 2.16); password change verifies the current
// password and enforces the length/confirmation rules (Req 2.21-2.24).
// ─────────────────────────────────────────────────────────────────────────────

function AccountSecuritySection({
  view,
  requestedLocationId,
  requestEmailChange,
  resendEmailChange,
  confirmEmailChange,
  changePassword,
  onEmailChanged,
}: {
  view: RestaurantProfileView;
  requestedLocationId: string | null;
  requestEmailChange: RequestAccountEmailChange;
  resendEmailChange: ResendAccountEmailChange;
  confirmEmailChange: ConfirmAccountEmailChange;
  changePassword: ChangeOwnPassword;
  onEmailChanged: (email: string) => void;
}) {
  return (
    <section className="space-y-5" aria-labelledby="account-security-heading">
      <div className={sectionHeadingClass}>
        <Lock className="h-4 w-4 text-brand" />
        <h4 id="account-security-heading">Account security</h4>
      </div>

      <EmailChangeForm
        currentEmail={view.accountEmail}
        requestedLocationId={requestedLocationId}
        requestEmailChange={requestEmailChange}
        resendEmailChange={resendEmailChange}
        confirmEmailChange={confirmEmailChange}
        onEmailChanged={onEmailChanged}
      />

      <PasswordChangeForm
        requestedLocationId={requestedLocationId}
        changePassword={changePassword}
      />
    </section>
  );
}

function EmailChangeForm({
  currentEmail,
  requestedLocationId,
  requestEmailChange,
  resendEmailChange,
  confirmEmailChange,
  onEmailChanged,
}: {
  currentEmail: string;
  requestedLocationId: string | null;
  requestEmailChange: RequestAccountEmailChange;
  resendEmailChange: ResendAccountEmailChange;
  confirmEmailChange: ConfirmAccountEmailChange;
  onEmailChanged: (email: string) => void;
}) {
  const [emailInput, setEmailInput] = useState("");
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resendAvailableAtMs, setResendAvailableAtMs] = useState<number | null>(null);
  const [resendRemaining, setResendRemaining] = useState(0);

  // Cleanup-safe resend countdown: recomputes each second while a code is
  // pending, and clears itself on unmount or once the boundary passes (Req 2.16).
  useEffect(() => {
    if (resendAvailableAtMs === null) {
      setResendRemaining(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((resendAvailableAtMs - Date.now()) / 1000));
      setResendRemaining(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [resendAvailableAtMs]);

  const applyRequestResult = (result: AccountEmailChangeRequestResult, target: string) => {
    if (result.status === "code_sent") {
      setPendingTarget(result.targetEmail ?? target);
      setResendAvailableAtMs(result.resendAvailableAtMs);
      setNotice(`Verification code sent to ${result.targetEmail ?? target}`);
      setError(null);
    } else {
      // email_current, email_in_use, resend_too_soon, no_pending — no code sent.
      setError(result.message ?? "The verification code could not be sent");
      setNotice(null);
      if (result.resendAvailableAtMs !== null) setResendAvailableAtMs(result.resendAvailableAtMs);
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSuccess(null);
    setRequesting(true);
    try {
      const target = emailInput.trim();
      const result = await requestEmailChange({ data: { email: target, requestedLocationId } });
      applyRequestResult(result, target);
    } catch (err) {
      setError(errorText(err, "The verification code could not be sent"));
    } finally {
      setRequesting(false);
    }
  };

  const resend = async () => {
    if (resendRemaining > 0) return;
    setError(null);
    setNotice(null);
    setRequesting(true);
    try {
      const result = await resendEmailChange({ data: { requestedLocationId } });
      applyRequestResult(result, pendingTarget ?? "");
    } catch (err) {
      setError(errorText(err, "The verification code could not be resent"));
    } finally {
      setRequesting(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingTarget) return;
    setError(null);
    setNotice(null);
    setSuccess(null);
    setConfirming(true);
    try {
      const result = await confirmEmailChange({
        data: { email: pendingTarget, code: codeInput.trim(), requestedLocationId },
      });
      if (result.status === "updated") {
        onEmailChanged(result.email);
        setSuccess(`Account email changed to ${result.email}`);
        setPendingTarget(null);
        setEmailInput("");
        setCodeInput("");
        setResendAvailableAtMs(null);
      } else {
        // invalid_code, email_in_use, not_found — the stored email is unchanged.
        setError(result.message ?? "The verification code is invalid or expired");
      }
    } catch (err) {
      setError(errorText(err, "The verification code is invalid or expired"));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className={cn(cardClass, "space-y-4")}>
      <div className="flex items-center gap-2">
        <Mail className="h-3.5 w-3.5 text-zinc-500" />
        <h5 className="text-xs font-bold text-zinc-850">Login email</h5>
      </div>
      <p className="text-[11px] font-semibold text-zinc-500">
        Current: <span data-testid="account-email">{currentEmail || "—"}</span>
      </p>

      <form className="space-y-3" onSubmit={send}>
        <label htmlFor="account-new-email" className="block">
          <span className={labelClass}>New email address</span>
          <input
            id="account-new-email"
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="new.address@example.com"
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={requesting || emailInput.trim().length === 0}
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2 text-[11px] font-bold text-white transition-all hover:bg-zinc-850 disabled:opacity-50 cursor-pointer"
        >
          {requesting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Send verification code
        </button>
      </form>

      {pendingTarget && (
        <form className="space-y-3 border-t border-zinc-100 pt-3" onSubmit={confirm}>
          <label htmlFor="account-email-code" className="block">
            <span className={labelClass}>Verification code</span>
            <input
              id="account-email-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="4-digit code"
              className={inputClass}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={confirming || codeInput.trim().length === 0}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2 text-[11px] font-bold text-white transition-all hover:bg-zinc-850 disabled:opacity-50 cursor-pointer"
            >
              {confirming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Confirm new email
            </button>
            <button
              type="button"
              onClick={resend}
              disabled={requesting || resendRemaining > 0}
              data-testid="resend-code"
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-[11px] font-bold text-zinc-600 transition-all hover:bg-zinc-50 disabled:opacity-50 cursor-pointer"
            >
              {resendRemaining > 0 ? `Resend in ${resendRemaining}s` : "Resend code"}
            </button>
          </div>
        </form>
      )}

      <div aria-live="polite" role="status">
        {notice && <p className="text-[11px] font-semibold text-zinc-500">{notice}</p>}
        {error && (
          <p className="flex items-center gap-1 text-[11px] font-bold text-rose-600" role="alert">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </p>
        )}
        {success && (
          <p className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> {success}
          </p>
        )}
      </div>
    </div>
  );
}

function PasswordChangeForm({
  requestedLocationId,
  changePassword,
}: {
  requestedLocationId: string | null;
  changePassword: ChangeOwnPassword;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const result = await changePassword({
        data: { currentPassword, newPassword, confirmation, requestedLocationId },
      });
      if (result.status === "updated") {
        setSuccess("Password changed");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmation("");
      } else {
        const map: Record<string, string> = {};
        for (const fe of result.fieldErrors) if (!map[fe.field]) map[fe.field] = fe.message;
        setFieldErrors(map);
        // A non-field failure (or a summary) still surfaces the message.
        if (result.fieldErrors.length === 0 && result.message) setError(result.message);
      }
    } catch (err) {
      setError(errorText(err, "Could not change the password"));
    } finally {
      setSubmitting(false);
    }
  };

  const fields: ReadonlyArray<{
    key: "currentPassword" | "newPassword" | "confirmation";
    label: string;
    value: string;
    set: (v: string) => void;
  }> = [
    {
      key: "currentPassword",
      label: "Current password",
      value: currentPassword,
      set: setCurrentPassword,
    },
    { key: "newPassword", label: "New password", value: newPassword, set: setNewPassword },
    {
      key: "confirmation",
      label: "Confirm new password",
      value: confirmation,
      set: setConfirmation,
    },
  ];

  return (
    <form className={cn(cardClass, "space-y-4")} onSubmit={submit}>
      <div className="flex items-center gap-2">
        <KeyRound className="h-3.5 w-3.5 text-zinc-500" />
        <h5 className="text-xs font-bold text-zinc-850">Password</h5>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {fields.map((field) => {
          const inputId = `account-${field.key}`;
          const message = fieldErrors[field.key];
          return (
            <label key={field.key} htmlFor={inputId} className="block">
              <span className={labelClass}>{field.label}</span>
              <input
                id={inputId}
                type="password"
                autoComplete={field.key === "currentPassword" ? "current-password" : "new-password"}
                value={field.value}
                onChange={(e) => field.set(e.target.value)}
                className={cn(inputClass, message && "border-rose-300")}
              />
              {message && (
                <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-rose-600">
                  <AlertCircle className="h-3 w-3" /> {message}
                </span>
              )}
            </label>
          );
        })}
      </div>

      <div aria-live="polite" role="status">
        {error && (
          <p className="flex items-center gap-1 text-[11px] font-bold text-rose-600" role="alert">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </p>
        )}
        {success && (
          <p className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> {success}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-[11px] font-bold text-white transition-all hover:bg-zinc-850 disabled:opacity-50 cursor-pointer"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Change password
        </button>
      </div>
    </form>
  );
}

export default RestaurantProfilePanel;
