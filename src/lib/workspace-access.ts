/**
 * Client-safe workspace access helpers (pure, no I/O, no server imports).
 *
 * A custom-plan workspace is provisioned the moment it is approved, but access
 * is withheld until payment is confirmed. That interim is represented by the
 * `subscriptionStatus` value below. The dashboards and the dashboard gateway
 * import this to bounce a locked owner to the paywall, so the "must pay first"
 * rule lives in exactly one place rather than being re-typed per dashboard.
 */

/** The `User.subscriptionStatus` value for an approved-but-unpaid workspace. */
export const WORKSPACE_PAYMENT_PENDING = "PaymentPending";

/** The route a payment-locked workspace is sent to. */
export const WORKSPACE_UNLOCK_PATH = "/unlock";

/** True when the given subscription status means "provisioned but not yet paid". */
export function isWorkspacePaymentLocked(status?: string | null): boolean {
  return (status ?? "").trim().toLowerCase() === WORKSPACE_PAYMENT_PENDING.toLowerCase();
}
