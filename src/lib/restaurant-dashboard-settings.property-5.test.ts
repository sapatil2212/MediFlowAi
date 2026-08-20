import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  ACCOUNT_TYPES,
  LIMITS,
  MSG_VERIFICATION_INVALID_OR_EXPIRED,
  canResendEmailVerification,
  createVerificationTiming,
  isEmailVerificationUnexpired,
  matchesEmailVerificationBinding,
  normaliseEmail,
  validateEmailVerificationAttempt,
  validateVerificationCode,
  type AccountType,
  type EmailVerification,
} from "./restaurant-settings-model";

// Feature: restaurant-dashboard-settings, Property 5: Email verification lifecycle
// **Validates: Requirements 2.14, 2.16, 2.17, 2.20**

const VALIDITY_MS = LIMITS.verificationCodeValidityMs; // exactly five minutes
const RESEND_MS = LIMITS.verificationResendDelayMs; // exactly sixty seconds

/** A 4-digit numeric code, zero-padded, exactly as the requirements demand. */
const validCodeArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 9999 })
  .map((n) => n.toString().padStart(4, "0"));

/** Shapes that are NOT a bare four-digit numeric string. */
const invalidCodeArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(""),
  fc.constant("123"),
  fc.constant("12345"),
  fc.constant("abcd"),
  fc.constant("12 4"),
  fc.constant("12.4"),
  fc.constant(" 123"),
  fc.constant("0x12"),
  fc.integer({ min: 0, max: 9999 }),
  fc.constant(null),
  fc.constant(undefined),
);

const EMAIL_BASES = [
  "owner@shop.com",
  "chef@bistro.io",
  "a@b.co",
  "manager@grand-hotel.net",
  "team.lead@example.org",
] as const;

/** Produces a case/space presentation of an email that still normalizes to `base`. */
const presentationArb = (base: string): fc.Arbitrary<string> =>
  fc
    .tuple(fc.boolean(), fc.constantFrom("", " ", "  ", "\t"), fc.constantFrom("", " ", "  "))
    .map(([upper, lead, trail]) => `${lead}${upper ? base.toUpperCase() : base}${trail}`);

const accountTypeArb: fc.Arbitrary<AccountType> = fc.constantFrom(...ACCOUNT_TYPES);
const accountIdArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 8 });

/** Instants clustered on the exact 60-second and five-minute boundaries. */
const nowOffsetArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(-1),
  fc.constant(0),
  fc.constant(1),
  fc.constant(RESEND_MS - 1),
  fc.constant(RESEND_MS),
  fc.constant(RESEND_MS + 1),
  fc.constant(VALIDITY_MS - 1),
  fc.constant(VALIDITY_MS),
  fc.constant(VALIDITY_MS + 1),
  fc.integer({ min: -5_000, max: VALIDITY_MS + 5_000 }),
);

interface Scenario {
  issuedAtMs: number;
  nowMs: number;
  verificationAccountType: AccountType;
  verificationAccountId: string;
  verificationEmailBase: string;
  verificationEmailPresentation: string;
  inputAccountType: AccountType;
  inputAccountId: string;
  inputEmailBase: string;
  inputEmailPresentation: string;
  code: unknown;
  codeMatches: boolean;
  consumed: boolean;
  consumedAtMs: number;
  storedEmail: string;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    issuedAtMs: fc.integer({ min: 0, max: 4_000_000_000_000 }),
    nowOffset: nowOffsetArb,
    verificationAccountType: accountTypeArb,
    verificationAccountId: accountIdArb,
    verificationEmailBase: fc.constantFrom(...EMAIL_BASES),
    sameAccountType: fc.boolean(),
    sameAccountId: fc.boolean(),
    sameEmail: fc.boolean(),
    inputAccountType: accountTypeArb,
    inputAccountId: accountIdArb,
    inputEmailBase: fc.constantFrom(...EMAIL_BASES),
    code: fc.oneof(
      { weight: 4, arbitrary: validCodeArb },
      { weight: 1, arbitrary: invalidCodeArb },
    ),
    codeMatches: fc.boolean(),
    consumed: fc.boolean(),
    consumedOffset: fc.integer({ min: 0, max: VALIDITY_MS }),
    storedEmail: fc.constantFrom(...EMAIL_BASES, "old@stored.example"),
  })
  .chain((base) =>
    fc
      .tuple(
        presentationArb(base.verificationEmailBase),
        presentationArb(base.sameEmail ? base.verificationEmailBase : base.inputEmailBase),
      )
      .map(([verificationEmailPresentation, inputEmailPresentation]) => ({
        issuedAtMs: base.issuedAtMs,
        nowMs: base.issuedAtMs + base.nowOffset,
        verificationAccountType: base.verificationAccountType,
        verificationAccountId: base.verificationAccountId,
        verificationEmailBase: base.verificationEmailBase,
        verificationEmailPresentation,
        inputAccountType: base.sameAccountType
          ? base.verificationAccountType
          : base.inputAccountType,
        inputAccountId: base.sameAccountId ? base.verificationAccountId : base.inputAccountId,
        inputEmailBase: base.sameEmail ? base.verificationEmailBase : base.inputEmailBase,
        inputEmailPresentation,
        code: base.code,
        codeMatches: base.codeMatches,
        consumed: base.consumed,
        consumedAtMs: base.issuedAtMs + base.consumedOffset,
        storedEmail: base.storedEmail,
      })),
  );

function buildVerification(scenario: Scenario): EmailVerification {
  const timing = createVerificationTiming(scenario.issuedAtMs);
  return {
    accountType: scenario.verificationAccountType,
    accountId: scenario.verificationAccountId,
    targetEmail: scenario.verificationEmailPresentation,
    codeHash: "hash-is-opaque-to-pure-model",
    issuedAtMs: timing.issuedAtMs,
    expiresAtMs: timing.expiresAtMs,
    resendAvailableAtMs: timing.resendAvailableAtMs,
    consumedAtMs: scenario.consumed ? scenario.consumedAtMs : null,
  };
}

describe("restaurant dashboard settings email verification lifecycle", () => {
  // Feature: restaurant-dashboard-settings, Property 5: Email verification lifecycle
  // **Validates: Requirements 2.14, 2.16, 2.17, 2.20**
  it("accepts a code only for a matching binding strictly before the exact five-minute expiry, and never mutates a mismatched stored email", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const verification = buildVerification(scenario);

        // Exact timing derivation (Requirement 2.14): five-minute validity and
        // sixty-second resend gate measured from the issue instant.
        expect(verification.expiresAtMs).toBe(scenario.issuedAtMs + VALIDITY_MS);
        expect(verification.resendAvailableAtMs).toBe(scenario.issuedAtMs + RESEND_MS);

        const input = {
          accountType: scenario.inputAccountType,
          accountId: scenario.inputAccountId,
          targetEmail: scenario.inputEmailPresentation,
          code: scenario.code,
        };

        // Recompute every gate independently of the implementation.
        const codeShapeOk = validateVerificationCode(scenario.code).ok;
        const bindingOk =
          scenario.inputAccountType === scenario.verificationAccountType &&
          scenario.inputAccountId === scenario.verificationAccountId &&
          normaliseEmail(scenario.inputEmailPresentation) ===
            normaliseEmail(scenario.verificationEmailPresentation);
        const unexpired =
          !scenario.consumed &&
          scenario.nowMs >= scenario.issuedAtMs &&
          scenario.nowMs < scenario.issuedAtMs + VALIDITY_MS;
        const expectedAccepted = codeShapeOk && scenario.codeMatches && bindingOk && unexpired;

        // Cross-check the exposed predicates against the recomputed gates.
        expect(matchesEmailVerificationBinding(verification, input)).toBe(bindingOk);
        expect(isEmailVerificationUnexpired(verification, scenario.nowMs)).toBe(unexpired);

        const result = validateEmailVerificationAttempt(
          verification,
          input,
          scenario.nowMs,
          scenario.codeMatches,
        );

        expect(result.ok).toBe(expectedAccepted);

        // Model a stored email that only changes on an accepted confirmation.
        let storedEmail = scenario.storedEmail;
        if (result.ok) {
          storedEmail = result.value.targetEmail;
          // Accepted result is fully normalized and echoes the input binding.
          expect(result.value.targetEmail).toBe(normaliseEmail(scenario.inputEmailPresentation));
          expect(result.value.accountType).toBe(scenario.inputAccountType);
          expect(result.value.accountId).toBe(scenario.inputAccountId);
          expect(result.value.code).toBe(scenario.code);
          expect(storedEmail).toBe(normaliseEmail(scenario.inputEmailPresentation));
        } else {
          // Every invalid, expired, consumed, or differently-bound attempt
          // leaves the stored email untouched with the stable message.
          expect(storedEmail).toBe(scenario.storedEmail);
          if (!codeShapeOk) {
            expect(result.errors[0]?.field).toBe("code");
          } else {
            expect(result.errors).toEqual([
              { field: "code", message: MSG_VERIFICATION_INVALID_OR_EXPIRED },
            ]);
          }
        }

        // The verification row itself is never mutated by validation.
        expect(verification.consumedAtMs).toBe(scenario.consumed ? scenario.consumedAtMs : null);
      }),
      { numRuns: 400 },
    );
  });

  // Feature: restaurant-dashboard-settings, Property 5: Email verification lifecycle
  // **Validates: Requirements 2.16**
  it("keeps resend unavailable strictly before sixty seconds and available at or after sixty seconds", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        nowOffsetArb,
        (issuedAtMs, offset) => {
          const timing = createVerificationTiming(issuedAtMs);
          const nowMs = issuedAtMs + offset;
          const expected = nowMs >= issuedAtMs + RESEND_MS;
          expect(canResendEmailVerification(timing, nowMs)).toBe(expected);

          // Exact boundary anchors.
          expect(canResendEmailVerification(timing, issuedAtMs + RESEND_MS - 1)).toBe(false);
          expect(canResendEmailVerification(timing, issuedAtMs + RESEND_MS)).toBe(true);
        },
      ),
      { numRuns: 400 },
    );
  });
});
