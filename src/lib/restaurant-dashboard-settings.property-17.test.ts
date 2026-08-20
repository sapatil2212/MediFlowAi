import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { SUB_USER_ROLES, type SubUserRole } from "./restaurant-settings-model";

/**
 * Property 17: Password omission preserves a SubUser hash
 *
 * This is a DEDICATED, DB-free model of the repository's `updateSubUser`
 * semantics in `src/lib/restaurant-settings.server.ts`. That method builds its
 * SQL SET clause as:
 *
 *   const columns = ["name = ?", "email = ?", "phone = ?", "role = ?", "isActive = ?"];
 *   ...
 *   if (input.passwordHash !== undefined) {
 *     columns.push("password = ?");
 *     params.push(input.passwordHash);
 *   }
 *
 * i.e. the `password` column is written IF AND ONLY IF `passwordHash !== undefined`.
 * When omitted, the stored password hash is retained byte-for-byte. When a valid
 * replacement hash is supplied, it replaces exactly the password column while the
 * other submitted fields update and any non-submitted fields are preserved.
 *
 * We faithfully reproduce that behavior with an in-memory user store. We do NOT
 * import DB code.
 */

// -----------------------------------------------------------------------------
// In-memory model of a stored SubUser row and the updateSubUser mutation.
// -----------------------------------------------------------------------------

/** Mirrors the persistent SubUser columns touched by `updateSubUser`. */
interface StoredUserRow {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  /** Persisted as NULL when empty, exactly like `input.phone || null`. */
  phone: string | null;
  role: SubUserRole;
  /** The stored bcrypt-style password hash. */
  password: string;
  isActive: boolean;
  /** A non-submitted column the mutation never touches. */
  profilePhoto: string | null;
}

/** Mirrors `UpdateSubUserInput`: `passwordHash` omitted (undefined) retains the hash. */
interface UpdateInput {
  name: string;
  email: string;
  phone: string;
  role: SubUserRole;
  passwordHash?: string;
  isActive: boolean;
}

type UpdateOutcome = { status: "updated" } | { status: "not_found" };

/**
 * Faithful in-memory port of `RestaurantSettingsRepository.updateSubUser`.
 *
 * - Resolves the row by (id, tenantId); missing rows are `not_found`.
 * - Always writes name/email/phone/role/isActive.
 * - Writes `password` only when `passwordHash !== undefined`.
 * - Never touches non-submitted columns (e.g. `profilePhoto`).
 */
function updateSubUserInMemory(
  store: Map<string, StoredUserRow>,
  tenantId: string,
  subUserId: string,
  input: UpdateInput,
): UpdateOutcome {
  const key = `${tenantId}::${subUserId}`;
  const existing = store.get(key);
  if (!existing) return { status: "not_found" };

  const next: StoredUserRow = {
    ...existing,
    name: input.name,
    email: input.email,
    phone: input.phone || null,
    role: input.role,
    isActive: input.isActive,
  };
  if (input.passwordHash !== undefined) {
    next.password = input.passwordHash;
  }
  store.set(key, next);
  return { status: "updated" };
}

// -----------------------------------------------------------------------------
// Generators
// -----------------------------------------------------------------------------

const roleArb: fc.Arbitrary<SubUserRole> = fc.constantFrom(...SUB_USER_ROLES);

// Password hashes are opaque byte strings; generate distinctive values so we can
// detect byte-level changes. Includes unicode/whitespace to stress byte identity.
const hashArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 80 });

const storedUserArb: fc.Arbitrary<StoredUserRow> = fc.record({
  id: fc.uuid(),
  tenantId: fc.constantFrom("tenant-a", "tenant-b", "tenant-c"),
  name: fc.string({ maxLength: 40 }),
  email: fc.emailAddress(),
  phone: fc.oneof(fc.constant<string | null>(null), fc.string({ maxLength: 20 })),
  role: roleArb,
  password: hashArb,
  isActive: fc.boolean(),
  profilePhoto: fc.oneof(fc.constant<string | null>(null), fc.webUrl()),
});

// Editable fields the UI submits (everything except the password decision).
const editableFieldsArb = fc.record({
  name: fc.string({ maxLength: 40 }),
  email: fc.emailAddress(),
  phone: fc.string({ maxLength: 20 }),
  role: roleArb,
  isActive: fc.boolean(),
});

type EditableFields = {
  name: string;
  email: string;
  phone: string;
  role: SubUserRole;
  isActive: boolean;
};

function seedStore(user: StoredUserRow): Map<string, StoredUserRow> {
  const store = new Map<string, StoredUserRow>();
  store.set(`${user.tenantId}::${user.id}`, { ...user });
  return store;
}

function assertSubmittedFieldsApplied(row: StoredUserRow, edit: EditableFields): void {
  expect(row.name).toBe(edit.name);
  expect(row.email).toBe(edit.email);
  expect(row.phone).toBe(edit.phone || null);
  expect(row.role).toBe(edit.role);
  expect(row.isActive).toBe(edit.isActive);
}

// -----------------------------------------------------------------------------
// Feature: restaurant-dashboard-settings, Property 17: Password omission preserves a SubUser hash
// **Validates: Requirements 8.5, 8.6, 8.7**
// -----------------------------------------------------------------------------
describe("Feature: restaurant-dashboard-settings, Property 17: Password omission preserves a SubUser hash", () => {
  it("omitting the password leaves the stored hash byte-for-byte identical while other fields update", () => {
    fc.assert(
      fc.property(storedUserArb, editableFieldsArb, (user, edit) => {
        const store = seedStore(user);
        const originalHash = user.password;

        const outcome = updateSubUserInMemory(store, user.tenantId, user.id, {
          ...edit,
          // passwordHash intentionally omitted (undefined) — retain current hash.
        });

        expect(outcome.status).toBe("updated");
        const updated = store.get(`${user.tenantId}::${user.id}`)!;

        // Byte-identical hash retention.
        expect(updated.password).toBe(originalHash);
        expect(updated.password.length).toBe(originalHash.length);
        expect([...updated.password]).toEqual([...originalHash]);

        // Submitted fields update per the edit.
        assertSubmittedFieldsApplied(updated, edit);
        // Non-submitted field preserved.
        expect(updated.profilePhoto).toBe(user.profilePhoto);
      }),
      { numRuns: 400 },
    );
  });

  it("supplying a valid replacement hash replaces exactly the password without overwriting non-submitted fields", () => {
    fc.assert(
      fc.property(storedUserArb, editableFieldsArb, hashArb, (user, edit, newHash) => {
        const store = seedStore(user);

        const outcome = updateSubUserInMemory(store, user.tenantId, user.id, {
          ...edit,
          passwordHash: newHash,
        });

        expect(outcome.status).toBe("updated");
        const updated = store.get(`${user.tenantId}::${user.id}`)!;

        // The password column is replaced by exactly the supplied hash.
        expect(updated.password).toBe(newHash);

        // Submitted fields update per the edit; non-submitted field preserved.
        assertSubmittedFieldsApplied(updated, edit);
        expect(updated.profilePhoto).toBe(user.profilePhoto);
      }),
      { numRuns: 400 },
    );
  });

  it("a replacement equal to the current hash keeps it byte-identical (idempotent write)", () => {
    fc.assert(
      fc.property(storedUserArb, editableFieldsArb, (user, edit) => {
        const store = seedStore(user);
        const originalHash = user.password;

        const outcome = updateSubUserInMemory(store, user.tenantId, user.id, {
          ...edit,
          passwordHash: originalHash,
        });

        expect(outcome.status).toBe("updated");
        const updated = store.get(`${user.tenantId}::${user.id}`)!;
        expect(updated.password).toBe(originalHash);
        expect([...updated.password]).toEqual([...originalHash]);
        assertSubmittedFieldsApplied(updated, edit);
      }),
      { numRuns: 400 },
    );
  });

  it("omission and supplying the current hash yield an identical stored row (equivalence)", () => {
    fc.assert(
      fc.property(storedUserArb, editableFieldsArb, (user, edit) => {
        const omittedStore = seedStore(user);
        const suppliedStore = seedStore(user);

        updateSubUserInMemory(omittedStore, user.tenantId, user.id, { ...edit });
        updateSubUserInMemory(suppliedStore, user.tenantId, user.id, {
          ...edit,
          passwordHash: user.password,
        });

        const omitted = omittedStore.get(`${user.tenantId}::${user.id}`)!;
        const supplied = suppliedStore.get(`${user.tenantId}::${user.id}`)!;
        expect(omitted).toEqual(supplied);
      }),
      { numRuns: 400 },
    );
  });

  it("the mutation targets only the resolved (tenant,id) row and reports not_found otherwise", () => {
    fc.assert(
      fc.property(storedUserArb, editableFieldsArb, hashArb, (user, edit, newHash) => {
        const store = seedStore(user);
        // A foreign tenant never matches the tenant-scoped row.
        const foreignTenant = `${user.tenantId}-other`;
        const outcome = updateSubUserInMemory(store, foreignTenant, user.id, {
          ...edit,
          passwordHash: newHash,
        });
        expect(outcome.status).toBe("not_found");

        // The stored row is untouched, hash included.
        const untouched = store.get(`${user.tenantId}::${user.id}`)!;
        expect(untouched).toEqual(user);
      }),
      { numRuns: 400 },
    );
  });
});
