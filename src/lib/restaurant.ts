// ─────────────────────────────────────────────────────────────────────────────
// restaurant.ts — the Restaurant & Dining server function boundary.
//
// This module contains `createServerFn` declarations and the small, I/O-free
// helpers they share. Row access lives in `./restaurant.server`; every decision
// lives in the pure, isomorphic `./restaurant-availability`. Nothing here issues
// SQL and nothing here re-derives a slot list, an overlap test, an
// auto-assignment or a status set.
//
// EVERY handler follows the same four steps, in this order:
//
//   1. validate the payload            (`.validator`)
//   2. verify the session              (`verifySession`; a PUBLIC handler skips
//                                       this, takes `tenantId` from the
//                                       validated payload, and instead verifies
//                                       the addressed tenant's Business_
//                                       Profession is `Restaurant and dining`)
//   3. check the permission            (`canUseFeature` / `canOperateFeature`)
//   4. pure validation, then row access
//
// No row is touched before step 3. Hiding a control in the dashboard is a UI
// convenience; this file is the enforcement point (Req 2.8, 4.11, 9.13).
//
// Failures are reported the way every existing server function reports them:
// `throw new Error(message)`, with the message taken from the exported constants
// of `./restaurant-availability` so a copy edit cannot silently break an
// acceptance criterion.
// ─────────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";

import { verifySession } from "./auth.server";
import {
  canOperateFeature,
  canUseFeature,
  type AccountContext,
  type AccountRole,
  type FeatureId,
  type Permission,
  resolveFeatureAccess,
} from "./feature-access";
import {
  DEFAULT_TABLE_AREA,
  MSG_NOT_AUTHORISED_BOOKINGS,
  MSG_NOT_AUTHORISED_RULES,
  MSG_TABLE_HAS_UPCOMING_BOOKINGS,
  MSG_TABLE_NOT_FOUND,
  computeAvailability,
  dayOfWeekForDate,
  daysBetween,
  formatClock,
  formatSlotLabel,
  generateSlotStarts,
  isBookingStatus,
  isRestaurantProfession,
  isValidDateStr,
  occupancyRate,
  tenantNow,
  windowsOverlap,
  type BookingStatus,
  type DayHours,
  type DiningTable,
  type FieldError,
  type Result,
  type ServiceSettings,
  validateBookingRequest,
  validateOperatingHours,
  validateServiceSettings,
  validateTableInput,
} from "./restaurant-availability";
import {
  countTables,
  createBookingAtomic,
  createRestaurantGuest,
  createWalkInBooking,
  deleteBookingAtomic,
  deleteRestaurantGuest,
  deleteTable,
  getBookingsForDate,
  getClosuresForDate,
  getHours,
  getHoursForWeekday,
  getResolvedSettings,
  getRestaurantOverviewAnalytics,
  getTableById,
  getTenantProfile,
  hasUpcomingBlockingBookings,
  highestDisplayOrderInArea,
  insertTable,
  isWhatsAppEnabled,
  listBlockingBookings,
  listBookings,
  listGuests,
  listTableNames,
  listTables,
  reassignBookingAtomic,
  replaceHours,
  setBookingStatus,
  setTableState,
  updateBookingAtomic,
  updateRestaurantGuest,
  updateTable,
  upsertSettings,
  type BookingFilters,
  type RestaurantOverviewAnalytics,
  type TenantProfile,
} from "./restaurant.server";
import { enqueueWA, getWAStatus } from "./whatsapp";

// ─────────────────────────────────────────────────────────────────────────────
// Messages this boundary owns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A tenant that does not exist, or exists but is not a Restaurant_Tenant, is
 * reported identically — a public caller learns nothing from the difference.
 */
export const MSG_RESTAURANT_NOT_FOUND = "Restaurant not found";

/** No session at all. Matches every existing server function's wording. */
export const MSG_UNAUTHORIZED = "Unauthorized";

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 / step 3 helpers — session, tenant identity and permission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The `AccountContext` the pure Feature_Access_Service consumes, built from a
 * `verifySession` result exactly as `auth.ts` builds it. `verifySession` already
 * resolves `profession` from the PARENT `User` row for admin, sub-user and
 * sub-location sessions, and only returns an active child session, so `isActive`
 * is always true here.
 */
function contextFromSession(user: any): AccountContext {
  return {
    role: (user?.role ?? "admin") as AccountRole,
    profession: user?.profession,
    subscriptionPlan: user?.subscriptionPlan,
    subscriptionStatus: user?.subscriptionStatus,
    subscriptionExpiresAt: user?.subscriptionExpiresAt,
    isActive: true,
  };
}

/** The tenant-level `AccountContext` of a PUBLIC caller — owner role, no session. */
function contextFromTenant(profile: TenantProfile): AccountContext {
  return {
    role: "admin",
    profession: profile.profession,
    subscriptionPlan: profile.subscriptionPlan,
    subscriptionStatus: profile.subscriptionStatus,
    subscriptionExpiresAt: profile.subscriptionExpiresAt,
    isActive: true,
  };
}

interface RestaurantSession {
  user: any;
  tenantId: string;
  ctx: AccountContext;
  /** The resolved permission for the feature this handler is gated on. */
  permission: Permission;
}

/**
 * Steps 2 and 3 for a session-backed handler.
 *
 * `mode: "view"` requires `canUseFeature`, `mode: "operate"` requires
 * `canOperateFeature`. The refusal message is the one the requirements name for
 * the feature, and it is thrown BEFORE any row is read or written.
 */
async function requireRestaurant(
  feature: Extract<FeatureId, "restaurant_config" | "restaurant_bookings">,
  mode: "view" | "operate",
): Promise<RestaurantSession> {
  const user = await verifySession();
  if (!user || !user.tenantId) throw new Error(MSG_UNAUTHORIZED);

  const ctx = contextFromSession(user);
  const allowed =
    mode === "operate" ? canOperateFeature(ctx, feature) : canUseFeature(ctx, feature);
  if (!allowed) {
    throw new Error(
      feature === "restaurant_config" ? MSG_NOT_AUTHORISED_RULES : MSG_NOT_AUTHORISED_BOOKINGS,
    );
  }

  return {
    user,
    tenantId: String(user.tenantId),
    ctx,
    permission: resolveFeatureAccess(ctx)[feature].permission,
  };
}

/**
 * Step 2 for a PUBLIC handler: the addressed tenant must exist and its
 * Business_Profession must be `Restaurant and dining` before anything
 * restaurant-shaped happens (design, "Components and Interfaces").
 */
async function requireRestaurantTenant(tenantId: string): Promise<TenantProfile> {
  const profile = await getTenantProfile(tenantId);
  if (!profile || !isRestaurantProfession(profile.profession)) {
    throw new Error(MSG_RESTAURANT_NOT_FOUND);
  }
  return profile;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 helpers — surfacing pure validation, and building the snapshot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turns a validator refusal into the thrown error this codebase reports.
 *
 * A single `FieldError` is thrown verbatim, so the guest-facing message is the
 * exact exported constant the requirements name (and the UI can map it back to
 * its input). Those constants already name the offending field and its
 * permitted range — `Seat capacity must be between 1 and 30`, `Display order
 * must be a whole number between 1 and 999` — so the all-or-nothing validators
 * that collect several at once join them with `; ` rather than inventing a
 * wrapper wording.
 */
function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new Error(messageFor(result.errors));
}

function messageFor(errors: FieldError[]): string {
  if (errors.length === 0) return "Invalid input";
  if (errors.length === 1) return errors[0].message;
  return errors.map((e) => e.message).join("; ");
}

/** Req 11.7 — an absent Location means the Primary_Location (`locationId IS NULL`). */
function scopeLocation(locationId?: string | null): string | null {
  const raw = locationId === null || locationId === undefined ? "" : String(locationId).trim();
  return raw.length === 0 ? null : raw;
}

/** Tenant-local wall time in the `YYYY-MM-DD HH:MM:SS` form stored rows use. */
function wallTimeOf(now: { dateStr: string; minutesOfDay: number }): string {
  return `${now.dateStr} ${formatClock(now.minutesOfDay)}:00`;
}

interface Snapshot {
  settings: ServiceSettings;
  hours: DayHours | null;
  tables: DiningTable[];
  now: { dateStr: string; minutesOfDay: number; weekday: number };
  availability: ReturnType<typeof computeAvailability>;
}

/**
 * The `computeAvailability` snapshot for one tenant, date and Party_Size —
 * shared by the public availability read, the public booking path and the
 * walk-in path, so all three see the same slot list.
 *
 * `includeInactive` is deliberately true: `computeAvailability` needs both
 * Table_States to report `activeTableCount` and the largest Seat_Capacity
 * (Req 5.12), and only `active` tables ever enter an Available_Table set.
 */
async function loadSnapshot(
  tenantId: string,
  date: string,
  partySize: number,
  locationId: string | null,
): Promise<Snapshot> {
  const settings = await getResolvedSettings(tenantId);
  const now = tenantNow(settings.timezone, new Date());
  const hours = await getHoursForWeekday(tenantId, dayOfWeekForDate(date));
  const tables = await listTables(tenantId, { locationId, includeInactive: true });
  const bookings = await listBlockingBookings(
    tenantId,
    date,
    tables.map((t) => t.id),
    settings.turnTime,
  );
  // Req 4.7, 4.8, 11.5, 11.6 — the Closure_Day snapshot for the SAME tenant,
  // date and effective Location, fed into the SAME pure computation the locked
  // booking recheck uses, so a public read and the transaction cannot disagree.
  const closures = await getClosuresForDate(tenantId, date, locationId);

  const availability = computeAvailability({
    settings,
    hours,
    tables,
    bookings,
    closures,
    partySize,
    date,
    nowDateStr: now.dateStr,
    nowMinutes: now.minutesOfDay,
    daysAhead: daysBetween(now.dateStr, date),
  });

  return { settings, hours, tables, now, availability };
}

/** The Dining_Table facts the Table_Layout_View renders. */
function tableView(t: DiningTable) {
  return {
    id: t.id,
    name: t.name,
    seatCapacity: t.seatCapacity,
    area: t.area,
    displayOrder: t.displayOrder,
    state: t.state,
    locationId: t.locationId ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5.1 Public availability (Req 5.1-5.14, 6.4, 11.6, 11.7)
// ─────────────────────────────────────────────────────────────────────────────

export const getRestaurantAvailabilityServerFn = createServerFn({ method: "GET" })
  .validator(
    (data: {
      tenantId: string;
      date: string;
      partySize: number;
      locationId?: string | null;
      /** Echoed back so the client can discard a stale response (Req 6.4). */
      reqId?: number;
    }) => {
      if (!data?.tenantId) throw new Error("Tenant ID is required");
      if (!isValidDateStr(String(data.date ?? "")))
        throw new Error("A valid booking date is required");
      const partySize = Number(data.partySize);
      if (!Number.isInteger(partySize) || partySize < 1)
        throw new Error("A valid party size is required");
      return {
        tenantId: String(data.tenantId),
        date: String(data.date).trim(),
        partySize,
        locationId: data.locationId ?? null,
        reqId: Number.isFinite(Number(data.reqId)) ? Number(data.reqId) : 0,
      };
    },
  )
  .handler(async ({ data }) => {
    // Step 2 — public: no session, so the tenant itself is what gets verified.
    const profile = await requireRestaurantTenant(data.tenantId);

    // Step 4 — snapshot in, pure computation, value out.
    const locationId = scopeLocation(data.locationId);
    const { settings, availability, tables, now } = await loadSnapshot(
      data.tenantId,
      data.date,
      data.partySize,
      locationId,
    );

    return {
      // Req 6.4 — the client applies a response only when all three echoes match
      // its current selection and the reqId is the latest it issued.
      reqId: data.reqId,
      requestedDate: data.date,
      requestedPartySize: data.partySize,

      restaurantName: profile.businessName,
      timezone: settings.timezone,
      maxPartySize: settings.maxPartySize,
      turnTimeMinutes: settings.turnTime,
      advanceBookingWindow: settings.advanceBookingWindow,
      minLeadTime: settings.minLeadTime,
      tenantDateStr: now.dateStr,

      closed: availability.closed,
      outOfWindow: availability.outOfWindow,
      requiresMultipleTables: availability.requiresMultipleTables,
      activeTableCount: availability.activeTableCount,
      largestCapacity: availability.largestCapacity,
      slots: availability.slots,
      tables: tables.map(tableView),
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// 5.1 Public booking creation, with the fire-and-forget notification
// (Req 7.1-7.12, 8.1-8.6, 10.1-10.6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Queues the Table_Booking notification (Req 8.1-8.6).
 *
 * Called WITHOUT `await` from the response path, so a slow or dead WhatsApp
 * microservice cannot delay the committed booking's response (Req 8.5). Every
 * failure inside is caught and logged, and the booking — already committed — is
 * returned regardless (Req 8.2, 8.4, 8.6). A guest without a phone is skipped
 * with a logged omission (Req 8.6).
 */
async function queueBookingNotification(
  profile: TenantProfile,
  booking: {
    bookingId: string;
    guestName: string;
    phone: string;
    date: string;
    slotLabel: string;
    partySize: number;
    /** The Table_Group rendered for display, e.g. `T1 + T2`. */
    tableName: string;
    /** How many Dining_Tables the Table_Group holds, so the copy can pluralise. */
    tableCount: number;
    tokenNo: number;
  },
): Promise<void> {
  if (typeof window !== "undefined") return;

  try {
    const phone = String(booking.phone ?? "").trim();
    if (phone.length === 0) {
      console.log(
        `[Restaurant] Booking ${booking.bookingId}: notification omitted — the guest supplied no phone number`,
      );
      return;
    }

    // Req 8.3 — a message is queued if and only if the WhatsApp feature is
    // available for the tenant AND the connection state is connected.
    if (!canUseFeature(contextFromTenant(profile), "whatsapp")) {
      console.log(
        `[Restaurant] Booking ${booking.bookingId}: notification omitted — the WhatsApp feature is not available for this tenant`,
      );
      return;
    }
    if (!(await isWhatsAppEnabled(profile.tenantId))) {
      console.log(
        `[Restaurant] Booking ${booking.bookingId}: notification omitted — WhatsApp is switched off for this tenant`,
      );
      return;
    }
    const status = await getWAStatus(profile.tenantId);
    if (status.state !== "CONNECTED") {
      console.log(
        `[Restaurant] Booking ${booking.bookingId}: notification omitted — WhatsApp is ${status.state}`,
      );
      return;
    }

    // Req 8.1 — restaurant name, booking date, Booking_Slot, Party_Size, the
    // assigned Table_Group and the Booking_Token.
    const tableLabel = booking.tableCount > 1 ? "Tables" : "Table";
    const body =
      `Hello *${booking.guestName}*,\n\n` +
      `Your table at *${profile.businessName}* is booked.\n\n` +
      `📅 *Date:* ${booking.date}\n` +
      `🕒 *Time:* ${booking.slotLabel}\n` +
      `👥 *Party size:* ${booking.partySize}\n` +
      `🍽️ *${tableLabel}:* ${booking.tableName}\n` +
      `🎫 *Your Token No: #${booking.tokenNo}*\n\n` +
      `We look forward to seeing you!\n\n_This is an automated notification message._`;

    await enqueueWA(profile.tenantId, phone, body);
  } catch (err: any) {
    console.error("[Restaurant] Failed to queue the booking notification:", err?.message ?? err);
  }
}

export const createRestaurantBookingPublicServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      tenantId: string;
      guestName: string;
      phone: string;
      email?: string;
      partySize: number;
      date: string;
      slotStartMinutes?: number;
      slotLabel?: string;
      /**
       * The Table_Group: one or more table ids. Omitted, empty, or the single
       * value `any` means `Any available table`.
       */
      tableIds?: string[] | string | null;
      specialRequests?: string;
      locationId?: string | null;
    }) => {
      if (!data?.tenantId) throw new Error("Tenant ID is required");
      return data;
    },
  )
  .handler(async ({ data }) => {
    // Step 2 — public.
    const profile = await requireRestaurantTenant(data.tenantId);

    // Step 4a — the snapshot the request is validated against.
    const locationId = scopeLocation(data.locationId);
    const partySize = Number(data.partySize);
    const date = String(data.date ?? "").trim();
    const { settings, availability, tables } = await loadSnapshot(
      data.tenantId,
      date,
      Number.isFinite(partySize) ? partySize : 0,
      locationId,
    );

    // Step 4b — pure validation against the computed slots (Req 7.5-7.7, 7.12).
    const request = unwrap(
      validateBookingRequest(
        {
          guestName: data.guestName,
          phone: data.phone,
          email: data.email,
          partySize: data.partySize,
          date,
          slotStartMinutes: data.slotStartMinutes,
          slotLabel: data.slotLabel,
          tableIds: data.tableIds,
          specialRequests: data.specialRequests,
        },
        {
          maxPartySize: settings.maxPartySize,
          slots: availability.slots,
          tables,
          phoneRequired: true,
        },
      ),
    );

    // Step 4c — the transaction. The Req 7.4 conflict is re-checked under its
    // `RestaurantTable` row lock, so the snapshot above is an optimisation, not
    // the guard.
    const created = await createBookingAtomic(data.tenantId, {
      guestName: request.guestName,
      phone: request.phone,
      email: request.email,
      partySize: request.partySize,
      date: request.date,
      slotStartMinutes: request.slotStartMinutes,
      tableIds: request.tableIds,
      specialRequests: request.specialRequests,
      locationId,
      status: "Pending",
    });
    if (!created.ok) throw new Error(created.message);

    // The booking facts are assembled BEFORE the notification is queued, so the
    // response never depends on the Notification_Service (Req 7.9, 8.5).
    const result = {
      success: true as const,
      bookingId: created.bookingId,
      tokenNo: created.tokenNo,
      tables: created.tables,
      tableName: created.tableName,
      date: created.date,
      slotLabel: created.slotLabel,
      startMinutes: created.startMinutes,
      partySize: created.partySize,
      status: created.status,
    };

    // Fire and forget — deliberately not awaited, and it cannot reject.
    void queueBookingNotification(profile, {
      bookingId: created.bookingId,
      guestName: request.guestName,
      phone: request.phone,
      date: created.date,
      slotLabel: created.slotLabel,
      partySize: created.partySize,
      tableName: created.tableName,
      tableCount: created.tables.length,
      tokenNo: created.tokenNo,
    });

    return result;
  });

// ─────────────────────────────────────────────────────────────────────────────
// 5.2 Configuration, gated on `restaurant_config`
// (Req 2.8, 3.1-3.18, 4.1-4.11, 11.1, 11.3)
//
// Reads require `canUseFeature`; every write requires `canOperateFeature` and
// otherwise throws `MSG_NOT_AUTHORISED_RULES` without touching a row.
// ─────────────────────────────────────────────────────────────────────────────

export const getRestaurantTablesServerFn = createServerFn({ method: "GET" })
  .validator((data?: { locationId?: string | null; includeInactive?: boolean }) => ({
    locationId: data?.locationId,
    includeInactive: data?.includeInactive !== false,
  }))
  .handler(async ({ data }) => {
    const { tenantId, permission } = await requireRestaurant("restaurant_config", "view");

    const tables = await listTables(tenantId, {
      // `undefined` keeps every Location of the tenant in scope; the dashboard
      // registry shows them all unless a branch is selected.
      locationId: data.locationId === undefined ? undefined : scopeLocation(data.locationId),
      includeInactive: data.includeInactive,
    });

    return {
      permission,
      tableCount: await countTables(tenantId),
      tables: tables.map(tableView),
    };
  });

export const saveRestaurantTableServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      /** Absent = create, present = edit that row (Req 3.8). */
      id?: string | null;
      name: string;
      seatCapacity: number;
      area?: string;
      displayOrder?: number | null;
      state?: "active" | "inactive";
      locationId?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    // Steps 2 and 3 — nothing below runs for a permission under `operate`.
    const { tenantId } = await requireRestaurant("restaurant_config", "operate");

    const editingId =
      data.id === null || data.id === undefined ? null : String(data.id).trim() || null;

    // Req 3.7 — the Table_Area defaults to `Main`, and Req 3.17's Display_Order
    // default is relative to THAT resolved area.
    const rawArea = String(data.area ?? "").trim();
    const area = rawArea.length === 0 ? DEFAULT_TABLE_AREA : rawArea;

    // Step 4 — pure validation first, against the tenant's stored context.
    const normalised = unwrap(
      validateTableInput(
        {
          name: data.name,
          seatCapacity: data.seatCapacity,
          area: data.area,
          displayOrder: data.displayOrder,
          state: data.state,
          locationId: data.locationId ?? null,
        },
        {
          existingNames: await listTableNames(tenantId),
          editingId,
          tableCount: await countTables(tenantId),
          highestDisplayOrderInArea: await highestDisplayOrderInArea(tenantId, area),
        },
      ),
    );

    const write = editingId
      ? await updateTable(tenantId, editingId, normalised)
      : await insertTable(tenantId, normalised);
    if (!write.ok) throw new Error(write.message);

    return { success: true as const, table: tableView(write.table) };
  });

export const setRestaurantTableStateServerFn = createServerFn({ method: "POST" })
  .validator((data: { tableId: string; state: "active" | "inactive" }) => {
    if (!data?.tableId) throw new Error("A table is required");
    if (data.state !== "active" && data.state !== "inactive")
      throw new Error("Unknown table state");
    return data;
  })
  .handler(async ({ data }) => {
    const { tenantId } = await requireRestaurant("restaurant_config", "operate");

    // Req 3.9, 3.13 — every existing Table_Booking keeps its Booking_Status.
    const write = await setTableState(tenantId, data.tableId, data.state);
    if (!write.ok) throw new Error(write.message);

    return { success: true as const, tableId: data.tableId, state: data.state };
  });

export const deleteRestaurantTableServerFn = createServerFn({ method: "POST" })
  .validator((data: { tableId: string }) => {
    if (!data?.tableId) throw new Error("A table is required");
    return data;
  })
  .handler(async ({ data }) => {
    const { tenantId } = await requireRestaurant("restaurant_config", "operate");

    // A foreign or unknown id is reported as not found (Req 11.3).
    const table = await getTableById(tenantId, data.tableId);
    if (!table) throw new Error(MSG_TABLE_NOT_FOUND);

    // Req 3.11 — refuse while an upcoming Blocking_Status booking references it.
    // `dateTime` stores wall time on the booking date, so "upcoming" is measured
    // in the Tenant_Timezone.
    const settings = await getResolvedSettings(tenantId);
    const now = tenantNow(settings.timezone, new Date());
    if (await hasUpcomingBlockingBookings(tenantId, data.tableId, wallTimeOf(now))) {
      throw new Error(MSG_TABLE_HAS_UPCOMING_BOOKINGS);
    }

    const write = await deleteTable(tenantId, data.tableId);
    if (!write.ok) throw new Error(write.message);

    // Req 3.12 — the referencing bookings are untouched and keep displaying
    // `tableNameAtBooking`.
    return { success: true as const, tableId: data.tableId };
  });

/**
 * Operating_Hours and Service_Settings in one read, which is what the
 * `Booking Rules` and `Operating Hours` sub-tabs mount with.
 *
 * The seven weekday rows are always returned: a weekday the tenant stores no row
 * for is reported closed, which is exactly how the pure layer treats it
 * (Req 4.13, 5.4), so the form never renders a gap.
 */
export const getRestaurantRulesServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const { tenantId, permission } = await requireRestaurant("restaurant_config", "view");

  const settings = await getResolvedSettings(tenantId);
  const stored = await getHours(tenantId);

  const hours: DayHours[] = Array.from({ length: 7 }, (_, dayOfWeek) => {
    const row = stored.find((h) => h.dayOfWeek === dayOfWeek);
    return row
      ? { dayOfWeek, openTime: row.openTime, closeTime: row.closeTime, isClosed: row.isClosed }
      : { dayOfWeek, openTime: "00:00", closeTime: "00:00", isClosed: true };
  });

  return { permission, settings, hours };
});

export const saveRestaurantHoursServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      days: Array<{ dayOfWeek: number; openTime: string; closeTime: string; isClosed?: boolean }>;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireRestaurant("restaurant_config", "operate");

    // Req 4.2 — all seven days, all-or-nothing; `replaceHours` writes them in one
    // transaction so a partial save is impossible.
    const days = unwrap(validateOperatingHours(data?.days));
    await replaceHours(tenantId, days);

    return { success: true as const, hours: days };
  });

export const saveRestaurantSettingsServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      slotInterval?: number;
      turnTime?: number;
      maxPartySize?: number;
      advanceBookingWindow?: number;
      minLeadTime?: number;
      timezone?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireRestaurant("restaurant_config", "operate");

    // Req 4.8 — all-or-nothing, with a per-field message for each offender.
    const settings = unwrap(validateServiceSettings(data));
    // Req 4.12 — existing bookings carry their own Turn_Time snapshot, so this
    // write cannot move an existing Occupancy_Window.
    await upsertSettings(tenantId, settings);

    return { success: true as const, settings };
  });

// ─────────────────────────────────────────────────────────────────────────────
// 5.3 Booking management, gated on `restaurant_bookings`
// (Req 9.1-9.7, 9.12, 9.13, 11.2)
//
// Reads require `canUseFeature`; every write requires `canOperateFeature` and
// otherwise throws `MSG_NOT_AUTHORISED_BOOKINGS`, leaving the stored
// Booking_Status and the stored Dining_Table untouched (Req 9.13).
// ─────────────────────────────────────────────────────────────────────────────

export const getRestaurantBookingsServerFn = createServerFn({ method: "GET" })
  .validator(
    (data?: {
      dateFrom?: string | null;
      dateTo?: string | null;
      statuses?: string[] | null;
      area?: string | null;
      tableId?: string | null;
      guestName?: string | null;
      guestPhone?: string | null;
      locationId?: string | null;
      page?: number;
    }) => {
      const page = Number(data?.page);
      return {
        filters: {
          dateFrom: data?.dateFrom ?? null,
          dateTo: data?.dateTo ?? null,
          statuses: data?.statuses ?? null,
          area: data?.area ?? null,
          tableId: data?.tableId ?? null,
          guestName: data?.guestName ?? null,
          guestPhone: data?.guestPhone ?? null,
          locationId: data?.locationId === undefined ? undefined : scopeLocation(data.locationId),
        } satisfies BookingFilters,
        page: Number.isInteger(page) && page >= 1 ? page : 1,
      };
    },
  )
  .handler(async ({ data }) => {
    const { tenantId, permission } = await requireRestaurant("restaurant_bookings", "view");

    // Default ordering and 25 rows per page live in the row-access layer
    // (Req 9.12), so every caller pages identically.
    const page = await listBookings(tenantId, data.filters, data.page);

    return {
      permission,
      ...page, // rows, total, page and pageSize (= BOOKINGS_PAGE_SIZE)
      totalPages: page.total === 0 ? 0 : Math.ceil(page.total / page.pageSize),
    };
  });

export const setRestaurantBookingStatusServerFn = createServerFn({ method: "POST" })
  .validator((data: { bookingId: string; status: string }) => {
    if (!data?.bookingId) throw new Error("A booking is required");
    if (!data?.status) throw new Error("A booking status is required");
    return data;
  })
  .handler(async ({ data }) => {
    const { tenantId } = await requireRestaurant("restaurant_bookings", "operate");

    // Req 9.4, 9.5 — and, for a Releasing_Status → Blocking_Status transition,
    // the Req 7.8 re-check under the `RestaurantTable` row lock.
    const write = await setBookingStatus(tenantId, data.bookingId, data.status);
    if (!write.ok) throw new Error(write.message);

    return { success: true as const, bookingId: data.bookingId, status: data.status };
  });

export const reassignRestaurantBookingServerFn = createServerFn({ method: "POST" })
  .validator((data: { bookingId: string; tableId: string }) => {
    if (!data?.bookingId) throw new Error("A booking is required");
    if (!data?.tableId) throw new Error("A table is required");
    return data;
  })
  .handler(async ({ data }) => {
    const { tenantId } = await requireRestaurant("restaurant_bookings", "operate");

    // Req 9.6 — the target's Seat_Capacity and Occupancy_Window are re-checked
    // under the same lock order the create path uses.
    const write = await reassignBookingAtomic(tenantId, data.bookingId, data.tableId);
    if (!write.ok) throw new Error(write.message);

    return {
      success: true as const,
      bookingId: write.bookingId,
      tableId: write.tableId,
      tableName: write.tableName,
    };
  });

/**
 * Req 9.7 — a walk-in uses the SAME validation rules as the public path and is
 * created with Booking_Status `Seated`. The only difference is that a walk-in
 * guest may have no phone number, so the phone rule only applies to a submitted
 * value.
 */
export const createWalkInBookingServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      guestName: string;
      phone?: string;
      email?: string;
      partySize: number;
      date: string;
      slotStartMinutes?: number;
      slotLabel?: string;
      /** The Table_Group; omitted / empty / `any` means `Any available table`. */
      tableIds?: string[] | string | null;
      specialRequests?: string;
      locationId?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireRestaurant("restaurant_bookings", "operate");

    const locationId = scopeLocation(data.locationId);
    const partySize = Number(data.partySize);
    const date = String(data.date ?? "").trim();
    const { settings, availability, tables } = await loadSnapshot(
      tenantId,
      date,
      Number.isFinite(partySize) ? partySize : 0,
      locationId,
    );

    const request = unwrap(
      validateBookingRequest(
        {
          guestName: data.guestName,
          phone: data.phone,
          email: data.email,
          partySize: data.partySize,
          date,
          slotStartMinutes: data.slotStartMinutes,
          slotLabel: data.slotLabel,
          tableIds: data.tableIds,
          specialRequests: data.specialRequests,
        },
        {
          maxPartySize: settings.maxPartySize,
          slots: availability.slots,
          tables,
          phoneRequired: false,
        },
      ),
    );

    const created = await createWalkInBooking(tenantId, {
      guestName: request.guestName,
      phone: request.phone,
      email: request.email,
      partySize: request.partySize,
      date: request.date,
      slotStartMinutes: request.slotStartMinutes,
      tableIds: request.tableIds,
      specialRequests: request.specialRequests,
      locationId,
    });
    if (!created.ok) throw new Error(created.message);

    return {
      success: true as const,
      bookingId: created.bookingId,
      tokenNo: created.tokenNo,
      tables: created.tables,
      tableName: created.tableName,
      date: created.date,
      slotLabel: created.slotLabel,
      startMinutes: created.startMinutes,
      partySize: created.partySize,
      status: created.status,
    };
  });

/**
 * Creates a advance or custom reservation with configurable initial status (Confirmed, Pending, etc.).
 */
export const createRestaurantReservationServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      guestName: string;
      phone?: string;
      email?: string;
      partySize: number;
      date: string;
      slotStartMinutes?: number;
      slotLabel?: string;
      tableIds?: string[] | string | null;
      specialRequests?: string;
      status?: string;
      locationId?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireRestaurant("restaurant_bookings", "operate");

    const locationId = scopeLocation(data.locationId);
    const partySize = Number(data.partySize);
    const date = String(data.date ?? "").trim();
    const { settings, availability, tables } = await loadSnapshot(
      tenantId,
      date,
      Number.isFinite(partySize) ? partySize : 0,
      locationId,
    );

    const request = unwrap(
      validateBookingRequest(
        {
          guestName: data.guestName,
          phone: data.phone,
          email: data.email,
          partySize: data.partySize,
          date,
          slotStartMinutes: data.slotStartMinutes,
          slotLabel: data.slotLabel,
          tableIds: data.tableIds,
          specialRequests: data.specialRequests,
        },
        {
          maxPartySize: settings.maxPartySize,
          slots: availability.slots,
          tables,
          phoneRequired: false,
        },
      ),
    );

    const created = await createBookingAtomic(tenantId, {
      guestName: request.guestName,
      phone: request.phone,
      email: request.email,
      partySize: request.partySize,
      date: request.date,
      slotStartMinutes: request.slotStartMinutes,
      tableIds: request.tableIds,
      specialRequests: request.specialRequests,
      status: (data.status && isBookingStatus(data.status) ? data.status : "Confirmed") as BookingStatus,
      locationId,
    });
    if (!created.ok) throw new Error(created.message);

    return {
      success: true as const,
      bookingId: created.bookingId,
      tokenNo: created.tokenNo,
      tables: created.tables,
      tableName: created.tableName,
      date: created.date,
      slotLabel: created.slotLabel,
      startMinutes: created.startMinutes,
      partySize: created.partySize,
      status: created.status,
    };
  });

/**
 * Updates full booking details: guest name, phone, email, party size, notes, status, table.
 */
export const updateRestaurantBookingServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      bookingId: string;
      guestName?: string;
      phone?: string;
      email?: string;
      partySize?: number;
      specialRequests?: string;
      status?: string;
      tableId?: string;
    }) => {
      if (!data?.bookingId) throw new Error("A booking ID is required");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireRestaurant("restaurant_bookings", "operate");
    const res = await updateBookingAtomic(tenantId, data);
    if (!res.ok) throw new Error(res.message || "Failed to update booking");
    return { success: true as const, bookingId: data.bookingId };
  });

/**
 * Deletes a booking group and frees its table allocations completely.
 */
export const deleteRestaurantBookingServerFn = createServerFn({ method: "POST" })
  .validator((data: { bookingId: string }) => {
    if (!data?.bookingId) throw new Error("A booking ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    const { tenantId } = await requireRestaurant("restaurant_bookings", "operate");
    const res = await deleteBookingAtomic(tenantId, data.bookingId);
    if (!res.ok) throw new Error(res.message || "Failed to delete booking");
    return { success: true as const, bookingId: data.bookingId };
  });

// ─────────────────────────────────────────────────────────────────────────────
// 5.4 Overview and Guests (Req 9.8-9.11, 10.3)
// ─────────────────────────────────────────────────────────────────────────────

/** One row of the per-slot grid the Overview and Calendar views render. */
interface SlotOccupancy {
  startMinutes: number;
  label: string;
  /** `active` Dining_Tables held by a Blocking_Status booking in that window. */
  occupiedCount: number;
  /** The rest of the `active` Dining_Tables (Req 9.8). */
  availableCount: number;
}

interface DayOccupancy {
  date: string;
  closed: boolean;
  activeTableCount: number;
  slots: SlotOccupancy[];
  /** Blocking table-slot pairs — the numerator of the occupancy rate (Req 9.10). */
  blockingPairs: number;
  /** Whole percent 0-100, and 0 for a zero slot count (Req 9.10, 9.11). */
  occupancyRate: number;
}

/**
 * The occupancy grid of one date.
 *
 * Deliberately built from `generateSlotStarts` rather than from
 * `computeAvailability`: the availability endpoint filters the current date's
 * slots by the Min_Lead_Time, which is right for a guest choosing a time and
 * wrong for a dashboard reporting on a whole day — it would shrink the
 * denominator of the occupancy rate as the day progressed. Every decision here
 * is still a pure call: slot generation, the half-open overlap test and the rate
 * itself.
 */
async function occupancyForDate(
  tenantId: string,
  date: string,
  locationId: string | null,
  settings: ServiceSettings,
): Promise<DayOccupancy> {
  const hours = await getHoursForWeekday(tenantId, dayOfWeekForDate(date));
  const tables = await listTables(tenantId, { locationId, includeInactive: true });
  const active = tables.filter((t) => t.state === "active");

  const starts = generateSlotStarts(hours, settings);
  const bookings = await listBlockingBookings(
    tenantId,
    date,
    active.map((t) => t.id),
    settings.turnTime,
  );

  let blockingPairs = 0;
  const slots: SlotOccupancy[] = starts.map((startMinutes) => {
    let occupiedCount = 0;
    for (const table of active) {
      const occupied = bookings.some(
        (b) =>
          b.tableId === table.id &&
          windowsOverlap(startMinutes, settings.turnTime, b.startMinutes, b.turnTimeMinutes),
      );
      if (occupied) occupiedCount += 1;
    }
    blockingPairs += occupiedCount;
    return {
      startMinutes,
      label: formatSlotLabel(startMinutes),
      occupiedCount,
      availableCount: active.length - occupiedCount,
    };
  });

  return {
    date,
    closed: !hours || hours.isClosed,
    activeTableCount: active.length,
    slots,
    blockingPairs,
    occupancyRate: occupancyRate(blockingPairs, active.length, starts.length),
  };
}

/**
 * Req 9.9-9.11 — today's Table_Booking count and Party_Size sum in the
 * Tenant_Timezone plus that date's occupancy rate, and the per-slot occupied and
 * available counts of a selected date (Req 9.8).
 *
 * `date` defaults to the tenant-local current date, so the Overview and the
 * Calendar can share one call on first render.
 */
export const getRestaurantOverviewServerFn = createServerFn({ method: "GET" })
  .validator((data?: { date?: string | null; locationId?: string | null }) => ({
    date: data?.date ?? null,
    locationId: data?.locationId,
  }))
  .handler(async ({ data }) => {
    const { tenantId, permission } = await requireRestaurant("restaurant_bookings", "view");

    const settings = await getResolvedSettings(tenantId);
    const now = tenantNow(settings.timezone, new Date());
    const locationId =
      data.locationId === undefined
        ? undefined
        : data.locationId === null
        ? null
        : scopeLocation(data.locationId);

    const requested = String(data.date ?? "").trim();
    const selectedDate = isValidDateStr(requested) ? requested : now.dateStr;

    // Req 9.9 — every Table_Booking whose booking date is the tenant-local
    // current date counts, and its Party_Size contributes to the sum.
    const todays = await getBookingsForDate(tenantId, now.dateStr, { locationId });
    const bookingCount = todays.length;
    const partySizeSum = todays.reduce((sum, b) => sum + (b.partySize ?? 0), 0);

    const today = await occupancyForDate(tenantId, now.dateStr, locationId ?? null, settings);
    const selected =
      selectedDate === now.dateStr
        ? today
        : await occupancyForDate(tenantId, selectedDate, locationId ?? null, settings);

    const analytics = await getRestaurantOverviewAnalytics(tenantId, now.dateStr, { locationId });

    return {
      permission,
      timezone: settings.timezone,
      today: {
        date: now.dateStr,
        bookingCount: analytics.metrics.todayBookings || bookingCount,
        partySizeSum: analytics.metrics.todayGuests || partySizeSum,
        occupancyRate: today.occupancyRate,
        activeTableCount: today.activeTableCount,
        slotCount: today.slots.length,
      },
      selected,
      analytics,
    };
  });

/**
 * Req 10.3 — every Guest record of the tenant with its linked Table_Booking
 * count, most recent booking date and `No Show` count.
 */
export const getRestaurantGuestsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const { tenantId, permission } = await requireRestaurant("restaurant_bookings", "view");
  return { permission, guests: await listGuests(tenantId) };
});

export const createRestaurantGuestServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      name: string;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
      address?: string | null;
    }) => {
      if (!data?.name || !data.name.trim()) throw new Error("Guest name is required");
      return {
        name: data.name.trim(),
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        notes: data.notes?.trim() || null,
        address: data.address?.trim() || null,
      };
    },
  )
  .handler(async ({ data }) => {
    const { tenantId, permission } = await requireRestaurant("restaurant_bookings", "operate");
    const guest = await createRestaurantGuest(tenantId, data);
    return { permission, guest };
  });

export const updateRestaurantGuestServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      name?: string;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
      address?: string | null;
    }) => {
      if (!data?.id || !data.id.trim()) throw new Error("Guest ID is required");
      return {
        id: data.id.trim(),
        name: data.name !== undefined ? data.name.trim() : undefined,
        phone: data.phone !== undefined ? (data.phone ? data.phone.trim() : null) : undefined,
        email: data.email !== undefined ? (data.email ? data.email.trim() : null) : undefined,
        notes: data.notes !== undefined ? (data.notes ? data.notes.trim() : null) : undefined,
        address: data.address !== undefined ? (data.address ? data.address.trim() : null) : undefined,
      };
    },
  )
  .handler(async ({ data }) => {
    const { tenantId, permission } = await requireRestaurant("restaurant_bookings", "operate");
    await updateRestaurantGuest(tenantId, data);
    return { permission, success: true };
  });

export const deleteRestaurantGuestServerFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data?.id || !data.id.trim()) throw new Error("Guest ID is required");
    return { id: data.id.trim() };
  })
  .handler(async ({ data }) => {
    const { tenantId, permission } = await requireRestaurant("restaurant_bookings", "operate");
    await deleteRestaurantGuest(tenantId, data.id);
    return { permission, success: true };
  });

