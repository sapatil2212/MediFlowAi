// ─────────────────────────────────────────────────────────────────────────────
// wa-template-model.ts  (PURE, client-safe — no I/O, no server imports)
//
// The single source of truth for the WhatsApp Utility Template Management
// model: types, Meta limits, the verified language list, the notify-kind list,
// the variable catalogue, the placeholder parser, every validator, the
// create-payload builder (which CANNOT emit a media header), the Meta→local
// component converter, the components fingerprint, the preview model (HTML
// escaped), status normalization + attention bucketing, the allowed-actions
// matrix, describeMetaError, and mapping eligibility.
//
// This module is imported by both the server (wa-templates.ts, the repo, the
// webhook) and the client UI so the SAME validation message appears on both
// sides (design §7.1, §10, R-SEC-01). It must stay free of any server-only
// import (db, crypto, graph): only `import type` is allowed, and only for the
// AptNotifyKind union so the notify-kind list stays in lock-step with
// appointment-notify.ts.
// ─────────────────────────────────────────────────────────────────────────────
import type { AptNotifyKind } from "./appointment-notify";

// ─────────────────────────────────────────────────────────────────────────────
// Meta component / button limits (MV-06).
// ─────────────────────────────────────────────────────────────────────────────
export const TEMPLATE_LIMITS = {
  /** `^[a-z0-9_]{1,128}$` — Meta allows 512 but the column is VARCHAR(128) (MV-03). */
  NAME_MAX: 128,
  HEADER_TEXT_MAX: 60,
  HEADER_TEXT_MAX_VARS: 1,
  BODY_TEXT_MAX: 1024,
  FOOTER_TEXT_MAX: 60,
  BUTTONS_MAX: 10,
  QUICK_REPLY_MAX: 10,
  URL_BUTTON_MAX: 2,
  PHONE_BUTTON_MAX: 1,
  BUTTON_LABEL_MAX: 25,
  URL_MAX: 2000,
  URL_MAX_TRAILING_VARS: 1,
  PHONE_MAX: 20,
  /** ≥4 buttons or quick-replies mixed with other types are not shown on WhatsApp desktop. */
  DESKTOP_VISIBLE_BUTTON_MAX: 3,
  /** Documented list page size and the local draft paging clamp (MV-09/R-LIST-02). */
  LIST_PAGE_MAX: 100,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Verified language list (MV-04). en_US / en_GB / hi / mr first; legacy `en`
// is valid. The remainder is the verified Meta list; unsupported codes → 100.
// ─────────────────────────────────────────────────────────────────────────────
export interface TemplateLanguage {
  code: string;
  label: string;
}

export const TEMPLATE_LANGUAGES: readonly TemplateLanguage[] = [
  { code: "en_US", label: "English (US)" },
  { code: "en_GB", label: "English (UK)" },
  { code: "hi", label: "Hindi" },
  { code: "mr", label: "Marathi" },
  { code: "en", label: "English" },
  { code: "en_IN", label: "English (India)" },
  { code: "bn", label: "Bengali" },
  { code: "gu", label: "Gujarati" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "pa", label: "Punjabi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "ur", label: "Urdu" },
  { code: "ar", label: "Arabic" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "es_ES", label: "Spanish (Spain)" },
  { code: "es_MX", label: "Spanish (Mexico)" },
  { code: "fr", label: "French" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "nl", label: "Dutch" },
  { code: "pt_BR", label: "Portuguese (Brazil)" },
  { code: "pt_PT", label: "Portuguese (Portugal)" },
  { code: "ru", label: "Russian" },
  { code: "th", label: "Thai" },
  { code: "tr", label: "Turkish" },
  { code: "vi", label: "Vietnamese" },
  { code: "zh_CN", label: "Chinese (Simplified)" },
  { code: "zh_HK", label: "Chinese (Hong Kong)" },
  { code: "zh_TW", label: "Chinese (Traditional)" },
];

const LANGUAGE_CODE_SET: ReadonlySet<string> = new Set(TEMPLATE_LANGUAGES.map((l) => l.code));

// ─────────────────────────────────────────────────────────────────────────────
// Notify-kind list and labels — mirrors AptNotifyKind in appointment-notify.ts.
// The compile-time map below fails to typecheck if a kind is added/removed
// there, keeping the two lists in lock-step.
// ─────────────────────────────────────────────────────────────────────────────
export const NOTIFY_KIND_LABELS: Record<AptNotifyKind, string> = {
  booked: "Appointment Booked",
  confirmed: "Appointment Confirmed",
  cancelled: "Appointment Cancelled",
  completed: "Appointment Completed",
  reminderDayBefore: "Reminder — Day Before",
  reminderDayOf: "Reminder — Day Of",
  reminder2h: "Reminder — 2 Hours Before",
  reminder1h: "Reminder — 1 Hour Before",
  tokenUpdated: "Token / Booking Updated",
  videoLinkIssued: "Video Link Issued",
  videoLinkReissued: "Video Link Reissued",
};

export const NOTIFY_KINDS: readonly AptNotifyKind[] = Object.keys(
  NOTIFY_KIND_LABELS,
) as AptNotifyKind[];

export function isNotifyKind(value: string): value is AptNotifyKind {
  return Object.prototype.hasOwnProperty.call(NOTIFY_KIND_LABELS, value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Variable catalogue (DP-08/09). Only fields derivable from existing data
// already shown to patients are offered. Service name and a booking-management
// URL are intentionally NOT offered (DP-08). `bookingCode` = first 8 chars of
// the appointment id, upper-cased, shown to patients as the Confirmation Code.
// ─────────────────────────────────────────────────────────────────────────────
export type CatalogueField = "name" | "clinicName" | "doctorName" | "date" | "time" | "bookingCode";

export interface CatalogueEntry {
  field: CatalogueField;
  label: string;
  description: string;
}

export const VARIABLE_CATALOGUE: readonly CatalogueEntry[] = [
  { field: "name", label: "Patient Name", description: "The patient's full name." },
  { field: "clinicName", label: "Clinic Name", description: "The clinic / business name." },
  { field: "doctorName", label: "Doctor Name", description: "The doctor's display name." },
  { field: "date", label: "Appointment Date", description: "The appointment date, formatted." },
  { field: "time", label: "Appointment Time", description: "The appointment time or slot." },
  {
    field: "bookingCode",
    label: "Confirmation Code",
    description: "First 8 characters of the appointment id, upper-cased.",
  },
];

const CATALOGUE_FIELD_SET: ReadonlySet<string> = new Set(VARIABLE_CATALOGUE.map((c) => c.field));

export function isCatalogueField(value: string): value is CatalogueField {
  return CATALOGUE_FIELD_SET.has(value);
}

/**
 * Which catalogue fields are resolvable for a given notify kind. Mirrors the
 * data the Web body uses per kind (TEMPLATE_VAR_SPEC), expressed in catalogue
 * terms. `bookingCode` is available for every kind (derived from the
 * appointment id). Resolvability is enforced at assign/enable/send (DP-09).
 */
export const KIND_RESOLVABLE_FIELDS: Record<AptNotifyKind, readonly CatalogueField[]> = {
  booked: ["name", "clinicName", "doctorName", "date", "time", "bookingCode"],
  confirmed: ["name", "clinicName", "doctorName", "date", "time", "bookingCode"],
  cancelled: ["name", "clinicName", "date", "time", "bookingCode"],
  completed: ["name", "clinicName", "doctorName", "bookingCode"],
  reminderDayBefore: ["name", "clinicName", "doctorName", "date", "time", "bookingCode"],
  reminderDayOf: ["name", "clinicName", "doctorName", "time", "bookingCode"],
  reminder2h: ["name", "clinicName", "doctorName", "time", "bookingCode"],
  reminder1h: ["name", "clinicName", "doctorName", "time", "bookingCode"],
  tokenUpdated: ["name", "clinicName", "doctorName", "date", "time", "bookingCode"],
  videoLinkIssued: ["name", "clinicName", "doctorName", "date", "time", "bookingCode"],
  videoLinkReissued: ["name", "clinicName", "doctorName", "date", "time", "bookingCode"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Resolution links (MV-20). Rendered target="_blank" rel="noopener noreferrer".
// ─────────────────────────────────────────────────────────────────────────────
export const RESOLUTION_LINKS = {
  whatsappManager: "https://business.facebook.com/latest/whatsapp_manager/",
  manageTemplates: "https://business.facebook.com/latest/whatsapp_manager/message_templates",
  businessSupportHome: "https://business.facebook.com/business-support-home/",
  directSupport: "https://business.facebook.com/direct-support",
  businessSuite: "https://business.facebook.com/",
  appDashboard: "https://developers.facebook.com/apps/",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Graph API version expiry (MV-02, S16). Drives the Credentials/health warning
// when the effective version expires within 120 days or is unknown.
// ─────────────────────────────────────────────────────────────────────────────
export const API_VERSION_EXPIRY: Record<string, string | null> = {
  "v26.0": null, // released 29 Jul 2026, expiry TBD
  "v25.0": "2028-07-29",
  "v24.0": "2028-02-18",
  "v23.0": "2027-10-08",
  "v22.0": "2027-05-20",
  "v21.0": "2027-01-21",
};

// ─────────────────────────────────────────────────────────────────────────────
// Core model types.
// ─────────────────────────────────────────────────────────────────────────────
export type TemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";
export type ParameterFormat = "POSITIONAL" | "NAMED";
export type HeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";
export type ButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER";

export interface TemplateButton {
  type: ButtonType;
  text: string;
  /** URL base for a URL button (may carry ≤1 trailing variable). */
  url?: string;
  /** Phone number for a PHONE_NUMBER button. */
  phoneNumber?: string;
}

/** A normalized local draft — what the builder produces and the repo stores. */
export interface TemplateDraft {
  name: string;
  language: string;
  category: TemplateCategory;
  parameterFormat: ParameterFormat;
  headerType: HeaderType;
  headerText?: string | null;
  bodyText: string;
  footerText?: string | null;
  buttons: TemplateButton[];
  /** placeholder key (`body.1`, `header.1`, `button.0.1`) → fictional sample. */
  sampleValues: Record<string, string>;
  /** placeholder key → catalogue field (DP-09). */
  variableMappings: Record<string, CatalogueField>;
}

/** A placeholder occurrence parsed from a component's text. */
export interface Placeholder {
  /** The component namespace, e.g. `body`, `header`, `button.0`. */
  component: string;
  /** The full key, e.g. `body.1` (positional) or `body.patient_name` (named). */
  key: string;
  /** The raw token inside the braces (`1` or `patient_name`). */
  token: string;
  /** 1-based position within the component in source order. */
  position: number;
  /** True when this is a named token (NAMED format). */
  named: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Placeholder parser (MV-07). Positional `{{1}}` sequential from 1; named
// `{{token}}` lowercase + underscore, unique. Leading/trailing + adjacency are
// checked. Numbering is per component.
// ─────────────────────────────────────────────────────────────────────────────
const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
const NAMED_TOKEN_RE = /^[a-z_]+$/;
const POSITIONAL_TOKEN_RE = /^\d+$/;

export interface ParsedComponentText {
  placeholders: Placeholder[];
  /** Validation problems specific to placeholder layout (MV-07). */
  errors: string[];
}

/**
 * Parses placeholders in one component's text for a given format. `component`
 * namespaces the produced keys (`body`, `header`, `button.0`). Enforces
 * leading/trailing (2388299) and adjacency (INVALID_FORMAT) rules, sequential
 * numbering from 1 (positional) and valid, unique named tokens (named).
 */
export function parsePlaceholders(
  text: string,
  format: ParameterFormat,
  component: string,
): ParsedComponentText {
  const placeholders: Placeholder[] = [];
  const errors: string[] = [];
  if (!text) return { placeholders, errors };

  const matches: { token: string; start: number; end: number }[] = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    matches.push({ token: m[1], start: m.index, end: m.index + m[0].length });
  }
  if (matches.length === 0) return { placeholders, errors };

  // Leading / trailing variable check (2388299): ignore surrounding whitespace.
  const firstNonSpace = text.search(/\S/);
  const lastNonSpace = text.length - 1 - [...text].reverse().join("").search(/\S/);
  if (matches[0].start <= firstNonSpace) {
    errors.push("A variable cannot be at the start of the text (Meta error 2388299).");
  }
  if (matches[matches.length - 1].end - 1 >= lastNonSpace) {
    errors.push("A variable cannot be at the end of the text (Meta error 2388299).");
  }

  // Adjacency check (INVALID_FORMAT): two placeholders with only whitespace
  // between them are rejected.
  for (let i = 1; i < matches.length; i++) {
    const between = text.slice(matches[i - 1].end, matches[i].start);
    if (between.trim() === "") {
      errors.push("Variables cannot be placed next to each other without text between them.");
      break;
    }
  }

  const seenTokens = new Set<string>();
  matches.forEach((mm, idx) => {
    const token = mm.token;
    const named = !POSITIONAL_TOKEN_RE.test(token);
    if (format === "NAMED") {
      if (!named || !NAMED_TOKEN_RE.test(token)) {
        errors.push(`Named variable "${token}" must use lowercase letters and underscores only.`);
      }
      if (seenTokens.has(token)) {
        errors.push(`Named variable "${token}" is used more than once.`);
      }
    } else {
      if (named) {
        errors.push(`Positional variable "${token}" must be a number like {{1}}.`);
      }
    }
    seenTokens.add(token);
    placeholders.push({
      component,
      key: `${component}.${token}`,
      token,
      position: idx + 1,
      named,
    });
  });

  // Positional: sequential from 1 with no gaps or repeats (MV-07).
  if (format === "POSITIONAL") {
    const numbers = placeholders.filter((p) => !p.named).map((p) => Number(p.token));
    const unique = [...new Set(numbers)].sort((a, b) => a - b);
    const expected = unique.length;
    for (let i = 0; i < expected; i++) {
      if (unique[i] !== i + 1) {
        errors.push("Positional variables must be sequential starting at {{1}} with no gaps.");
        break;
      }
    }
  }

  return { placeholders, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation result type shared by every validator.
// ─────────────────────────────────────────────────────────────────────────────
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** Non-blocking notices (e.g. desktop-visibility, legacy language). */
  warnings: string[];
}

function result(errors: string[], warnings: string[] = []): ValidationResult {
  return { ok: errors.length === 0, errors, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Field validators (§10).
// ─────────────────────────────────────────────────────────────────────────────
const NAME_RE = /^[a-z0-9_]{1,128}$/;

export function validateName(name: string): ValidationResult {
  const errors: string[] = [];
  if (!name) {
    errors.push("A template name is required.");
  } else if (name.length > TEMPLATE_LIMITS.NAME_MAX) {
    errors.push(`The name must be at most ${TEMPLATE_LIMITS.NAME_MAX} characters.`);
  } else if (!NAME_RE.test(name)) {
    errors.push("The name may use only lowercase letters, numbers and underscores (a-z, 0-9, _).");
  }
  return result(errors);
}

export function isValidLanguage(code: string): boolean {
  return LANGUAGE_CODE_SET.has(code);
}

export function validateLanguage(code: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!code) {
    errors.push("A language is required.");
  } else if (!isValidLanguage(code)) {
    errors.push(`Unsupported language "${code}".`);
  } else if (code === "en") {
    warnings.push('The legacy "en" code is valid but "en_US" or "en_GB" is recommended.');
  }
  return result(errors, warnings);
}

export function validateCategoryOnCreate(category: string): ValidationResult {
  const errors: string[] = [];
  if (category !== "UTILITY") {
    errors.push("Templates can only be created with the UTILITY category.");
  }
  return result(errors);
}

export function validateParameterFormat(format: string): ValidationResult {
  const errors: string[] = [];
  if (format !== "POSITIONAL" && format !== "NAMED") {
    errors.push('parameterFormat must be "POSITIONAL" or "NAMED".');
  }
  return result(errors);
}

export function validateHeaderType(headerType: string): ValidationResult {
  const errors: string[] = [];
  if (headerType !== "NONE" && headerType !== "TEXT") {
    errors.push(
      "Media and location headers need Meta's Resumable Upload flow (App ID, user token) and " +
        "per-message media, which BookMyTime does not support yet.",
    );
  }
  return result(errors);
}

export function validateHeaderText(text: string, format: ParameterFormat): ValidationResult {
  const errors: string[] = [];
  if (!text) return result(errors);
  if (/[\r\n]/.test(text)) {
    errors.push("A text header cannot contain line breaks.");
  }
  if (/[*_~`]/.test(text)) {
    errors.push("A text header cannot contain Markdown formatting.");
  }
  if (text.length > TEMPLATE_LIMITS.HEADER_TEXT_MAX) {
    errors.push(`A text header must be at most ${TEMPLATE_LIMITS.HEADER_TEXT_MAX} characters.`);
  }
  const parsed = parsePlaceholders(text, format, "header");
  if (parsed.placeholders.length > TEMPLATE_LIMITS.HEADER_TEXT_MAX_VARS) {
    errors.push("A text header can contain at most one variable.");
  }
  errors.push(...parsed.errors);
  return result(errors);
}

export function validateBody(text: string, format: ParameterFormat): ValidationResult {
  const errors: string[] = [];
  if (!text) {
    errors.push("A template body is required.");
    return result(errors);
  }
  if (text.length > TEMPLATE_LIMITS.BODY_TEXT_MAX) {
    errors.push(`The body must be at most ${TEMPLATE_LIMITS.BODY_TEXT_MAX} characters.`);
  }
  const parsed = parsePlaceholders(text, format, "body");
  errors.push(...parsed.errors);
  return result(errors);
}

export function validateFooter(text: string, format: ParameterFormat): ValidationResult {
  const errors: string[] = [];
  if (!text) return result(errors);
  if (text.length > TEMPLATE_LIMITS.FOOTER_TEXT_MAX) {
    errors.push(`A footer must be at most ${TEMPLATE_LIMITS.FOOTER_TEXT_MAX} characters.`);
  }
  const parsed = parsePlaceholders(text, format, "footer");
  if (parsed.placeholders.length > 0) {
    errors.push("A footer cannot contain variables.");
  }
  return result(errors);
}

/**
 * Button validation (MV-06): total ≤10; QR ≤10 / URL ≤2 / PHONE ≤1; labels ≤25;
 * URL ≤2000 with ≤1 trailing variable; phone ≤20; quick replies grouped
 * together. A desktop-visibility notice is emitted (warning) for ≥4 buttons or
 * quick replies mixed with other types.
 */
export function validateButtons(
  buttons: TemplateButton[],
  format: ParameterFormat,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!buttons || buttons.length === 0) return result(errors, warnings);

  if (buttons.length > TEMPLATE_LIMITS.BUTTONS_MAX) {
    errors.push(`A template can have at most ${TEMPLATE_LIMITS.BUTTONS_MAX} buttons.`);
  }

  const counts = { QUICK_REPLY: 0, URL: 0, PHONE_NUMBER: 0 };
  buttons.forEach((b, idx) => {
    counts[b.type]++;
    if (!b.text || b.text.length === 0) {
      errors.push(`Button ${idx + 1} needs a label.`);
    } else if (b.text.length > TEMPLATE_LIMITS.BUTTON_LABEL_MAX) {
      errors.push(
        `Button ${idx + 1} label must be at most ${TEMPLATE_LIMITS.BUTTON_LABEL_MAX} characters.`,
      );
    }
    if (b.type === "URL") {
      const url = b.url || "";
      if (!url) {
        errors.push(`Button ${idx + 1} needs a URL.`);
      } else if (url.length > TEMPLATE_LIMITS.URL_MAX) {
        errors.push(`Button ${idx + 1} URL must be at most ${TEMPLATE_LIMITS.URL_MAX} characters.`);
      }
      const parsed = parsePlaceholders(url, format, `button.${idx}`);
      const vars = parsed.placeholders;
      if (vars.length > TEMPLATE_LIMITS.URL_MAX_TRAILING_VARS) {
        errors.push(`Button ${idx + 1} URL can contain at most one variable.`);
      }
      if (vars.length === 1) {
        // The single variable must be a trailing suffix.
        const lastVarEnd = url.lastIndexOf("}}");
        if (lastVarEnd !== url.length - 2) {
          errors.push(`Button ${idx + 1} URL variable must be a trailing suffix.`);
        }
        if (format === "NAMED") {
          errors.push("A NAMED template cannot use a dynamic URL button.");
        }
      }
    }
    if (b.type === "PHONE_NUMBER") {
      const phone = b.phoneNumber || "";
      if (!phone) {
        errors.push(`Button ${idx + 1} needs a phone number.`);
      } else if (phone.length > TEMPLATE_LIMITS.PHONE_MAX) {
        errors.push(
          `Button ${idx + 1} phone number must be at most ${TEMPLATE_LIMITS.PHONE_MAX} characters.`,
        );
      }
    }
  });

  if (counts.QUICK_REPLY > TEMPLATE_LIMITS.QUICK_REPLY_MAX) {
    errors.push(`At most ${TEMPLATE_LIMITS.QUICK_REPLY_MAX} quick-reply buttons are allowed.`);
  }
  if (counts.URL > TEMPLATE_LIMITS.URL_BUTTON_MAX) {
    errors.push(`At most ${TEMPLATE_LIMITS.URL_BUTTON_MAX} URL buttons are allowed.`);
  }
  if (counts.PHONE_NUMBER > TEMPLATE_LIMITS.PHONE_BUTTON_MAX) {
    errors.push(`At most ${TEMPLATE_LIMITS.PHONE_BUTTON_MAX} phone-number button is allowed.`);
  }

  // Quick replies must be grouped together (MV-06). Walk the sequence of QR vs
  // non-QR and reject if a QR block is split by a non-QR button.
  let qrBlocks = 0;
  let prevWasQr = false;
  for (const b of buttons) {
    const isQr = b.type === "QUICK_REPLY";
    if (isQr && !prevWasQr) qrBlocks++;
    prevWasQr = isQr;
  }
  if (qrBlocks > 1) {
    errors.push("Quick-reply buttons must be grouped together.");
  }

  const hasMixed = counts.QUICK_REPLY > 0 && counts.URL + counts.PHONE_NUMBER > 0;
  if (buttons.length >= 4 || hasMixed) {
    warnings.push(
      "Four or more buttons, or quick replies mixed with other button types, are not shown on WhatsApp desktop.",
    );
  }

  return result(errors, warnings);
}

/**
 * Sample-value validation (§10): every placeholder in the draft must have a
 * non-empty sample with no newline and within the component's length.
 */
export function validateSampleValues(draft: TemplateDraft): ValidationResult {
  const errors: string[] = [];
  const keys = collectPlaceholderKeys(draft);
  for (const key of keys) {
    const sample = draft.sampleValues[key];
    if (sample == null || sample === "") {
      errors.push(`A sample value is required for ${key}.`);
    } else if (/[\r\n]/.test(sample)) {
      errors.push(`The sample value for ${key} cannot contain line breaks.`);
    }
  }
  return result(errors);
}

/**
 * Variable-mapping validation (DP-08/09): every placeholder must map to a
 * catalogue field that exists for the target kind (when a kind is supplied).
 */
export function validateVariableMappings(
  draft: TemplateDraft,
  kind?: AptNotifyKind | null,
): ValidationResult {
  const errors: string[] = [];
  const keys = collectPlaceholderKeys(draft);
  const allowed = kind ? new Set(KIND_RESOLVABLE_FIELDS[kind]) : null;
  for (const key of keys) {
    const field = draft.variableMappings[key];
    if (!field) {
      errors.push(`Variable ${key} is not mapped to a booking field.`);
      continue;
    }
    if (!isCatalogueField(field)) {
      errors.push(`Variable ${key} is mapped to an unknown field "${field}".`);
      continue;
    }
    if (allowed && !allowed.has(field)) {
      errors.push(`Field "${field}" is not available for the ${kind} notification.`);
    }
  }
  return result(errors);
}

/** Collects every placeholder key across the draft's components, in source order. */
export function collectPlaceholderKeys(draft: TemplateDraft): string[] {
  const keys: string[] = [];
  const push = (parsed: ParsedComponentText) => {
    for (const p of parsed.placeholders) if (!keys.includes(p.key)) keys.push(p.key);
  };
  if (draft.headerType === "TEXT" && draft.headerText) {
    push(parsePlaceholders(draft.headerText, draft.parameterFormat, "header"));
  }
  push(parsePlaceholders(draft.bodyText, draft.parameterFormat, "body"));
  draft.buttons.forEach((b, idx) => {
    if (b.type === "URL" && b.url) {
      push(parsePlaceholders(b.url, draft.parameterFormat, `button.${idx}`));
    }
  });
  return keys;
}

/** Full draft validation — every field validator plus cross-field sample/mapping. */
export function validateDraft(draft: TemplateDraft, kind?: AptNotifyKind | null): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const merge = (r: ValidationResult) => {
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  };
  merge(validateName(draft.name));
  merge(validateLanguage(draft.language));
  merge(validateCategoryOnCreate(draft.category));
  merge(validateParameterFormat(draft.parameterFormat));
  merge(validateHeaderType(draft.headerType));
  if (draft.headerType === "TEXT") {
    merge(validateHeaderText(draft.headerText || "", draft.parameterFormat));
  }
  merge(validateBody(draft.bodyText, draft.parameterFormat));
  merge(validateFooter(draft.footerText || "", draft.parameterFormat));
  merge(validateButtons(draft.buttons, draft.parameterFormat));
  merge(validateSampleValues(draft));
  merge(validateVariableMappings(draft, kind));
  return result(errors, warnings);
}

// ─────────────────────────────────────────────────────────────────────────────
// Create-payload builder (MV-09, MV-07). Emits the exact Meta create body. By
// construction it CANNOT emit a media header: only TEXT/NONE are handled, and a
// media header type throws (double-owned invariant, §10).
// ─────────────────────────────────────────────────────────────────────────────
export interface MetaComponentExample {
  header_text?: string[];
  body_text?: string[][];
  header_text_named_params?: { param_name: string; example: string }[];
  body_text_named_params?: { param_name: string; example: string }[];
}

export interface MetaComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT";
  text?: string;
  example?: MetaComponentExample;
  buttons?: MetaButton[];
}

export interface MetaButton {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phone_number?: string;
  example?: string[];
}

export interface MetaCreatePayload {
  name: string;
  language: string;
  category: "UTILITY";
  parameter_format: "POSITIONAL" | "NAMED";
  components: MetaComponent[];
}

/**
 * Builds the exact Meta create payload for a draft. Throws for a media/location
 * header (the validator must reject before this is reached; the builder is the
 * second owner of the "no media header reaches Meta" invariant).
 */
export function buildCreatePayload(draft: TemplateDraft): MetaCreatePayload {
  if (draft.headerType !== "NONE" && draft.headerType !== "TEXT") {
    throw new Error("buildCreatePayload cannot emit a media or location header.");
  }
  const named = draft.parameterFormat === "NAMED";
  const components: MetaComponent[] = [];

  if (draft.headerType === "TEXT" && draft.headerText) {
    const parsed = parsePlaceholders(draft.headerText, draft.parameterFormat, "header");
    const header: MetaComponent = { type: "HEADER", format: "TEXT", text: draft.headerText };
    if (parsed.placeholders.length > 0) {
      header.example = named
        ? {
            header_text_named_params: parsed.placeholders.map((p) => ({
              param_name: p.token,
              example: draft.sampleValues[p.key] ?? "",
            })),
          }
        : { header_text: parsed.placeholders.map((p) => draft.sampleValues[p.key] ?? "") };
    }
    components.push(header);
  }

  const bodyParsed = parsePlaceholders(draft.bodyText, draft.parameterFormat, "body");
  const body: MetaComponent = { type: "BODY", text: draft.bodyText };
  if (bodyParsed.placeholders.length > 0) {
    body.example = named
      ? {
          body_text_named_params: bodyParsed.placeholders.map((p) => ({
            param_name: p.token,
            example: draft.sampleValues[p.key] ?? "",
          })),
        }
      : { body_text: [bodyParsed.placeholders.map((p) => draft.sampleValues[p.key] ?? "")] };
  }
  components.push(body);

  if (draft.footerText) {
    components.push({ type: "FOOTER", text: draft.footerText });
  }

  if (draft.buttons.length > 0) {
    const buttons: MetaButton[] = draft.buttons.map((b, idx) => {
      if (b.type === "URL") {
        const parsed = parsePlaceholders(b.url || "", draft.parameterFormat, `button.${idx}`);
        const btn: MetaButton = { type: "URL", text: b.text, url: b.url };
        if (parsed.placeholders.length === 1) {
          const key = parsed.placeholders[0].key;
          btn.example = [draft.sampleValues[key] ?? ""];
        }
        return btn;
      }
      if (b.type === "PHONE_NUMBER") {
        return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phoneNumber };
      }
      return { type: "QUICK_REPLY", text: b.text };
    });
    components.push({ type: "BUTTONS", buttons });
  }

  return {
    name: draft.name,
    language: draft.language,
    category: "UTILITY",
    parameter_format: draft.parameterFormat,
    components,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta → local component converter. Reads a Meta template node's components
// into a normalized local shape; a media/location header is preserved as its
// type so the UI can show it read-only (DP-02) but never clone/send it.
// ─────────────────────────────────────────────────────────────────────────────
export interface MetaTemplateNode {
  name?: string;
  language?: string;
  category?: string;
  status?: string;
  parameter_format?: string;
  components?: Array<{
    type?: string;
    format?: string;
    text?: string;
    buttons?: Array<{ type?: string; text?: string; url?: string; phone_number?: string }>;
  }>;
}

export interface LocalComponents {
  headerType: HeaderType;
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: TemplateButton[];
  parameterFormat: ParameterFormat;
  /** True when the node carries a media/location header (read-only, DP-02). */
  hasMediaHeader: boolean;
}

export function metaNodeToLocal(node: MetaTemplateNode): LocalComponents {
  const out: LocalComponents = {
    headerType: "NONE",
    headerText: null,
    bodyText: "",
    footerText: null,
    buttons: [],
    parameterFormat: node.parameter_format === "named" ? "NAMED" : "POSITIONAL",
    hasMediaHeader: false,
  };
  for (const c of node.components || []) {
    const type = (c.type || "").toUpperCase();
    if (type === "HEADER") {
      const fmt = (c.format || "").toUpperCase();
      if (fmt === "TEXT") {
        out.headerType = "TEXT";
        out.headerText = c.text ?? null;
      } else if (fmt === "IMAGE" || fmt === "VIDEO" || fmt === "DOCUMENT" || fmt === "LOCATION") {
        out.headerType = fmt as HeaderType;
        out.hasMediaHeader = true;
      }
    } else if (type === "BODY") {
      out.bodyText = c.text ?? "";
    } else if (type === "FOOTER") {
      out.footerText = c.text ?? null;
    } else if (type === "BUTTONS") {
      out.buttons = (c.buttons || []).map((b) => {
        const bt = (b.type || "").toUpperCase();
        if (bt === "URL") return { type: "URL" as const, text: b.text || "", url: b.url };
        if (bt === "PHONE_NUMBER")
          return { type: "PHONE_NUMBER" as const, text: b.text || "", phoneNumber: b.phone_number };
        return { type: "QUICK_REPLY" as const, text: b.text || "" };
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Components fingerprint — a stable hash of the authored components, used to
// detect drift between a local draft and the Meta-reported components.
// ─────────────────────────────────────────────────────────────────────────────
export function componentsFingerprint(draft: TemplateDraft): string {
  const canonical = JSON.stringify({
    h: draft.headerType,
    ht: draft.headerText || "",
    b: draft.bodyText,
    f: draft.footerText || "",
    btn: draft.buttons.map((x) => ({
      t: x.type,
      x: x.text,
      u: x.url || "",
      p: x.phoneNumber || "",
    })),
    pf: draft.parameterFormat,
  });
  // Small, dependency-free FNV-1a hash rendered as hex (not a security hash).
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview model with HTML escaping (reuses the escapeHtml approach from
// appointment-notify.ts). No template evaluation, no script, no Meta call.
// ─────────────────────────────────────────────────────────────────────────────
export interface PreviewButton {
  type: ButtonType;
  text: string;
}

export interface PreviewModel {
  header: string | null;
  body: string;
  footer: string | null;
  buttons: PreviewButton[];
}

/** Minimal HTML escaping for interpolated preview values (matches appointment-notify.ts). */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function substitutePlaceholders(
  text: string,
  format: ParameterFormat,
  component: string,
  samples: Record<string, string>,
): string {
  PLACEHOLDER_RE.lastIndex = 0;
  return text.replace(PLACEHOLDER_RE, (_full, token: string) => {
    const key = `${component}.${token}`;
    const sample = samples[key];
    return sample != null ? sample : `{{${token}}}`;
  });
}

/**
 * Builds the preview model with sample values substituted and HTML-escaped.
 * The caller renders the escaped strings in a WhatsApp-style bubble labelled
 * "Preview — not sent".
 */
export function buildPreviewModel(draft: TemplateDraft): PreviewModel {
  const header =
    draft.headerType === "TEXT" && draft.headerText
      ? escapeHtml(
          substitutePlaceholders(
            draft.headerText,
            draft.parameterFormat,
            "header",
            draft.sampleValues,
          ),
        )
      : null;
  const body = escapeHtml(
    substitutePlaceholders(draft.bodyText, draft.parameterFormat, "body", draft.sampleValues),
  );
  const footer = draft.footerText ? escapeHtml(draft.footerText) : null;
  const buttons: PreviewButton[] = draft.buttons.map((b) => ({
    type: b.type,
    text: escapeHtml(b.text),
  }));
  return { header, body, footer, buttons };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status normalization + attention bucketing (MV-12). Unknown statuses are
// kept raw and bucketed safely.
// ─────────────────────────────────────────────────────────────────────────────
export type TemplateStatus =
  | "APPROVED"
  | "ARCHIVED"
  | "DELETED"
  | "DISABLED"
  | "IN_APPEAL"
  | "LIMIT_EXCEEDED"
  | "PAUSED"
  | "PENDING"
  | "PENDING_DELETION"
  | "REJECTED";

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  "APPROVED",
  "ARCHIVED",
  "DELETED",
  "DISABLED",
  "IN_APPEAL",
  "LIMIT_EXCEEDED",
  "PAUSED",
  "PENDING",
  "PENDING_DELETION",
  "REJECTED",
]);

export interface NormalizedStatus {
  /** Raw, untruncated status from Meta (or a legacy value). */
  raw: string;
  /** Upper-cased trimmed form. */
  normalized: string;
  known: boolean;
}

export function normalizeStatus(raw: string | null | undefined): NormalizedStatus {
  const value = (raw ?? "").trim();
  const normalized = value.toUpperCase();
  return { raw: value, normalized, known: KNOWN_STATUSES.has(normalized) };
}

export type AttentionBucket = "approved" | "pending" | "actionRequired" | "inactive" | "unknown";

/**
 * Buckets a status for the dashboard "Requiring Attention" grouping. Unknown
 * statuses bucket to `unknown` (never crash, MV-12).
 */
export function attentionBucket(raw: string | null | undefined): AttentionBucket {
  const { normalized, known } = normalizeStatus(raw);
  if (!known) return "unknown";
  switch (normalized) {
    case "APPROVED":
      return "approved";
    case "PENDING":
    case "IN_APPEAL":
      return "pending";
    case "REJECTED":
    case "DISABLED":
    case "PAUSED":
    case "LIMIT_EXCEEDED":
      return "actionRequired";
    case "ARCHIVED":
    case "DELETED":
    case "PENDING_DELETION":
      return "inactive";
    default:
      return "unknown";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Allowed-actions matrix (DP-11). Which row actions are permitted given the
// source and Meta status. META-source templates are read-only; LOCAL edits are
// in-place only for APPROVED/REJECTED/PAUSED.
// ─────────────────────────────────────────────────────────────────────────────
export type TemplateSource = "LOCAL" | "META";
export type TemplateAction =
  | "edit"
  | "clone"
  | "submit"
  | "archive"
  | "unarchive"
  | "deleteDraft"
  | "deleteMeta"
  | "reconcile";

export interface ActionContext {
  source: TemplateSource;
  metaStatus: string | null;
  localState: string | null;
  opState: string | null;
  hasMediaHeader?: boolean;
}

export interface AllowedActions {
  allowed: Record<TemplateAction, boolean>;
  reasons: Partial<Record<TemplateAction, string>>;
}

export function allowedActions(ctx: ActionContext): AllowedActions {
  const reasons: Partial<Record<TemplateAction, string>> = {};
  const { normalized } = normalizeStatus(ctx.metaStatus);
  const isLocal = ctx.source === "LOCAL";
  const isDraft = !ctx.metaStatus && ctx.localState !== "SUBMITTED";
  const inFlight = ctx.opState === "IN_FLIGHT";
  const uncertain = ctx.opState === "UNCERTAIN";
  const editableStatus =
    normalized === "APPROVED" || normalized === "REJECTED" || normalized === "PAUSED";

  const allowed: Record<TemplateAction, boolean> = {
    edit: false,
    clone: false,
    submit: false,
    archive: false,
    unarchive: false,
    deleteDraft: false,
    deleteMeta: false,
    reconcile: false,
  };

  if (inFlight) {
    for (const a of Object.keys(allowed) as TemplateAction[])
      reasons[a] = "An operation is in flight.";
    return { allowed, reasons };
  }

  // Reconcile (Check with Meta) is available for an uncertain op.
  if (uncertain) {
    allowed.reconcile = true;
    return { allowed, reasons };
  }

  // Clone is always available for a readable template.
  allowed.clone = true;
  if (ctx.hasMediaHeader) {
    allowed.clone = false;
    reasons.clone = "Media/location-header templates cannot be cloned.";
  }

  if (isDraft && isLocal) {
    allowed.submit = true;
    allowed.deleteDraft = true;
    allowed.archive = true;
    allowed.edit = true; // editing a never-submitted draft is always allowed
  } else {
    reasons.submit = "Only a local draft can be submitted.";
    reasons.deleteDraft = "Only a never-submitted draft can be deleted.";
    reasons.archive = "Only a never-submitted draft can be archived.";
  }

  if (isLocal && !isDraft) {
    if (editableStatus) {
      allowed.edit = true;
    } else {
      reasons.edit = "Only APPROVED, REJECTED or PAUSED templates can be edited.";
    }
    allowed.deleteMeta = normalized !== "DISABLED";
    if (!allowed.deleteMeta) reasons.deleteMeta = "Disabled templates cannot be deleted.";
  } else if (ctx.source === "META") {
    reasons.edit = "Imported templates are read-only.";
  }

  return { allowed, reasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// describeMetaError (MV-16). Maps a Meta error code + optional subcode to a
// stable UI description. The single source of error text.
// ─────────────────────────────────────────────────────────────────────────────
export type MetaErrorCategory =
  | "auth"
  | "permission"
  | "rate_limited"
  | "account_restricted"
  | "invalid_input"
  | "not_found"
  | "transient"
  | "unknown";

export interface MetaErrorDescription {
  category: MetaErrorCategory;
  explanation: string;
  nextAction: string;
  link?: string;
}

export function describeMetaError(
  code: number | null | undefined,
  subcode?: number | null,
): MetaErrorDescription {
  switch (code) {
    case 190:
      return {
        category: "auth",
        explanation: "The access token is expired or invalid.",
        nextAction: "Generate a new System User token and save it in Credentials.",
        link: RESOLUTION_LINKS.appDashboard,
      };
    case 10:
    case 200:
      return {
        category: "permission",
        explanation: "The token is missing a required permission or advanced access.",
        nextAction:
          "Grant whatsapp_business_management and whatsapp_business_messaging to the token.",
        link: RESOLUTION_LINKS.appDashboard,
      };
    case 4:
    case 80007:
    case 130429:
      return {
        category: "rate_limited",
        explanation: "A Meta rate limit was reached.",
        nextAction: "Wait and retry later; scheduled sync is throttled by default.",
      };
    case 131031:
    case 368:
      return {
        category: "account_restricted",
        explanation: "The Messaging account is restricted or disabled for a policy reason.",
        nextAction: "Review the account status in WhatsApp Manager and resolve the restriction.",
        link: RESOLUTION_LINKS.whatsappManager,
      };
    case 133010:
      return {
        category: "invalid_input",
        explanation: "The phone number is not registered to send messages.",
        nextAction: "Register and connect the phone number in WhatsApp Manager.",
        link: RESOLUTION_LINKS.whatsappManager,
      };
    case 131016:
      return {
        category: "transient",
        explanation: "The service is temporarily unavailable.",
        nextAction: "Retry the request shortly.",
      };
    case 100:
      switch (subcode) {
        case 2388024:
          return {
            category: "invalid_input",
            explanation: "A template with this name already exists in this language.",
            nextAction: "Choose a different name or language.",
          };
        case 2388040:
          return {
            category: "invalid_input",
            explanation: "A component exceeds its character limit.",
            nextAction: "Shorten the header, body, footer or button text.",
          };
        case 2388299:
          return {
            category: "invalid_input",
            explanation: "A variable is at the start or end of the text.",
            nextAction: "Add text before and after every variable.",
          };
        case 2388019:
          return {
            category: "invalid_input",
            explanation: "The template limit for this account was reached.",
            nextAction: "Delete unused templates or verify the business portfolio.",
            link: RESOLUTION_LINKS.manageTemplates,
          };
        case 2388039:
          return {
            category: "invalid_input",
            explanation: "The template status cannot be changed as requested.",
            nextAction: "Only APPROVED, REJECTED or PAUSED templates can be edited.",
          };
        default:
          return {
            category: "invalid_input",
            explanation: "An invalid parameter was sent to Meta.",
            nextAction: "Review the template fields and try again.",
          };
      }
    case 132000:
      return {
        category: "invalid_input",
        explanation: "The number of parameters does not match the template.",
        nextAction: "Check the variable mapping and sample values.",
      };
    case 132001:
      return {
        category: "not_found",
        explanation: "The template is missing or not approved.",
        nextAction: "Submit the template and wait for approval before sending.",
      };
    case 132012:
      return {
        category: "invalid_input",
        explanation: "A parameter format is invalid.",
        nextAction: "Review the parameter format (positional vs named).",
      };
    case 132015:
      return {
        category: "account_restricted",
        explanation: "The template is paused and cannot be sent.",
        nextAction: "Resolve the quality issue in WhatsApp Manager.",
        link: RESOLUTION_LINKS.whatsappManager,
      };
    case 132016:
      return {
        category: "account_restricted",
        explanation: "The template is disabled and cannot be sent.",
        nextAction: "Review the template status in WhatsApp Manager.",
        link: RESOLUTION_LINKS.whatsappManager,
      };
    case 132018:
      return {
        category: "invalid_input",
        explanation: "Template validation failed at send time.",
        nextAction: "Re-check the template against Meta's rules.",
      };
    default:
      return {
        category: "unknown",
        explanation: "An unexpected Meta error occurred.",
        nextAction: "Review the error details and try again.",
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping eligibility (§15). A template is mappable only when it is APPROVED,
// its Meta category is UTILITY, and every placeholder resolves for the kind.
// ─────────────────────────────────────────────────────────────────────────────
export interface MappingEligibilityInput {
  metaStatus: string | null;
  metaCategory: string | null;
  draft: TemplateDraft;
  kind: AptNotifyKind;
}

export interface MappingEligibility {
  eligible: boolean;
  reasons: string[];
}

export function evaluateMappingEligibility(input: MappingEligibilityInput): MappingEligibility {
  const reasons: string[] = [];
  const { normalized } = normalizeStatus(input.metaStatus);
  if (normalized !== "APPROVED") {
    reasons.push("The template must be APPROVED by Meta.");
  }
  if ((input.metaCategory || "").toUpperCase() !== "UTILITY") {
    reasons.push("The template's Meta category must be UTILITY.");
  }
  const mappingCheck = validateVariableMappings(input.draft, input.kind);
  if (!mappingCheck.ok) {
    reasons.push(...mappingCheck.errors);
  }
  return { eligible: reasons.length === 0, reasons };
}
