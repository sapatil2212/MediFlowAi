// @vitest-environment node
//
// Tests for wa-crypto.ts: AES-256-GCM encrypt/decrypt roundtrip, tamper
// detection, and key-configuration detection. A fixed key is injected so no
// test mutates process.env (except the isEncKeyConfigured env cases).

import { describe, it, expect, afterEach } from "vitest";
import * as fc from "fast-check";
import crypto from "crypto";
import { encryptSecret, decryptSecret, isEncKeyConfigured, last4 } from "./wa-crypto";

const KEY = crypto.randomBytes(32);

describe("encrypt/decrypt roundtrip", () => {
  it("decrypts what it encrypts for arbitrary UTF-8 input", () => {
    fc.assert(
      fc.property(fc.string(), (plain) => {
        const blob = encryptSecret(plain, KEY);
        expect(decryptSecret(blob, KEY)).toBe(plain);
      }),
      { numRuns: 200 },
    );
  });

  it("produces the iv:tag:ciphertext base64 shape", () => {
    const blob = encryptSecret("hello", KEY);
    const parts = blob.split(":");
    expect(parts).toHaveLength(3);
    expect(Buffer.from(parts[0], "base64")).toHaveLength(12);
    expect(Buffer.from(parts[1], "base64")).toHaveLength(16);
  });

  it("uses a fresh IV per call (ciphertext differs for the same input)", () => {
    expect(encryptSecret("same", KEY)).not.toBe(encryptSecret("same", KEY));
  });
});

describe("tamper detection", () => {
  it("throws when a single byte of the ciphertext is flipped", () => {
    const blob = encryptSecret("secret-value", KEY);
    const parts = blob.split(":");
    const data = Buffer.from(parts[2], "base64");
    data[0] = data[0] ^ 0xff;
    const tampered = `${parts[0]}:${parts[1]}:${data.toString("base64")}`;
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  it("throws when decrypted with the wrong key", () => {
    const blob = encryptSecret("secret-value", KEY);
    expect(() => decryptSecret(blob, crypto.randomBytes(32))).toThrow();
  });

  it("throws on a malformed blob", () => {
    expect(() => decryptSecret("not-a-valid-blob", KEY)).toThrow();
    expect(() => decryptSecret("a:b", KEY)).toThrow();
  });
});

describe("isEncKeyConfigured", () => {
  const original = process.env.WA_CLOUD_ENC_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.WA_CLOUD_ENC_KEY;
    else process.env.WA_CLOUD_ENC_KEY = original;
  });

  it("is true for a valid 32-byte key in base64 and hex", () => {
    const raw = crypto.randomBytes(32);
    process.env.WA_CLOUD_ENC_KEY = raw.toString("base64");
    expect(isEncKeyConfigured()).toBe(true);
    process.env.WA_CLOUD_ENC_KEY = raw.toString("hex");
    expect(isEncKeyConfigured()).toBe(true);
  });

  it("is false when missing, short, or malformed", () => {
    delete process.env.WA_CLOUD_ENC_KEY;
    expect(isEncKeyConfigured()).toBe(false);
    process.env.WA_CLOUD_ENC_KEY = "";
    expect(isEncKeyConfigured()).toBe(false);
    process.env.WA_CLOUD_ENC_KEY = crypto.randomBytes(16).toString("base64");
    expect(isEncKeyConfigured()).toBe(false);
    process.env.WA_CLOUD_ENC_KEY = "not%%%valid";
    expect(isEncKeyConfigured()).toBe(false);
  });
});

describe("last4", () => {
  it("returns the final 4 characters", () => {
    expect(last4("abcdef")).toBe("cdef");
    expect(last4("12")).toBe("12");
    expect(last4("")).toBe("");
  });
});
