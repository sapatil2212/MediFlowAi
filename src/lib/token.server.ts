/**
 * token.server.ts — SERVER ONLY
 *
 * Daily token renumbering helper shared by all clinic appointment mutation
 * paths (booking.ts server-fn handlers and auth.ts). Kept in a separate
 * server-only file so it is never pulled into the client bundle; booking.ts
 * imports it via dynamic `await import(...)` inside its handler bodies.
 */
import { queryOne, execute } from "./db";
import { isRestaurantProfession } from "./restaurant-availability";

/**
 * Recomputes the daily token numbers for a tenant so tokens follow the
 * appointment *time* order — the earliest slot of the day gets #1, the
 * next #2, etc., regardless of booking order.
 *
 * Restaurant tenants are intentionally skipped: their tokens are a
 * first-come-first-served queue managed by a dedicated counter.
 */
export async function renumberDailyTokens(tenantId: string, date: Date | string): Promise<void> {
  const dateVal = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(dateVal.getTime())) return;

  const prof = await queryOne<any>("SELECT profession FROM User WHERE tenantId = ? LIMIT 1", [
    tenantId,
  ]);
  if (isRestaurantProfession(prof?.profession)) return;

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
}
