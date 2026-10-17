// @vitest-environment node
//
// Tests for whatsapp-router.ts routing decisions. The pure decideRoute function
// carries the HIGH-1 video exclusion and the official/web fallback policy, so it
// is tested exhaustively here. sendPatientMessage is an I/O orchestration layer
// over DB/cloud/web; its single-channel guarantee is a direct consequence of the
// decideRoute policy exercised below.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { decideRoute, VIDEO_LINK_KINDS } from "./whatsapp-router";
import { TEMPLATE_VAR_SPEC, type AptNotifyKind } from "./appointment-notify";

const ALL_KINDS = Object.keys(TEMPLATE_VAR_SPEC) as AptNotifyKind[];
const NON_VIDEO_KINDS = ALL_KINDS.filter(
  (k) => !(VIDEO_LINK_KINDS as readonly string[]).includes(k),
);

describe("decideRoute — video exclusion (HIGH-1)", () => {
  it("returns 'web' for both video kinds regardless of config", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (available, approvedTemplate) => {
        for (const kind of VIDEO_LINK_KINDS) {
          expect(decideRoute(kind, { available, approvedTemplate })).toBe("web");
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("decideRoute — official vs web for transactional kinds", () => {
  it("returns 'official' only when available AND an approved template exists", () => {
    for (const kind of NON_VIDEO_KINDS) {
      expect(decideRoute(kind, { available: true, approvedTemplate: true })).toBe("official");
      expect(decideRoute(kind, { available: true, approvedTemplate: false })).toBe("web");
      expect(decideRoute(kind, { available: false, approvedTemplate: true })).toBe("web");
      expect(decideRoute(kind, { available: false, approvedTemplate: false })).toBe("web");
    }
  });

  it("is a total function returning exactly one of 'official'|'web' for any input", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_KINDS),
        fc.boolean(),
        fc.boolean(),
        (kind, available, approvedTemplate) => {
          const route = decideRoute(kind, { available, approvedTemplate });
          expect(route === "official" || route === "web").toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});
