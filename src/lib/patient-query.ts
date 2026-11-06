/**
 * patient-query.ts
 *
 * Pure helpers that build the search, filter and ORDER BY clauses for the paged
 * Patient Records list, mirroring appointment-query.ts. No I/O, no db imports,
 * so the SQL-shaping rules are unit-testable.
 *
 * Guarantees:
 *  • No SQL injection. Sort keys and filter values resolve through fixed
 *    whitelists to constant SQL we authored; user input only ever arrives as a
 *    bound `?` parameter.
 *  • The search covers what the UI promises (name, patient ID, phone, email,
 *    complaint). The old query ignored the complaint even though the search box
 *    advertised "symptoms".
 *
 * The list query is two-level:
 *
 *   SELECT … FROM ( SELECT p.*, <visit columns> FROM Patient p
 *                   WHERE p.tenantId = ? AND <search/gender/registered> ) x
 *   WHERE <visit filter> ORDER BY <x.…>
 *
 * so the derived visit columns (lastVisit, nextVisit, visitCount) can be
 * filtered and sorted on like real columns.
 */

export type SortDirection = "asc" | "desc";

// ---------------------------------------------------------------------------
// Visit columns (derived from the patient's appointments in the same tenant)
// ---------------------------------------------------------------------------

/**
 * An appointment belongs to a patient when it is linked by id or, for older
 * and public bookings that were never linked, by the same name in the tenant.
 * This is the rule the list already used for "last visit".
 */
const APPOINTMENT_OF_PATIENT =
  "a.tenantId = p.tenantId AND (a.patientId = p.id OR (a.patientId IS NULL AND a.name = p.name))";

/** The derived visit columns added to every patient row. */
export const PATIENT_VISIT_COLUMNS = [
  // Most recent appointment that has already happened and was not cancelled.
  `(SELECT MAX(a.dateTime) FROM Appointment a WHERE ${APPOINTMENT_OF_PATIENT} AND a.dateTime <= NOW() AND COALESCE(a.status, '') <> 'Cancelled') AS lastVisit`,
  // Next booked appointment still to come.
  `(SELECT MIN(a.dateTime) FROM Appointment a WHERE ${APPOINTMENT_OF_PATIENT} AND a.dateTime > NOW() AND COALESCE(a.status, '') NOT IN ('Cancelled', 'Completed')) AS nextVisit`,
  // Every non-cancelled appointment, past or future.
  `(SELECT COUNT(*) FROM Appointment a WHERE ${APPOINTMENT_OF_PATIENT} AND COALESCE(a.status, '') <> 'Cancelled') AS visitCount`,
].join(", ");

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type PatientSortKey = "createdAt" | "name" | "patientNo" | "age" | "lastVisit";

interface SortDefinition {
  readonly label: string;
  /** Constant SQL over the derived table alias `x`. Never built from input. */
  readonly expr: string;
  readonly nullable: boolean;
}

export const PATIENT_SORTS: Record<PatientSortKey, SortDefinition> = {
  createdAt: { label: "Date registered", expr: "x.createdAt", nullable: false },
  name: { label: "Patient name", expr: "x.name", nullable: false },
  // "P-010" must sort after "P-009", not between "P-001" and "P-002".
  patientNo: {
    label: "Patient ID",
    expr: "CASE WHEN x.patientNo LIKE 'P-%' THEN CAST(SUBSTRING(x.patientNo, 3) AS UNSIGNED) END",
    nullable: true,
  },
  age: { label: "Age", expr: "x.age", nullable: true },
  lastVisit: { label: "Last visit", expr: "x.lastVisit", nullable: true },
};

export const DEFAULT_PATIENT_SORT_KEY: PatientSortKey = "createdAt";
export const DEFAULT_PATIENT_SORT_DIRECTION: SortDirection = "desc";

export const PATIENT_SORT_OPTIONS: ReadonlyArray<{ key: PatientSortKey; label: string }> = (
  Object.keys(PATIENT_SORTS) as PatientSortKey[]
).map((key) => ({ key, label: PATIENT_SORTS[key].label }));

export function resolvePatientSortKey(value: unknown): PatientSortKey {
  return typeof value === "string" && value in PATIENT_SORTS
    ? (value as PatientSortKey)
    : DEFAULT_PATIENT_SORT_KEY;
}

export function resolvePatientSortDirection(value: unknown): SortDirection {
  if (typeof value !== "string") return DEFAULT_PATIENT_SORT_DIRECTION;
  const lowered = value.toLowerCase();
  return lowered === "asc" || lowered === "desc" ? lowered : DEFAULT_PATIENT_SORT_DIRECTION;
}

/** The direction a column starts in when its header is first clicked. */
export function initialPatientSortDirection(key: PatientSortKey): SortDirection {
  return key === "createdAt" || key === "lastVisit" ? "desc" : "asc";
}

/**
 * ORDER BY body (without the keyword). NULLs always last, then a total
 * tiebreaker so LIMIT/OFFSET pages never duplicate or skip rows.
 */
export function buildPatientOrderBy(sortKey: unknown, sortDir: unknown): string {
  const key = resolvePatientSortKey(sortKey);
  const direction = resolvePatientSortDirection(sortDir) === "asc" ? "ASC" : "DESC";
  const { expr, nullable } = PATIENT_SORTS[key];
  const parts: string[] = [];
  if (nullable) parts.push(`(${expr}) IS NULL ASC`);
  parts.push(`${expr} ${direction}`);
  if (key === "patientNo") parts.push(`x.patientNo ${direction}`);
  if (key !== "createdAt") parts.push("x.createdAt DESC");
  parts.push("x.id ASC");
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Searching (inner query, alias `p`)
// ---------------------------------------------------------------------------

const PHONE_NORMALIZE_SQL =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.phone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '')";

export interface SqlPredicate {
  clauses: string[];
  params: string[];
}

/**
 * Every whitespace-separated term must match at least one field, so more words
 * narrow the result. Phone is only compared when the term contains digits.
 */
export function buildPatientSearch(raw: unknown): SqlPredicate {
  const terms = typeof raw === "string" ? raw.trim().split(/\s+/).filter(Boolean) : [];
  const clauses: string[] = [];
  const params: string[] = [];
  for (const term of terms.slice(0, 8)) {
    const like = `%${term}%`;
    const fields = [
      "p.name LIKE ?",
      "p.patientNo LIKE ?",
      "COALESCE(p.email, '') LIKE ?",
      "COALESCE(p.chiefComplaint, '') LIKE ?",
    ];
    const termParams = [like, like, like, like];
    const digits = term.replace(/\D/g, "");
    if (digits) {
      fields.push(`${PHONE_NORMALIZE_SQL} LIKE ?`);
      termParams.push(`%${digits}%`);
    }
    clauses.push(`(${fields.join(" OR ")})`);
    params.push(...termParams);
  }
  return { clauses, params };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type PatientGenderFilter = "all" | "Female" | "Male" | "Other";

export const PATIENT_GENDER_OPTIONS: ReadonlyArray<{ value: PatientGenderFilter; label: string }> =
  [
    { value: "all", label: "All genders" },
    { value: "Female", label: "Female" },
    { value: "Male", label: "Male" },
    { value: "Other", label: "Other" },
  ];

/** Inner-query gender clause. "Other" covers anything not recorded as Female/Male. */
export function buildPatientGenderFilter(value: unknown): string | null {
  switch (value) {
    case "Female":
      return "p.gender = 'Female'";
    case "Male":
      return "p.gender = 'Male'";
    case "Other":
      return "COALESCE(p.gender, '') NOT IN ('Female', 'Male')";
    default:
      return null;
  }
}

export type PatientRegisteredFilter = "all" | "today" | "week" | "month" | "year";

const REGISTERED_SQL: Record<Exclude<PatientRegisteredFilter, "all">, string> = {
  today: "DATE(p.createdAt) = CURDATE()",
  week: "p.createdAt >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)",
  month: "p.createdAt >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)",
  year: "p.createdAt >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)",
};

export const PATIENT_REGISTERED_OPTIONS: ReadonlyArray<{
  value: PatientRegisteredFilter;
  label: string;
}> = [
  { value: "all", label: "Registered: any time" },
  { value: "today", label: "Registered today" },
  { value: "week", label: "Registered last 7 days" },
  { value: "month", label: "Registered last 30 days" },
  { value: "year", label: "Registered last 12 months" },
];

export function buildPatientRegisteredFilter(value: unknown): string | null {
  return typeof value === "string" && value in REGISTERED_SQL
    ? REGISTERED_SQL[value as Exclude<PatientRegisteredFilter, "all">]
    : null;
}

export type PatientVisitFilter = "all" | "upcoming" | "recent" | "inactive" | "never";

/** Outer-query clauses over the derived visit columns (alias `x`). */
const VISIT_SQL: Record<Exclude<PatientVisitFilter, "all">, string> = {
  upcoming: "x.nextVisit IS NOT NULL",
  recent: "x.lastVisit >= DATE_SUB(NOW(), INTERVAL 30 DAY)",
  inactive: "x.lastVisit < DATE_SUB(NOW(), INTERVAL 90 DAY) AND x.nextVisit IS NULL",
  never: "x.visitCount = 0",
};

export const PATIENT_VISIT_OPTIONS: ReadonlyArray<{ value: PatientVisitFilter; label: string }> = [
  { value: "all", label: "All visit activity" },
  { value: "upcoming", label: "Has upcoming appointment" },
  { value: "recent", label: "Visited in last 30 days" },
  { value: "inactive", label: "Not seen in 90+ days" },
  { value: "never", label: "No appointments yet" },
];

export function buildPatientVisitFilter(value: unknown): string | null {
  return typeof value === "string" && value in VISIT_SQL
    ? VISIT_SQL[value as Exclude<PatientVisitFilter, "all">]
    : null;
}

// ---------------------------------------------------------------------------
// Whole query
// ---------------------------------------------------------------------------

export interface PatientListQueryInput {
  tenantId: string;
  search?: unknown;
  gender?: unknown;
  registered?: unknown;
  visit?: unknown;
  sortBy?: unknown;
  sortDir?: unknown;
}

export interface PatientListQuery {
  /** `SELECT x.* FROM (...) x WHERE ... ORDER BY ...` (append LIMIT/OFFSET). */
  listSql: string;
  countSql: string;
  params: unknown[];
}

/** Builds the list and count SQL sharing one parameter list. */
export function buildPatientListQuery(input: PatientListQueryInput): PatientListQuery {
  const inner: string[] = ["p.tenantId = ?"];
  const params: unknown[] = [input.tenantId];

  const search = buildPatientSearch(input.search);
  inner.push(...search.clauses);
  params.push(...search.params);

  const gender = buildPatientGenderFilter(input.gender);
  if (gender) inner.push(gender);
  const registered = buildPatientRegisteredFilter(input.registered);
  if (registered) inner.push(registered);

  const derived = `(SELECT p.*, ${PATIENT_VISIT_COLUMNS} FROM Patient p WHERE ${inner.join(" AND ")}) x`;
  const visit = buildPatientVisitFilter(input.visit);
  const outerWhere = visit ? ` WHERE ${visit}` : "";
  const orderBy = buildPatientOrderBy(input.sortBy, input.sortDir);

  return {
    listSql: `SELECT x.* FROM ${derived}${outerWhere} ORDER BY ${orderBy}`,
    countSql: `SELECT COUNT(*) AS total FROM ${derived}${outerWhere}`,
    params,
  };
}

/**
 * Tenant-wide counts for the stat cards. Not narrowed by search or filters, so
 * the cards stay meaningful while filtering (as in the appointment list).
 */
export const PATIENT_SUMMARY_SQL = `SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN x.createdAt >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) THEN 1 ELSE 0 END) AS newLast30,
    SUM(CASE WHEN x.lastVisit >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS seenLast30,
    SUM(CASE WHEN x.nextVisit IS NOT NULL THEN 1 ELSE 0 END) AS upcoming
  FROM (SELECT p.*, ${PATIENT_VISIT_COLUMNS} FROM Patient p WHERE p.tenantId = ?) x`;
