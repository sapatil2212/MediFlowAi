import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  LIMITS,
  PROFILE_PHOTO_MIME_TYPES,
  validateProfilePhoto,
  type ProfilePhotoInput,
} from "./restaurant-settings-model";

// Feature: restaurant-dashboard-settings, Property 4: Profile photo validation is exact
// **Validates: Requirements 2.10, 2.12**

/**
 * The exact inclusive maximum decoded byte length (5 MiB) stated by the design
 * (Profile and account security) and requirements 2.10/2.12.
 */
const MAX_BYTES = LIMITS.profilePhotoBytes;

/**
 * The exact set of permitted detected MIME strings. Anything outside this set
 * (including case variants and near-misses) must be rejected.
 */
const PERMITTED_MIME = new Set<string>(PROFILE_PHOTO_MIME_TYPES);

/**
 * MIME arbitrary that deliberately over-samples the three permitted strings so
 * the accept and reject branches are both exercised, while still generating
 * arbitrary and near-miss MIME strings and non-string values.
 */
const mimeArb: fc.Arbitrary<unknown> = fc.oneof(
  // The three permitted strings.
  fc.constantFrom(...PROFILE_PHOTO_MIME_TYPES),
  // Near-misses: case variants and unsupported image/other types.
  fc.constantFrom(
    "image/jpg",
    "image/JPEG",
    "image/PNG",
    "image/webp ",
    " image/webp",
    "image/gif",
    "image/svg+xml",
    "image/heic",
    "application/octet-stream",
    "text/plain",
    "",
  ),
  // Arbitrary strings.
  fc.string({ maxLength: 24 }),
  // Non-string values reach the validator through untrusted payloads.
  fc.constantFrom(null, undefined, 123, {}, ["image/png"]),
);

/**
 * Byte-length arbitrary concentrated around the 5 MiB boundary, and including
 * 0, negatives, non-integers, and values just above/below/at the limit as well
 * as non-number values.
 */
const byteLengthArb: fc.Arbitrary<unknown> = fc.oneof(
  // Exact and near-boundary integers.
  fc.constantFrom(0, 1, MAX_BYTES - 1, MAX_BYTES, MAX_BYTES + 1, MAX_BYTES * 2),
  // Anywhere in and beyond the valid range.
  fc.integer({ min: -1024, max: MAX_BYTES + 4096 }),
  fc.integer({ min: MAX_BYTES, max: MAX_BYTES * 8 }),
  // Non-integers and non-finite numbers must be rejected.
  fc.constantFrom(0.5, 1.1, MAX_BYTES - 0.5, MAX_BYTES + 0.5, -0.1, NaN, Infinity, -Infinity),
  // Non-number values reach the validator through untrusted payloads.
  fc.constantFrom(null, undefined, "1024", {}, [10]),
);

const photoInputArb: fc.Arbitrary<ProfilePhotoInput> = fc.record({
  mimeType: mimeArb,
  byteLength: byteLengthArb,
});

/** Independent oracle: the exact accept condition from Property 4. */
function shouldAccept(input: ProfilePhotoInput): boolean {
  const mimeOk = typeof input.mimeType === "string" && PERMITTED_MIME.has(input.mimeType);
  const lengthOk =
    typeof input.byteLength === "number" &&
    Number.isInteger(input.byteLength) &&
    input.byteLength >= 0 &&
    input.byteLength <= MAX_BYTES;
  return mimeOk && lengthOk;
}

/**
 * Models the stored-photo retention behaviour that surrounds the pure
 * validator (design: role-aware photo upload). The stored URL is only replaced
 * by the candidate URL when validation passes; every rejected payload retains
 * the previous stored URL unchanged.
 */
function applyPhotoUpdate(
  storedUrl: string | null,
  candidateUrl: string,
  input: ProfilePhotoInput,
) {
  const result = validateProfilePhoto(input);
  return result.ok ? candidateUrl : storedUrl;
}

const urlArb = fc.oneof(
  fc.constant<string | null>(null),
  fc.webUrl(),
  fc.string({ maxLength: 40 }),
);

// A successful upload always yields a concrete URL string, so the candidate URL
// replacing the stored one is never null.
const candidateUrlArb = fc.oneof(fc.webUrl(), fc.string({ maxLength: 40 }));

describe("Property 4: Profile photo validation is exact", () => {
  it("accepts iff MIME is exactly JPEG/PNG/WEBP and byte length is an integer in [0, 5 MiB]", () => {
    fc.assert(
      fc.property(photoInputArb, (input) => {
        const before = structuredClone(input);
        const result = validateProfilePhoto(input);
        const expected = shouldAccept(input);

        expect(result.ok).toBe(expected);

        if (result.ok) {
          // Accepted payloads normalize to the exact submitted MIME/length.
          expect(result.value.mimeType).toBe(input.mimeType);
          expect(result.value.byteLength).toBe(input.byteLength);
          expect(PERMITTED_MIME.has(result.value.mimeType)).toBe(true);
          expect(Number.isInteger(result.value.byteLength)).toBe(true);
          expect(result.value.byteLength).toBeGreaterThanOrEqual(0);
          expect(result.value.byteLength).toBeLessThanOrEqual(MAX_BYTES);
        } else {
          // Rejections always report the single stable photo field error.
          expect(result.errors).toHaveLength(1);
          expect(result.errors[0].field).toBe("photo");
        }

        // The validator never mutates its input payload.
        expect(input).toEqual(before);
      }),
      { numRuns: 400 },
    );
  });

  it("every rejected payload leaves the stored photo URL unchanged", () => {
    fc.assert(
      fc.property(urlArb, candidateUrlArb, photoInputArb, (storedUrl, candidateUrl, input) => {
        const accepted = shouldAccept(input);
        const nextUrl = applyPhotoUpdate(storedUrl, candidateUrl, input);

        if (accepted) {
          // A valid payload may replace the stored URL with the new one.
          expect(nextUrl).toBe(candidateUrl);
        } else {
          // A rejected payload must retain the previously stored URL exactly.
          expect(nextUrl).toBe(storedUrl);
        }
      }),
      { numRuns: 400 },
    );
  });
});
