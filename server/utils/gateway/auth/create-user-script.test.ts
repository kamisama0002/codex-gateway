import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("create-user", () => {
  it("assigns admin to the first user and user to later users unless a role is explicit", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-gateway-create-user-"));
    temporaryDirectories.push(directory);
    const dbPath = join(directory, "gateway.db");

    runCreateUser(dbPath, "first-user", "password-1");
    runCreateUser(dbPath, "second-user", "password-2");
    runCreateUser(dbPath, "third-user", "password-3", "--role", "admin");

    const db = new DatabaseSync(dbPath);
    expect(db.prepare("SELECT username, role FROM users ORDER BY id").all()).toEqual([
      { username: "first-user", role: "admin" },
      { username: "second-user", role: "user" },
      { username: "third-user", role: "admin" },
    ]);
    db.close();
  });

  it("preserves an existing administrator role when rerun without --role", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-gateway-create-user-"));
    temporaryDirectories.push(directory);
    const dbPath = join(directory, "gateway.db");

    runCreateUser(dbPath, "admin-user", "password-1");
    runCreateUser(dbPath, "admin-user", "password-2");

    const db = new DatabaseSync(dbPath);
    try {
      expect(db.prepare("SELECT role FROM users WHERE username = ?").get("admin-user")).toEqual({
        role: "admin",
      });
    } finally {
      db.close();
    }
  });
});

function runCreateUser(dbPath: string, ...args: string[]) {
  const result = spawnSync(process.execPath, ["scripts/create-user.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, CODEX_GATEWAY_DB_PATH: dbPath },
  });
  expect(result.status, result.stderr).toBe(0);
}
