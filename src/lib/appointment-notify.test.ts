// @vitest-environment node
//
// Tests for the official-template variable helpers in appointment-notify.ts:
// buildTemplateVars length/non-empty invariants, countBodyPlaceholders, and the
// save-guard mismatch detection.

import { describe, it, expect } from "vitest";
import {
  TEMPLATE_VAR_SPEC,
  expectedVarCount,
  buildTemplateVars,
  countBodyPlaceholders,
  resolveTemplateField,
  type AptNotifyKind,
  type AptNotifyContext,
} from "./appointment-notify";

const ALL_KINDS = Object.keys(TEMPLATE_VAR_SPEC) as AptNotifyKind[];

const baseCtx: AptNotifyContext = {
  name: "Alex",
  clinicName: "Sunrise Clinic",
  doctorName: "Dr. Rao",
  dateTime: new Date("2026-02-01T09:30:00Z"),
  timeSlot: "9:30 AM",
  tokenNo: 7,
  partySize: 4,
  tableName: "T1 + T2",
};

// A context with every optional field empty, to exercise the non-empty fallbacks.
const sparseCtx: AptNotifyContext = {
  name: "",
  clinicName: null,
  doctorName: null,
  dateTime: new Date("2026-02-01T09:30:00Z"),
  timeSlot: null,
  tokenNo: null,
};

describe("buildTemplateVars", () => {
  it("returns exactly expectedVarCount values for every kind", () => {
    for (const kind of ALL_KINDS) {
      expect(buildTemplateVars(kind, baseCtx)).toHaveLength(expectedVarCount(kind));
    }
  });

  it("never emits an empty body param, even with a sparse context", () => {
    for (const kind of ALL_KINDS) {
      for (const v of buildTemplateVars(kind, sparseCtx)) {
        expect(typeof v).toBe("string");
        expect(v.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("resolveTemplateField", () => {
  it("resolves tokenNo exactly and fails closed when it is missing", () => {
    expect(resolveTemplateField("tokenNo", baseCtx)).toBe("7");
    expect(resolveTemplateField("tokenNo", sparseCtx)).toBeNull();
  });

  it("resolves restaurant fields exactly and fails closed when missing", () => {
    expect(resolveTemplateField("partySize", baseCtx)).toBe("4");
    expect(resolveTemplateField("tableName", baseCtx)).toBe("T1 + T2");
    expect(resolveTemplateField("partySize", sparseCtx)).toBeNull();
    expect(resolveTemplateField("tableName", sparseCtx)).toBeNull();
  });
});

describe("countBodyPlaceholders", () => {
  it("counts distinct {{n}} tokens", () => {
    expect(countBodyPlaceholders("Hi {{1}}, token {{2}}")).toBe(2);
    expect(countBodyPlaceholders("{{1}} and {{1}} again")).toBe(1);
    expect(countBodyPlaceholders("no placeholders here")).toBe(0);
    expect(countBodyPlaceholders("{{ 1 }} spaced {{2}}")).toBe(2);
    expect(countBodyPlaceholders("")).toBe(0);
  });
});

describe("save-guard mismatch detection", () => {
  it("detects when authored placeholder count differs from the spec", () => {
    const kind: AptNotifyKind = "booked"; // expects 6
    const matching = "{{1}} {{2}} {{3}} {{4}} {{5}} {{6}}";
    const tooFew = "{{1}} {{2}} {{3}}";
    expect(countBodyPlaceholders(matching)).toBe(expectedVarCount(kind));
    expect(countBodyPlaceholders(tooFew)).not.toBe(expectedVarCount(kind));
  });
});
