// ─────────────────────────────────────────────────────────────────────────────
// wa-template-presets.ts  (PURE)
//
// The six BookMyTime preset local drafts (DP-07). Each is a UTILITY draft with
// factual, neutral, non-promotional wording (T§9 / MV-18). Variables use only
// catalogue fields that exist (DP-08: name, clinicName, doctorName, date, time,
// bookingCode — NO service name, NO booking URL). Every mapping resolves for its
// suggested kind. `bmt_appointment_rescheduled` has NO matching notify event, so
// it stays unmapped (DP-07; §5 item 22), hence suggestedKind = null.
//
// Positional format throughout. Placeholders are sequential from {{1}} and are
// never leading/trailing/adjacent, so each preset passes validateDraft().
// ─────────────────────────────────────────────────────────────────────────────
import type { AptNotifyKind } from "./appointment-notify";
import type { CatalogueField, TemplateDraft } from "./wa-template-model";

export interface TemplatePreset {
  draft: TemplateDraft;
  /** Internal purpose note (never sent to Meta). */
  purpose: string;
  /** The notify kind this preset is intended for, or null if none exists. */
  suggestedKind: AptNotifyKind | null;
}

/**
 * Runtime metadata for templates that already exist in Meta. These contracts
 * are deliberately separate from TEMPLATE_PRESETS so Sync adopts the existing
 * template instead of offering to submit a duplicate.
 */
export interface PublishedTemplateSpec {
  name: string;
  language: string;
  parameterFormat: "POSITIONAL";
  headerType: "NONE";
  bodyText: string;
  footerText: string | null;
  variableMappings: Record<string, CatalogueField>;
  sampleValues: Record<string, string>;
  notifyKind: AptNotifyKind;
}

export const PUBLISHED_TEMPLATE_SPECS: readonly PublishedTemplateSpec[] = [
  {
    name: "appointment_booked",
    language: "en_US",
    parameterFormat: "POSITIONAL",
    headerType: "NONE",
    bodyText:
      "Hello {{1}},\n\nYour appointment at {{2}} with {{3}} is booked for {{4}} at {{5}}. Your queue number at the clinic is {{6}}.\n\nThank you for choosing us!",
    footerText: "This is an automated notification message.",
    variableMappings: {
      "body.1": "name",
      "body.2": "clinicName",
      "body.3": "doctorName",
      "body.4": "date",
      "body.5": "time",
      "body.6": "tokenNo",
    },
    sampleValues: {
      "body.1": "Priya Sharma",
      "body.2": "CityCare Clinic",
      "body.3": "Dr. Rohan Mehta",
      "body.4": "Tuesday, October 20, 2026",
      "body.5": "10:30 AM",
      "body.6": "7",
    },
    notifyKind: "booked",
  },
];

export function findPublishedTemplateSpec(
  name: string,
  language: string,
): PublishedTemplateSpec | null {
  return (
    PUBLISHED_TEMPLATE_SPECS.find((spec) => spec.name === name && spec.language === language) ??
    null
  );
}

/** Small helper so each preset reads clearly and stays type-checked. */
function preset(
  name: string,
  bodyText: string,
  footerText: string,
  mappings: Record<string, CatalogueField>,
  sampleValues: Record<string, string>,
  purpose: string,
  suggestedKind: AptNotifyKind | null,
): TemplatePreset {
  return {
    draft: {
      name,
      language: "en_US",
      category: "UTILITY",
      parameterFormat: "POSITIONAL",
      headerType: "NONE",
      headerText: null,
      bodyText,
      footerText,
      buttons: [],
      sampleValues,
      variableMappings: mappings,
    },
    purpose,
    suggestedKind,
  };
}

const FOOTER = "BookMyTime appointment notification";

export const TEMPLATE_PRESETS: readonly TemplatePreset[] = [
  preset(
    "bmt_appointment_confirmed",
    "Hello {{1}}, your appointment at {{2}} with {{3}} on {{4}} at {{5}} is confirmed. Your confirmation code is {{6}}.",
    FOOTER,
    {
      "body.1": "name",
      "body.2": "clinicName",
      "body.3": "doctorName",
      "body.4": "date",
      "body.5": "time",
      "body.6": "bookingCode",
    },
    {
      "body.1": "Asha Patel",
      "body.2": "Sunrise Clinic",
      "body.3": "Dr. Mehta",
      "body.4": "Monday, 12 January 2026",
      "body.5": "10:30 AM",
      "body.6": "A1B2C3D4",
    },
    "Sent when an appointment is confirmed.",
    "confirmed",
  ),
  preset(
    "bmt_appointment_reminder",
    "Hello {{1}}, this is a reminder of your appointment at {{2}} with {{3}} on {{4}} at {{5}}. Your confirmation code is {{6}}.",
    FOOTER,
    {
      "body.1": "name",
      "body.2": "clinicName",
      "body.3": "doctorName",
      "body.4": "date",
      "body.5": "time",
      "body.6": "bookingCode",
    },
    {
      "body.1": "Asha Patel",
      "body.2": "Sunrise Clinic",
      "body.3": "Dr. Mehta",
      "body.4": "Monday, 12 January 2026",
      "body.5": "10:30 AM",
      "body.6": "A1B2C3D4",
    },
    "Sent as an appointment reminder (day before by default).",
    "reminderDayBefore",
  ),
  preset(
    "bmt_appointment_rescheduled",
    "Hello {{1}}, your appointment at {{2}} with {{3}} has been rescheduled to {{4}} at {{5}}. Your confirmation code is {{6}}.",
    FOOTER,
    {
      "body.1": "name",
      "body.2": "clinicName",
      "body.3": "doctorName",
      "body.4": "date",
      "body.5": "time",
      "body.6": "bookingCode",
    },
    {
      "body.1": "Asha Patel",
      "body.2": "Sunrise Clinic",
      "body.3": "Dr. Mehta",
      "body.4": "Tuesday, 13 January 2026",
      "body.5": "11:00 AM",
      "body.6": "A1B2C3D4",
    },
    "Reschedule notice. No rescheduled notify event exists, so this preset stays unmapped (DP-07).",
    null,
  ),
  preset(
    "bmt_appointment_cancelled",
    "Hello {{1}}, your appointment at {{2}} on {{3}} at {{4}} has been cancelled. Your confirmation code was {{5}}.",
    FOOTER,
    {
      "body.1": "name",
      "body.2": "clinicName",
      "body.3": "date",
      "body.4": "time",
      "body.5": "bookingCode",
    },
    {
      "body.1": "Asha Patel",
      "body.2": "Sunrise Clinic",
      "body.3": "Monday, 12 January 2026",
      "body.4": "10:30 AM",
      "body.5": "A1B2C3D4",
    },
    "Sent when an appointment is cancelled.",
    "cancelled",
  ),
  preset(
    "bmt_appointment_completed",
    "Hello {{1}}, thank you for visiting {{2}} with {{3}}. Your consultation is complete. Your reference code is {{4}}.",
    FOOTER,
    {
      "body.1": "name",
      "body.2": "clinicName",
      "body.3": "doctorName",
      "body.4": "bookingCode",
    },
    {
      "body.1": "Asha Patel",
      "body.2": "Sunrise Clinic",
      "body.3": "Dr. Mehta",
      "body.4": "A1B2C3D4",
    },
    "Sent when an appointment is completed.",
    "completed",
  ),
  preset(
    "bmt_booking_updated",
    "Hello {{1}}, your booking at {{2}} with {{3}} on {{4}} at {{5}} has been updated. Your confirmation code is {{6}}.",
    FOOTER,
    {
      "body.1": "name",
      "body.2": "clinicName",
      "body.3": "doctorName",
      "body.4": "date",
      "body.5": "time",
      "body.6": "bookingCode",
    },
    {
      "body.1": "Asha Patel",
      "body.2": "Sunrise Clinic",
      "body.3": "Dr. Mehta",
      "body.4": "Monday, 12 January 2026",
      "body.5": "10:30 AM",
      "body.6": "A1B2C3D4",
    },
    "Sent when a booking's token or details are updated.",
    "tokenUpdated",
  ),
];
