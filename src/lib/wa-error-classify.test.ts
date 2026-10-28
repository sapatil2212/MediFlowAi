import { describe, expect, it } from "vitest";
import { backoffDelayMs, classifyMetaError, classifyTransportError } from "./wa-error-classify";

describe("classifyMetaError", () => {
  it.each([
    ["130429", "retryable", true],
    ["131000", "retryable", true],
    ["131016", "retryable", true],
    ["131056", "retryable", true],
    ["4", "retryable", true],
    ["80007", "retryable", true],
    ["131026", "permanent", false],
    ["131009", "permanent", false],
    ["100", "permanent", false],
    ["132000", "template", false],
    ["132001", "template", false],
    ["132015", "template", false],
    ["190", "configuration", false],
    ["10", "configuration", false],
    ["133010", "configuration", false],
    ["368", "provider_restriction", false],
    ["131031", "provider_restriction", false],
    ["131048", "provider_restriction", false],
    ["131049", "provider_restriction", false],
    ["131050", "consent", false],
    ["131047", "permanent", false],
  ])("code %s → %s (retry=%s)", (code, cls, retry) => {
    const c = classifyMetaError({ httpStatus: 400, code });
    expect(c.errorClass).toBe(cls);
    expect(c.retry).toBe(retry);
    expect(c.hint.length).toBeGreaterThan(10);
  });

  it("asks for a template re-sync on template errors", () => {
    expect(classifyMetaError({ code: "132001" }).refreshTemplate).toBe(true);
  });

  it("marks account-wide problems as systemic (alert-worthy)", () => {
    expect(classifyMetaError({ code: "190" }).systemic).toBe(true);
    expect(classifyMetaError({ code: "131026" }).systemic).toBeFalsy();
  });

  it("enforces a minimum delay for throughput and pair-rate limits", () => {
    expect(classifyMetaError({ code: "130429" }).minRetryDelayMs).toBeGreaterThanOrEqual(60_000);
    expect(classifyMetaError({ code: "131056" }).minRetryDelayMs).toBeGreaterThanOrEqual(60_000);
  });

  it("never retries an unknown code unless Meta says it is transient", () => {
    expect(classifyMetaError({ httpStatus: 400, code: "999999" })).toMatchObject({
      errorClass: "unknown",
      retry: false,
    });
    expect(classifyMetaError({ httpStatus: 400, code: "999999", isTransient: true }).retry).toBe(
      true,
    );
    expect(classifyMetaError({ httpStatus: 503, code: "999999" }).retry).toBe(true);
  });
});

describe("classifyTransportError", () => {
  it("retries failures that happened before the request reached Meta", () => {
    expect(
      classifyTransportError({ message: "getaddrinfo ENOTFOUND graph.facebook.com" }).retry,
    ).toBe(true);
    expect(classifyTransportError({ message: "connect ECONNREFUSED" }).retry).toBe(true);
  });

  it("treats timeouts and resets as ambiguous (never auto-retried)", () => {
    const c = classifyTransportError({ message: "The operation was aborted due to timeout" });
    expect(c).toMatchObject({ ambiguous: true, retry: false });
    expect(classifyTransportError({ message: "socket hang up" }).ambiguous).toBe(true);
  });

  it("retries a Meta 5xx and holds when credentials are missing", () => {
    expect(
      classifyTransportError({ message: "Graph API returned 502", httpStatus: 502 }).retry,
    ).toBe(true);
    expect(classifyTransportError({ message: "Cloud API not configured" })).toMatchObject({
      errorClass: "configuration",
      retry: true,
    });
  });

  it("does not retry a local test-mode refusal", () => {
    expect(
      classifyTransportError({
        message: "Recipient not in WA_CLOUD_TEST_RECIPIENTS (local test mode)",
      }),
    ).toMatchObject({ errorClass: "configuration", retry: false });
  });
});

describe("backoffDelayMs", () => {
  it("grows exponentially with full jitter, floored and capped", () => {
    const max = (attempt: number) => backoffDelayMs(attempt, { random: () => 1 });
    expect(max(1)).toBe(30_000);
    expect(max(2)).toBe(60_000);
    expect(max(3)).toBe(120_000);
    expect(max(20)).toBe(6 * 60 * 60_000);
    expect(backoffDelayMs(3, { random: () => 0 })).toBe(15_000);
  });
});
