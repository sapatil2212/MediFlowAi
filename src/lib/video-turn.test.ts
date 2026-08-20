/**
 * @vitest-environment node
 *
 * Property-based and example-based tests for video-turn.server.ts
 *
 * Covers Property 11 of the video-consultation design: TURN credentials are
 * bounded, well-formed, and leak nothing.
 *
 * The module under test imports `node:crypto`, so this suite must run in the
 * node environment. It takes `env` and `nowMs` as injectable parameters —
 * no test mutates `process.env` and no test reads the real clock.
 */

import { describe, it, expect, test } from "vitest";
import * as fc from "fast-check";
import {
  readTurnConfig,
  isTurnConfigured,
  buildTurnUsername,
  parseTurnUsername,
  deriveTurnPassword,
  mintTurnCredential,
  buildIceConfiguration,
  MAX_TURN_CREDENTIAL_TTL_SECONDS,
  DEFAULT_TURN_CREDENTIAL_TTL_SECONDS,
  type TurnConfig,
} from "./video-turn.server";

// ───────────────────────────────────────────────────────────────────────────
// Arbitraries
//
// Charset-controlled generators (fc.array + join) rather than fc.string, so
// the alphabet is explicit. That matters for two reasons:
//   * HMAC zero-pads keys shorter than the block size, so "k" and "k\0" are
//     the SAME key. Excluding NUL keeps "different secrets differ" honest.
//   * The leak property compares the secret against generated URLs, so the
//     URL pool is drawn from fixed constants and cannot accidentally contain
//     a generated secret.
// ───────────────────────────────────────────────────────────────────────────

const SECRET_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".split("");

/** Long enough that a 28-char base64 HMAC cannot contain it as a substring. */
const arbSecret = fc
  .array(fc.constantFrom(...SECRET_CHARS), { minLength: 24, maxLength: 48 })
  .map((chars) => chars.join(""));

const TURN_URL_POOL = [
  "turn:turn.example.com:3478",
  "turn:turn.example.com:3478?transport=tcp",
  "turns:turn.example.com:5349",
  "turn:10.0.0.7:3478",
];

const STUN_URL_POOL = ["stun:turn.example.com:3478", "stun:stun.internal.example.com:3478"];

const arbTurnUrls = fc.uniqueArray(fc.constantFrom(...TURN_URL_POOL), {
  minLength: 1,
  maxLength: TURN_URL_POOL.length,
});

const arbStunUrls = fc.uniqueArray(fc.constantFrom(...STUN_URL_POOL), {
  minLength: 0,
  maxLength: STUN_URL_POOL.length,
});

const arbRealm = fc.option(fc.constantFrom("example.com", "clinic.local"), {
  nil: null,
});

/**
 * Configured TTLs, deliberately including values the 3600 ceiling must survive:
 * far above the ceiling, zero, negative, NaN, and non-finite.
 */
const arbTtlSeconds = fc.oneof(
  fc.integer({ min: -100_000, max: 100_000 }),
  fc.constantFrom(
    0,
    -1,
    -3600,
    1,
    3599,
    3600,
    3601,
    86_400,
    999_999,
    Number.MAX_SAFE_INTEGER,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ),
);

/** A config for which `isTurnConfigured` is true. */
const arbConfiguredTurnConfig: fc.Arbitrary<TurnConfig> = fc.record({
  stunUrls: arbStunUrls,
  turnUrls: arbTurnUrls,
  realm: arbRealm,
  sharedSecret: arbSecret,
  ttlSeconds: arbTtlSeconds,
});

/**
 * Configs for which `isTurnConfigured` is false: no TURN URLs, no secret, or
 * both. STUN URLs are still generated, because "no TURN" must not mean
 * "fall back to whatever STUN we have" (Req 8.6, 11.3).
 */
const arbUnconfiguredTurnConfig: fc.Arbitrary<TurnConfig> = fc
  .record({
    stunUrls: arbStunUrls,
    turnUrls: arbTurnUrls,
    realm: arbRealm,
    sharedSecret: fc.oneof(arbSecret, fc.constant(null), fc.constant("")),
    ttlSeconds: arbTtlSeconds,
    missing: fc.constantFrom("urls", "secret", "both"),
  })
  .map(({ missing, ...cfg }) => ({
    ...cfg,
    turnUrls: missing === "secret" ? cfg.turnUrls : [],
    sharedSecret: missing === "urls" ? cfg.sharedSecret : null,
  }))
  .filter((cfg) => !isTurnConfigured(cfg));

const arbParticipantId = fc
  .array(fc.constantFrom(...SECRET_CHARS), { minLength: 1, maxLength: 40 })
  .map((chars) => chars.join(""));

/** Milliseconds since epoch, bounded well inside the safe-integer range. */
const arbNowMs = fc.integer({ min: 0, max: 4_000_000_000_000 });

// ───────────────────────────────────────────────────────────────────────────
// Property 11.1: credentials expire strictly in the future, TTL ≤ 3600
// ───────────────────────────────────────────────────────────────────────────

test("Property 11.1: mintTurnCredential expires strictly in the future with ttl <= 3600 for any configured ttl", () => {
  fc.assert(
    fc.property(
      arbConfiguredTurnConfig,
      arbParticipantId,
      arbNowMs,
      (cfg, participantId, nowMs) => {
        const credential = mintTurnCredential(cfg, participantId, nowMs);
        const nowUnix = Math.floor(nowMs / 1000);

        // Strictly in the future: a credential that is already expired at the
        // moment of minting is useless to the browser.
        expect(credential.expiresAtUnix).toBeGreaterThan(nowUnix);

        // Req 8.3: the ceiling holds no matter what the environment asked for.
        expect(credential.ttlSeconds).toBeLessThanOrEqual(MAX_TURN_CREDENTIAL_TTL_SECONDS);
        expect(credential.ttlSeconds).toBeGreaterThanOrEqual(1);
        expect(Number.isSafeInteger(credential.ttlSeconds)).toBe(true);

        // expiresAtUnix is exactly the clamped ttl past now.
        expect(credential.expiresAtUnix).toBe(nowUnix + credential.ttlSeconds);
        expect(credential.expiresAtUnix - nowUnix).toBeLessThanOrEqual(
          MAX_TURN_CREDENTIAL_TTL_SECONDS,
        );

        // The username carries the same expiry that was reported.
        expect(parseTurnUsername(credential.username)).toEqual({
          expiryUnix: credential.expiresAtUnix,
          id: participantId,
        });
      },
    ),
    { numRuns: 200 },
  );
});

test("Property 11.1: buildIceConfiguration expiresAtUnix is also strictly future and within the ceiling", () => {
  fc.assert(
    fc.property(
      arbConfiguredTurnConfig,
      arbParticipantId,
      arbNowMs,
      (cfg, participantId, nowMs) => {
        const ice = buildIceConfiguration(cfg, participantId, nowMs);
        const nowUnix = Math.floor(nowMs / 1000);

        expect(ice.turnConfigured).toBe(true);
        expect(ice.expiresAtUnix).not.toBeNull();
        expect(ice.expiresAtUnix as number).toBeGreaterThan(nowUnix);
        expect((ice.expiresAtUnix as number) - nowUnix).toBeLessThanOrEqual(
          MAX_TURN_CREDENTIAL_TTL_SECONDS,
        );
      },
    ),
    { numRuns: 200 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 11.2: username round-trip
// ───────────────────────────────────────────────────────────────────────────

const arbExpiryUnix = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });

/** Any non-empty id free of `:` — the separator is the only reserved char. */
const arbColonFreeId = fc
  .string({ minLength: 1, maxLength: 64 })
  .filter((id) => id.length > 0 && !id.includes(":"));

test("Property 11.2: parseTurnUsername inverts buildTurnUsername for any expiry and colon-free id", () => {
  fc.assert(
    fc.property(arbExpiryUnix, arbColonFreeId, (expiryUnix, id) => {
      const username = buildTurnUsername(expiryUnix, id);
      expect(username).toBe(`${expiryUnix}:${id}`);
      expect(parseTurnUsername(username)).toEqual({ expiryUnix, id });
    }),
    { numRuns: 300 },
  );
});

test("Property 11.2: parseTurnUsername rejects malformed usernames", () => {
  fc.assert(
    fc.property(arbExpiryUnix, arbColonFreeId, (expiryUnix, id) => {
      // No colon at all.
      expect(parseTurnUsername(`${expiryUnix}`)).toBeNull();
      // Empty expiry segment.
      expect(parseTurnUsername(`:${id}`)).toBeNull();
      // Empty id segment.
      expect(parseTurnUsername(`${expiryUnix}:`)).toBeNull();
      // Non-numeric expiry segment.
      expect(parseTurnUsername(`x${expiryUnix}:${id}`)).toBeNull();
    }),
    { numRuns: 200 },
  );
});

describe("parseTurnUsername malformed examples", () => {
  it.each([
    ["", "empty string"],
    ["1700000000", "no colon"],
    [":participant-abc", "empty expiry"],
    ["1700000000:", "empty id"],
    [":", "both segments empty"],
    ["abc:participant-abc", "non-numeric expiry"],
    ["17e9:participant-abc", "exponent-notation expiry"],
    ["-1700000000:participant-abc", "negative expiry"],
    ["1700000000.5:participant-abc", "fractional expiry"],
    [" 1700000000:participant-abc", "leading whitespace in expiry"],
    ["99999999999999999999:participant-abc", "expiry beyond safe integer range"],
  ])("returns null for %s (%s)", (input) => {
    expect(parseTurnUsername(input)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Property 11.3: deriveTurnPassword is deterministic and secret-sensitive
// ───────────────────────────────────────────────────────────────────────────

test("Property 11.3: deriveTurnPassword is deterministic for equal (username, secret)", () => {
  fc.assert(
    fc.property(arbExpiryUnix, arbParticipantId, arbSecret, (expiryUnix, id, secret) => {
      const username = buildTurnUsername(expiryUnix, id);
      expect(deriveTurnPassword(username, secret)).toBe(deriveTurnPassword(username, secret));
    }),
    { numRuns: 200 },
  );
});

test("Property 11.3: deriveTurnPassword differs when the shared secret differs", () => {
  fc.assert(
    fc.property(
      arbExpiryUnix,
      arbParticipantId,
      fc.tuple(arbSecret, arbSecret).filter(([a, b]) => a !== b),
      (expiryUnix, id, [secretA, secretB]) => {
        const username = buildTurnUsername(expiryUnix, id);
        expect(deriveTurnPassword(username, secretA)).not.toBe(
          deriveTurnPassword(username, secretB),
        );
      },
    ),
    { numRuns: 200 },
  );
});

test("Property 11.3: mintTurnCredential is deterministic under a fixed clock and secret-sensitive", () => {
  fc.assert(
    fc.property(
      arbConfiguredTurnConfig,
      arbParticipantId,
      arbNowMs,
      arbSecret,
      (cfg, participantId, nowMs, otherSecret) => {
        const first = mintTurnCredential(cfg, participantId, nowMs);
        const second = mintTurnCredential(cfg, participantId, nowMs);
        expect(second).toEqual(first);

        if (otherSecret !== cfg.sharedSecret) {
          const rotated = mintTurnCredential(
            { ...cfg, sharedSecret: otherSecret },
            participantId,
            nowMs,
          );
          // Same username (same clock, same participant), different password.
          expect(rotated.username).toBe(first.username);
          expect(rotated.credential).not.toBe(first.credential);
        }
      },
    ),
    { numRuns: 200 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 11.4: the shared secret never crosses the wire (Req 8.4)
// ───────────────────────────────────────────────────────────────────────────

test("Property 11.4: neither username, credential, nor the serialised ICE configuration contains the shared secret", () => {
  fc.assert(
    fc.property(
      arbConfiguredTurnConfig,
      arbParticipantId,
      arbNowMs,
      (cfg, participantId, nowMs) => {
        const secret = cfg.sharedSecret as string;
        expect(secret.length).toBeGreaterThanOrEqual(24);

        const credential = mintTurnCredential(cfg, participantId, nowMs);
        expect(credential.username).not.toContain(secret);
        expect(credential.credential).not.toContain(secret);

        // The whole payload handed to the browser, serialised exactly as the
        // server function would send it.
        const ice = buildIceConfiguration(cfg, participantId, nowMs);
        const serialised = JSON.stringify(ice);
        expect(serialised).not.toContain(secret);

        // Belt and braces: also check every field individually, so a future
        // added field cannot hide behind a JSON escape.
        for (const server of ice.iceServers) {
          for (const url of server.urls) {
            expect(url).not.toContain(secret);
          }
          expect(server.username ?? "").not.toContain(secret);
          expect(server.credential ?? "").not.toContain(secret);
        }
      },
    ),
    { numRuns: 200 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 11.5: unconfigured TURN yields an empty server list (Req 8.6, 11.3)
// ───────────────────────────────────────────────────────────────────────────

test("Property 11.5: when TURN is not configured, buildIceConfiguration returns exactly the empty configuration", () => {
  fc.assert(
    fc.property(
      arbUnconfiguredTurnConfig,
      arbParticipantId,
      arbNowMs,
      (cfg, participantId, nowMs) => {
        expect(isTurnConfigured(cfg)).toBe(false);

        const ice = buildIceConfiguration(cfg, participantId, nowMs);

        // Exact shape — nothing extra, nothing substituted.
        expect(ice).toEqual({
          iceServers: [],
          iceTransportPolicy: "all",
          expiresAtUnix: null,
          turnConfigured: false,
        });

        // Stated separately because it is the guarantee that matters: we never
        // substitute a public STUN/TURN server, not even when stunUrls is set.
        expect(ice.iceServers).toHaveLength(0);
      },
    ),
    { numRuns: 200 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 11.6: every advertised URL came from configuration (Req 8.1, 11.3)
// ───────────────────────────────────────────────────────────────────────────

test("Property 11.6: every URL in iceServers originates from cfg.stunUrls or cfg.turnUrls", () => {
  fc.assert(
    fc.property(
      arbConfiguredTurnConfig,
      arbParticipantId,
      arbNowMs,
      (cfg, participantId, nowMs) => {
        const ice = buildIceConfiguration(cfg, participantId, nowMs);
        const configured = new Set([...cfg.stunUrls, ...cfg.turnUrls]);

        const advertised = ice.iceServers.flatMap((server) => server.urls);
        expect(advertised.length).toBeGreaterThan(0);
        for (const url of advertised) {
          expect(configured.has(url)).toBe(true);
        }

        // And every configured TURN URL is actually offered.
        for (const url of cfg.turnUrls) {
          expect(advertised).toContain(url);
        }
      },
    ),
    { numRuns: 200 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Example-based tests
// ───────────────────────────────────────────────────────────────────────────

describe("deriveTurnPassword known-answer vector", () => {
  // Pins coturn's `use-auth-secret` (TURN REST API) scheme: base64 of
  // HMAC-SHA1 over the username, keyed by the shared secret. Computed
  // independently with node:crypto:
  //   createHmac("sha1", SECRET).update(USERNAME).digest("base64")
  // If this literal ever changes, the wire format has drifted and every
  // coturn deployment stops authenticating our credentials.
  const USERNAME = "1700000000:participant-abc";
  const SECRET = "test-shared-secret-do-not-use";
  const EXPECTED = "eby2Xebi8FWeGr5bSzWk7pPFeJg=";

  it("matches the independently computed HMAC-SHA1 base64 vector", () => {
    expect(deriveTurnPassword(USERNAME, SECRET)).toBe(EXPECTED);
  });

  it("produces a 28-character base64 encoding of a 20-byte SHA-1 digest", () => {
    const password = deriveTurnPassword(USERNAME, SECRET);
    expect(password).toHaveLength(28);
    expect(password).toMatch(/^[A-Za-z0-9+/]{27}=$/);
    expect(Buffer.from(password, "base64")).toHaveLength(20);
  });

  it("mints exactly that vector for the matching clock and participant", () => {
    const cfg: TurnConfig = {
      stunUrls: [],
      turnUrls: ["turn:turn.example.com:3478"],
      realm: "example.com",
      sharedSecret: SECRET,
      ttlSeconds: 3600,
    };
    // nowMs chosen so floor(nowMs / 1000) + 3600 === 1700000000.
    const nowMs = (1_700_000_000 - 3600) * 1000;
    const credential = mintTurnCredential(cfg, "participant-abc", nowMs);

    expect(credential.username).toBe(USERNAME);
    expect(credential.credential).toBe(EXPECTED);
    expect(credential.expiresAtUnix).toBe(1_700_000_000);
    expect(credential.ttlSeconds).toBe(3600);
  });
});

describe("TTL clamping", () => {
  const baseEnv = {
    TURN_URLS: "turn:turn.example.com:3478",
    TURN_SHARED_SECRET: "test-shared-secret-do-not-use",
  };

  it("clamps a configured TTL of 999999 to exactly 3600", () => {
    const cfg = readTurnConfig({
      ...baseEnv,
      TURN_CREDENTIAL_TTL_SECONDS: "999999",
    });
    expect(cfg.ttlSeconds).toBe(999999);

    const credential = mintTurnCredential(cfg, "participant-abc", 1_700_000_000_000);
    expect(credential.ttlSeconds).toBe(3600);
    expect(credential.expiresAtUnix).toBe(1_700_000_000 + 3600);
  });

  it("clamps zero and negative TTLs up to 1 second", () => {
    for (const raw of ["0", "-1", "-999999"]) {
      const cfg = readTurnConfig({ ...baseEnv, TURN_CREDENTIAL_TTL_SECONDS: raw });
      const credential = mintTurnCredential(cfg, "p", 1_700_000_000_000);
      expect(credential.ttlSeconds).toBe(1);
      expect(credential.expiresAtUnix).toBe(1_700_000_001);
    }
  });

  it("honours a TTL inside the permitted range", () => {
    const cfg = readTurnConfig({ ...baseEnv, TURN_CREDENTIAL_TTL_SECONDS: "600" });
    expect(cfg.ttlSeconds).toBe(600);
    const credential = mintTurnCredential(cfg, "p", 1_700_000_000_000);
    expect(credential.ttlSeconds).toBe(600);
    expect(credential.expiresAtUnix).toBe(1_700_000_600);
  });
});

describe("readTurnConfig parsing", () => {
  it("splits and trims comma-separated URL lists and drops empty entries", () => {
    const cfg = readTurnConfig({
      TURN_URLS: " turn:a.example.com:3478 , ,turn:b.example.com:3478,,",
      TURN_STUN_URLS: "stun:a.example.com:3478 ,  stun:b.example.com:3478 ",
      TURN_REALM: " example.com ",
      TURN_SHARED_SECRET: "  s3cret-value  ",
      TURN_CREDENTIAL_TTL_SECONDS: " 1800 ",
    });

    expect(cfg).toEqual({
      turnUrls: ["turn:a.example.com:3478", "turn:b.example.com:3478"],
      stunUrls: ["stun:a.example.com:3478", "stun:b.example.com:3478"],
      realm: "example.com",
      sharedSecret: "s3cret-value",
      ttlSeconds: 1800,
    });
  });

  it("treats blank realm and blank secret as null", () => {
    const cfg = readTurnConfig({
      TURN_URLS: "turn:a.example.com:3478",
      TURN_REALM: "   ",
      TURN_SHARED_SECRET: "",
    });
    expect(cfg.realm).toBeNull();
    expect(cfg.sharedSecret).toBeNull();
    expect(isTurnConfigured(cfg)).toBe(false);
  });

  it("falls back to the default TTL when unset or unparsable", () => {
    for (const raw of [undefined, "", "   ", "abc", "not-a-number"]) {
      const cfg = readTurnConfig({
        TURN_URLS: "turn:a.example.com:3478",
        TURN_SHARED_SECRET: "s3cret-value-long-enough",
        ...(raw === undefined ? {} : { TURN_CREDENTIAL_TTL_SECONDS: raw }),
      });
      expect(cfg.ttlSeconds).toBe(DEFAULT_TURN_CREDENTIAL_TTL_SECONDS);
      expect(cfg.ttlSeconds).toBe(3600);
    }
  });

  it("returns empty URL lists for a fully empty environment", () => {
    const cfg = readTurnConfig({});
    expect(cfg).toEqual({
      turnUrls: [],
      stunUrls: [],
      realm: null,
      sharedSecret: null,
      ttlSeconds: 3600,
    });
    expect(isTurnConfigured(cfg)).toBe(false);
  });
});

describe("isTurnConfigured", () => {
  const secret = "test-shared-secret-do-not-use";

  it.each([
    [["turn:a.example.com:3478"], secret, true],
    [[], secret, false],
    [["turn:a.example.com:3478"], null, false],
    [["turn:a.example.com:3478"], "", false],
    [[], null, false],
  ])("urls=%j secret present=%j => %s", (turnUrls, sharedSecret, expected) => {
    const cfg: TurnConfig = {
      stunUrls: ["stun:a.example.com:3478"],
      turnUrls: turnUrls as string[],
      realm: null,
      sharedSecret: sharedSecret as string | null,
      ttlSeconds: 3600,
    };
    expect(isTurnConfigured(cfg)).toBe(expected);
  });
});

describe("buildIceConfiguration", () => {
  it("returns the exact unconfigured shape, with no substituted server", () => {
    const cfg = readTurnConfig({
      // STUN configured but no TURN URLs and no secret: still empty.
      TURN_STUN_URLS: "stun:stun.internal.example.com:3478",
    });

    expect(buildIceConfiguration(cfg, "participant-abc", 1_700_000_000_000)).toEqual({
      iceServers: [],
      iceTransportPolicy: "all",
      expiresAtUnix: null,
      turnConfigured: false,
    });
  });

  it("puts STUN in a credential-free entry and TURN in a credentialed entry", () => {
    const cfg = readTurnConfig({
      TURN_STUN_URLS: "stun:turn.example.com:3478",
      TURN_URLS: "turn:turn.example.com:3478,turns:turn.example.com:5349",
      TURN_REALM: "example.com",
      TURN_SHARED_SECRET: "test-shared-secret-do-not-use",
      TURN_CREDENTIAL_TTL_SECONDS: "3600",
    });

    const nowMs = (1_700_000_000 - 3600) * 1000;
    const ice = buildIceConfiguration(cfg, "participant-abc", nowMs);

    expect(ice.turnConfigured).toBe(true);
    expect(ice.iceTransportPolicy).toBe("all");
    expect(ice.expiresAtUnix).toBe(1_700_000_000);
    expect(ice.iceServers).toHaveLength(2);

    const [stunEntry, turnEntry] = ice.iceServers;

    expect(stunEntry.urls).toEqual(["stun:turn.example.com:3478"]);
    expect(stunEntry.username).toBeUndefined();
    expect(stunEntry.credential).toBeUndefined();
    expect("username" in stunEntry).toBe(false);
    expect("credential" in stunEntry).toBe(false);

    expect(turnEntry.urls).toEqual(["turn:turn.example.com:3478", "turns:turn.example.com:5349"]);
    expect(turnEntry.username).toBe("1700000000:participant-abc");
    expect(turnEntry.credential).toBe("eby2Xebi8FWeGr5bSzWk7pPFeJg=");
  });

  it("omits the STUN entry entirely when no STUN URLs are configured", () => {
    const cfg = readTurnConfig({
      TURN_URLS: "turn:turn.example.com:3478",
      TURN_SHARED_SECRET: "test-shared-secret-do-not-use",
    });

    const ice = buildIceConfiguration(cfg, "participant-abc", 1_700_000_000_000);
    expect(ice.iceServers).toHaveLength(1);
    expect(ice.iceServers[0].username).toBeDefined();
  });

  it("does not alias the configured URL arrays", () => {
    const cfg = readTurnConfig({
      TURN_STUN_URLS: "stun:turn.example.com:3478",
      TURN_URLS: "turn:turn.example.com:3478",
      TURN_SHARED_SECRET: "test-shared-secret-do-not-use",
    });

    const ice = buildIceConfiguration(cfg, "participant-abc", 1_700_000_000_000);
    ice.iceServers[0].urls.push("stun:evil.example.com:3478");
    ice.iceServers[1].urls.push("turn:evil.example.com:3478");

    expect(cfg.stunUrls).toEqual(["stun:turn.example.com:3478"]);
    expect(cfg.turnUrls).toEqual(["turn:turn.example.com:3478"]);
  });
});

describe("mintTurnCredential failure mode", () => {
  it("throws without disclosing secret material when no secret is configured", () => {
    const cfg = readTurnConfig({ TURN_URLS: "turn:turn.example.com:3478" });
    expect(() => mintTurnCredential(cfg, "participant-abc", 1_700_000_000_000)).toThrow(
      /shared secret is not configured/i,
    );
  });
});
