/**
 * appointment-query.ts
 *
 * Pure helpers that build the search predicate and ORDER BY clause for the
 * paged appointment list. No I/O, no db imports — so the SQL-shaping rules are
 * unit-testable and identical wherever they run.
 *
 * Two things this module exists to guarantee:
 *
 *  1. **No SQL injection.** Sort keys are resolved through a fixed whitelist and
 *     the caller can only ever splice a constant string we authored into the
 *     query. Raw user input is never interpolated — it only ever arrives as a
 *     bound `?` parameter.
 *
 *  2. **The search covers what the UI promises.** The appointments toolbar says
 *     it searches "name, email, phone, or complaint", but the server predicate
 *     only looked at name/email/phone. Searching a complaint returned nothing
 *     while the client-side filter — which did check `reason` — had already
 *     been handed an empty page, so the feature looked broken rather than
 *     partial. The term list below is the single source of truth.
 */

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/** Sort direction, already narrowed to the only two legal values. */
export type SortDirection = "asc" | "desc";

/** The sortable columns exposed to the client. */
export type AppointmentSortKey = "dateTime" | "createdAt" | "name" | "status" | "doctor" | "token";

interface SortDefinition {
  /** Human label for the dashboard dropdown. */
  readonly label: string;
  /**
   * The SQL expression to order by. A constant we authored — never built from
   * user input.
   */
  readonly expr: string;
  /** Whether the expression can be NULL, so NULLs can be forced last. */
  readonly nullable: boolean;
}

export const APPOINTMENT_SORTS: Record<AppointmentSortKey, SortDefinition> = {
  dateTime: { label: "Appointment date", expr: "a.dateTime", nullable: false },
  createdAt: { label: "Date booked", expr: "a.createdAt", nullable: false },
  name: { label: "Patient name", expr: "a.name", nullable: false },
  // Alphabetical status sorting is useless to a receptionist ("Cancelled"
  // first). Order by the real workflow instead.
  status: {
    label: "Status (workflow order)",
    expr: "FIELD(a.status, 'Pending', 'Confirmed', 'Completed', 'Cancelled')",
    nullable: false,
  },
  doctor: { label: "Doctor", expr: "d.name", nullable: true },
  token: { label: "Token number", expr: "a.tokenNo", nullable: true },
};

export const DEFAULT_SORT_KEY: AppointmentSortKey = "dateTime";
export const DEFAULT_SORT_DIRECTION: SortDirection = "desc";

/** The dropdown options, in display order. */
export const APPOINTMENT_SORT_OPTIONS: ReadonlyArray<{
  key: AppointmentSortKey;
  label: string;
}> = (Object.keys(APPOINTMENT_SORTS) as AppointmentSortKey[]).map((key) => ({
  key,
  label: APPOINTMENT_SORTS[key].label,
}));

/** Narrow an arbitrary value to a known sort key, falling back to the default. */
export function resolveSortKey(value: unknown): AppointmentSortKey {
  return typeof value === "string" && value in APPOINTMENT_SORTS
    ? (value as AppointmentSortKey)
    : DEFAULT_SORT_KEY;
}

/** Narrow an arbitrary value to a direction, falling back to the default. */
export function resolveSortDirection(value: unknown): SortDirection {
  if (typeof value !== "string") return DEFAULT_SORT_DIRECTION;
  const lowered = value.toLowerCase();
  return lowered === "asc" || lowered === "desc" ? lowered : DEFAULT_SORT_DIRECTION;
}

/**
 * Build the ORDER BY body (without the "ORDER BY" keyword).
 *
 * Always ends with `a.id` so the ordering is total. Without that tiebreaker,
 * rows sharing a sort value (two appointments the same minute, or every row
 * when sorting by status) can be returned in a different order per page,
 * which makes LIMIT/OFFSET pagination duplicate and skip rows.
 */
export function buildAppointmentOrderBy(sortKey: unknown, sortDir: unknown): string {
  const key = resolveSortKey(sortKey);
  const direction = resolveSortDirection(sortDir) === "asc" ? "ASC" : "DESC";
  const { expr, nullable } = APPOINTMENT_SORTS[key];

  const parts: string[] = [];
  // Keep NULLs at the bottom in both directions: an unassigned doctor or a
  // missing token should never outrank real data.
  if (nullable) parts.push(`(${expr}) IS NULL ASC`);
  parts.push(`${expr} ${direction}`);
  if (key !== "dateTime") parts.push("a.dateTime DESC");
  parts.push("a.id ASC");

  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

/**
 * SQL expression that strips common phone punctuation so "+91 98765-43210",
 * "(98765) 43210" and "9876543210" all compare equal.
 */
export const PHONE_NORMALIZE_SQL =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(a.phone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '')";

/** Split a raw query into search terms. Every term must match (AND). */
export function parseSearchTerms(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw.trim().split(/\s+/).filter(Boolean);
}

/** Reduce a term to digits only, for comparison against a normalized phone. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export interface SearchPredicate {
  /** SQL fragments to AND into the WHERE clause. Empty when there is no query. */
  clauses: string[];
  /** Bound parameters, positionally matching the `?` in `clauses`. */
  params: string[];
}

/**
 * Build the search predicate.
 *
 * Each whitespace-separated term must match at least one field, so "sharma
 * fever" narrows instead of widening — typing more words always shrinks the
 * result set, which is what users expect from a search box.
 *
 * Text fields are matched with LIKE %term%. Phone and token are only consulted
 * when the term actually contains digits; otherwise a `%%` pattern would match
 * every row and quietly defeat the filter.
 */
export function buildAppointmentSearch(raw: unknown): SearchPredicate {
  const terms = parseSearchTerms(raw);
  const clauses: string[] = [];
  const params: string[] = [];

  for (const term of terms) {
    const like = `%${term}%`;
    const fields = [
      "a.name LIKE ?",
      "a.email LIKE ?",
      "a.reason LIKE ?",
      "COALESCE(d.name, '') LIKE ?",
    ];
    const termParams = [like, like, like, like];

    const digits = digitsOnly(term);
    if (digits) {
      fields.push(`${PHONE_NORMALIZE_SQL} LIKE ?`);
      termParams.push(`%${digits}%`);
      // Token is an INT; cast so "12" can prefix-match without arithmetic.
      fields.push("CAST(COALESCE(a.tokenNo, 0) AS CHAR) LIKE ?");
      termParams.push(`%${digits}%`);
    }

    clauses.push(`(${fields.join(" OR ")})`);
    params.push(...termParams);
  }

  return { clauses, params };
}

// ---------------------------------------------------------------------------
// Date filtering
// ---------------------------------------------------------------------------

export type AppointmentDateFilter =
  | "all"
  | "today"
  | "tomorrow"
  | "week"
  | "month"
  | "upcoming"
  | "past";

const DATE_FILTER_SQL: Record<Exclude<AppointmentDateFilter, "all">, string> = {
  today: "DATE(a.dateTime) = CURDATE()",
  tomorrow: "DATE(a.dateTime) = DATE_ADD(CURDATE(), INTERVAL 1 DAY)",
  // Calendar-forward windows: a receptionist asking for "this week" means the
  // next 7 days of bookings, not the trailing 7 days the old query returned.
  week: "DATE(a.dateTime) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)",
  month: "DATE(a.dateTime) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)",
  upcoming: "a.dateTime >= NOW()",
  past: "a.dateTime < NOW()",
};

export const APPOINTMENT_DATE_FILTER_OPTIONS: ReadonlyArray<{
  value: AppointmentDateFilter;
  label: string;
}> = [
  { value: "all", label: "All dates" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "week", label: "Next 7 days" },
  { value: "month", label: "Next 30 days" },
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
];

/**
 * True for a real calendar date in strict "YYYY-MM-DD" form. Rejects
 * "2026-02-30", "2026-2-3" and anything with trailing text, so only a clean
 * value is ever bound to `DATE(a.dateTime) = ?`.
 */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Local calendar date as "YYYY-MM-DD" (not UTC — that would be wrong after 18:30 IST). */
export function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Resolve a date filter to a SQL fragment, or null for "all"/unknown. */
export function buildAppointmentDateFilter(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value in DATE_FILTER_SQL
    ? DATE_FILTER_SQL[value as Exclude<AppointmentDateFilter, "all">]
    : null;
}
