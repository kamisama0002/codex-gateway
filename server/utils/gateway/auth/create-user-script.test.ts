import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import { verifyPassword } from "../storage/crypto";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";

describe("create-user", () => {
  it("ships a bundled production helper instead of unresolved TypeScript imports", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain(
      "pnpm --filter @codex-gateway/agent-runtime-manager exec esbuild ../../scripts/create-user.mjs",
    );
    expect(
      dockerfile.match(
        /--banner:js="import \{ createRequire \} from 'node:module'; const require = createRequire\(import\.meta\.url\);"/g,
      ),
    ).toHaveLength(2);
    expect(dockerfile).toContain(
      "COPY --from=build /app/.runtime-scripts/create-user.mjs ./scripts/create-user.mjs",
    );
  });

  it("assigns admin to the first user and user to a later user", async () => {
    const database = await migratedDatabase();

    expect(runCreateUser(database.url, "first-user", "password-1").status).toBe(0);
    expect(runCreateUser(database.url, "second-user", "password-2").status).toBe(0);

    expect(await database.db.many("SELECT username, role FROM users ORDER BY id")).toEqual([
      { username: "first-user", role: "admin" },
      { username: "second-user", role: "user" },
    ]);
  }, 15_000);

  it("updates a password without changing an implicit role", async () => {
    const database = await migratedDatabase();

    expect(runCreateUser(database.url, "admin-user", "password-1").status).toBe(0);
    expect(runCreateUser(database.url, "admin-user", "password-2").status).toBe(0);

    const user = await database.db.one<{ password_hash: string; role: string }>(
      "SELECT password_hash, role FROM users WHERE username = ?",
      ["admin-user"],
    );
    expect(user).not.toBeNull();
    expect(user?.role).toBe("admin");
    expect(verifyPassword("password-2", user?.password_hash ?? "")).toBe(true);
  });

  it("changes a role only when --role is explicit", async () => {
    const database = await migratedDatabase();

    expect(runCreateUser(database.url, "role-user", "password-1").status).toBe(0);
    expect(runCreateUser(database.url, "role-user", "password-2", "--role", "user").status).toBe(0);

    expect(
      await database.db.one<{ role: string }>("SELECT role FROM users WHERE username = ?", [
        "role-user",
      ]),
    ).toEqual({ role: "user" });
  });

  it("rejects short passwords without printing credentials", async () => {
    const database = await migratedDatabase();
    const password = "short";

    const result = runCreateUser(database.url, "short-password", password);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Password must be at least 8 characters");
    expect(`${result.stdout}${result.stderr}`).not.toContain(database.url);
    expect(`${result.stdout}${result.stderr}`).not.toContain(password);
  });

  it("closes the MySQL pool after a schema failure without printing DATABASE_URL", async () => {
    const db = await freshMysqlTestDatabase();
    const url = await databaseUrl(db);

    const result = runCreateUser(url, "schema-user", "password-1");

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain(url);
    await expect(db.one("SELECT 1 AS ready")).resolves.toEqual({ ready: 1 });
  });
});

async function migratedDatabase() {
  const db = await freshMysqlTestDatabase();
  await migrateMysqlGatewayDatabase(db);
  return { db, url: await databaseUrl(db) };
}

async function databaseUrl(db: {
  one<T extends Record<string, unknown>>(sql: string): Promise<T | null>;
}) {
  const database = await db.one<{ databaseName: string }>("SELECT DATABASE() AS databaseName");
  if (database === null) throw new Error("MySQL test database is unavailable");
  const url = new URL(process.env.MYSQL_TEST_DATABASE_URL ?? "");
  url.pathname = `/${database.databaseName}`;
  return url.toString();
}

function runCreateUser(databaseUrl: string, ...args: string[]) {
  const result = spawnSync(process.execPath, ["scripts/create-user.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  return result;
}
