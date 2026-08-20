/**
 * Pure contracts and shared primitives for restaurant dashboard settings.
 *
 * This module is intentionally isomorphic and I/O-free. It must not depend on
 * database, authentication, React, clocks, or network adapters.
 */

// ---------------------------------------------------------------------------
// Result and permission contracts
// ---------------------------------------------------------------------------

/** A stable field-level validation failure. */
export interface FieldError<Field extends string = string> {
  field: Field;
  message: string;
}

/** Every pure validator returns this discriminated result and never throws. */
export type Result<T, Field extends string = string> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldError<Field>[] };

/** Permission level resolved by the Feature Access Service. */
export type Permission = "operate" | "view_only" | "none";

export type SettingsFeature = "restaurant_config" | "users" | "locations" | "whatsapp";

export interface FeaturePermission {
  available: boolean;
  permission: Permission;
  visible: boolean;
}

export type RestaurantSettingsPermissions = Record<SettingsFeature, FeaturePermission>;

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<Field extends string = string>(
  errors: readonly FieldError<Field>[],
): Result<never, Field> {
  return { ok: false, errors: errors.map((error) => ({ ...error })) };
}

// ---------------------------------------------------------------------------
// Exact bounds and defaults
// ---------------------------------------------------------------------------

/** Every inclusive settings bound stated by the requirements. */
export const RESTAURANT_SETTINGS_LIMITS = {
  operatingHoursDays: 7,
  areaName: { min: 1, max: 30 },
  displayOrder: { min: 1, max: 999 },
  closureReason: { max: 100 },
  menuCategoryName: { min: 1, max: 40 },
  menuItemName: { min: 1, max: 80 },
  menuItemPriceMinor: { min: 0, max: 10_000_000 },
  menuItemDescription: { max: 300 },
  menuCategoriesPerTenant: 40,
  menuItemsPerTenant: 500,
  profilePhotoBytes: 5 * 1024 * 1024,
  verificationCodeDigits: 4,
  verificationCodeValidityMs: 5 * 60 * 1000,
  verificationResendDelayMs: 60 * 1000,
  passwordLength: { min: 8 },
} as const;

/** Short alias used by validators in this domain. */
export const LIMITS = RESTAURANT_SETTINGS_LIMITS;

export const DEFAULT_DINING_AREA_NAME = "Main";
export const DEFAULT_DISPLAY_ORDER = 1;
export const DEFAULT_CLOSURE_REASON = "";
export const DEFAULT_MENU_ITEM_DESCRIPTION = "";
export const DEFAULT_MENU_ITEM_STATE = "available" as const;

export const PROFILE_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ProfilePhotoMimeType = (typeof PROFILE_PHOTO_MIME_TYPES)[number];

export const SUB_USER_ROLES = ["reception", "doctor"] as const;
export type SubUserRole = (typeof SUB_USER_ROLES)[number];
export type UserPlanTier = "Basic" | "Premium" | "Enterprise";

/** Per-role account maxima; `null` means unlimited. */
export const SUB_USER_PLAN_MAXIMUMS: Record<
  UserPlanTier,
  Readonly<Record<SubUserRole, number | null>>
> = {
  Basic: { doctor: 1, reception: 0 },
  Premium: { doctor: 5, reception: null },
  Enterprise: { doctor: null, reception: null },
};

export const DEFAULT_SUB_USER_ACTIVE = true;

export const MENU_ITEM_STATES = ["available", "unavailable"] as const;
export type MenuItemState = (typeof MENU_ITEM_STATES)[number];

export const ACCOUNT_TYPES = ["user", "sub_user", "location"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

// ---------------------------------------------------------------------------
// Location scope and resource contracts
// ---------------------------------------------------------------------------

/** `null` identifies the owner's unscoped primary restaurant resources. */
export type LocationScope = string | null;

export interface RestaurantResourceScope {
  tenantId: string;
  locationId: LocationScope;
}

export interface LocationScoped {
  locationId: LocationScope;
}

export type TenantLocationScoped = RestaurantResourceScope;

// ---------------------------------------------------------------------------
// Dining area contracts
// ---------------------------------------------------------------------------

export interface DiningArea extends LocationScoped {
  id: string;
  name: string;
  displayOrder: number;
  tableCount: number;
}

export interface DiningAreaInput {
  name: unknown;
  displayOrder?: unknown;
}

export interface ExistingAreaName {
  id: string;
  name: string;
}

export interface AreaContext {
  existingNames: readonly ExistingAreaName[];
  editingId?: string | null;
  highestDisplayOrder?: number | null;
}

export interface NormalisedDiningArea {
  name: string;
  displayOrder: number;
}

// ---------------------------------------------------------------------------
// Closure contracts
// ---------------------------------------------------------------------------

export type ClosureScope = { type: "restaurant" } | { type: "table"; tableId: string };

export interface ClosureDay extends LocationScoped {
  id: string;
  date: string;
  scope: ClosureScope;
  reason: string;
  isHoliday: boolean;
  affectedBookingCount: number;
}

export interface ClosureDayInput {
  date: unknown;
  scope: unknown;
  reason?: unknown;
  isHoliday?: unknown;
}

export interface NormalisedClosureDay {
  date: string;
  scope: ClosureScope;
  reason: string;
  isHoliday: boolean;
}

// ---------------------------------------------------------------------------
// Menu contracts
// ---------------------------------------------------------------------------

export interface MenuItem extends LocationScoped {
  id: string;
  categoryId: string;
  name: string;
  priceMinor: number;
  description: string;
  displayOrder: number;
  state: MenuItemState;
}

export interface MenuCategory extends LocationScoped {
  id: string;
  name: string;
  displayOrder: number;
  items: MenuItem[];
}

export interface MenuCategoryInput {
  name: unknown;
  displayOrder?: unknown;
}

export interface MenuItemInput {
  categoryId: unknown;
  name: unknown;
  priceMinor: unknown;
  description?: unknown;
  displayOrder?: unknown;
  state?: unknown;
}

export interface ExistingMenuCategoryName {
  id: string;
  name: string;
}

export interface MenuContext {
  existingCategoryNames: readonly ExistingMenuCategoryName[];
  editingCategoryId?: string | null;
  editingItemId?: string | null;
  categoryCount: number;
  itemCount: number;
  highestCategoryDisplayOrder?: number | null;
  highestItemDisplayOrder?: number | null;
  validCategoryIds?: readonly string[];
}

export interface NormalisedMenuCategory {
  name: string;
  displayOrder: number;
}

export interface NormalisedMenuItem {
  categoryId: string;
  name: string;
  priceMinor: number;
  description: string;
  displayOrder: number;
  state: MenuItemState;
}

export interface MenuCategoryDeletionPreview {
  categoryId: string;
  itemCount: number;
  confirmationRequired: boolean;
}

// ---------------------------------------------------------------------------
// Profile and account-verification contracts
// ---------------------------------------------------------------------------

export interface RestaurantProfile {
  restaurantName: string;
  ownerOrManagerName: string;
  accountPhone: string;
  teamSize: string;
  publicEmail: string;
  contactNumber: string;
  whatsappNumber: string;
  landline: string;
  address: string;
  cuisineOrServices: string;
  description: string;
}

export type RestaurantProfileInput = { [Field in keyof RestaurantProfile]: unknown };
export type NormalisedRestaurantProfile = RestaurantProfile;

export interface ProfilePhotoInput {
  mimeType: unknown;
  byteLength: unknown;
}

export interface NormalisedProfilePhoto {
  mimeType: ProfilePhotoMimeType;
  byteLength: number;
}

export interface VerificationAccount {
  accountType: AccountType;
  accountId: string;
}

/** Stored timestamps are epoch milliseconds; callers inject the comparison time. */
export interface EmailVerification extends VerificationAccount {
  targetEmail: string;
  codeHash: string;
  issuedAtMs: number;
  expiresAtMs: number;
  resendAvailableAtMs: number;
  consumedAtMs: number | null;
}

export interface EmailVerificationBinding extends VerificationAccount {
  targetEmail: string;
}

export interface VerificationCodeInput extends EmailVerificationBinding {
  code: unknown;
}

export interface PasswordChangeInput {
  currentPassword: unknown;
  newPassword: unknown;
  confirmation: unknown;
}

// ---------------------------------------------------------------------------
// Sub-user and plan-limit contracts
// ---------------------------------------------------------------------------

export interface SubUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: SubUserRole;
  isActive: boolean;
}

export interface SubUserInput {
  name: unknown;
  email: unknown;
  phone?: unknown;
  role: unknown;
  password?: unknown;
  confirmation?: unknown;
  isActive?: unknown;
}

export interface NormalisedSubUser {
  name: string;
  email: string;
  phone: string;
  role: SubUserRole;
  password?: string;
  isActive: boolean;
}

export interface UserRoleLimit {
  role: SubUserRole;
  /** `null` means unlimited. */
  maximum: number | null;
  current: number;
  remaining: number | null;
  canCreate: boolean;
}

export interface SubUserPlanLimits {
  plan: UserPlanTier;
  doctor: UserRoleLimit;
  reception: UserRoleLimit;
  message: string;
}

export interface UserRoleCounts {
  doctor: number;
  reception: number;
}

// ---------------------------------------------------------------------------
// Stable validation and authorization messages
// ---------------------------------------------------------------------------

export const MSG_AREA_NAME_LENGTH = `Dining area name must be between ${LIMITS.areaName.min} and ${LIMITS.areaName.max} characters`;
export const MSG_AREA_ALREADY_EXISTS = "This dining area already exists";
export const MSG_DISPLAY_ORDER_RANGE = `Display order must be a whole number between ${LIMITS.displayOrder.min} and ${LIMITS.displayOrder.max}`;
export const MSG_CLOSURE_DATE = "Closure date must be an existing calendar date in YYYY-MM-DD form";
export const MSG_CLOSURE_REASON_LENGTH = `Closure reason must be at most ${LIMITS.closureReason.max} characters`;
export const MSG_CLOSURE_ALREADY_EXISTS = "This date is already blocked for the selected scope";
export const MSG_MENU_CATEGORY_NAME_LENGTH = `Menu category name must be between ${LIMITS.menuCategoryName.min} and ${LIMITS.menuCategoryName.max} characters`;
export const MSG_MENU_CATEGORY_ALREADY_EXISTS = "This menu category already exists";
export const MSG_MENU_ITEM_NAME_LENGTH = `Menu item name must be between ${LIMITS.menuItemName.min} and ${LIMITS.menuItemName.max} characters`;
export const MSG_MENU_ITEM_PRICE_RANGE = `Menu item price must be a whole number between ${LIMITS.menuItemPriceMinor.min} and ${LIMITS.menuItemPriceMinor.max} minor units`;
export const MSG_MENU_ITEM_DESCRIPTION_LENGTH = `Menu item description must be at most ${LIMITS.menuItemDescription.max} characters`;
export const MSG_MENU_ITEM_STATE = `Menu item state must be one of ${MENU_ITEM_STATES.join(", ")}`;
export const MSG_MAX_MENU_CATEGORIES = `A restaurant can store at most ${LIMITS.menuCategoriesPerTenant} menu categories`;
export const MSG_MAX_MENU_ITEMS = `A restaurant can store at most ${LIMITS.menuItemsPerTenant} menu items`;
export const MSG_OPERATING_HOURS_SEVEN_DAYS = `Operating hours must contain exactly ${LIMITS.operatingHoursDays} weekdays`;
export const MSG_PROFILE_PHOTO = `Profile photo must be JPEG, PNG, or WEBP and at most 5 megabytes`;
export const MSG_VERIFICATION_CODE = `Verification code must contain exactly ${LIMITS.verificationCodeDigits} numeric digits`;
export const MSG_EMAIL_ALREADY_CURRENT = "This email address is already registered to your account";
export const MSG_EMAIL_ALREADY_IN_USE = "This email address is registered to another account";
export const MSG_VERIFICATION_INVALID_OR_EXPIRED = "The verification code is invalid or expired";
export const MSG_PASSWORD_MIN_LENGTH = `Password must be at least ${LIMITS.passwordLength.min} characters`;
export const MSG_PASSWORDS_DO_NOT_MATCH = "Passwords do not match";
export const MSG_CURRENT_PASSWORD_INCORRECT = "The current password is incorrect";
export const MSG_SUB_USER_ROLE = `Role must be one of ${SUB_USER_ROLES.join(", ")}`;
export const MSG_SUB_USER_EMAIL_IN_USE = "This email address is already in use";
export const MSG_SUB_USER_CREATE_FAILED = "The team member could not be created";
export const MSG_NOT_AUTHORISED_CONFIG = "You are not authorised to change booking rules";
export const MSG_NOT_AUTHORISED_USERS = "You are not authorised to change users";
export const MSG_NOT_AUTHORISED_LOCATIONS = "You are not authorised to change branches";
export const MSG_NOT_AUTHORISED_WHATSAPP = "You are not authorised to change WhatsApp settings";
export const MSG_SETTINGS_RESOURCE_NOT_FOUND = "Restaurant setting not found";

/** Stable field errors used directly by pure validators and UI field mapping. */
export const SETTINGS_FIELD_ERRORS = {
  areaName: { field: "name", message: MSG_AREA_NAME_LENGTH },
  displayOrder: { field: "displayOrder", message: MSG_DISPLAY_ORDER_RANGE },
  closureDate: { field: "date", message: MSG_CLOSURE_DATE },
  closureReason: { field: "reason", message: MSG_CLOSURE_REASON_LENGTH },
  menuCategoryName: { field: "name", message: MSG_MENU_CATEGORY_NAME_LENGTH },
  menuItemName: { field: "name", message: MSG_MENU_ITEM_NAME_LENGTH },
  menuItemPrice: { field: "priceMinor", message: MSG_MENU_ITEM_PRICE_RANGE },
  menuItemDescription: { field: "description", message: MSG_MENU_ITEM_DESCRIPTION_LENGTH },
  menuItemState: { field: "state", message: MSG_MENU_ITEM_STATE },
  profilePhoto: { field: "photo", message: MSG_PROFILE_PHOTO },
  verificationCode: { field: "code", message: MSG_VERIFICATION_CODE },
  passwordLength: { field: "newPassword", message: MSG_PASSWORD_MIN_LENGTH },
  passwordConfirmation: { field: "confirmation", message: MSG_PASSWORDS_DO_NOT_MATCH },
  subUserRole: { field: "role", message: MSG_SUB_USER_ROLE },
} as const satisfies Record<string, FieldError>;

// ---------------------------------------------------------------------------
// Dependency-free normalization helpers
// ---------------------------------------------------------------------------

/** Trims string input; non-string values normalize to the empty string. */
export function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Trims and lower-cases an email for case-insensitive identity comparisons. */
export function normaliseEmail(value: unknown): string {
  return trimmedString(value).toLowerCase();
}

/** Canonical key for case-insensitive, trim-insensitive name comparisons. */
export function normaliseNameKey(value: unknown): string {
  return trimmedString(value).toLowerCase();
}

/** Empty/invalid location ids map to the primary (`null`) scope. */
export function normaliseLocationScope(value: unknown): LocationScope {
  const locationId = trimmedString(value);
  return locationId.length > 0 ? locationId : null;
}

/** Produces a fresh field error so callers cannot mutate shared constants. */
export function fieldError<Field extends string>(field: Field, message: string): FieldError<Field> {
  return { field, message };
}

// ---------------------------------------------------------------------------
// Hours, closure, profile, and account-security helpers
// ---------------------------------------------------------------------------

export interface DayHours {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export interface HoursPreset {
  name: string;
  days: readonly DayHours[];
}

export interface NormalisedPasswordChange {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
}

export interface VerificationTiming {
  issuedAtMs: number;
  expiresAtMs: number;
  resendAvailableAtMs: number;
}

export interface NormalisedVerificationCodeInput extends EmailVerificationBinding {
  code: string;
}

export const RESTAURANT_WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const MSG_OPERATING_HOURS_TIME =
  "Open and close times must use HH:MM form and close time must be strictly later than open time";
export const MSG_OPERATING_HOURS_DAY = "Weekday must be a whole number from 0 through 6";
export const MSG_CLOSURE_SCOPE = "Closure scope must be the restaurant or one dining table";
export const MSG_CLOSURE_HOLIDAY = "Holiday flag must be true or false";

function presetDay(
  dayOfWeek: number,
  openTime: string,
  closeTime: string,
  isClosed = false,
): DayHours {
  return { dayOfWeek, openTime, closeTime, isClosed };
}

/** Requirement-provided shortcuts. Preset rows are immutable shared definitions. */
export const HOURS_PRESETS: readonly HoursPreset[] = [
  {
    name: "All Days 09:00–22:00",
    days: Array.from({ length: 7 }, (_, day) => presetDay(day, "09:00", "22:00")),
  },
  {
    name: "Weekdays 09:00–18:00",
    days: Array.from({ length: 7 }, (_, day) =>
      presetDay(day, "09:00", "18:00", day === 0 || day === 6),
    ),
  },
  {
    name: "Dinner Service 17:00–23:00",
    days: Array.from({ length: 7 }, (_, day) => presetDay(day, "17:00", "23:00")),
  },
] as const;

function cloneDayHours(day: DayHours): DayHours {
  return { ...day };
}

function parseStrictClock(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function weekdayError(day: number, detail = MSG_OPERATING_HOURS_TIME): FieldError {
  return fieldError(`hours.${day}`, `${RESTAURANT_WEEKDAY_NAMES[day]}: ${detail}`);
}

/** Strictly round-trips UTC calendar components instead of using permissive parsing. */
export function isExistingCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

/** Validates and normalizes a closure submission while reporting every bad field. */
export function validateClosureDay(
  input: unknown,
): Result<NormalisedClosureDay, "date" | "scope" | "reason" | "isHoliday"> {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const errors: FieldError<"date" | "scope" | "reason" | "isHoliday">[] = [];
  const date = typeof raw.date === "string" ? raw.date : "";
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : DEFAULT_CLOSURE_REASON;

  if (!isExistingCalendarDate(date)) errors.push(fieldError("date", MSG_CLOSURE_DATE));
  if (reason.length > LIMITS.closureReason.max) {
    errors.push(fieldError("reason", MSG_CLOSURE_REASON_LENGTH));
  }

  let scope: ClosureScope = { type: "restaurant" };
  const submittedScope = raw.scope;
  if (
    submittedScope &&
    typeof submittedScope === "object" &&
    (submittedScope as Record<string, unknown>).type === "restaurant"
  ) {
    scope = { type: "restaurant" };
  } else if (
    submittedScope &&
    typeof submittedScope === "object" &&
    (submittedScope as Record<string, unknown>).type === "table" &&
    trimmedString((submittedScope as Record<string, unknown>).tableId).length > 0
  ) {
    scope = {
      type: "table",
      tableId: trimmedString((submittedScope as Record<string, unknown>).tableId),
    };
  } else {
    errors.push(fieldError("scope", MSG_CLOSURE_SCOPE));
  }

  if (typeof raw.isHoliday !== "boolean") {
    errors.push(fieldError("isHoliday", MSG_CLOSURE_HOLIDAY));
  }

  if (errors.length > 0) return fail(errors);
  return ok({ date, scope, reason, isHoliday: raw.isHoliday as boolean });
}

/** Validates one apply-to-open-days time pair and returns all bad time fields. */
export function validateHoursPair(
  openTime: unknown,
  closeTime: unknown,
): Result<{ openTime: string; closeTime: string }, "openTime" | "closeTime"> {
  const errors: FieldError<"openTime" | "closeTime">[] = [];
  const open = parseStrictClock(openTime);
  const close = parseStrictClock(closeTime);

  if (open === null) errors.push(fieldError("openTime", MSG_OPERATING_HOURS_TIME));
  if (close === null) errors.push(fieldError("closeTime", MSG_OPERATING_HOURS_TIME));
  if (open !== null && close !== null && close <= open) {
    errors.push(fieldError("closeTime", MSG_OPERATING_HOURS_TIME));
  }
  if (errors.length > 0) return fail(errors);
  return ok({ openTime: openTime as string, closeTime: closeTime as string });
}

/**
 * Requires each weekday exactly once. Every missing, duplicate, malformed, or
 * invalid open weekday is reported; no submitted row is changed.
 */
export function validateRestaurantOperatingHours(input: unknown): Result<DayHours[]> {
  if (!Array.isArray(input)) {
    return fail([fieldError("hours", MSG_OPERATING_HOURS_SEVEN_DAYS)]);
  }

  const errors: FieldError[] = [];
  const rowsByDay = new Map<number, Record<string, unknown>[]>();
  if (input.length !== LIMITS.operatingHoursDays) {
    errors.push(fieldError("hours", MSG_OPERATING_HOURS_SEVEN_DAYS));
  }

  input.forEach((value, index) => {
    const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const day = raw.dayOfWeek;
    if (!Number.isInteger(day) || (day as number) < 0 || (day as number) > 6) {
      errors.push(fieldError(`hours.${index}.dayOfWeek`, MSG_OPERATING_HOURS_DAY));
      return;
    }
    const rows = rowsByDay.get(day as number) ?? [];
    rows.push(raw);
    rowsByDay.set(day as number, rows);
  });

  const days: DayHours[] = [];
  for (let day = 0; day < LIMITS.operatingHoursDays; day += 1) {
    const rows = rowsByDay.get(day) ?? [];
    if (rows.length !== 1) {
      errors.push(
        weekdayError(
          day,
          `Operating hours must contain exactly one ${RESTAURANT_WEEKDAY_NAMES[day]} entry`,
        ),
      );
      continue;
    }

    const raw = rows[0];
    if (typeof raw.isClosed !== "boolean") {
      errors.push(weekdayError(day, "Closed flag must be true or false"));
      continue;
    }

    const open = parseStrictClock(raw.openTime);
    const close = parseStrictClock(raw.closeTime);
    if (!raw.isClosed && (open === null || close === null || close <= open)) {
      errors.push(weekdayError(day));
      continue;
    }

    days.push({
      dayOfWeek: day,
      openTime: open === null ? "00:00" : (raw.openTime as string),
      closeTime: close === null ? "00:00" : (raw.closeTime as string),
      isClosed: raw.isClosed,
    });
  }

  if (errors.length > 0) return fail(errors);
  return ok(days);
}

/** Aliases matching existing and settings-specific terminology without replacing legacy modules. */
export const validateOperatingHours = validateRestaurantOperatingHours;
export const validateSettingsOperatingHours = validateRestaurantOperatingHours;

/** Applies a complete named preset to a fresh draft and never mutates either argument. */
export function applyHoursPreset(_days: readonly DayHours[], preset: HoursPreset): DayHours[] {
  return preset.days.map(cloneDayHours);
}

/** Changes only open draft rows; an invalid pair returns an unchanged defensive copy. */
export function applyHoursToOpenDays(
  days: readonly DayHours[],
  openTime: string,
  closeTime: string,
): DayHours[] {
  const pair = validateHoursPair(openTime, closeTime);
  return days.map((day) =>
    !pair.ok || day.isClosed
      ? cloneDayHours(day)
      : { ...day, openTime: pair.value.openTime, closeTime: pair.value.closeTime },
  );
}

/** Trims every submitted profile field into a fresh object. */
export function normaliseRestaurantProfile(input: unknown): NormalisedRestaurantProfile {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    restaurantName: trimmedString(raw.restaurantName),
    ownerOrManagerName: trimmedString(raw.ownerOrManagerName),
    accountPhone: trimmedString(raw.accountPhone),
    teamSize: trimmedString(raw.teamSize),
    publicEmail: trimmedString(raw.publicEmail),
    contactNumber: trimmedString(raw.contactNumber),
    whatsappNumber: trimmedString(raw.whatsappNumber),
    landline: trimmedString(raw.landline),
    address: trimmedString(raw.address),
    cuisineOrServices: trimmedString(raw.cuisineOrServices),
    description: trimmedString(raw.description),
  };
}

/** A decoded base64 image data URL: detected MIME, decoded byte length, and payload. */
export interface DecodedImageDataUrl {
  mimeType: string;
  byteLength: number;
  base64: string;
}

/**
 * Parses a `data:<mime>;base64,<payload>` image URL into its detected MIME type
 * and exact decoded byte length without allocating the decoded buffer. Returns
 * `null` for any value that is not a non-empty base64 image data URL, so callers
 * can feed the result straight into `validateProfilePhoto`. This is I/O-free and
 * never throws.
 */
export function parseImageDataUrl(value: unknown): DecodedImageDataUrl | null {
  if (typeof value !== "string") return null;
  const match =
    /^data:([a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9!#$&^_.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
      value.trim(),
    );
  if (!match) return null;
  const base64 = match[2];
  // A valid base64 payload is a positive multiple of four characters.
  if (base64.length === 0 || base64.length % 4 !== 0) return null;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const byteLength = (base64.length / 4) * 3 - padding;
  return { mimeType: match[1].toLowerCase(), byteLength, base64 };
}

/** Accepts exactly the three permitted MIME strings and an integer byte count up to 5 MiB. */
export function validateProfilePhoto(input: unknown): Result<NormalisedProfilePhoto, "photo"> {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const mimeType = raw.mimeType;
  const byteLength = raw.byteLength;
  const validMime =
    typeof mimeType === "string" &&
    (PROFILE_PHOTO_MIME_TYPES as readonly string[]).includes(mimeType);
  const validLength =
    typeof byteLength === "number" &&
    Number.isInteger(byteLength) &&
    byteLength >= 0 &&
    byteLength <= LIMITS.profilePhotoBytes;

  if (!validMime || !validLength) return fail([fieldError("photo", MSG_PROFILE_PHOTO)]);
  return ok({ mimeType: mimeType as ProfilePhotoMimeType, byteLength });
}

/** Derives the exact five-minute expiry and 60-second resend instants. */
export function createVerificationTiming(issuedAtMs: number): VerificationTiming {
  return {
    issuedAtMs,
    expiresAtMs: issuedAtMs + LIMITS.verificationCodeValidityMs,
    resendAvailableAtMs: issuedAtMs + LIMITS.verificationResendDelayMs,
  };
}

export function validateVerificationCode(code: unknown): Result<string, "code"> {
  if (typeof code !== "string" || !/^\d{4}$/.test(code)) {
    return fail([fieldError("code", MSG_VERIFICATION_CODE)]);
  }
  return ok(code);
}

/** Account ids are exact; target email binding is case- and surrounding-space-insensitive. */
export function matchesEmailVerificationBinding(
  verification: EmailVerification,
  binding: EmailVerificationBinding,
): boolean {
  return (
    verification.accountType === binding.accountType &&
    verification.accountId === binding.accountId &&
    normaliseEmail(verification.targetEmail) === normaliseEmail(binding.targetEmail)
  );
}

/** Validity is inclusive at issue and exclusive at the exact five-minute boundary. */
export function isEmailVerificationUnexpired(
  verification: EmailVerification,
  nowMs: number,
): boolean {
  return (
    verification.consumedAtMs === null &&
    Number.isFinite(nowMs) &&
    nowMs >= verification.issuedAtMs &&
    nowMs < verification.expiresAtMs
  );
}

/** Resending becomes possible at the exact stored 60-second boundary. */
export function canResendEmailVerification(
  verification: Pick<EmailVerification, "resendAvailableAtMs">,
  nowMs: number,
): boolean {
  return Number.isFinite(nowMs) && nowMs >= verification.resendAvailableAtMs;
}

/**
 * Validates shape, binding, timing, and an injected constant-time hash-match
 * outcome without exposing hashing or clocks to this pure module.
 */
export function validateEmailVerificationAttempt(
  verification: EmailVerification,
  input: VerificationCodeInput,
  nowMs: number,
  codeMatches: boolean,
): Result<NormalisedVerificationCodeInput, "code"> {
  const code = validateVerificationCode(input.code);
  if (!code.ok) return code;
  if (
    !codeMatches ||
    !matchesEmailVerificationBinding(verification, input) ||
    !isEmailVerificationUnexpired(verification, nowMs)
  ) {
    return fail([fieldError("code", MSG_VERIFICATION_INVALID_OR_EXPIRED)]);
  }
  return ok({
    accountType: input.accountType,
    accountId: input.accountId,
    targetEmail: normaliseEmail(input.targetEmail),
    code: code.value,
  });
}

/** Preserves password whitespace and reports length and confirmation failures together. */
export function validatePasswordChangeInput(
  input: PasswordChangeInput,
): Result<NormalisedPasswordChange, "newPassword" | "confirmation"> {
  const currentPassword = typeof input?.currentPassword === "string" ? input.currentPassword : "";
  const newPassword = typeof input?.newPassword === "string" ? input.newPassword : "";
  const confirmation = typeof input?.confirmation === "string" ? input.confirmation : "";
  const errors: FieldError<"newPassword" | "confirmation">[] = [];

  if (newPassword.length < LIMITS.passwordLength.min) {
    errors.push(fieldError("newPassword", MSG_PASSWORD_MIN_LENGTH));
  }
  if (newPassword !== confirmation) {
    errors.push(fieldError("confirmation", MSG_PASSWORDS_DO_NOT_MATCH));
  }
  if (errors.length > 0) return fail(errors);
  return ok({ currentPassword, newPassword, confirmation });
}
// ---------------------------------------------------------------------------
// Dining-area and menu invariants
// ---------------------------------------------------------------------------

export const EFFECTIVE_MAIN_AREA_ID = "__main__";
export const MSG_MENU_CATEGORY_REFERENCE = "Menu category must belong to this restaurant";

/** Minimal table shape needed to derive registry assignment counts. */
export interface DiningTableAreaAssignment extends LocationScoped {
  id: string;
  areaId?: string | null;
  area?: string | null;
}

function compareStableId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareDisplayNameAndId(
  left: Pick<DiningArea, "id" | "name" | "displayOrder">,
  right: Pick<DiningArea, "id" | "name" | "displayOrder">,
): number {
  return (
    left.displayOrder - right.displayOrder ||
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
    compareStableId(left.id, right.id)
  );
}

function nextDisplayOrder(highest: number | null | undefined): number {
  return highest == null ? DEFAULT_DISPLAY_ORDER : highest + 1;
}

function isDisplayOrder(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= LIMITS.displayOrder.min &&
    value <= LIMITS.displayOrder.max
  );
}

/** Validates area bounds, tenant-wide normalized uniqueness, and display-order defaults. */
export function validateDiningArea(
  input: unknown,
  context: AreaContext,
): Result<NormalisedDiningArea, "name" | "displayOrder"> {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const name = trimmedString(raw.name);
  const displayOrder =
    raw.displayOrder === undefined
      ? nextDisplayOrder(context.highestDisplayOrder)
      : raw.displayOrder;
  const errors: FieldError<"name" | "displayOrder">[] = [];

  if (name.length < LIMITS.areaName.min || name.length > LIMITS.areaName.max) {
    errors.push(fieldError("name", MSG_AREA_NAME_LENGTH));
  }

  const nameKey = normaliseNameKey(name);
  if (
    nameKey.length > 0 &&
    context.existingNames.some(
      (existing) =>
        existing.id !== context.editingId && normaliseNameKey(existing.name) === nameKey,
    )
  ) {
    errors.push(fieldError("name", MSG_AREA_ALREADY_EXISTS));
  }

  if (!isDisplayOrder(displayOrder)) {
    errors.push(fieldError("displayOrder", MSG_DISPLAY_ORDER_RANGE));
  }

  if (errors.length > 0) return fail(errors);
  return ok<NormalisedDiningArea>({ name, displayOrder: displayOrder as number });
}

/** Returns a canonically ordered deep-enough copy without mutating rows. */
export function orderDiningAreas(rows: readonly DiningArea[]): DiningArea[] {
  return rows.map((row) => ({ ...row })).sort(compareDisplayNameAndId);
}

function sameLocation(left: LocationScope, right: LocationScope): boolean {
  return left === right;
}

function tableMatchesArea(table: DiningTableAreaAssignment, area: DiningArea): boolean {
  if (!sameLocation(table.locationId, area.locationId)) return false;
  const areaId = trimmedString(table.areaId);
  if (areaId.length > 0) return areaId === area.id;

  const tableAreaKey = normaliseNameKey(table.area);
  if (tableAreaKey === normaliseNameKey(area.name)) return true;
  return area.id === EFFECTIVE_MAIN_AREA_ID && tableAreaKey.length === 0;
}

/** Recomputes assigned counts from scoped tables and returns fresh ordered area values. */
export function withAssignedDiningTableCounts(
  areas: readonly DiningArea[],
  tables: readonly DiningTableAreaAssignment[],
): DiningArea[] {
  return orderDiningAreas(
    areas.map((area) => ({
      ...area,
      tableCount: tables.reduce(
        (count, table) => count + (tableMatchesArea(table, area) ? 1 : 0),
        0,
      ),
    })),
  );
}

/**
 * Returns stored areas with derived counts, or exactly one synthetic Main area
 * when the effective scope has no stored registry rows.
 */
export function effectiveDiningAreas(
  areas: readonly DiningArea[],
  tables: readonly DiningTableAreaAssignment[] = [],
  locationId: LocationScope = null,
): DiningArea[] {
  const effective =
    areas.length > 0
      ? areas
      : [
          {
            id: EFFECTIVE_MAIN_AREA_ID,
            name: DEFAULT_DINING_AREA_NAME,
            displayOrder: DEFAULT_DISPLAY_ORDER,
            tableCount: 0,
            locationId,
          },
        ];
  return withAssignedDiningTableCounts(effective, tables);
}

/** Alias used by read-model assemblers. */
export const getEffectiveDiningAreas = effectiveDiningAreas;

/** Validates category bounds, tenant-wide normalized uniqueness, defaults, and hard cap. */
export function validateMenuCategory(
  input: unknown,
  context: MenuContext,
): Result<NormalisedMenuCategory, "name" | "displayOrder" | "categoryCount"> {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const name = trimmedString(raw.name);
  const displayOrder =
    raw.displayOrder === undefined
      ? nextDisplayOrder(context.highestCategoryDisplayOrder)
      : raw.displayOrder;
  const errors: FieldError<"name" | "displayOrder" | "categoryCount">[] = [];

  if (name.length < LIMITS.menuCategoryName.min || name.length > LIMITS.menuCategoryName.max) {
    errors.push(fieldError("name", MSG_MENU_CATEGORY_NAME_LENGTH));
  }

  const nameKey = normaliseNameKey(name);
  if (
    nameKey.length > 0 &&
    context.existingCategoryNames.some(
      (existing) =>
        existing.id !== context.editingCategoryId && normaliseNameKey(existing.name) === nameKey,
    )
  ) {
    errors.push(fieldError("name", MSG_MENU_CATEGORY_ALREADY_EXISTS));
  }

  if (!isDisplayOrder(displayOrder)) {
    errors.push(fieldError("displayOrder", MSG_DISPLAY_ORDER_RANGE));
  }
  if (
    context.editingCategoryId == null &&
    context.categoryCount >= LIMITS.menuCategoriesPerTenant
  ) {
    errors.push(fieldError("categoryCount", MSG_MAX_MENU_CATEGORIES));
  }

  if (errors.length > 0) return fail(errors);
  return ok<NormalisedMenuCategory>({ name, displayOrder: displayOrder as number });
}

/** Validates all item fields together, including category membership and tenant cap. */
export function validateMenuItem(
  input: unknown,
  context: MenuContext,
): Result<
  NormalisedMenuItem,
  "categoryId" | "name" | "priceMinor" | "description" | "displayOrder" | "state" | "itemCount"
> {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const categoryId = trimmedString(raw.categoryId);
  const name = trimmedString(raw.name);
  const description =
    raw.description === undefined ? DEFAULT_MENU_ITEM_DESCRIPTION : trimmedString(raw.description);
  const displayOrder =
    raw.displayOrder === undefined
      ? nextDisplayOrder(context.highestItemDisplayOrder)
      : raw.displayOrder;
  const state = raw.state === undefined ? DEFAULT_MENU_ITEM_STATE : raw.state;
  const errors: FieldError<
    "categoryId" | "name" | "priceMinor" | "description" | "displayOrder" | "state" | "itemCount"
  >[] = [];

  if (
    categoryId.length === 0 ||
    (context.validCategoryIds !== undefined && !context.validCategoryIds.includes(categoryId))
  ) {
    errors.push(fieldError("categoryId", MSG_MENU_CATEGORY_REFERENCE));
  }
  if (name.length < LIMITS.menuItemName.min || name.length > LIMITS.menuItemName.max) {
    errors.push(fieldError("name", MSG_MENU_ITEM_NAME_LENGTH));
  }
  if (
    typeof raw.priceMinor !== "number" ||
    !Number.isInteger(raw.priceMinor) ||
    raw.priceMinor < LIMITS.menuItemPriceMinor.min ||
    raw.priceMinor > LIMITS.menuItemPriceMinor.max
  ) {
    errors.push(fieldError("priceMinor", MSG_MENU_ITEM_PRICE_RANGE));
  }
  if (
    (raw.description !== undefined && typeof raw.description !== "string") ||
    description.length > LIMITS.menuItemDescription.max
  ) {
    errors.push(fieldError("description", MSG_MENU_ITEM_DESCRIPTION_LENGTH));
  }
  if (!isDisplayOrder(displayOrder)) {
    errors.push(fieldError("displayOrder", MSG_DISPLAY_ORDER_RANGE));
  }
  if (!(MENU_ITEM_STATES as readonly unknown[]).includes(state)) {
    errors.push(fieldError("state", MSG_MENU_ITEM_STATE));
  }
  if (context.editingItemId == null && context.itemCount >= LIMITS.menuItemsPerTenant) {
    errors.push(fieldError("itemCount", MSG_MAX_MENU_ITEMS));
  }

  if (errors.length > 0) return fail(errors);
  return ok({
    categoryId,
    name,
    priceMinor: raw.priceMinor as number,
    description,
    displayOrder: displayOrder as number,
    state: state as MenuItemState,
  });
}

function compareMenuCategory(left: MenuCategory, right: MenuCategory): number {
  return compareDisplayNameAndId(left, right);
}

function compareMenuItem(left: MenuItem, right: MenuItem): number {
  return compareDisplayNameAndId(left, right);
}

/** Canonically orders categories and nested items while preserving both item states. */
export function orderMenu(rows: readonly MenuCategory[]): MenuCategory[] {
  return rows
    .map((category) => ({
      ...category,
      items: category.items.map((item) => ({ ...item })).sort(compareMenuItem),
    }))
    .sort(compareMenuCategory);
}

/** Creates the first, non-destructive category deletion step. */
export function previewMenuCategoryDeletion(
  categoryId: string,
  itemsOrCount: readonly MenuItem[] | number,
): MenuCategoryDeletionPreview {
  const itemCount =
    typeof itemsOrCount === "number"
      ? Math.max(0, Math.trunc(itemsOrCount))
      : itemsOrCount.reduce((count, item) => count + (item.categoryId === categoryId ? 1 : 0), 0);
  return { categoryId, itemCount, confirmationRequired: itemCount > 0 };
}

/** Alias matching UI terminology for the category cascade confirmation. */
export const previewMenuCategoryCascade = previewMenuCategoryDeletion;

/** Returns canonical categories containing every and only available items. */
export function publicMenu(categories: readonly MenuCategory[]): MenuCategory[] {
  return orderMenu(categories)
    .map((category) => ({
      ...category,
      items: category.items
        .filter((item) => item.state === DEFAULT_MENU_ITEM_STATE)
        .map((item) => ({ ...item })),
    }))
    .filter((category) => category.items.length > 0);
}

/** Alias used by public route assemblers. */
export const projectPublicMenu = publicMenu;

// ---------------------------------------------------------------------------
// Settings navigation, capabilities, scope, authorization, and plan decisions
// ---------------------------------------------------------------------------

/** Canonical Settings selector order. Profile is deliberately unconditional. */
export const RESTAURANT_SETTINGS_TAB_ORDER = [
  "Restaurant Profile",
  "Operating Hours",
  "Dining Areas",
  "Tables",
  "Menu",
  "Booking Rules",
  "WhatsApp Alerts",
  "Multi Location",
  "Manage Users",
] as const;

export type RestaurantSettingsTab = (typeof RESTAURANT_SETTINGS_TAB_ORDER)[number];

export const CONFIG_SETTINGS_TABS = [
  "Operating Hours",
  "Dining Areas",
  "Tables",
  "Menu",
  "Booking Rules",
] as const satisfies readonly RestaurantSettingsTab[];

export const MSG_FEATURE_ACCESS_UNRESOLVED = "Feature access could not be resolved";
export const MSG_NO_RESTAURANT_SETTINGS =
  "This account's role has no restaurant settings to manage";

export interface RestaurantSettingsNavigation {
  accessResolved: boolean;
  message: string | null;
  visibleTabs: RestaurantSettingsTab[];
  selectedTab: RestaurantSettingsTab;
  activePanel: RestaurantSettingsTab;
  hasVisibleSettings: boolean;
}

const SETTINGS_TAB_FEATURE: Partial<Record<RestaurantSettingsTab, SettingsFeature>> = {
  "WhatsApp Alerts": "whatsapp",
  "Multi Location": "locations",
  "Manage Users": "users",
};

/**
 * Derives the selector and active panel from one resolved access snapshot.
 * Unresolved access fails closed to Profile, while Profile and security remain
 * reachable independently of restaurant configuration permission.
 */
export function deriveRestaurantSettingsNavigation(input: {
  access?: Partial<RestaurantSettingsPermissions> | null;
  requestedTab?: string | null;
}): RestaurantSettingsNavigation {
  const access = input?.access ?? null;
  if (!access) {
    return {
      accessResolved: false,
      message: MSG_FEATURE_ACCESS_UNRESOLVED,
      visibleTabs: ["Restaurant Profile"],
      selectedTab: "Restaurant Profile",
      activePanel: "Restaurant Profile",
      hasVisibleSettings: true,
    };
  }

  const configPermission = access.restaurant_config?.permission ?? "none";
  const configVisible = configPermission === "operate" || configPermission === "view_only";
  const visibleTabs = RESTAURANT_SETTINGS_TAB_ORDER.filter((tab) => {
    if (tab === "Restaurant Profile") return true;
    if ((CONFIG_SETTINGS_TABS as readonly RestaurantSettingsTab[]).includes(tab)) {
      return configVisible;
    }
    const feature = SETTINGS_TAB_FEATURE[tab];
    return feature !== undefined && access[feature]?.visible === true;
  });
  const requested = trimmedString(input.requestedTab) as RestaurantSettingsTab;
  const selectedTab = visibleTabs.includes(requested) ? requested : visibleTabs[0];

  return {
    accessResolved: true,
    message: null,
    visibleTabs: [...visibleTabs],
    selectedTab,
    activePanel: selectedTab,
    hasVisibleSettings: visibleTabs.length > 0,
  };
}

/** Compatibility aliases for route/server assemblers. */
export const deriveSettingsNavigation = deriveRestaurantSettingsNavigation;
export const SETTINGS_ORDER = RESTAURANT_SETTINGS_TAB_ORDER;

export interface ProfileCapabilityViewModel {
  showProfile: true;
  showAccountSecurity: true;
  profileReadOnly: boolean;
  canEditProfile: boolean;
  canUploadProfilePhoto: boolean;
  canChangeOwnEmail: true;
  canChangeOwnPassword: true;
  viewOnlyMessage: string | null;
}

export const MSG_PROFILE_VIEW_ONLY = "Your role can view but not change the restaurant details";

/** Account security is self-service and never inherits the config write gate. */
export function deriveProfileCapabilityViewModel(
  configPermission: Permission | null | undefined,
): ProfileCapabilityViewModel {
  const canEditProfile = configPermission === "operate";
  return {
    showProfile: true,
    showAccountSecurity: true,
    profileReadOnly: !canEditProfile,
    canEditProfile,
    canUploadProfilePhoto: canEditProfile,
    canChangeOwnEmail: true,
    canChangeOwnPassword: true,
    viewOnlyMessage: configPermission === "view_only" ? MSG_PROFILE_VIEW_ONLY : null,
  };
}

export interface FeatureCapabilityViewModel {
  feature: SettingsFeature;
  permission: Permission;
  visible: boolean;
  readOnly: boolean;
  canWrite: boolean;
  showMutationControls: boolean;
}

/** Produces one presentation model without granting more than resolved access. */
export function deriveFeatureCapabilityViewModel(
  feature: SettingsFeature,
  access: FeaturePermission | null | undefined,
): FeatureCapabilityViewModel {
  const permission = access?.permission ?? "none";
  const visible = access?.visible === true && permission !== "none";
  const canWrite = visible && permission === "operate";
  return {
    feature,
    permission,
    visible,
    readOnly: visible && !canWrite,
    canWrite,
    showMutationControls: canWrite,
  };
}

export type RestaurantSettingsAccountRole = "admin" | "reception" | "doctor" | "location";

export interface RestaurantScopeBranch {
  id: string;
  tenantId: string;
  isActive?: boolean;
}

export interface RestaurantScopeDecisionInput {
  tenantId: string;
  role: RestaurantSettingsAccountRole;
  sessionLocationId?: string | null;
  requestedLocationId?: string | null;
  branches?: readonly RestaurantScopeBranch[];
}

export const MSG_BRANCH_SCOPE_REQUIRED = "The signed-in branch account has no branch scope";
export const MSG_BRANCH_SCOPE_OVERRIDE = "A branch account cannot select another branch";
export const MSG_BRANCH_SELECTION_NOT_ALLOWED = "Only the owner account can select a branch";
export const MSG_BRANCH_NOT_FOUND = "Branch not found";

/**
 * Computes location scope solely from verified session facts and an owner's
 * tenant-validated branch list. Active and inactive branches are both valid
 * owner selections; branch sessions can never override their own identifier.
 */
export function resolveRestaurantResourceScope(
  input: RestaurantScopeDecisionInput,
): Result<RestaurantResourceScope, "tenantId" | "locationId"> {
  const tenantId = trimmedString(input?.tenantId);
  if (!tenantId) {
    return fail([fieldError("tenantId", MSG_SETTINGS_RESOURCE_NOT_FOUND)]);
  }

  const requestedLocationId = normaliseLocationScope(input.requestedLocationId);
  if (input.role === "location") {
    const sessionLocationId = normaliseLocationScope(input.sessionLocationId);
    if (!sessionLocationId) {
      return fail([fieldError("locationId", MSG_BRANCH_SCOPE_REQUIRED)]);
    }
    if (requestedLocationId !== null && requestedLocationId !== sessionLocationId) {
      return fail([fieldError("locationId", MSG_BRANCH_SCOPE_OVERRIDE)]);
    }
    return ok({ tenantId, locationId: sessionLocationId });
  }

  if (input.role !== "admin") {
    if (requestedLocationId !== null) {
      return fail([fieldError("locationId", MSG_BRANCH_SELECTION_NOT_ALLOWED)]);
    }
    return ok({ tenantId, locationId: null });
  }

  if (requestedLocationId === null) return ok({ tenantId, locationId: null });
  const selectedBranch = (input.branches ?? []).find(
    (branch) => trimmedString(branch.id) === requestedLocationId && branch.tenantId === tenantId,
  );
  if (!selectedBranch) return fail([fieldError("locationId", MSG_BRANCH_NOT_FOUND)]);
  return ok({ tenantId, locationId: requestedLocationId });
}

export interface FeatureWriteGuardDecision {
  feature: SettingsFeature;
  allowed: boolean;
  error: FieldError<SettingsFeature> | null;
}

const FEATURE_WRITE_MESSAGES: Record<SettingsFeature, string> = {
  restaurant_config: MSG_NOT_AUTHORISED_CONFIG,
  users: MSG_NOT_AUTHORISED_USERS,
  locations: MSG_NOT_AUTHORISED_LOCATIONS,
  whatsapp: MSG_NOT_AUTHORISED_WHATSAPP,
};

/** A resolved feature reaches a mutating adapter exactly for `operate`. */
export function featureWriteGuardDecision(
  feature: SettingsFeature,
  permission: Permission | null | undefined,
): FeatureWriteGuardDecision {
  if (permission === "operate") return { feature, allowed: true, error: null };
  return {
    feature,
    allowed: false,
    error: fieldError(feature, FEATURE_WRITE_MESSAGES[feature]),
  };
}

export function authoriseSettingsFeatureWrite(
  feature: SettingsFeature,
  permission: Permission | null | undefined,
): Result<true, SettingsFeature> {
  const decision = featureWriteGuardDecision(feature, permission);
  return decision.allowed ? ok(true) : fail([decision.error as FieldError<SettingsFeature>]);
}

/** Canonicalizes both current names and historical persisted aliases. */
export function normaliseSubUserPlanTier(plan?: string | null): UserPlanTier {
  const raw = (plan ?? "").trim().toLowerCase();
  const digits = raw.replace(/\D/g, "");
  if (raw.includes("enterprise") || raw.includes("hospital") || raw.includes("custom")) {
    return "Enterprise";
  }
  if (
    raw.includes("premium") ||
    raw.includes("clinic") ||
    raw.includes("pro") ||
    digits.includes("1499")
  ) {
    return "Premium";
  }
  return "Basic";
}

function normaliseRoleCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normaliseUserRoleCounts(counts?: Partial<UserRoleCounts> | null): UserRoleCounts {
  return {
    doctor: normaliseRoleCount(counts?.doctor),
    reception: normaliseRoleCount(counts?.reception),
  };
}

function userRoleLimit(role: SubUserRole, maximum: number | null, current: number): UserRoleLimit {
  const remaining = maximum === null ? null : Math.max(0, maximum - current);
  return { role, maximum, current, remaining, canCreate: remaining === null || remaining > 0 };
}

function planMaximumLabel(maximum: number | null): string {
  return maximum === null ? "unlimited" : String(maximum);
}

/** The display message and mutation limits are built from the same maxima. */
export function resolveSubUserPlanLimits(
  plan: string | null | undefined,
  counts?: Partial<UserRoleCounts> | null,
): SubUserPlanLimits {
  const tier = normaliseSubUserPlanTier(plan);
  const current = normaliseUserRoleCounts(counts);
  const maximums = SUB_USER_PLAN_MAXIMUMS[tier];
  const doctor = userRoleLimit("doctor", maximums.doctor, current.doctor);
  const reception = userRoleLimit("reception", maximums.reception, current.reception);
  return {
    plan: tier,
    doctor,
    reception,
    message: `${tier} plan permits ${planMaximumLabel(doctor.maximum)} doctor account${
      doctor.maximum === 1 ? "" : "s"
    } and ${planMaximumLabel(reception.maximum)} reception account${
      reception.maximum === 1 ? "" : "s"
    }.`,
  };
}

export interface SubUserRoleChangeDecision {
  allowed: boolean;
  plan: UserPlanTier;
  requestedRole: SubUserRole | null;
  countsBefore: UserRoleCounts;
  countsAfterRemoval: UserRoleCounts;
  projectedCounts: UserRoleCounts;
  countsAfterDecision: UserRoleCounts;
  limitsAfterRemoval: SubUserPlanLimits;
  message: string;
}

function isSubUserRole(value: unknown): value is SubUserRole {
  return typeof value === "string" && (SUB_USER_ROLES as readonly string[]).includes(value);
}

function roleLimitRefusal(plan: UserPlanTier, role: SubUserRole, maximum: number): string {
  if (maximum === 0) {
    return `${plan} plan permits no ${role} accounts. Please upgrade your plan.`;
  }
  return `${plan} plan permits at most ${maximum} ${role} account${
    maximum === 1 ? "" : "s"
  }. Please upgrade your plan.`;
}

/**
 * Evaluates creates and edits without mutating counts. For edits the existing
 * user is removed from the old role before the requested role is added, so a
 * same-role edit at capacity remains valid and cross-role limits are exact.
 */
export function decideSubUserRoleChange(input: {
  plan?: string | null;
  counts?: Partial<UserRoleCounts> | null;
  requestedRole: unknown;
  previousRole?: SubUserRole | null;
}): SubUserRoleChangeDecision {
  const countsBefore = normaliseUserRoleCounts(input.counts);
  const requestedRole = isSubUserRole(input.requestedRole) ? input.requestedRole : null;
  const countsAfterRemoval = { ...countsBefore };
  if (input.previousRole && countsAfterRemoval[input.previousRole] > 0) {
    countsAfterRemoval[input.previousRole] -= 1;
  }
  const limitsAfterRemoval = resolveSubUserPlanLimits(input.plan, countsAfterRemoval);

  if (!requestedRole) {
    return {
      allowed: false,
      plan: limitsAfterRemoval.plan,
      requestedRole: null,
      countsBefore,
      countsAfterRemoval,
      projectedCounts: { ...countsAfterRemoval },
      countsAfterDecision: { ...countsBefore },
      limitsAfterRemoval,
      message: MSG_SUB_USER_ROLE,
    };
  }

  const projectedCounts = { ...countsAfterRemoval };
  projectedCounts[requestedRole] += 1;
  const maximum = limitsAfterRemoval[requestedRole].maximum;
  const allowed = maximum === null || projectedCounts[requestedRole] <= maximum;
  return {
    allowed,
    plan: limitsAfterRemoval.plan,
    requestedRole,
    countsBefore,
    countsAfterRemoval,
    projectedCounts,
    countsAfterDecision: allowed ? projectedCounts : { ...countsBefore },
    limitsAfterRemoval,
    message: allowed
      ? limitsAfterRemoval.message
      : roleLimitRefusal(limitsAfterRemoval.plan, requestedRole, maximum as number),
  };
}

export const resolveSubUserRoleChange = decideSubUserRoleChange;

// ---------------------------------------------------------------------------
// Tenant and location scope enforcement for row access
// ---------------------------------------------------------------------------

/**
 * The minimal identity every scoped restaurant resource row carries. Branch
 * resources (areas, tables, menu categories/items, closure days) persist both
 * a tenant owner and a nullable branch scope.
 */
export interface TenantLocationRow {
  tenantId: string;
  locationId: LocationScope;
}

/**
 * Mirrors the server row predicate `tenantId = ? AND locationId <=> ?`.
 *
 * A row belongs to a resolved scope only when its tenant matches exactly and
 * its branch scope is null-safe equal to the effective location (both `null`
 * for primary scope, or the identical branch id). Foreign tenants and any
 * other branch never match, so identifier lookups outside the resolved scope
 * resolve as not found.
 */
export function isRestaurantResourceInScope(
  scope: RestaurantResourceScope,
  row: TenantLocationRow,
): boolean {
  return row.tenantId === scope.tenantId && row.locationId === scope.locationId;
}

/**
 * Restricts a mixed-tenant / mixed-location collection to exactly the rows the
 * resolved scope may read or write. The input collection is never mutated and
 * ordering of surviving rows is preserved.
 */
export function filterRestaurantResourcesToScope<Row extends TenantLocationRow>(
  scope: RestaurantResourceScope,
  rows: readonly Row[],
): Row[] {
  return rows.filter((row) => isRestaurantResourceInScope(scope, row));
}
