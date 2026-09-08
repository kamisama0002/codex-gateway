import { describe, expect, it } from "vitest";
import { MYSQL_SCHEMA_MIGRATIONS } from "./mysql-schema";

describe("MySQL capability schema", () => {
  it("adds capability tables in migration 10", () => {
    const migration = MYSQL_SCHEMA_MIGRATIONS.find((item) => item.version === 10);
    const sql = migration?.statements.join("\n") ?? "";
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS capability_definitions");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS capability_artifacts");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS capability_assignments");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS capability_syncs");
    expect(sql).toContain("uq_capability_assignments_scope");
    expect(sql).toContain("uq_capability_syncs_scope");
  });

  it("adds encrypted scoped credentials in migration 11", () => {
    const migration = MYSQL_SCHEMA_MIGRATIONS.find((item) => item.version === 11);
    const sql = migration?.statements.join("\n") ?? "";
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS credentials");
    expect(sql).toContain("encrypted_payload LONGTEXT NOT NULL");
    expect(sql).toContain("idx_credentials_context");
  });

  it("adds one-time MCP OAuth state in migration 12", () => {
    const migration = MYSQL_SCHEMA_MIGRATIONS.find((item) => item.version === 12);
    const sql = migration?.statements.join("\n") ?? "";
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS credential_oauth_states");
    expect(sql).toContain("PRIMARY KEY (state_hash)");
    expect(sql).toContain("consumed_at VARCHAR(32) NULL");
  });

  it("seeds the default web search capability in migration 13", () => {
    const migration = MYSQL_SCHEMA_MIGRATIONS.find((item) => item.version === 13);
    const sql = migration?.statements.join("\n") ?? "";
    expect(sql).toContain("org__web_search");
    expect(sql).toContain("http://search-mcp:8788/mcp");
    expect(sql).toContain("INSERT IGNORE INTO capability_assignments");
  });

  it("seeds the default browser automation capability in migration 14", () => {
    const migration = MYSQL_SCHEMA_MIGRATIONS.find((item) => item.version === 14);
    const sql = migration?.statements.join("\n") ?? "";
    expect(sql).toContain("org__browser");
    expect(sql).toContain("playwright-mcp");
    expect(sql).toContain("/usr/bin/chromium");
    expect(sql).toContain("/codex-home/browser-profile");
    expect(sql).toContain("INSERT IGNORE INTO capability_assignments");
  });

  it("seeds the authenticated Infinity Dinky MCP in migration 15", () => {
    const migration = MYSQL_SCHEMA_MIGRATIONS.find((item) => item.version === 15);
    const sql = migration?.statements.join("\n") ?? "";
    expect(sql).toContain("org__infinity");
    expect(sql).toContain("http://172.25.106.252:8000/api/v1/mcp/");
    expect(sql).toContain("bearerTokenEnvVar");
    expect(sql).toContain("INFINITY_MCP_TOKEN");
    expect(sql).toContain("INSERT IGNORE INTO capability_assignments");
  });

  it("adds versioned DataOps integration pairing state in migration 16", () => {
    const migration = MYSQL_SCHEMA_MIGRATIONS.find((item) => item.version === 16);
    const sql = migration?.statements.join("\n") ?? "";
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS platform_integrations");
    expect(sql).toContain("encrypted_shared_secret LONGTEXT NOT NULL");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS integration_pairing_codes");
    expect(sql).toContain("code_hash CHAR(64) NOT NULL");
    expect(sql).toContain("uq_platform_integrations_active_provider");
    expect(sql).toContain("uq_integration_pairing_codes_active_provider");
  });

  it("adds runtime nodes and rolling placement columns in migration 17", () => {
    const migration = MYSQL_SCHEMA_MIGRATIONS.find((item) => item.version === 17);
    const sql = migration?.statements.join("\n") ?? "";
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS runtime_nodes");
    expect(sql).toContain("base_url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL");
    expect(sql).toContain("runtime_node_id VARCHAR(128) NULL");
    expect(sql).toContain("placement_generation INT UNSIGNED NULL");
    expect(sql).toContain("workspace_key VARCHAR(128) NULL");
    expect(sql).toContain("fk_user_agent_runtimes_runtime_node");
  });
});
