// Pure SQL-shaping rules for the Patient Records list (no database).
import { describe, expect, it } from "vitest";
import {
  buildPatientGenderFilter,
  buildPatientListQuery,
  buildPatientOrderBy,
  buildPatientRegisteredFilter,
  buildPatientSearch,
  buildPatientVisitFilter,
  initialPatientSortDirection,
  PATIENT_SORT_OPTIONS,
  resolvePatientSortKey,
} from "./patient-query";

describe("buildPatientSearch", () => {
  it("returns nothing for an empty or non-string query", () => {
    expect(buildPatientSearch("")).toEqual({ clauses: [], params: [] });
    expect(buildPatientSearch("   ")).toEqual({ clauses: [], params: [] });
    expect(buildPatientSearch(undefined)).toEqual({ clauses: [], params: [] });
  });

  it("requires every word to match and searches the complaint", () => {
    const s = buildPatientSearch("asha migraine");
    expect(s.clauses).toHaveLength(2);
    expect(s.clauses[0]).toContain("p.chiefComplaint");
    expect(s.params).toEqual(
      Array(8).fill("%asha%").slice(0, 4).concat(Array(4).fill("%migraine%")),
    );
  });

  it("compares digits against a punctuation-free phone", () => {
    const s = buildPatientSearch("+91 98765-43210");
    expect(s.clauses[0]).toContain("REPLACE(");
    expect(s.params).toContain("%91%");
    expect(s.params).toContain("%9876543210%");
  });

  it("never splices user input into the SQL text", () => {
    const evil = "x' OR 1=1; DROP TABLE Patient; --";
    const q = buildPatientListQuery({
      tenantId: "t1",
      search: evil,
      gender: "Male' OR '1'='1",
      registered: "1=1",
      visit: "DROP",
      sortBy: "name; DROP TABLE Patient",
      sortDir: "desc; --",
    });
    expect(q.listSql).not.toContain("DROP");
    expect(q.listSql).not.toContain("1=1");
    expect(q.countSql).not.toContain("DROP");
    expect(q.params[0]).toBe("t1");
    // Each word is bound as its own parameter, never spliced into the SQL.
    expect(q.params).toContain("%DROP%");
    expect(q.params).toContain("%x'%");
  });
});

describe("filters", () => {
  it("whitelists gender, registration window and visit activity", () => {
    expect(buildPatientGenderFilter("Female")).toBe("p.gender = 'Female'");
    expect(buildPatientGenderFilter("Other")).toContain("NOT IN ('Female', 'Male')");
    expect(buildPatientGenderFilter("all")).toBeNull();
    expect(buildPatientGenderFilter("anything")).toBeNull();
    expect(buildPatientRegisteredFilter("today")).toBe("DATE(p.createdAt) = CURDATE()");
    expect(buildPatientRegisteredFilter("month")).toContain("INTERVAL 29 DAY");
    expect(buildPatientRegisteredFilter("all")).toBeNull();
    expect(buildPatientVisitFilter("never")).toBe("x.visitCount = 0");
    expect(buildPatientVisitFilter("upcoming")).toBe("x.nextVisit IS NOT NULL");
    expect(buildPatientVisitFilter("bogus")).toBeNull();
  });

  it("applies visit filters to the derived table and the rest inside it", () => {
    const q = buildPatientListQuery({
      tenantId: "t1",
      gender: "Male",
      registered: "week",
      visit: "recent",
    });
    const [inner, outer] = q.listSql.split(") x");
    expect(inner).toContain("p.tenantId = ? AND p.gender = 'Male' AND p.createdAt >=");
    expect(outer).toContain("WHERE x.lastVisit >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
    expect(q.countSql).toContain("WHERE x.lastVisit >=");
    expect(q.params).toEqual(["t1"]);
  });

  it("scopes visits to the patient's own tenant and ignores cancelled bookings", () => {
    const q = buildPatientListQuery({ tenantId: "t1" });
    expect(q.listSql).toContain("a.tenantId = p.tenantId");
    expect(q.listSql).toContain("a.patientId IS NULL AND a.name = p.name");
    expect(q.listSql).toContain("<> 'Cancelled'");
  });
});

describe("sorting", () => {
  it("defaults to newest registration first with a total tiebreaker", () => {
    expect(buildPatientOrderBy(undefined, undefined)).toBe("x.createdAt DESC, x.id ASC");
    expect(resolvePatientSortKey("nope")).toBe("createdAt");
  });

  it("sorts patient IDs numerically and keeps blanks last", () => {
    expect(buildPatientOrderBy("patientNo", "asc")).toBe(
      "(CASE WHEN x.patientNo LIKE 'P-%' THEN CAST(SUBSTRING(x.patientNo, 3) AS UNSIGNED) END) IS NULL ASC, " +
        "CASE WHEN x.patientNo LIKE 'P-%' THEN CAST(SUBSTRING(x.patientNo, 3) AS UNSIGNED) END ASC, " +
        "x.patientNo ASC, x.createdAt DESC, x.id ASC",
    );
    expect(buildPatientOrderBy("lastVisit", "desc")).toBe(
      "(x.lastVisit) IS NULL ASC, x.lastVisit DESC, x.createdAt DESC, x.id ASC",
    );
  });

  it("starts dates descending and text ascending", () => {
    expect(initialPatientSortDirection("createdAt")).toBe("desc");
    expect(initialPatientSortDirection("lastVisit")).toBe("desc");
    expect(initialPatientSortDirection("name")).toBe("asc");
    expect(PATIENT_SORT_OPTIONS.map((o) => o.key)).toEqual([
      "createdAt",
      "name",
      "patientNo",
      "age",
      "lastVisit",
    ]);
  });
});
