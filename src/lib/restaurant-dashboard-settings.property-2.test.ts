import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  deriveProfileCapabilityViewModel,
  type Permission,
  type RestaurantSettingsAccountRole,
} from "./restaurant-settings-model";

const roles: readonly RestaurantSettingsAccountRole[] = [
  "admin",
  "reception",
  "doctor",
  "location",
];
const configPermissions: readonly Permission[] = ["operate", "view_only", "none"];
const rolePermissionCases = roles.flatMap((role) =>
  configPermissions.map((configPermission) => ({ role, configPermission })),
);

// Feature: restaurant-dashboard-settings, Property 2: Profile security visibility is independent of configuration permission
// **Validates: Requirements 2.6, 2.8, 2.9, 2.13**
describe("Property 2: Profile security visibility is independent of configuration permission", () => {
  it("always exposes account security and gates profile/photo mutation exactly on operate", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(rolePermissionCases, {
          minLength: rolePermissionCases.length,
          maxLength: rolePermissionCases.length,
        }),
        (cases) => {
          expect(cases).toHaveLength(roles.length * configPermissions.length);

          for (const { role, configPermission } of cases) {
            const capability = deriveProfileCapabilityViewModel(configPermission);
            const canOperate = configPermission === "operate";

            expect(role).toBeTypeOf("string");
            expect(capability.showProfile).toBe(true);
            expect(capability.showAccountSecurity).toBe(true);
            expect(capability.canChangeOwnEmail).toBe(true);
            expect(capability.canChangeOwnPassword).toBe(true);
            expect(capability.canEditProfile).toBe(canOperate);
            expect(capability.canUploadProfilePhoto).toBe(canOperate);
            expect(capability.profileReadOnly).toBe(!canOperate);
          }
        },
      ),
      { numRuns: 400 },
    );
  });
});
