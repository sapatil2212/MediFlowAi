/**
 * staff-permissions.ts
 *
 * Role policy for actions that have no plan-gated FeatureId of their own (clinic
 * configuration, staff accounts, billing visibility), plus role-only views of
 * the existing ROLE_PERMISSIONS for features (scribe, video, WhatsApp).
 *
 * Pure and isomorphic: the server enforces it and the dashboard uses the same
 * answers to decide what to render, so the UI can never offer an action the
 * server will refuse — and vice versa.
 *
 * Deliberately role-only. Plan and subscription gating stay in
 * feature-access.ts; folding them in here would change behaviour for owners on
 * unusual subscription states, which is out of scope for a permissions fix.
 */

import { rolePermission, type AccountRole } from "./feature-access";

export type StaffAction =
  /** Clinic identity: name, owner/clinician name, phone, public contact details. */
  | "manage_clinic_profile"
  /** Working hours, departments, doctor directory create/edit/delete. */
  | "manage_clinic_config"
  /** Day-to-day doctor availability: weekly schedule, leaves, urgent absence. */
  | "manage_doctor_availability"
  /** Create / edit / delete staff logins. */
  | "manage_users"
  /** List branch (location) accounts. */
  | "view_locations"
  /** SOAP notes, prescriptions, AI scribe, prescription emails. */
  | "clinical_records"
  /** Book or switch an appointment to a video consultation. */
  | "video"
  /** Any WhatsApp action that sends, configures or (re)connects. */
  | "whatsapp_operate"
  /**
   * Send operational patient notices tied to a doctor's availability (urgent
   * absence, leave cancelled / reinstated) through the clinic's connected
   * WhatsApp session. Deliberately narrower than whatsapp_operate: it can't
   * connect, configure, broadcast or run campaigns.
   */
  | "send_patient_notices"
  /** Subscription, billing and payment details. */
  | "view_billing";

const ROLE_SETS: Partial<Record<StaffAction, readonly AccountRole[]>> = {
  manage_clinic_profile: ["admin"],
  manage_clinic_config: ["admin", "location"],
  // Front-desk staff routinely record a doctor's leave; doctors manage their own.
  manage_doctor_availability: ["admin", "location", "reception", "doctor"],
  // Whoever may record the absence may also tell the affected patients.
  send_patient_notices: ["admin", "location", "reception", "doctor"],
  view_locations: ["admin", "location"],
};

function normalizeRole(role: unknown): AccountRole {
  return role === "reception" || role === "doctor" || role === "location" ? role : "admin";
}

/** True when `role` may perform `action`. Unknown roles resolve to the owner. */
export function canPerform(role: unknown, action: StaffAction): boolean {
  const r = normalizeRole(role);
  switch (action) {
    case "manage_users":
      return rolePermission(r, "users") === "operate";
    case "clinical_records":
      return rolePermission(r, "scribe") === "operate";
    case "video":
      return rolePermission(r, "video") === "operate";
    case "whatsapp_operate":
      return rolePermission(r, "whatsapp") === "operate";
    case "view_billing":
      return rolePermission(r, "plans") === "operate";
    default:
      return (ROLE_SETS[action] ?? []).includes(r);
  }
}

/** Throws a user-facing error when `role` may not perform `action`. */
export function assertCanPerform(role: unknown, action: StaffAction): void {
  if (!canPerform(role, action)) {
    throw new Error("You do not have permission to perform this action.");
  }
}

/** Human label for a role, for UI chips. */
export function roleLabel(role: unknown): string {
  switch (normalizeRole(role)) {
    case "reception":
      return "Reception";
    case "doctor":
      return "Doctor";
    case "location":
      return "Branch";
    default:
      return "Hosp. Admin";
  }
}
