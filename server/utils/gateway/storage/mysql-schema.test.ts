import { describe, expect, it } from "vitest";
import { MYSQL_SCHEMA_MIGRATIONS } from "./mysql-schema";

describe("MySQL capability schema", () => {
  it("adds capability tables in migration 9", () => {
    const migration = MYSQL_SCHEMA_MIGRATIONS.at(-1);
    expect(migration?.version).toBe(9);
    const sql = migration?.statements.join("\n") ?? "";
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS capability_definitions");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS capability_artifacts");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS capability_assignments");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS capability_syncs");
    expect(sql).toContain("uq_capability_assignments_scope");
    expect(sql).toContain("uq_capability_syncs_scope");
  });
});
