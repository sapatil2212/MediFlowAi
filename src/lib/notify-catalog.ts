// ─────────────────────────────────────────────────────────────────────────────
// notify-catalog.ts  (PURE, isomorphic)
//
// The BookMyTime WhatsApp Utility template catalog and the event → template
// routing matrix for every supported business category.
//
//   • Business categories are derived from the tenant's registered profession
//     (User.profession). Six exist in the product today.
//   • The four templates already approved on the connected WABA are reused
//     verbatim (origin "approved_existing"). They are clinic-worded ("at the
//     clinic", "consultation", "prescription"), so they route to clinics only.
//   • Missing transactional templates are defined here (origin "catalog_new")
//     with neutral, non-promotional wording, non-sensitive sample values and
//     variables that the application genuinely resolves. They are submitted to
//     Meta as UTILITY by notify-template-catalog.ts and only become routable
//     after Meta reports APPROVED + UTILITY.
//   • Candidates without a real workflow (customer payments, refunds, gym
//     memberships, restaurant table-ready/reschedule) are excluded and listed in
//     EXCLUDED_CANDIDATES with the reason, instead of being submitted.
//
// Healthcare templates carry only scheduling details — never diagnoses,
// treatment, test results or prescription content.
// ─────────────────────────────────────────────────────────────────────────────
import type { AptNotifyKind } from "./appointment-notify";
import type { CatalogueField, TemplateButton, TemplateDraft } from "./wa-template-model";

// ── Business categories ──────────────────────────────────────────────────────
export type BusinessCategory =
  | "clinic"
  | "salon"
  | "gym"
  | "coaching"
  | "restaurant"
  | "professional";

export const BUSINESS_CATEGORIES: readonly BusinessCategory[] = [
  "clinic",
  "salon",
  "gym",
  "coaching",
  "restaurant",
  "professional",
];

export const BUSINESS_CATEGORY_LABELS: Record<BusinessCategory, string> = {
  clinic: "Clinics & healthcare",
  salon: "Salons, spas & beauty",
  gym: "Gyms & fitness",
  coaching: "Coaching & education",
  restaurant: "Restaurants & dining",
  professional: "Professional services",
};

/** The exact User.profession values the product registers (tenant-provisioning.ts). */
export const PROFESSION_TO_CATEGORY: Record<string, BusinessCategory> = {
  "Healthcare and medical": "clinic",
  "Beauty and wellness": "salon",
  "Fitness Gym etc": "gym",
  "Education institutions": "coaching",
  "Restaurant and dining": "restaurant",
  "Professional services like law, consultant, real estate, CA": "professional",
};

/** Maps a tenant profession to its notification category (clinic by default, as signup does). */
export function businessCategoryFromProfession(
  profession: string | null | undefined,
): BusinessCategory {
  const p = String(profession ?? "").trim();
  if (PROFESSION_TO_CATEGORY[p]) return PROFESSION_TO_CATEGORY[p];
  const lower = p.toLowerCase();
  if (lower.startsWith("restaurant")) return "restaurant";
  if (lower.startsWith("beauty")) return "salon";
  if (lower.startsWith("fitness") || lower.includes("gym")) return "gym";
  if (lower.startsWith("education")) return "coaching";
  if (lower.startsWith("professional")) return "professional";
  return "clinic";
}

export function isBusinessCategory(value: unknown): value is BusinessCategory {
  return typeof value === "string" && (BUSINESS_CATEGORIES as readonly string[]).includes(value);
}

/** Wildcard used by WaNotifyMapping rows that apply to every category. */
export const ANY_CATEGORY = "*";

// ── Domain events ────────────────────────────────────────────────────────────
export type NotificationEventType =
  | "booking.created"
  | "booking.confirmed"
  | "booking.rescheduled"
  | "booking.cancelled"
  | "booking.completed"
  | "booking.reminder_due"
  | "queue.updated"
  | "booking.reschedule_needed"
  | "booking.reinstated"
  | "booking.table_changed"
  | "video.link_issued";

export const EVENT_TYPE_LABELS: Record<NotificationEventType, string> = {
  "booking.created": "Booking created",
  "booking.confirmed": "Booking confirmed",
  "booking.rescheduled": "Booking rescheduled",
  "booking.cancelled": "Booking cancelled",
  "booking.completed": "Booking completed",
  "booking.reminder_due": "Reminder due",
  "queue.updated": "Queue number updated",
  "booking.reschedule_needed": "Provider unavailable",
  "booking.reinstated": "Booking reinstated",
  "booking.table_changed": "Table changed",
  "video.link_issued": "Video link issued",
};

/** The notify kinds the engine will attempt for each category. Others are skipped as not applicable. */
export const CATEGORY_KINDS: Record<BusinessCategory, readonly AptNotifyKind[]> = {
  clinic: [
    "booked",
    "confirmed",
    "rescheduled",
    "cancelled",
    "completed",
    "reminderDayBefore",
    "reminder2h",
    "tokenUpdated",
    "rescheduleNeeded",
    "reinstated",
    "videoLinkIssued",
    "videoLinkReissued",
  ],
  salon: ["booked", "rescheduled", "cancelled", "completed", "reminderDayBefore", "reminder2h"],
  gym: ["booked", "rescheduled", "cancelled", "completed", "reminderDayBefore", "reminder2h"],
  coaching: ["booked", "rescheduled", "cancelled", "completed", "reminderDayBefore"],
  restaurant: [
    "restaurantBooked",
    "restaurantTableChanged",
    "cancelled",
    "completed",
    "reminderDayBefore",
    "reminder2h",
  ],
  professional: ["booked", "rescheduled", "cancelled", "reminderDayBefore", "reminder2h"],
};

export function isKindApplicable(category: BusinessCategory, kind: AptNotifyKind): boolean {
  return CATEGORY_KINDS[category].includes(kind);
}

// ── Catalog ──────────────────────────────────────────────────────────────────
export type CatalogOrigin = "approved_existing" | "catalog_new";

export interface CatalogTemplate {
  name: string;
  /** Exact Meta language code. Never normalized between en and en_US. */
  language: string;
  /** Categories routed to this template. */
  appliesTo: readonly BusinessCategory[];
  /** Notify kinds this template serves for those categories. */
  kinds: readonly AptNotifyKind[];
  origin: CatalogOrigin;
  bodyText: string;
  footerText: string | null;
  buttons: TemplateButton[];
  variableMappings: Record<string, CatalogueField>;
  sampleValues: Record<string, string>;
  purpose: string;
}

/** Footer for new templates: states the message is automated and how to opt out. */
export const CATALOG_FOOTER = "Automated message. Reply STOP to opt out.";
const APPROVED_FOOTER = "This is an automated notification message.";

/** Public origin used for the static part of the video join URL button. */
export const DEFAULT_PUBLIC_ORIGIN = "https://bookmytime.tech";

type Fields = readonly CatalogueField[];

function positional(fields: Fields, samples: readonly string[]) {
  const variableMappings: Record<string, CatalogueField> = {};
  const sampleValues: Record<string, string> = {};
  fields.forEach((field, i) => {
    variableMappings[`body.${i + 1}`] = field;
    sampleValues[`body.${i + 1}`] = samples[i];
  });
  return { variableMappings, sampleValues };
}

function entry(
  t: Omit<CatalogTemplate, "variableMappings" | "sampleValues" | "buttons" | "footerText"> & {
    fields: Fields;
    samples: readonly string[];
    footerText?: string | null;
    buttons?: TemplateButton[];
    extraMappings?: Record<string, CatalogueField>;
    extraSamples?: Record<string, string>;
  },
): CatalogTemplate {
  const { fields, samples, extraSamples, extraMappings, ...rest } = t;
  const p = positional(fields, samples);
  return {
    ...rest,
    footerText: t.footerText === undefined ? CATALOG_FOOTER : t.footerText,
    buttons: t.buttons ?? [],
    variableMappings: { ...p.variableMappings, ...(extraMappings ?? {}) },
    sampleValues: { ...p.sampleValues, ...(extraSamples ?? {}) },
  };
}

// Non-sensitive fictional sample values used for Meta review.
const S = {
  name: "Rahul",
  clinic: "City Care Clinic",
  doctor: "Dr. Mehta",
  salon: "Glow Studio",
  gym: "FitZone Gym",
  institute: "Bright Minds Academy",
  restaurant: "Spice Garden",
  firm: "Sharma & Associates",
  date: "28 October 2026",
  time: "10:30 AM",
  token: "12",
  ref: "BK7Q2M9X",
};

/** Builds the catalog. `publicOrigin` fixes the static prefix of the video join button. */
export function buildTemplateCatalog(
  publicOrigin: string = DEFAULT_PUBLIC_ORIGIN,
): CatalogTemplate[] {
  const origin = String(publicOrigin || DEFAULT_PUBLIC_ORIGIN).replace(/\/+$/, "");
  return [
    // ── Clinic: the four templates already APPROVED on the WABA (reused) ──
    entry({
      name: "appointment_booked",
      language: "en_US",
      appliesTo: ["clinic"],
      kinds: ["booked"],
      origin: "approved_existing",
      bodyText:
        "Hello {{1}},\n\nYour appointment at {{2}} with {{3}} is booked for {{4}} at {{5}}. Your queue number at the clinic is {{6}}.\n\nThank you for choosing us!",
      footerText: null,
      fields: ["name", "clinicName", "doctorName", "date", "time", "tokenNo"],
      samples: [S.name, S.clinic, S.doctor, S.date, S.time, S.token],
      purpose: "Booking confirmation sent right after a clinic appointment is created.",
    }),
    entry({
      name: "appointment_cancelled",
      language: "en_US",
      appliesTo: ["clinic"],
      kinds: ["cancelled"],
      origin: "approved_existing",
      bodyText:
        "Hello {{1}},\n\nYour appointment at {{2}} scheduled for {{3}} at {{4}} has been cancelled.\n\nIf this was a mistake or you would like to rebook, please contact the clinic.",
      footerText: APPROVED_FOOTER,
      fields: ["name", "clinicName", "date", "time"],
      samples: [S.name, S.clinic, S.date, S.time],
      purpose: "Sent when a clinic appointment is actually cancelled.",
    }),
    entry({
      name: "appointment_completed",
      language: "en",
      appliesTo: ["clinic"],
      kinds: ["completed"],
      origin: "approved_existing",
      bodyText:
        "Hello {{1}},\n\nThank you for visiting {{2}} with {{3}} today. Your consultation is now complete.\n\nYour prescription and advice, if any, have been recorded. Take care!",
      footerText: APPROVED_FOOTER,
      fields: ["name", "clinicName", "doctorName"],
      samples: [S.name, S.clinic, S.doctor],
      purpose:
        "Sent when a clinic appointment is marked Completed. Clinic-only: clinics record prescriptions and notes in BookMyTime.",
    }),
    entry({
      name: "appointment_reminder_day_before",
      language: "en",
      appliesTo: ["clinic"],
      kinds: ["reminderDayBefore"],
      origin: "approved_existing",
      bodyText:
        "Hello {{1}},\n\nReminder: You have an appointment at {{2}} with {{3}} tomorrow, {{4}} at {{5}}. Your queue number at the clinic is {{6}}.\n\nPlease arrive 10 minutes early. See you soon!",
      footerText: APPROVED_FOOTER,
      fields: ["name", "clinicName", "doctorName", "date", "time", "tokenNo"],
      samples: [S.name, S.clinic, S.doctor, S.date, S.time, S.token],
      purpose: "Day-before reminder for clinic appointments (sent on the previous local day).",
    }),

    // ── Clinic: missing transactional events ──
    entry({
      name: "clinic_booking_confirmed",
      language: "en_US",
      appliesTo: ["clinic"],
      kinds: ["confirmed"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour appointment at {{2}} with {{3}} on {{4}} at {{5}} has been confirmed by the clinic. Your queue number is {{6}}.\n\nPlease arrive 10 minutes early.",
      fields: ["name", "clinicName", "doctorName", "date", "time", "tokenNo"],
      samples: [S.name, S.clinic, S.doctor, S.date, S.time, S.token],
      purpose: "Sent when clinic staff confirm a pending appointment.",
    }),
    entry({
      name: "clinic_booking_rescheduled",
      language: "en_US",
      appliesTo: ["clinic"],
      kinds: ["rescheduled"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour appointment at {{2}} with {{3}} has been rescheduled to {{4}} at {{5}}. Your queue number is {{6}}.\n\nIf the new time does not suit you, please contact the clinic.",
      fields: ["name", "clinicName", "doctorName", "date", "time", "tokenNo"],
      samples: [S.name, S.clinic, S.doctor, S.date, S.time, S.token],
      purpose: "Sent when the date or time of a clinic appointment changes.",
    }),
    entry({
      name: "clinic_reminder_2h",
      language: "en_US",
      appliesTo: ["clinic"],
      kinds: ["reminder2h"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nReminder: your appointment at {{2}} with {{3}} is today at {{4}}. Your queue number is {{5}}.\n\nPlease arrive 10 minutes early.",
      fields: ["name", "clinicName", "doctorName", "time", "tokenNo"],
      samples: [S.name, S.clinic, S.doctor, S.time, S.token],
      purpose: "Optional same-day reminder about two hours before a clinic appointment.",
    }),
    entry({
      name: "clinic_queue_updated",
      language: "en_US",
      appliesTo: ["clinic"],
      kinds: ["tokenUpdated"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour queue number for your appointment at {{2}} with {{3}} on {{4}} at {{5}} is now {{6}}.\n\nYour appointment date and time have not changed.",
      fields: ["name", "clinicName", "doctorName", "date", "time", "tokenNo"],
      samples: [S.name, S.clinic, S.doctor, S.date, S.time, "14"],
      purpose: "Sent once when the clinic's queue order changes a patient's queue number.",
    }),
    entry({
      name: "clinic_doctor_unavailable",
      language: "en_US",
      appliesTo: ["clinic"],
      kinds: ["rescheduleNeeded"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\n{{2}} is unavailable for your appointment at {{3}} on {{4}} at {{5}}. Please contact the clinic to choose a new time.\n\nWe apologise for the inconvenience.",
      fields: ["name", "doctorName", "clinicName", "date", "time"],
      samples: [S.name, S.doctor, S.clinic, S.date, S.time],
      purpose: "Sent when the doctor's leave makes an appointment need rescheduling.",
    }),
    entry({
      name: "clinic_booking_reinstated",
      language: "en_US",
      appliesTo: ["clinic"],
      kinds: ["reinstated"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour appointment at {{2}} with {{3}} on {{4}} at {{5}} will go ahead as originally scheduled.\n\nPlease arrive 10 minutes early.",
      fields: ["name", "clinicName", "doctorName", "date", "time"],
      samples: [S.name, S.clinic, S.doctor, S.date, S.time],
      purpose: "Sent when a doctor's leave is withdrawn and the appointment is reinstated.",
    }),
    entry({
      name: "clinic_video_consultation_link",
      language: "en_US",
      appliesTo: ["clinic"],
      kinds: ["videoLinkIssued", "videoLinkReissued"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour video consultation at {{2}} with {{3}} is scheduled for {{4}} at {{5}}.\n\nUse the button below to join at your appointment time. You will wait briefly until the doctor admits you.",
      fields: ["name", "clinicName", "doctorName", "date", "time"],
      samples: [S.name, S.clinic, S.doctor, S.date, S.time],
      buttons: [{ type: "URL", text: "Join consultation", url: `${origin}/consult/{{1}}` }],
      extraMappings: { "button.0.1": "joinToken" },
      // Meta reviews URL-button examples as the full resolved URL.
      extraSamples: { "button.0.1": `${origin}/consult/AbCdEf123456` },
      purpose: "Delivers the patient's personal video consultation join link.",
    }),

    // ── Salons, spas & beauty ──
    entry({
      name: "salon_booking_confirmed",
      language: "en_US",
      appliesTo: ["salon"],
      kinds: ["booked"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour {{2}} appointment at {{3}} is confirmed for {{4}} at {{5}}.\n\nYour booking reference is {{6}}. Please arrive a few minutes early. If you need to make any changes, contact the salon directly before your appointment.\n\nWe look forward to seeing you.",
      fields: ["name", "serviceName", "clinicName", "date", "time", "bookingCode"],
      samples: [S.name, "Hair Spa", S.salon, S.date, S.time, S.ref],
      purpose: "Booking confirmation for salon, spa and beauty appointments.",
    }),
    entry({
      name: "salon_booking_rescheduled",
      language: "en_US",
      appliesTo: ["salon"],
      kinds: ["rescheduled"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour {{2}} appointment at {{3}} has been rescheduled to {{4}} at {{5}}.\n\nBooking reference: {{6}}. Please contact the salon if the new time does not suit you.",
      fields: ["name", "serviceName", "clinicName", "date", "time", "bookingCode"],
      samples: [S.name, "Hair Spa", S.salon, S.date, S.time, S.ref],
      purpose: "Sent when a salon appointment moves to a new date or time.",
    }),
    entry({
      name: "salon_reminder_24h",
      language: "en_US",
      appliesTo: ["salon"],
      kinds: ["reminderDayBefore"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nReminder: your {{2}} appointment at {{3}} is tomorrow, {{4}} at {{5}}.\n\nBooking reference: {{6}}. See you soon.",
      fields: ["name", "serviceName", "clinicName", "date", "time", "bookingCode"],
      samples: [S.name, "Hair Spa", S.salon, S.date, S.time, S.ref],
      purpose: "Day-before reminder for salon appointments.",
    }),
    entry({
      name: "salon_reminder_2h",
      language: "en_US",
      appliesTo: ["salon"],
      kinds: ["reminder2h"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nReminder: your {{2}} appointment at {{3}} is today at {{4}}.\n\nBooking reference: {{5}}. See you soon.",
      fields: ["name", "serviceName", "clinicName", "time", "bookingCode"],
      samples: [S.name, "Hair Spa", S.salon, S.time, S.ref],
      purpose: "Optional same-day reminder for salon appointments.",
    }),
    entry({
      name: "salon_booking_cancelled",
      language: "en_US",
      appliesTo: ["salon"],
      kinds: ["cancelled"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour {{2}} appointment at {{3}} on {{4}} at {{5}} has been cancelled.\n\nBooking reference: {{6}}. Please contact the salon if you would like to rebook.",
      fields: ["name", "serviceName", "clinicName", "date", "time", "bookingCode"],
      samples: [S.name, "Hair Spa", S.salon, S.date, S.time, S.ref],
      purpose: "Sent when a salon appointment is cancelled.",
    }),
    entry({
      name: "salon_service_completed",
      language: "en_US",
      appliesTo: ["salon"],
      kinds: ["completed"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour {{2}} appointment at {{3}} is now complete. Booking reference: {{4}}.\n\nThank you for visiting.",
      fields: ["name", "serviceName", "clinicName", "bookingCode"],
      samples: [S.name, "Hair Spa", S.salon, S.ref],
      purpose: "Sent when a salon appointment is marked Completed.",
    }),

    // ── Gyms & fitness ──
    entry({
      name: "gym_session_confirmed",
      language: "en_US",
      appliesTo: ["gym"],
      kinds: ["booked"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour {{2}} at {{3}} is booked for {{4}} at {{5}}.\n\nBooking reference: {{6}}. Please arrive 10 minutes early.",
      fields: ["name", "serviceName", "clinicName", "date", "time", "bookingCode"],
      samples: [S.name, "Trial Session", S.gym, S.date, S.time, S.ref],
      purpose: "Booking confirmation for gym and fitness sessions.",
    }),
    entry({
      name: "gym_session_rescheduled",
      language: "en_US",
      appliesTo: ["gym"],
      kinds: ["rescheduled"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour {{2}} at {{3}} has been rescheduled to {{4}} at {{5}}.\n\nBooking reference: {{6}}. Please contact the gym if the new time does not suit you.",
      fields: ["name", "serviceName", "clinicName", "date", "time", "bookingCode"],
      samples: [S.name, "Trial Session", S.gym, S.date, S.time, S.ref],
      purpose: "Sent when a gym session moves to a new date or time.",
    }),
    entry({
      name: "gym_session_reminder",
      language: "en_US",
      appliesTo: ["gym"],
      kinds: ["reminderDayBefore", "reminder2h"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nReminder: your {{2}} at {{3}} is scheduled for {{4}} at {{5}}.\n\nBooking reference: {{6}}. See you soon.",
      fields: ["name", "serviceName", "clinicName", "date", "time", "bookingCode"],
      samples: [S.name, "Trial Session", S.gym, S.date, S.time, S.ref],
      purpose: "Day-before and optional same-day reminder for gym sessions.",
    }),
    entry({
      name: "gym_session_cancelled",
      language: "en_US",
      appliesTo: ["gym"],
      kinds: ["cancelled"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour {{2}} at {{3}} on {{4}} at {{5}} has been cancelled.\n\nBooking reference: {{6}}. Please contact the gym if you would like to rebook.",
      fields: ["name", "serviceName", "clinicName", "date", "time", "bookingCode"],
      samples: [S.name, "Trial Session", S.gym, S.date, S.time, S.ref],
      purpose: "Sent when a gym session is cancelled.",
    }),
    entry({
      name: "gym_session_completed",
      language: "en_US",
      appliesTo: ["gym"],
      kinds: ["completed"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour {{2}} at {{3}} is now complete. Booking reference: {{4}}.\n\nThank you for training with us.",
      fields: ["name", "serviceName", "clinicName", "bookingCode"],
      samples: [S.name, "Trial Session", S.gym, S.ref],
      purpose: "Sent when a gym session is marked Completed.",
    }),

    // ── Coaching & education (bookings are date-only on the public form) ──
    entry({
      name: "coaching_session_confirmed",
      language: "en_US",
      appliesTo: ["coaching"],
      kinds: ["booked"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour session at {{2}} is booked for {{3}}.\n\nBooking reference: {{4}}. Please share this reference when you arrive.",
      fields: ["name", "clinicName", "date", "bookingCode"],
      samples: [S.name, S.institute, S.date, S.ref],
      purpose: "Booking confirmation for coaching, tutoring and education visits.",
    }),
    entry({
      name: "coaching_session_rescheduled",
      language: "en_US",
      appliesTo: ["coaching"],
      kinds: ["rescheduled"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour session at {{2}} has been rescheduled to {{3}}.\n\nBooking reference: {{4}}. Please contact the institute if the new date does not suit you.",
      fields: ["name", "clinicName", "date", "bookingCode"],
      samples: [S.name, S.institute, S.date, S.ref],
      purpose: "Sent when a coaching booking moves to a new date.",
    }),
    entry({
      name: "coaching_class_reminder",
      language: "en_US",
      appliesTo: ["coaching"],
      kinds: ["reminderDayBefore"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nReminder: your session at {{2}} is tomorrow, {{3}}.\n\nBooking reference: {{4}}. See you there.",
      fields: ["name", "clinicName", "date", "bookingCode"],
      samples: [S.name, S.institute, S.date, S.ref],
      purpose: "Day-before reminder for coaching bookings.",
    }),
    entry({
      name: "coaching_session_cancelled",
      language: "en_US",
      appliesTo: ["coaching"],
      kinds: ["cancelled"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour session at {{2}} on {{3}} has been cancelled.\n\nBooking reference: {{4}}. Please contact the institute if you would like to rebook.",
      fields: ["name", "clinicName", "date", "bookingCode"],
      samples: [S.name, S.institute, S.date, S.ref],
      purpose: "Sent when a coaching booking is cancelled.",
    }),
    entry({
      name: "coaching_class_completed",
      language: "en_US",
      appliesTo: ["coaching"],
      kinds: ["completed"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour session at {{2}} is now marked as complete. Booking reference: {{3}}.\n\nThank you for attending.",
      fields: ["name", "clinicName", "bookingCode"],
      samples: [S.name, S.institute, S.ref],
      purpose: "Sent when a coaching booking is marked Completed.",
    }),

    // ── Restaurants & dining ──
    entry({
      name: "restaurant_reservation_confirmed",
      language: "en_US",
      appliesTo: ["restaurant"],
      kinds: ["restaurantBooked"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour table reservation at {{2}} is confirmed for {{3}} at {{4}}. Party size: {{5}}.\n\nReservation reference: {{6}}. Please arrive on time to keep your table.",
      fields: ["name", "clinicName", "date", "time", "partySize", "bookingCode"],
      samples: [S.name, S.restaurant, S.date, "8:00 PM", "4", S.ref],
      purpose: "Reservation confirmation sent when a table booking is created.",
    }),
    entry({
      name: "restaurant_reservation_reminder",
      language: "en_US",
      appliesTo: ["restaurant"],
      kinds: ["reminderDayBefore", "reminder2h"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nReminder: your table reservation at {{2}} is on {{3}} at {{4}}. Party size: {{5}}.\n\nReservation reference: {{6}}. Please contact the restaurant if your plans change.",
      fields: ["name", "clinicName", "date", "time", "partySize", "bookingCode"],
      samples: [S.name, S.restaurant, S.date, "8:00 PM", "4", S.ref],
      purpose: "Day-before and optional same-day reminder for table reservations.",
    }),
    entry({
      name: "restaurant_reservation_cancelled",
      language: "en_US",
      appliesTo: ["restaurant"],
      kinds: ["cancelled"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour table reservation at {{2}} for {{3}} at {{4}} has been cancelled.\n\nReservation reference: {{5}}. Please contact the restaurant if you would like to rebook.",
      fields: ["name", "clinicName", "date", "time", "bookingCode"],
      samples: [S.name, S.restaurant, S.date, "8:00 PM", S.ref],
      purpose: "Sent when a table reservation is cancelled.",
    }),
    entry({
      name: "restaurant_table_changed",
      language: "en_US",
      appliesTo: ["restaurant"],
      kinds: ["restaurantTableChanged"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour reservation at {{2}} on {{3}} at {{4}} has been moved to table {{5}}.\n\nReservation reference: {{6}}. Your reservation time has not changed.",
      fields: ["name", "clinicName", "date", "time", "tableName", "bookingCode"],
      samples: [S.name, S.restaurant, S.date, "8:00 PM", "T4", S.ref],
      purpose: "Sent when staff move a reservation to a different table.",
    }),
    entry({
      name: "restaurant_reservation_completed",
      language: "en_US",
      appliesTo: ["restaurant"],
      kinds: ["completed"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour reservation at {{2}} on {{3}} is now complete. Reservation reference: {{4}}.\n\nThank you for dining with us.",
      fields: ["name", "clinicName", "date", "bookingCode"],
      samples: [S.name, S.restaurant, S.date, S.ref],
      purpose: "Sent when a reservation is marked Completed.",
    }),

    // ── Shared (professional services and other appointment businesses) ──
    entry({
      name: "booking_confirmed",
      language: "en_US",
      appliesTo: ["professional"],
      kinds: ["booked"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour {{2}} with {{3}} is booked for {{4}} at {{5}}.\n\nBooking reference: {{6}}. Please contact the office if you need to make changes.",
      fields: ["name", "serviceName", "clinicName", "date", "time", "bookingCode"],
      samples: [S.name, "Initial Consultation", S.firm, S.date, S.time, S.ref],
      purpose: "Booking confirmation for professional-service appointments.",
    }),
    entry({
      name: "booking_rescheduled",
      language: "en_US",
      appliesTo: ["professional"],
      kinds: ["rescheduled"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour {{2}} with {{3}} has been rescheduled to {{4}} at {{5}}.\n\nBooking reference: {{6}}. Please contact the office if the new time does not suit you.",
      fields: ["name", "serviceName", "clinicName", "date", "time", "bookingCode"],
      samples: [S.name, "Initial Consultation", S.firm, S.date, S.time, S.ref],
      purpose: "Sent when a professional-service appointment moves.",
    }),
    entry({
      name: "booking_reminder",
      language: "en_US",
      appliesTo: ["professional"],
      kinds: ["reminderDayBefore", "reminder2h"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nReminder: your {{2}} with {{3}} is scheduled for {{4}} at {{5}}.\n\nBooking reference: {{6}}. Please be on time.",
      fields: ["name", "serviceName", "clinicName", "date", "time", "bookingCode"],
      samples: [S.name, "Initial Consultation", S.firm, S.date, S.time, S.ref],
      purpose: "Day-before and optional same-day reminder for professional services.",
    }),
    entry({
      name: "booking_cancelled",
      language: "en_US",
      appliesTo: ["professional"],
      kinds: ["cancelled"],
      origin: "catalog_new",
      bodyText:
        "Hello {{1}},\n\nYour {{2}} with {{3}} on {{4}} at {{5}} has been cancelled.\n\nBooking reference: {{6}}. Please contact the office if you would like to rebook.",
      fields: ["name", "serviceName", "clinicName", "date", "time", "bookingCode"],
      samples: [S.name, "Initial Consultation", S.firm, S.date, S.time, S.ref],
      purpose: "Sent when a professional-service appointment is cancelled.",
    }),
  ];
}

/** The catalog with the default public origin (display / tests). */
export const TEMPLATE_CATALOG: readonly CatalogTemplate[] = buildTemplateCatalog();

/** Candidates from the product brief that are deliberately NOT submitted. */
export const EXCLUDED_CANDIDATES: ReadonlyArray<{ name: string; reason: string }> = [
  {
    name: "clinic_booking_cancelled",
    reason: "Reuses the approved appointment_cancelled template (same event and variables).",
  },
  {
    name: "clinic_reminder_24h",
    reason: "Reuses the approved appointment_reminder_day_before template.",
  },
  {
    name: "clinic_visit_completed",
    reason:
      "Reuses the approved appointment_completed template; clinics record prescriptions/notes in BookMyTime, so its wording is accurate.",
  },
  {
    name: "gym_membership_payment_received",
    reason: "BookMyTime has no customer membership-payment workflow.",
  },
  {
    name: "coaching_fee_payment_received",
    reason: "BookMyTime has no student fee-payment workflow.",
  },
  {
    name: "payment_received / payment_failed / refund_processed",
    reason:
      "Payments in BookMyTime are tenant subscription payments to the platform, not customer payments; there is no customer transaction to notify.",
  },
  {
    name: "restaurant_reservation_rescheduled",
    reason:
      "Restaurant reservations cannot change date or time in the product (only table/status).",
  },
  {
    name: "restaurant_table_ready",
    reason: "There is no waitlist or table-ready status that could trigger it reliably.",
  },
];

/** A (category, kind) → template route derived from the catalog. */
export interface CatalogRoute {
  businessCategory: BusinessCategory;
  kind: AptNotifyKind;
  templateName: string;
  language: string;
  origin: CatalogOrigin;
}

export function catalogRoutes(
  catalog: readonly CatalogTemplate[] = TEMPLATE_CATALOG,
): CatalogRoute[] {
  const routes: CatalogRoute[] = [];
  for (const t of catalog) {
    for (const businessCategory of t.appliesTo) {
      for (const kind of t.kinds) {
        routes.push({
          businessCategory,
          kind,
          templateName: t.name,
          language: t.language,
          origin: t.origin,
        });
      }
    }
  }
  return routes;
}

export function findCatalogTemplate(
  name: string,
  language: string,
  catalog: readonly CatalogTemplate[] = TEMPLATE_CATALOG,
): CatalogTemplate | null {
  return catalog.find((t) => t.name === name && t.language === language) ?? null;
}

/** The catalog route for (category, kind), if the catalog defines one. */
export function catalogRouteFor(
  category: BusinessCategory,
  kind: AptNotifyKind,
  catalog: readonly CatalogTemplate[] = TEMPLATE_CATALOG,
): CatalogRoute | null {
  return (
    catalogRoutes(catalog).find((r) => r.businessCategory === category && r.kind === kind) ?? null
  );
}

/** A catalog entry as a local template draft (for validation and Meta submission). */
export function catalogEntryToDraft(t: CatalogTemplate): TemplateDraft {
  return {
    name: t.name,
    language: t.language,
    category: "UTILITY",
    parameterFormat: "POSITIONAL",
    headerType: "NONE",
    headerText: null,
    bodyText: t.bodyText,
    footerText: t.footerText,
    buttons: t.buttons,
    sampleValues: t.sampleValues,
    variableMappings: t.variableMappings,
  };
}

// ── Tenant notification preferences ──────────────────────────────────────────
/** Tenant preference switch that governs each notify kind. */
export type TenantNotifySwitch =
  | "confirmations"
  | "reschedules"
  | "cancellations"
  | "completions"
  | "reminderDayBefore"
  | "reminder2h"
  | "queueUpdates";

export const KIND_SWITCH: Record<AptNotifyKind, TenantNotifySwitch> = {
  booked: "confirmations",
  confirmed: "confirmations",
  restaurantBooked: "confirmations",
  videoLinkIssued: "confirmations",
  videoLinkReissued: "confirmations",
  rescheduled: "reschedules",
  rescheduleNeeded: "reschedules",
  reinstated: "reschedules",
  restaurantTableChanged: "reschedules",
  cancelled: "cancellations",
  completed: "completions",
  reminderDayBefore: "reminderDayBefore",
  reminderDayOf: "reminderDayBefore",
  reminder2h: "reminder2h",
  reminder1h: "reminder2h",
  tokenUpdated: "queueUpdates",
};

export const TENANT_SWITCH_LABELS: Record<TenantNotifySwitch, string> = {
  confirmations: "Booking confirmations",
  reschedules: "Reschedule and change notices",
  cancellations: "Cancellation notices",
  completions: "Visit completed messages",
  reminderDayBefore: "Day-before reminders",
  reminder2h: "Two-hour reminders",
  queueUpdates: "Queue number updates",
};
