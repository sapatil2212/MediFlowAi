/**
 * token.server.ts — SERVER ONLY
 *
 * Daily token renumbering helper shared by all clinic appointment mutation
 * paths (booking.ts server-fn handlers and auth.ts). Kept in a separate
 * server-only file so it is never pulled into the client bundle; booking.ts
 * imports it via dynamic `await import(...)` inside its handler bodies.
 */
import { query, queryOne, execute } from "./db";
import { isRestaurantProfession } from "./restaurant-availability";

export interface RenumberOptions {
  /**
   * An appointment that must NOT be flagged for a "token changed" message —
   * used for the row currently being created or updated, because that flow
   * sends its own confirmation carrying the freshly-read token.
   */
  skipNotifyId?: string;
}

/**
 * Recomputes the daily token numbers for a tenant so tokens follow the
 * appointment *time* order — the earliest slot of the day gets #1, the
 * next #2, etc., regardless of booking order.
 *
 * Because tokens are ordered by time, booking an EARLIER slot shifts every
 * later appointment's token up by one. Any patient who was already told their
 * old number is now holding a stale value, so this flags those rows via
 * `tokenNotifyPending`; the reminder scheduler sends one corrected message per
 * affected patient on its next cycle (which debounces a burst of bookings).
 *
 * Restaurant tenants are intentionally skipped: their tokens are a
 * first-come-first-served queue managed by a dedicated counter.
 */
export async function renumberDailyTokens(
  tenantId: string,
  date: Date | string,
  opts: RenumberOptions = {},
): Promise<void> {
  const dateVal = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(dateVal.getTime())) return;

  const prof = await queryOne<any>("SELECT profession FROM User WHERE tenantId = ? LIMIT 1", [
    tenantId,
  ]);
  if (isRestaurantProfession(prof?.profession)) return;

  // Snapshot the current tokens so we can tell which patients need a correction.
  const before = await query<any>(
    `SELECT id, tokenNo, status FROM Appointment
      WHERE tenantId = ? AND DATE(dateTime) = DATE(?)`,
    [tenantId, dateVal],
  );

  await execute(
    `UPDATE Appointment a
       JOIN (
         SELECT id,
                ROW_NUMBER() OVER (ORDER BY dateTime ASC, createdAt ASC, id ASC) AS rn
           FROM Appointment
          WHERE tenantId = ? AND DATE(dateTime) = DATE(?)
       ) ranked ON ranked.id = a.id
        SET a.tokenNo = ranked.rn`,
    [tenantId, dateVal],
  );

  const after = await query<any>(
    `SELECT id, tokenNo FROM Appointment
      WHERE tenantId = ? AND DATE(dateTime) = DATE(?)`,
    [tenantId, dateVal],
  );

  // Flag only rows whose token actually moved, that had a token to begin with
  // (so a brand-new row is never "corrected"), and that are still live.
  const newTokens = new Map<string, number>();
  for (const row of after) newTokens.set(String(row.id), Number(row.tokenNo));

  const changedIds: string[] = [];
  for (const row of before) {
    const id = String(row.id);
    if (id === opts.skipNotifyId) continue;
    if (row.tokenNo === null || row.tokenNo === undefined) continue;
    const status = String(row.status || "");
    if (status === "Cancelled" || status === "Completed") continue;
    const next = newTokens.get(id);
    if (next !== undefined && next !== Number(row.tokenNo)) changedIds.push(id);
  }

  if (changedIds.length === 0) return;

  const placeholders = changedIds.map(() => "?").join(", ");
  await execute(
    `UPDATE Appointment SET tokenNotifyPending = 1 WHERE id IN (${placeholders})`,
    changedIds,
  );
}
