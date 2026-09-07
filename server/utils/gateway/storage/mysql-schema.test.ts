import { describe, expect, it } from "vitest";
import { MYSQL_SCHEMA_MIGRATIONS } from "./mysql-schema";

describe("MySQL capability schema", () => {
  it("adds capability tables in migration 9", () => {
    const migration = MYSQL_SCHEMA_MIGRATIONS.find((item) => item.version === 9);
    const sql = migration?.statements.join("\n") ?? "";
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS capability_definitions");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS capability_artifacts");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS capability_assignments");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS capability_syncs");
    expect(sql).toContain("uq_capability_assignments_scope");
    expect(sql).toContain("uq_capability_syncs_scope");
  });

  it("adds encrypted scoped credentials in migration 10", () => {
    const migration = MYSQL_SCHEMA_MIGRATIONS.find((item) => item.version === 10);
    const sql = migration?.statements.join("\n") ?? "";
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS credentials");
    expect(sql).toContain("encrypted_payload LONGTEXT NOT NULL");
    expect(sql).toContain("idx_credentials_context");
  });

  it("adds one-time MCP OAuth state in migration 11", () => {
    const migration = MYSQL_SCHEMA_MIGRATIONS.find((item) => item.version === 11);
    const sql = migration?.statements.join("\n") ?? "";
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS credential_oauth_states");
    expect(sql).toContain("PRIMARY KEY (state_hash)");
    expect(sql).toContain("consumed_at VARCHAR(32) NULL");
  });
});
