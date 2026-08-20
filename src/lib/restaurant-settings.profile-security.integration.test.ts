/**
 * restaurant-settings.profile-security.integration.test.ts
 *
 * Account-security lifecycle integration suite (spec
 * `.kiro/specs/restaurant-dashboard-settings`, task 5.10, Req 2.14-2.24, 11.1).
 *
 * Where `restaurant-settings.test.ts` exercises each email/password branch with
 * per-scenario mocks, this suite wires the REAL `createRestaurantAccountEmail
 * Service` and `createRestaurantAccountPasswordService` to ONE stateful,
 * in-memory account+verification store and drives complete request -> resend ->
 * confirm sequences end to end. It proves the same store behaves correctly for
 * the three account roles (User / SubUser / Location), that email uniqueness is
 * enforced globally and case-insensitively, that a concurrently-claimed address
 * loses the transactional recheck, and that every failure leaves the stored
 * email and password hash untouched.
 *
 * All persistence, hashing timing and the clock are injected fakes, so the suite
 * touches no database, cookie, or email transport. Passwords use the production
 * bcrypt dependency so the current-password check is a genuine hash comparison.
 */
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveFeatureAccess, type AccountContext } from "./feature-access";
import {
  MSG_CURRENT_PASSWORD_INCORRECT,
  MSG_EMAIL_ALREADY_CURRENT,
  MSG_EMAIL_ALREADY_IN_USE,
  MSG_PASSWORD_MIN_LENGTH,
  MSG_PASSWORDS_DO_NOT_MATCH,
  MSG_VERIFICATION_INVALID_OR_EXPIRED,
  normaliseEmail,
  RESTAURANT_SETTINGS_LIMITS as LIMITS,
  type AccountType,
  type RestaurantSettingsAccountRole,
} from "./restaurant-settings-model";
import {
  createRestaurantAccountEmailService,
  createRestaurantAccountPasswordService,
  MSG_EMAIL_VERIFICATION_NONE_PENDING,
  MSG_EMAIL_VERIFICATION_RESEND_TOO_SOON,
  type AuthenticatedRestaurantSettingsContext,
} from "./restaurant-settings";
import type {
  AccountEmailChangeResult,
  AccountSecuritySnapshot,
  SaveEmailVerificationInput,
  StoredEmailVerification,
} from "./restaurant-settings.server";

const TENANT_ID = "tenant-a";
const BASE_NOW = Date.UTC(2026, 3, 1, 0, 0, 0);
const FIVE_MINUTES_MS = LIMITS.verificationCodeValidityMs;
const SIXTY_SECONDS_MS = LIMITS.verificationResendDelayMs;

interface StoredAccount {
  accountType: AccountType;
  accountId: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  profilePhoto: string | null;
}

/** Account-bound deterministic code hash, matching the production binding shape. */
function fakeHash(binding: { accountType: string; accountId: string }, code: string): string {
  return `hash:${binding.accountType}:${binding.accountId}:${code}`;
}

/**
 * One stateful in-memory store standing in for every account-security repository
 * method. Uniqueness is enforced globally across all account types, exactly like
 * the transactional MariaDB uniqueness key.
 */
function createStore(seed: readonly StoredAccount[]) {
  const accounts = seed.map((account) => ({ ...account }));
  const verifications: StoredEmailVerification[] = [];
  const deliveredCodes: Array<{ email: string; code: string }> = [];
  let now = BASE_NOW;
  let idCounter = 0;
  let codeCounter = 1000;

  const key = (accountType: AccountType, accountId: string) => `${accountType}:${accountId}`;

  function findAccount(accountType: AccountType, accountId: string): StoredAccount | undefined {
    return accounts.find((a) => a.accountType === accountType && a.accountId === accountId);
  }

  function emailAvailable(email: string, current: { accountType: AccountType; accountId: string }) {
    const target = normaliseEmail(email);
    // Available unless a DIFFERENT account already holds the address.
    return !accounts.some(
      (a) => normaliseEmail(a.email) === target && key(a.accountType, a.accountId) !== key(current.accountType, current.accountId),
    );
  }

  function activeVerification(accountType: AccountType, accountId: string) {
    // Newest unconsumed, unexpired code for the account (the repository contract).
    const candidates = verifications
      .filter(
        (v) =>
          v.accountType === accountType &&
          v.accountId === accountId &&
          v.consumedAtMs === null &&
          now < v.expiresAtMs,
      )
      .sort((a, b) => b.issuedAtMs - a.issuedAtMs);
    return candidates[0] ?? null;
  }

  return {
    get now() {
      return now;
    },
    advance(ms: number) {
      now += ms;
    },
    accountEmail(accountType: AccountType, accountId: string) {
      return findAccount(accountType, accountId)?.email ?? null;
    },
    accountPasswordHash(accountType: AccountType, accountId: string) {
      return findAccount(accountType, accountId)?.passwordHash ?? null;
    },
    /** Adds a competing account that suddenly claims an address (concurrency). */
    claimEmail(email: string) {
      accounts.push({
        accountType: "user",
        accountId: `rival-${idCounter++}`,
        tenantId: TENANT_ID,
        email,
        passwordHash: "x",
        profilePhoto: null,
      });
    },
    deliveredCodes,
    emailDeps: {
      getAccountSecurity: async (
        _tenantId: string,
        accountType: AccountType,
        accountId: string,
      ): Promise<AccountSecuritySnapshot | null> => {
        const account = findAccount(accountType, accountId);
        return account ? { ...account } : null;
      },
      isAccountEmailAvailable: async (
        email: string,
        current: { accountType: AccountType; accountId: string },
      ) => emailAvailable(email, current),
      getActiveEmailVerification: async (
        _tenantId: string,
        accountType: AccountType,
        accountId: string,
      ) => activeVerification(accountType, accountId),
      saveEmailVerification: async (_tenantId: string, input: SaveEmailVerificationInput) => {
        // A fresh code supersedes any outstanding one for the account.
        for (const v of verifications) {
          if (v.accountType === input.accountType && v.accountId === input.accountId) {
            v.consumedAtMs = v.consumedAtMs ?? now;
          }
        }
        const id = `verification-${idCounter++}`;
        verifications.push({
          id,
          tenantId: TENANT_ID,
          accountType: input.accountType,
          accountId: input.accountId,
          targetEmail: input.targetEmail,
          codeHash: input.codeHash,
          issuedAtMs: now,
          expiresAtMs: input.expiresAtMs,
          resendAvailableAtMs: input.resendAvailableAtMs,
          consumedAtMs: null,
        });
        return id;
      },
      confirmAccountEmailChange: async (
        _tenantId: string,
        input: {
          accountType: AccountType;
          accountId: string;
          verificationId: string;
          targetEmail: string;
          consumedAtMs: number;
        },
      ): Promise<AccountEmailChangeResult> => {
        const verification = verifications.find((v) => v.id === input.verificationId);
        if (!verification || verification.consumedAtMs !== null) {
          return { status: "verification_invalid" };
        }
        // Transactional uniqueness recheck against the live store.
        if (!emailAvailable(input.targetEmail, input)) {
          return { status: "email_taken" };
        }
        const account = findAccount(input.accountType, input.accountId);
        if (!account) return { status: "not_found" };
        verification.consumedAtMs = input.consumedAtMs;
        account.email = input.targetEmail;
        return { status: "updated" };
      },
      hashVerificationCode: (binding: { accountType: string; accountId: string }, code: string) =>
        fakeHash(binding, code),
      generateVerificationCode: () => String(codeCounter++),
      sendVerificationCode: async (email: string, code: string) => {
        deliveredCodes.push({ email, code });
      },
      now: () => now,
    },
    passwordDeps: {
      getAccountSecurity: async (
        _tenantId: string,
        accountType: AccountType,
        accountId: string,
      ): Promise<AccountSecuritySnapshot | null> => {
        const account = findAccount(accountType, accountId);
        return account ? { ...account } : null;
      },
      updateAccountPassword: async (
        _tenantId: string,
        accountType: AccountType,
        accountId: string,
        passwordHash: string,
      ) => {
        const account = findAccount(accountType, accountId);
        if (!account) return false;
        account.passwordHash = passwordHash;
        return true;
      },
    },
  };
}

type Store = ReturnType<typeof createStore>;

function contextFor(
  role: RestaurantSettingsAccountRole,
  accountId: string,
): AuthenticatedRestaurantSettingsContext {
  const accountContext: AccountContext = {
    role,
    profession: "Restaurant and dining",
    subscriptionPlan: "Premium",
    subscriptionStatus: "Active",
    subscriptionExpiresAt: "2027-01-01T00:00:00.000Z",
    isActive: true,
    now: new Date(BASE_NOW),
  };
  return {
    session: { id: accountId, tenantId: TENANT_ID, role },
    accountId,
    tenantId: TENANT_ID,
    role,
    featureContext: accountContext,
    access: resolveFeatureAccess(accountContext),
    scope: { tenantId: TENANT_ID, locationId: role === "location" ? accountId : null },
  };
}

function emailServiceFor(store: Store, context: AuthenticatedRestaurantSettingsContext) {
  return createRestaurantAccountEmailService({
    resolveContext: async () => context,
    ...store.emailDeps,
  });
}

function passwordServiceFor(store: Store, context: AuthenticatedRestaurantSettingsContext) {
  return createRestaurantAccountPasswordService({
    resolveContext: async () => context,
    ...store.passwordDeps,
  });
}

// ---------------------------------------------------------------------------
// Full email-change lifecycle per role (Req 2.14-2.20)
// ---------------------------------------------------------------------------

describe("email-change lifecycle across roles (Req 2.14-2.20)", () => {
  const roleCases: ReadonlyArray<{
    label: string;
    role: RestaurantSettingsAccountRole;
    accountType: AccountType;
    accountId: string;
    currentEmail: string;
    newEmail: string;
  }> = [
    { label: "User (owner)", role: "admin", accountType: "user", accountId: "owner-a", currentEmail: "owner@example.com", newEmail: "owner-new@example.com" },
    { label: "SubUser (reception)", role: "reception", accountType: "sub_user", accountId: "sub-a", currentEmail: "reception@example.com", newEmail: "reception-new@example.com" },
    { label: "Location (branch)", role: "location", accountType: "location", accountId: "branch-a", currentEmail: "branch@example.com", newEmail: "branch-new@example.com" },
  ];

  for (const { label, role, accountType, accountId, currentEmail, newEmail } of roleCases) {
    it(`${label}: request, resend after 60s, then confirm updates exactly this account`, async () => {
      const store = createStore([
        { accountType, accountId, tenantId: TENANT_ID, email: currentEmail, passwordHash: "h", profilePhoto: null },
      ]);
      const service = emailServiceFor(store, contextFor(role, accountId));

      // Request issues a hashed 4-digit code with the exact 5-minute / 60-second timing.
      const requested = await service.request({ email: newEmail });
      expect(requested.status).toBe("code_sent");
      expect(requested.targetEmail).toBe(normaliseEmail(newEmail));
      expect(requested.expiresAtMs).toBe(BASE_NOW + FIVE_MINUTES_MS);
      expect(requested.resendAvailableAtMs).toBe(BASE_NOW + SIXTY_SECONDS_MS);

      // A resend before the boundary is refused and issues no new code.
      store.advance(SIXTY_SECONDS_MS - 1);
      const tooSoon = await service.resend({});
      expect(tooSoon.status).toBe("resend_too_soon");
      expect(tooSoon.message).toBe(MSG_EMAIL_VERIFICATION_RESEND_TOO_SOON);
      expect(store.deliveredCodes).toHaveLength(1);

      // At the exact boundary a fresh code is delivered for the same target.
      store.advance(1);
      const resent = await service.resend({});
      expect(resent.status).toBe("code_sent");
      expect(resent.targetEmail).toBe(normaliseEmail(newEmail));
      expect(store.deliveredCodes).toHaveLength(2);

      // Confirm with the freshly-delivered code updates exactly this account.
      const code = store.deliveredCodes.at(-1)!.code;
      const confirmed = await service.confirm({ email: newEmail, code });
      expect(confirmed.status).toBe("updated");
      expect(confirmed.email).toBe(normaliseEmail(newEmail));
      expect(store.accountEmail(accountType, accountId)).toBe(normaliseEmail(newEmail));
    });
  }
});

// ---------------------------------------------------------------------------
// Global, case-insensitive uniqueness (Req 2.17, 2.18)
// ---------------------------------------------------------------------------

describe("email uniqueness (Req 2.17, 2.18)", () => {
  it("rejects the current address case-insensitively and sends no code (Req 2.17)", async () => {
    const store = createStore([
      { accountType: "user", accountId: "owner-a", tenantId: TENANT_ID, email: "Owner@Example.com", passwordHash: "h", profilePhoto: null },
    ]);
    const service = emailServiceFor(store, contextFor("admin", "owner-a"));

    const result = await service.request({ email: "  owner@example.com " });

    expect(result.status).toBe("email_current");
    expect(result.message).toBe(MSG_EMAIL_ALREADY_CURRENT);
    expect(store.deliveredCodes).toHaveLength(0);
    expect(store.accountEmail("user", "owner-a")).toBe("Owner@Example.com");
  });

  it("rejects an address held by another account across account types (Req 2.18)", async () => {
    const store = createStore([
      { accountType: "user", accountId: "owner-a", tenantId: TENANT_ID, email: "owner@example.com", passwordHash: "h", profilePhoto: null },
      // A branch (different account type) already holds the contested address.
      { accountType: "location", accountId: "branch-a", tenantId: TENANT_ID, email: "shared@example.com", passwordHash: "h", profilePhoto: null },
    ]);
    const service = emailServiceFor(store, contextFor("admin", "owner-a"));

    const result = await service.request({ email: "SHARED@example.com" });

    expect(result.status).toBe("email_in_use");
    expect(result.message).toBe(MSG_EMAIL_ALREADY_IN_USE);
    expect(store.deliveredCodes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Concurrent confirmation handling (Req 2.18-2.20)
// ---------------------------------------------------------------------------

describe("concurrent confirmation handling (Req 2.18-2.20)", () => {
  it("loses the transactional recheck when the address is claimed between request and confirm", async () => {
    const store = createStore([
      { accountType: "user", accountId: "owner-a", tenantId: TENANT_ID, email: "owner@example.com", passwordHash: "h", profilePhoto: null },
    ]);
    const service = emailServiceFor(store, contextFor("admin", "owner-a"));

    const requested = await service.request({ email: "contested@example.com" });
    expect(requested.status).toBe("code_sent");
    const code = store.deliveredCodes.at(-1)!.code;

    // A rival account claims the address after the code was issued.
    store.claimEmail("contested@example.com");

    const confirmed = await service.confirm({ email: "contested@example.com", code });
    expect(confirmed.status).toBe("email_in_use");
    expect(confirmed.message).toBe(MSG_EMAIL_ALREADY_IN_USE);
    // The stored email is untouched by the lost transaction.
    expect(store.accountEmail("user", "owner-a")).toBe("owner@example.com");
  });

  it("consumes the code once so a replayed confirmation is rejected as invalid (Req 2.20)", async () => {
    const store = createStore([
      { accountType: "user", accountId: "owner-a", tenantId: TENANT_ID, email: "owner@example.com", passwordHash: "h", profilePhoto: null },
    ]);
    const service = emailServiceFor(store, contextFor("admin", "owner-a"));

    await service.request({ email: "new@example.com" });
    const code = store.deliveredCodes.at(-1)!.code;

    const first = await service.confirm({ email: "new@example.com", code });
    expect(first.status).toBe("updated");

    // The same code cannot be replayed — the verification is already consumed.
    const replay = await service.confirm({ email: "new@example.com", code });
    expect(replay.status).toBe("invalid_code");
    expect(replay.message).toBe(MSG_VERIFICATION_INVALID_OR_EXPIRED);
  });

  it("rejects a resend when nothing is outstanding", async () => {
    const store = createStore([
      { accountType: "user", accountId: "owner-a", tenantId: TENANT_ID, email: "owner@example.com", passwordHash: "h", profilePhoto: null },
    ]);
    const service = emailServiceFor(store, contextFor("admin", "owner-a"));

    const result = await service.resend({});
    expect(result.status).toBe("no_pending");
    expect(result.message).toBe(MSG_EMAIL_VERIFICATION_NONE_PENDING);
  });

  it("rejects an expired code and leaves the stored email unchanged (Req 2.20)", async () => {
    const store = createStore([
      { accountType: "user", accountId: "owner-a", tenantId: TENANT_ID, email: "owner@example.com", passwordHash: "h", profilePhoto: null },
    ]);
    const service = emailServiceFor(store, contextFor("admin", "owner-a"));

    await service.request({ email: "new@example.com" });
    const code = store.deliveredCodes.at(-1)!.code;

    // Move one millisecond past the exact five-minute validity window.
    store.advance(FIVE_MINUTES_MS);
    const result = await service.confirm({ email: "new@example.com", code });
    expect(result.status).toBe("invalid_code");
    expect(store.accountEmail("user", "owner-a")).toBe("owner@example.com");
  });
});

// ---------------------------------------------------------------------------
// Password change lifecycle and stored-hash preservation (Req 2.21-2.24)
// ---------------------------------------------------------------------------

describe("password-change lifecycle (Req 2.21-2.24)", () => {
  const CURRENT = "current-secret";
  let store: Store;

  beforeEach(async () => {
    const hash = await bcrypt.hash(CURRENT, 10);
    store = createStore([
      { accountType: "user", accountId: "owner-a", tenantId: TENANT_ID, email: "owner@example.com", passwordHash: hash, profilePhoto: null },
    ]);
  });

  it("replaces the stored hash for a correct current password and valid new password (Req 2.21)", async () => {
    const service = passwordServiceFor(store, contextFor("admin", "owner-a"));

    const result = await service.change({
      currentPassword: CURRENT,
      newPassword: "brand-new-password",
      confirmation: "brand-new-password",
    });

    expect(result.status).toBe("updated");
    const stored = store.accountPasswordHash("user", "owner-a")!;
    // A genuine bcrypt hash of the new password now verifies.
    expect(await bcrypt.compare("brand-new-password", stored)).toBe(true);
    expect(await bcrypt.compare(CURRENT, stored)).toBe(false);
  });

  it("rejects a mismatched confirmation and preserves the stored hash (Req 2.22)", async () => {
    const before = store.accountPasswordHash("user", "owner-a");
    const service = passwordServiceFor(store, contextFor("admin", "owner-a"));

    const result = await service.change({
      currentPassword: CURRENT,
      newPassword: "brand-new-password",
      confirmation: "different-password",
    });

    expect(result.status).toBe("invalid_input");
    expect(result.message).toBe(MSG_PASSWORDS_DO_NOT_MATCH);
    expect(store.accountPasswordHash("user", "owner-a")).toBe(before);
  });

  it("rejects a too-short new password and preserves the stored hash (Req 2.23)", async () => {
    const before = store.accountPasswordHash("user", "owner-a");
    const service = passwordServiceFor(store, contextFor("admin", "owner-a"));

    const result = await service.change({
      currentPassword: CURRENT,
      newPassword: "short",
      confirmation: "short",
    });

    expect(result.status).toBe("invalid_input");
    expect(result.message).toBe(MSG_PASSWORD_MIN_LENGTH);
    expect(store.accountPasswordHash("user", "owner-a")).toBe(before);
  });

  it("rejects an incorrect current password and preserves the stored hash (Req 2.24)", async () => {
    const before = store.accountPasswordHash("user", "owner-a");
    const service = passwordServiceFor(store, contextFor("admin", "owner-a"));

    const result = await service.change({
      currentPassword: "wrong-current",
      newPassword: "brand-new-password",
      confirmation: "brand-new-password",
    });

    expect(result.status).toBe("current_incorrect");
    expect(result.message).toBe(MSG_CURRENT_PASSWORD_INCORRECT);
    expect(store.accountPasswordHash("user", "owner-a")).toBe(before);
  });
});

afterEach(() => {
  // No shared module state; the store is rebuilt per test.
});
