// ─────────────────────────────────────────────────────────────────────────────
// doctor-absence.ts  (PURE, isomorphic)
//
// The urgent-absence reasons staff can pick in the Doctor Directory, and the
// short patient-facing wording each one becomes inside the approved WhatsApp
// utility template `clinic_doctor_leave_notice`:
//
//   "Dr. Mehta is unavailable due to {{reason}}, so your appointment ..."
//
// Wording is deliberately general (no diagnosis or personal detail) because it
// is sent to every affected patient. A custom reason typed by staff is cleaned
// to one short line so it always fits the template variable.
// ─────────────────────────────────────────────────────────────────────────────

export interface AbsenceReasonOption {
  /** Value stored on the leave record and shown in the dashboard. */
  value: string;
  /** Phrase inserted after "unavailable due to". */
  patientText: string;
}

export const ABSENCE_REASONS: readonly AbsenceReasonOption[] = [
  { value: "Medical Emergency", patientText: "a medical emergency" },
  { value: "Severe Health Illness", patientText: "a sudden illness" },
  { value: "Family Emergency", patientText: "a family emergency" },
  { value: "Critical On-Call Duty", patientText: "urgent on-call duty" },
  { value: "Emergency Travel", patientText: "unexpected travel" },
  { value: "Personal Emergency", patientText: "a personal emergency" },
];

/** Generic wording used when no reason is available. */
export const DEFAULT_ABSENCE_TEXT = "an unforeseen emergency";

/** Longest custom reason sent to patients. Keeps the message readable. */
export const MAX_CUSTOM_REASON = 60;

/** Cleans a custom reason to one short line with no template-breaking characters. */
export function cleanCustomReason(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[{}*_~`]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, MAX_CUSTOM_REASON)
    .trim();
}

/**
 * Patient-facing reason text. A custom reason, when given, replaces the preset
 * wording, so staff control exactly what patients read.
 */
export function absenceReasonText(input: {
  reason?: string | null;
  customReason?: string | null;
}): string {
  const custom = cleanCustomReason(input.customReason);
  if (custom) {
    // Start lowercase so it reads naturally after "due to", unless it is an
    // acronym or proper noun the staff member capitalised on purpose.
    return /^[A-Z][a-z]/.test(custom) ? custom[0].toLowerCase() + custom.slice(1) : custom;
  }
  const preset = ABSENCE_REASONS.find((r) => r.value === input.reason);
  return preset ? preset.patientText : DEFAULT_ABSENCE_TEXT;
}
