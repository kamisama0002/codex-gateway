import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../tests/mysql/helpers";
import { buildGatewayV8Sqlite } from "../../tests/fixtures/build-gateway-v8-sqlite.mjs";
import type { GatewayDb } from "../../server/utils/gateway/storage/contracts";
import { encryptJson } from "../../server/utils/gateway/storage/crypto";
import { migrateMysqlGatewayDatabase } from "../../server/utils/gateway/storage/mysql-migrations";

const FIXTURE_SECRET = "task-8-fixture-encryption-secret";
const BUSINESS_TABLES = [
  "users",
  "sessions",
  "user_configs",
  "tmux_monitors",
  "user_agent_runtimes",
  "agent_audit_events",
  "model_providers",
  "provider_models",
  "user_model_grants",
  "external_identities",
  "external_session_contexts",
] as const;

const fixtureDirectory = mkdtempSync(join(tmpdir(), "codex-gateway-sqlite-import-"));
let fixtureNumber = 0;
let originalSecret: string | undefined;

describe("SQLite v8 to MySQL import", () => {
  beforeAll(() => {
    originalSecret = process.env.CODEX_GATEWAY_CONFIG_SECRET;
    process.env.CODEX_GATEWAY_CONFIG_SECRET = FIXTURE_SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.CODEX_GATEWAY_CONFIG_SECRET;
    } else {
      process.env.CODEX_GATEWAY_CONFIG_SECRET = originalSecret;
    }
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  it("exposes import and verification help without requiring database credentials", () => {
    for (const script of [
      "scripts/database/import-sqlite.mjs",
      "scripts/database/verify-import.mjs",
    ]) {
      const result = spawnSync(process.execPath, [script, "--", "--help"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: "" },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("--source <path>");
      expect(`${result.stdout}${result.stderr}`).not.toContain(FIXTURE_SECRET);
    }
  });

  it("ships both database helpers as Node 24 production bundles", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain(
      "pnpm --filter @codex-gateway/agent-runtime-manager exec esbuild ../../scripts/database/import-sqlite.mjs",
    );
    expect(dockerfile).toContain(
      "pnpm --filter @codex-gateway/agent-runtime-manager exec esbuild ../../scripts/database/verify-import.mjs",
    );
    expect(dockerfile).toContain(
      "COPY --from=build /app/.runtime-scripts/import-sqlite.mjs ./scripts/database/import-sqlite.mjs",
    );
    expect(dockerfile).toContain(
      "COPY --from=build /app/.runtime-scripts/verify-import.mjs ./scripts/database/verify-import.mjs",
    );
    expect(
      dockerfile.match(
        /--banner:js="import \{ createRequire \} from 'node:module'; const require = createRequire\(import\.meta\.url\);"/g,
      ),
    ).toHaveLength(4);
  });

  it("runs dry-run, import, and verification through the separate CLI processes", async () => {
    const sourcePath = createFixture();
    const db = await migratedDatabase();
    const databaseUrl = await testDatabaseUrl(db);

    const dryRun = runDatabaseCli("import-sqlite.mjs", databaseUrl, sourcePath, "--dry-run");
    expect(dryRun.status, dryRun.stderr).toBe(0);
    expect(dryRun.stdout).toContain("overall count=15");
    expect(dryRun.stdout).toContain("PASS");
    expect(dryRun.stdout).not.toContain(FIXTURE_SECRET);
    expect(dryRun.stdout).not.toContain("fixture-chat-secret");
    await expectBusinessCounts(db, 0);

    const imported = runDatabaseCli("import-sqlite.mjs", databaseUrl, sourcePath);
    expect(imported.status, imported.stderr).toBe(0);
    expect(imported.stdout).toContain("overall count=15");
    expect(imported.stdout).toContain("PASS");

    const verified = runDatabaseCli("verify-import.mjs", databaseUrl, sourcePath);
    expect(verified.status, verified.stderr).toBe(0);
    expect(verified.stdout).toContain("overall count=15");
    expect(verified.stdout).toContain("PASS");
    expect((await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM users"))?.count).toBe(2);
  });

  it("validates a deterministic fixture in dry-run mode without changing source or target rows", async () => {
    const sourcePath = createFixture();
    const sourceChecksum = fileChecksum(sourcePath);
    expect(fileChecksum(createFixture())).toBe(sourceChecksum);
    const db = await migratedDatabase();
    const { importSqliteGatewayDatabase } = await import("./sqlite-import.ts");

    const report = await importSqliteGatewayDatabase({ sourcePath, target: db, dryRun: true });

    expect(report.passed).toBe(true);
    expect(
      report.tables.map((table) => [table.table, table.sourceCount, table.targetCount]),
    ).toEqual([
      ["users", 2, 2],
      ["sessions", 2, 2],
      ["user_configs", 1, 1],
      ["tmux_monitors", 2, 2],
      ["user_agent_runtimes", 1, 1],
      ["agent_audit_events", 2, 2],
      ["model_providers", 2, 2],
      ["provider_models", 3, 3],
      ["user_model_grants", 3, 3],
      ["external_identities", 1, 1],
      ["external_session_contexts", 1, 1],
    ]);
    expect(fileChecksum(sourcePath)).toBe(sourceChecksum);
    await expectBusinessCounts(db, 0);
  });

  it("rejects a corrupt SQLite source after quick_check and leaves MySQL empty", async () => {
    const sourcePath = join(fixtureDirectory, `corrupt-${fixtureNumber++}.db`);
    writeFileSync(sourcePath, "not a sqlite database", "utf8");
    const db = await migratedDatabase();
    const { importSqliteGatewayDatabase } = await import("./sqlite-import.ts");

    await expect(
      importSqliteGatewayDatabase({ sourcePath, target: db, dryRun: false }),
    ).rejects.toThrow("SQLite quick_check failed");
    await expectBusinessCounts(db, 0);
  });

  it("refuses a non-empty migrated MySQL target before importing source rows", async () => {
    const sourcePath = createFixture();
    const db = await migratedDatabase();
    await db.execute(
      "INSERT INTO users (id, username, password_hash, is_active, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [7, "existing-target-user", "existing-hash", 1, "admin", timestamp(1), timestamp(1)],
    );
    const { importSqliteGatewayDatabase } = await import("./sqlite-import.ts");

    await expect(
      importSqliteGatewayDatabase({ sourcePath, target: db, dryRun: false }),
    ).rejects.toThrow("empty");
    expect(await db.many("SELECT id, username FROM users ORDER BY id")).toEqual([
      { id: 7, username: "existing-target-user" },
    ]);
    await expectBusinessCounts(db, 1);
  });

  it("serializes a disjoint writer until after the verified import commits", async () => {
    const sourcePath = createFixture();
    const db = await migratedDatabase();
    const databaseUrl = await testDatabaseUrl(db);
    const gate = pauseAfterTargetEmpty(db);
    const writer = await createConnection(databaseUrl);
    const observer = await createConnection(process.env.MYSQL_TEST_ADMIN_DATABASE_URL ?? "");
    const [connectionRows] = await writer.query<(RowDataPacket & { id: number })[]>(
      "SELECT CONNECTION_ID() AS id",
    );
    const writerConnectionId = Number(connectionRows[0]?.id);
    let writerSettled = false;
    let writerPromise: Promise<WriterOutcome> | null = null;
    const { importSqliteGatewayDatabase, verifySqliteGatewayImport } =
      await import("./sqlite-import.ts");
    const importPromise = importSqliteGatewayDatabase({
      sourcePath,
      target: gate.target,
      dryRun: false,
    });

    try {
      await gate.targetEmptyReached;
      writerPromise = writer
        .execute(
          `
            INSERT INTO model_providers (
              id, name, base_url, wire_api, encrypted_api_key, enabled,
              request_timeout_ms, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            "concurrent.writer",
            "Concurrent writer",
            "https://concurrent-writer.fixture.invalid/v1",
            "responses",
            encryptJson({ apiKey: "concurrent-writer-secret" }),
            1,
            30_000,
            timestamp(7),
            timestamp(7),
          ],
        )
        .then(
          (): WriterOutcome => ({ status: "committed" }),
          (error: unknown): WriterOutcome => ({ status: "rejected", error }),
        )
        .finally(() => {
          writerSettled = true;
        });
      const writerState = await waitForWriterState(
        observer,
        writerConnectionId,
        () => writerSettled,
      );
      gate.releaseImport();
      const report = await importPromise;
      const writerOutcome = await writerPromise;
      const finalReport = await verifySqliteGatewayImport({ sourcePath, target: db });

      expect(writerState).toBe("blocked");
      expect(writerOutcome.status).toBe("rejected");
      if (writerOutcome.status !== "rejected") throw new Error("Concurrent writer did not reject");
      expect(writerOutcome.error).toMatchObject({ code: "ER_LOCK_DEADLOCK", errno: 1213 });
      expect(report.passed).toBe(true);
      expect(finalReport.passed).toBe(true);
      expect(report.tables.find((table) => table.table === "model_providers")).toMatchObject({
        sourceCount: 2,
        targetCount: 2,
        passed: true,
      });
      expect(await db.many<{ id: string }>("SELECT id FROM model_providers ORDER BY id")).toEqual([
        { id: "fixture.chat" },
        { id: "fixture.responses" },
      ]);
    } finally {
      gate.releaseImport();
      await Promise.allSettled([importPromise, ...(writerPromise === null ? [] : [writerPromise])]);
      await observer.end();
      await writer.end();
    }
  });

  it("rolls back every table when a duplicate source primary key reaches MySQL", async () => {
    const sourcePath = duplicateAuditKeyFixture(`duplicate-key-${fixtureNumber++}.db`);
    const db = await migratedDatabase();
    const { importSqliteGatewayDatabase } = await import("./sqlite-import.ts");

    await expect(
      importSqliteGatewayDatabase({ sourcePath, target: db, dryRun: false }),
    ).rejects.toThrow("SQLite import failed");
    await expectBusinessCounts(db, 0);
  });

  it("rejects missing source foreign rows without leaving partial MySQL data", async () => {
    const sourcePath = mutateFixture(`orphan-${fixtureNumber++}.db`, (sqlite) => {
      sqlite.exec("PRAGMA foreign_keys = OFF");
      sqlite.prepare("UPDATE sessions SET user_id = ? WHERE id = ?").run(999_999, 509);
    });
    const db = await migratedDatabase();
    const { importSqliteGatewayDatabase } = await import("./sqlite-import.ts");

    await expect(
      importSqliteGatewayDatabase({ sourcePath, target: db, dryRun: false }),
    ).rejects.toThrow("SQLite import failed");
    await expectBusinessCounts(db, 0);
  });

  it("rolls back imported rows when the configured encryption secret is wrong", async () => {
    const sourcePath = createFixture();
    const db = await migratedDatabase();
    const { importSqliteGatewayDatabase } = await import("./sqlite-import.ts");
    process.env.CODEX_GATEWAY_CONFIG_SECRET = "wrong-task-8-secret";

    try {
      await expect(
        importSqliteGatewayDatabase({ sourcePath, target: db, dryRun: false }),
      ).rejects.toThrow("verification failed");
    } finally {
      process.env.CODEX_GATEWAY_CONFIG_SECRET = FIXTURE_SECRET;
    }
    await expectBusinessCounts(db, 0);
  });

  it("rolls back earlier inserts when MySQL fails in the middle of the ordered import", async () => {
    const sourcePath = createFixture();
    const db = await migratedDatabase();
    await installImportFailureTrigger(db);
    const { importSqliteGatewayDatabase } = await import("./sqlite-import.ts");

    await expect(
      importSqliteGatewayDatabase({ sourcePath, target: db, dryRun: false }),
    ).rejects.toThrow("SQLite import failed");
    await expectBusinessCounts(db, 0);
  });

  it("preserves explicit identifiers, opaque values, timestamps, and relationships exactly", async () => {
    const sourcePath = createFixture();
    const db = await migratedDatabase();
    const { importSqliteGatewayDatabase, verifySqliteGatewayImport } =
      await import("./sqlite-import.ts");

    const importReport = await importSqliteGatewayDatabase({
      sourcePath,
      target: db,
      dryRun: false,
    });
    const verifyReport = await verifySqliteGatewayImport({ sourcePath, target: db });

    expect(importReport.passed).toBe(true);
    expect(verifyReport.passed).toBe(true);
    expect(verifyReport.foreignKeys).toMatchObject({ sourceOrphans: 0, targetOrphans: 0 });
    expect(verifyReport.uniqueRelationships).toMatchObject({
      sourceDuplicates: 0,
      targetDuplicates: 0,
    });
    expect(verifyReport.encryptedValues).toMatchObject({ checked: 2, passed: true });
    await expectExactOpaqueValues(sourcePath, db);
    await expectAutoIncrementsAboveImportedMaxima(db);

    await expect(
      importSqliteGatewayDatabase({ sourcePath, target: db, dryRun: false }),
    ).rejects.toThrow("empty");
    expect((await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM users"))?.count).toBe(2);
  });

  it("reports deterministic content and relationship failures without exposing row values", async () => {
    const sourcePath = createFixture();
    const db = await migratedDatabase();
    const {
      formatSqliteImportVerification,
      importSqliteGatewayDatabase,
      verifySqliteGatewayImport,
    } = await import("./sqlite-import.ts");
    await importSqliteGatewayDatabase({ sourcePath, target: db, dryRun: false });
    await db.execute("UPDATE users SET updated_at = ? WHERE id = ?", [timestamp(9), 101]);

    const changedReport = await verifySqliteGatewayImport({ sourcePath, target: db });
    const changedUsers = changedReport.tables.find((table) => table.table === "users");
    expect(changedReport.passed).toBe(false);
    expect(changedUsers?.passed).toBe(false);
    expect(changedUsers?.keyChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(changedUsers?.sourceContentChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(changedUsers?.targetContentChecksum).toMatch(/^[a-f0-9]{64}$/);
    const output = formatSqliteImportVerification(changedReport).join("\n");
    expect(output).not.toContain("fixture-local-admin");
    expect(output).not.toContain("fixture-chat-secret");
    expect(output).not.toContain(FIXTURE_SECRET);
    expect(output).not.toContain(
      createHash("sha256").update("fixture-dataops-session").digest("hex"),
    );

    const orphanPath = mutateFixture(`verify-orphan-${fixtureNumber++}.db`, (sqlite) => {
      sqlite.exec("PRAGMA foreign_keys = OFF");
      sqlite.prepare("UPDATE sessions SET user_id = ? WHERE id = ?").run(999_999, 509);
    });
    const orphanReport = await verifySqliteGatewayImport({ sourcePath: orphanPath, target: db });
    expect(orphanReport.passed).toBe(false);
    expect(orphanReport.foreignKeys.sourceOrphans).toBe(1);

    const duplicateReport = await verifySqliteGatewayImport({
      sourcePath: duplicateAuditKeyFixture(`verify-duplicate-${fixtureNumber++}.db`),
      target: db,
    });
    expect(duplicateReport.passed).toBe(false);
    expect(duplicateReport.uniqueRelationships.sourceDuplicates).toBe(1);
  });
});

async function migratedDatabase(): Promise<GatewayDb> {
  const db = await freshMysqlTestDatabase();
  await migrateMysqlGatewayDatabase(db);
  return db;
}

async function testDatabaseUrl(db: GatewayDb): Promise<string> {
  const database = await db.one<{ databaseName: string }>("SELECT DATABASE() AS databaseName");
  if (database === null) throw new Error("MySQL test database is unavailable");
  const url = new URL(process.env.MYSQL_TEST_DATABASE_URL ?? "");
  url.pathname = `/${database.databaseName}`;
  return url.toString();
}

function runDatabaseCli(
  script: "import-sqlite.mjs" | "verify-import.mjs",
  databaseUrl: string,
  sourcePath: string,
  ...extraArguments: string[]
) {
  return spawnSync(
    process.execPath,
    [`scripts/database/${script}`, "--", "--source", sourcePath, ...extraArguments],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_GATEWAY_CONFIG_SECRET: FIXTURE_SECRET,
        DATABASE_URL: databaseUrl,
      },
      timeout: 20_000,
    },
  );
}

function pauseAfterTargetEmpty(target: GatewayDb) {
  const targetEmptyReached = deferred();
  const importRelease = deferred();
  const checkedTables = new Set<string>();
  let released = false;

  const observeEmptyRead = async (sql: string): Promise<void> => {
    if (checkedTables.size === BUSINESS_TABLES.length) return;
    const normalizedSql = sql.replaceAll(/\s+/g, " ");
    const table = BUSINESS_TABLES.find((candidate) => {
      return (
        normalizedSql.includes(`FROM ${candidate}`) &&
        (normalizedSql.includes("COUNT(*) AS count") || normalizedSql.includes("FOR UPDATE"))
      );
    });
    if (table === undefined || checkedTables.has(table)) return;
    checkedTables.add(table);
    if (checkedTables.size === BUSINESS_TABLES.length) {
      targetEmptyReached.resolve();
      await importRelease.promise;
    }
  };

  const coordinatedTarget: GatewayDb = {
    ...target,
    transaction(work, options) {
      return target.transaction(async (tx) => {
        const coordinatedTransaction: GatewayDb = {
          ...tx,
          async one<T extends Record<string, unknown>>(sql: string, params = []) {
            const row = await tx.one<T>(sql, params);
            await observeEmptyRead(sql);
            return row;
          },
          async many<T extends Record<string, unknown>>(sql: string, params = []) {
            const rows = await tx.many<T>(sql, params);
            await observeEmptyRead(sql);
            return rows;
          },
        };
        return await work(coordinatedTransaction);
      }, options);
    },
  };

  return {
    target: coordinatedTarget,
    targetEmptyReached: targetEmptyReached.promise,
    releaseImport() {
      if (released) return;
      released = true;
      importRelease.resolve();
    },
  };
}

type WriterOutcome = { status: "committed" } | { status: "rejected"; error: unknown };

async function waitForWriterState(
  observer: Connection,
  connectionId: number,
  writerSettled: () => boolean,
): Promise<"blocked" | "committed"> {
  const deadline = Date.now() + 5_000;
  let lastTransactionState: string | null = null;
  let lastLockState: string | null = null;
  let lastProcessState: string | null = null;
  while (Date.now() < deadline) {
    if (writerSettled()) return "committed";
    const [transactions] = await observer.query<(RowDataPacket & { state: string })[]>(
      "SELECT trx_state AS state FROM information_schema.innodb_trx WHERE trx_mysql_thread_id = ?",
      [connectionId],
    );
    lastTransactionState = transactions[0]?.state ?? null;
    if (lastTransactionState === "LOCK WAIT") return "blocked";
    const [locks] = await observer.query<(RowDataPacket & { state: string })[]>(
      `
        SELECT data_locks.LOCK_STATUS AS state
        FROM performance_schema.data_locks
        INNER JOIN performance_schema.threads
          ON threads.THREAD_ID = data_locks.THREAD_ID
        WHERE threads.PROCESSLIST_ID = ? AND data_locks.LOCK_STATUS = 'WAITING'
      `,
      [connectionId],
    );
    lastLockState = locks[0]?.state ?? null;
    if (lastLockState === "WAITING") return "blocked";
    const [processes] = await observer.query<(RowDataPacket & { state: string | null })[]>(
      "SELECT STATE AS state FROM information_schema.processlist WHERE ID = ?",
      [connectionId],
    );
    lastProcessState = processes[0]?.state ?? null;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Timed out waiting for concurrent writer state (transaction=${lastTransactionState ?? "missing"}, lock=${lastLockState ?? "missing"}, process=${lastProcessState ?? "missing"})`,
  );
}

function deferred() {
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function createFixture(): string {
  const path = join(fixtureDirectory, `gateway-v8-${fixtureNumber++}.db`);
  buildGatewayV8Sqlite(path, FIXTURE_SECRET);
  return path;
}

function mutateFixture(name: string, mutation: (sqlite: DatabaseSync) => void): string {
  const basePath = createFixture();
  const path = join(fixtureDirectory, name);
  copyFileSync(basePath, path);
  const sqlite = new DatabaseSync(path);
  try {
    mutation(sqlite);
  } finally {
    sqlite.close();
  }
  return path;
}

function duplicateAuditKeyFixture(name: string): string {
  return mutateFixture(name, (sqlite) => {
    sqlite.exec("PRAGMA foreign_keys = OFF");
    sqlite.exec(`
      ALTER TABLE agent_audit_events RENAME TO original_agent_audit_events;
      CREATE TABLE agent_audit_events (
        id INTEGER NOT NULL,
        actor_user_id INTEGER,
        user_id INTEGER,
        action TEXT NOT NULL,
        outcome TEXT NOT NULL,
        error_code TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO agent_audit_events SELECT * FROM original_agent_audit_events;
      INSERT INTO agent_audit_events SELECT * FROM original_agent_audit_events WHERE id = 1501;
      DROP TABLE original_agent_audit_events;
    `);
  });
}

async function expectBusinessCounts(db: GatewayDb, expectedTotal: number): Promise<void> {
  let total = 0;
  for (const table of BUSINESS_TABLES) {
    const row = await db.one<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
    total += Number(row?.count ?? 0);
  }
  expect(total).toBe(expectedTotal);
}

async function expectExactOpaqueValues(sourcePath: string, db: GatewayDb): Promise<void> {
  const sqlite = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const sourceSession = sqlite
      .prepare("SELECT token_hash, expires_at, created_at, last_seen_at FROM sessions WHERE id = ?")
      .get(509);
    const targetSession = await db.one(
      "SELECT token_hash, expires_at, created_at, last_seen_at FROM sessions WHERE id = ?",
      [509],
    );
    expect(targetSession).toEqual(sourceSession);

    const sourceConfig = sqlite
      .prepare("SELECT encrypted_config_json, updated_at FROM user_configs WHERE user_id = ?")
      .get(101);
    const targetConfig = await db.one(
      "SELECT encrypted_config_json, updated_at FROM user_configs WHERE user_id = ?",
      [101],
    );
    expect(targetConfig).toEqual(sourceConfig);

    const sourceProviders = sqlite
      .prepare(
        "SELECT id, encrypted_api_key, created_at, updated_at FROM model_providers ORDER BY id",
      )
      .all();
    const targetProviders = await db.many(
      "SELECT id, encrypted_api_key, created_at, updated_at FROM model_providers ORDER BY id",
    );
    expect(targetProviders).toEqual(sourceProviders);
  } finally {
    sqlite.close();
  }

  expect(
    await db.one(
      "SELECT id, user_id, host_id, runtime_type, container_id FROM user_agent_runtimes",
    ),
  ).toEqual({
    id: 1201,
    user_id: 101,
    host_id: 2_000_000_000,
    runtime_type: "codex-app-server",
    container_id: "fixture-container-1201",
  });
  expect(
    await db.one("SELECT provider, external_subject, user_id FROM external_identities"),
  ).toEqual({
    provider: "dataops",
    external_subject: "fixture-subject-205",
    user_id: 205,
  });
}

async function expectAutoIncrementsAboveImportedMaxima(db: GatewayDb): Promise<void> {
  const maxima = new Map([
    ["users", 205],
    ["sessions", 509],
    ["tmux_monitors", 909],
    ["user_agent_runtimes", 1201],
    ["agent_audit_events", 1603],
  ]);
  const rows = await db.many<{ table_name: string; auto_increment: number | bigint }>(`
    SELECT table_name AS table_name, auto_increment AS auto_increment
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name IN ('users', 'sessions', 'tmux_monitors', 'user_agent_runtimes', 'agent_audit_events')
  `);
  expect(rows).toHaveLength(maxima.size);
  for (const row of rows) {
    expect(Number(row.auto_increment)).toBeGreaterThan(
      maxima.get(row.table_name) ?? Number.MAX_VALUE,
    );
  }
}

async function installImportFailureTrigger(db: GatewayDb): Promise<void> {
  const database = await db.one<{ databaseName: string }>("SELECT DATABASE() AS databaseName");
  if (database === null) throw new Error("MySQL test database is unavailable");
  const adminUrl = new URL(process.env.MYSQL_TEST_ADMIN_DATABASE_URL ?? "");
  adminUrl.pathname = `/${database.databaseName}`;
  const connection = await createConnection(adminUrl.toString());
  try {
    await connection.query(`
      CREATE TRIGGER reject_fixture_provider
      BEFORE INSERT ON model_providers
      FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced fixture failure'
    `);
  } finally {
    await connection.end();
  }
}

function fileChecksum(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function timestamp(second: number): string {
  return `2025-10-01T00:00:0${second}.000Z`;
}
