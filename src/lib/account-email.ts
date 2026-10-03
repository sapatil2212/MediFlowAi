/**
 * account-email.ts
 *
 * Pure, isomorphic helpers for login-email uniqueness. No I/O.
 *
 * Why uniqueness is GLOBAL, not per-workspace: the login handler resolves a
 * username by trying `User` first, then `SubUser ... WHERE email = ? LIMIT 1`
 * across every tenant. Two accounts sharing an address therefore cannot both
 * sign in — the second one is either shadowed by the owner account or lands in
 * whichever tenant's row the database returns first. Creating such an account
 * has to be refused up front.
 */

/** Which kind of existing account already holds an email address. */
export type EmailConflictKind =
  | "same_workspace_sub_user"
  | "owner_account"
  | "other_sub_user"
  | "location_account";

/** Canonical form used for both storage and comparison. */
export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/**
 * Deliberately simple shape check — the browser's `type="email"` and the
 * login lookup are the real arbiters. This only rejects input that can never
 * be a usable login (missing "@", spaces, no dot in the domain).
 */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * User-facing message for a conflict. Messages for accounts outside the
 * caller's workspace stay generic so they never reveal another clinic's
 * details — only that the address is taken.
 */
export function emailConflictMessage(kind: EmailConflictKind): string {
  switch (kind) {
    case "same_workspace_sub_user":
      return "A user with this email ID is already registered in your workspace. Use a different email.";
    case "owner_account":
      return "This email ID is already registered as a workspace owner account. Use a different email.";
    case "location_account":
      return "This email ID is already registered as a branch/location login. Use a different email.";
    case "other_sub_user":
    default:
      return "This email ID is already registered with another account. Use a different email.";
  }
}

/** MariaDB/MySQL duplicate-key error, raised if a concurrent insert wins the race. */
export function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; errno?: unknown; message?: unknown };
  return (
    e.code === "ER_DUP_ENTRY" ||
    e.errno === 1062 ||
    (typeof e.message === "string" && e.message.includes("Duplicate entry"))
  );
}
