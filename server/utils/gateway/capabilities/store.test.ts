import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateGatewayDatabase } from "../storage/migrations";
import { createCapabilityStore, type CapabilityStore } from "./store";

describe("CapabilityStore", () => {
  let db: DatabaseSync;
  let store: CapabilityStore;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    migrateGatewayDatabase(db);
    db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)").run(
      7,
      "operator-seven",
      "hash",
      "user",
    );
    db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)").run(
      8,
      "operator-eight",
      "hash",
      "user",
    );
    store = createCapabilityStore(db);
  });

  it("combines user and project grants without leaking another user or project", () => {
    store.create(skillDefinition("org__revenue", "Revenue analysis"));
    store.create(searchDefinition("org__web_search"));
    store.create(httpMcpDefinition("org__project_sales", "https://mcp.example.com/sales"));
    store.create(skillDefinition("org__other_user", "Other user skill"));
    store.assign({ capabilityId: "org__revenue", userId: 7, projectId: null });
    store.assign({ capabilityId: "org__web_search", userId: 7, projectId: null });
    store.assign({ capabilityId: "org__project_sales", userId: 7, projectId: 10 });
    store.assign({ capabilityId: "org__other_user", userId: 8, projectId: null });

    expect(store.listDesiredForContext({ userId: 7, projectId: 10 }).map(({ id }) => id)).toEqual([
      "org__project_sales",
      "org__revenue",
      "org__web_search",
    ]);
    expect(store.listDesiredForContext({ userId: 7, projectId: 11 }).map(({ id }) => id)).toEqual([
      "org__revenue",
      "org__web_search",
    ]);
    expect(store.listDesiredForContext({ userId: 8, projectId: 10 }).map(({ id }) => id)).toEqual([
      "org__other_user",
    ]);
  });

  it("makes assignment idempotent and excludes disabled definitions", () => {
    store.create({ ...skillDefinition("org__disabled", "Disabled"), enabled: false });
    const first = store.assign({ capabilityId: "org__disabled", userId: 7, projectId: null });
    const second = store.assign({ capabilityId: "org__disabled", userId: 7, projectId: null });

    expect(second.id).toBe(first.id);
    expect(store.listAssignments("org__disabled")).toHaveLength(1);
    expect(store.listDesiredForContext({ userId: 7, projectId: null })).toEqual([]);
  });

  it("updates normalized definitions and cascades assignments on delete", () => {
    store.create(skillDefinition("org__knowledge", "Knowledge v1"));
    store.assign({ capabilityId: "org__knowledge", userId: 7, projectId: 22 });
    store.upsertArtifact({
      capabilityId: "org__knowledge",
      version: "1.0.0",
      sha256: "a".repeat(64),
      storagePath: "/data/capabilities/org__knowledge/1.0.0.tar.gz",
      sizeBytes: 128,
    });

    const updated = store.update("org__knowledge", {
      displayName: "Knowledge v2",
      version: "2.0.0",
    });
    expect(store.getArtifact("org__knowledge", "1.0.0")).toMatchObject({
      capabilityId: "org__knowledge",
      sha256: "a".repeat(64),
      sizeBytes: 128,
    });
    expect(updated).toMatchObject({
      id: "org__knowledge",
      displayName: "Knowledge v2",
      version: "2.0.0",
    });
    expect(store.delete("org__knowledge")).toBe(true);
    expect(store.listAssignments("org__knowledge")).toEqual([]);
    expect(store.getArtifact("org__knowledge", "1.0.0")).toBeNull();
  });

  it("rejects unnamespaced IDs, arbitrary MCP executables and external plain HTTP", () => {
    expect(() => store.create(skillDefinition("revenue", "Revenue"))).toThrow(/org__/);
    expect(() =>
      store.create({
        id: "org__shell",
        kind: "mcp",
        displayName: "Shell",
        description: "Unsafe shell",
        version: "1.0.0",
        source: { type: "builtin", locator: "platform" },
        config: { transport: "stdio", command: "bash", args: ["-lc", "env"] },
      }),
    ).toThrow(/executable/i);
    expect(() =>
      store.create(httpMcpDefinition("org__plain_http", "http://outside.example.com/mcp")),
    ).toThrow(/HTTPS/i);
    expect(() =>
      store.create({
        ...skillDefinition("org__url_secret", "URL secret"),
        source: { type: "git", locator: "https://token@github.com/example/skills.git" },
      }),
    ).toThrow(/credentials/i);
  });
});

function skillDefinition(id: string, displayName: string) {
  return {
    id,
    kind: "skill" as const,
    displayName,
    description: `${displayName} capability`,
    version: "1.0.0",
    source: { type: "upload" as const, locator: `artifact:${id}:1.0.0` },
    config: { entryPath: "SKILL.md" },
  };
}

function searchDefinition(id: string) {
  return {
    id,
    kind: "search" as const,
    displayName: "Web search",
    description: "Search public web",
    version: "1.0.0",
    source: { type: "internal" as const, locator: "search-mcp" },
    config: { transport: "streamable_http" as const, url: "http://search-mcp:8788/mcp" },
  };
}

function httpMcpDefinition(id: string, url: string) {
  return {
    id,
    kind: "mcp" as const,
    displayName: id,
    description: `${id} MCP server`,
    version: "1.0.0",
    source: { type: "builtin" as const, locator: "platform" },
    config: { transport: "streamable_http" as const, url },
    sensitiveFields: ["SALES_MCP_TOKEN"],
  };
}
