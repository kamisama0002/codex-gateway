import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { DbRow, GatewayDb, SqlValue } from "../../server/utils/gateway/storage/contracts.ts";
import { decryptJson } from "../../server/utils/gateway/storage/crypto.ts";
import { MYSQL_SCHEMA_MIGRATIONS } from "../../server/utils/gateway/storage/mysql-schema.ts";

interface TableSpec {
  name: string;
  columns: readonly string[];
  primaryKey: readonly string[];
  integerColumns: ReadonlySet<string>;
  sourceProjection?: string;
}

interface TableSnapshot {
  spec: TableSpec;
  rows: readonly SnapshotRow[];
}

type SnapshotRow = Record<string, SqlValue>;

interface SqliteSnapshot {
  tables: readonly TableSnapshot[];
  sourceForeignKeyOrphans: number;
  sourceUniqueDuplicates: number;
}

export interface TableVerification {
  table: string;
  sourceCount: number;
  targetCount: number;
  keyChecksum: string;
  targetKeyChecksum: string;
  sourceContentChecksum: string;
  targetContentChecksum: string;
  passed: boolean;
}

interface RelationshipVerification {
  sourceOrphans: number;
  targetOrphans: number;
  checksum: string;
  passed: boolean;
}

interface UniqueVerification {
  sourceDuplicates: number;
  targetDuplicates: number;
  checksum: string;
  passed: boolean;
}

interface CheckVerification {
  checked: number;
  checksum: string;
  passed: boolean;
}

interface AutoIncrementVerification extends CheckVerification {
  behind: number;
}

export interface SqliteImportVerificationReport {
  passed: boolean;
  tables: readonly TableVerification[];
  foreignKeys: RelationshipVerification;
  uniqueRelationships: UniqueVerification;
  encryptedValues: CheckVerification;
  autoIncrements: AutoIncrementVerification;
}

export interface SqliteImportOptions {
  sourcePath: string;
  target: GatewayDb;
  dryRun: boolean;
}

export interface SqliteVerifyOptions {
  sourcePath: string;
  target: GatewayDb;
}

const TABLE_SPECS: readonly TableSpec[] = [
  tableSpec(
    "users",
    ["id", "username", "password_hash", "is_active", "created_at", "updated_at", "role"],
    ["id"],
    ["id", "is_active"],
  ),
  tableSpec(
    "sessions",
    ["id", "user_id", "token_hash", "expires_at", "created_at", "last_seen_at"],
    ["id"],
    ["id", "user_id"],
  ),
  tableSpec(
    "user_configs",
    ["user_id", "encrypted_config_json", "revision", "updated_at"],
    ["user_id"],
    ["user_id", "revision"],
    "user_id, encrypted_config_json, 1 AS revision, updated_at",
  ),
  tableSpec(
    "tmux_monitors",
    [
      "id",
      "user_id",
      "host_id",
      "project_id",
      "thread_id",
      "thread_title",
      "session_name",
      "session_id",
      "session_created",
      "window_index",
      "window_name",
      "pane_index",
      "pane_id",
      "pane_pid",
      "initial_command",
      "last_command",
      "mode",
      "status",
      "completion_reason",
      "created_at",
      "run_started_at",
      "last_checked_at",
      "completed_at",
      "last_error",
      "last_error_at",
      "notification_sent_at",
    ],
    ["id"],
    [
      "id",
      "user_id",
      "host_id",
      "project_id",
      "session_created",
      "window_index",
      "pane_index",
      "pane_pid",
    ],
  ),
  tableSpec(
    "user_agent_runtimes",
    [
      "id",
      "user_id",
      "host_id",
      "runtime_type",
      "container_id",
      "image_version",
      "runtime_version",
      "schema_hash",
      "status",
      "last_error",
      "created_at",
      "updated_at",
    ],
    ["id"],
    ["id", "user_id", "host_id"],
  ),
  tableSpec(
    "agent_audit_events",
    [
      "id",
      "actor_user_id",
      "user_id",
      "action",
      "outcome",
      "error_code",
      "metadata_json",
      "created_at",
    ],
    ["id"],
    ["id", "actor_user_id", "user_id"],
  ),
  tableSpec(
    "model_providers",
    [
      "id",
      "name",
      "base_url",
      "wire_api",
      "encrypted_api_key",
      "enabled",
      "request_timeout_ms",
      "created_at",
      "updated_at",
    ],
    ["id"],
    ["enabled", "request_timeout_ms"],
  ),
  tableSpec(
    "provider_models",
    [
      "provider_id",
      "model_id",
      "display_name",
      "enabled",
      "capabilities_json",
      "created_at",
      "updated_at",
    ],
    ["provider_id", "model_id"],
    ["enabled"],
  ),
  tableSpec(
    "user_model_grants",
    ["user_id", "provider_id", "model_id", "created_at"],
    ["user_id", "provider_id", "model_id"],
    ["user_id"],
  ),
  tableSpec(
    "external_identities",
    ["provider", "external_subject", "user_id", "display_name", "created_at", "updated_at"],
    ["provider", "external_subject"],
    ["user_id"],
  ),
  tableSpec(
    "external_session_contexts",
    [
      "token_hash",
      "provider",
      "external_subject",
      "tenant_id",
      "external_user_id",
      "project_id",
      "authz_version",
      "created_at",
    ],
    ["token_hash"],
    ["tenant_id", "external_user_id", "project_id", "authz_version"],
  ),
];

const FOREIGN_KEY_CHECKS = [
  orphanQuery("sessions", "users", [["user_id", "id"]]),
  orphanQuery("user_configs", "users", [["user_id", "id"]]),
  orphanQuery("tmux_monitors", "users", [["user_id", "id"]]),
  orphanQuery("user_agent_runtimes", "users", [["user_id", "id"]]),
  orphanQuery("agent_audit_events", "users", [["actor_user_id", "id"]], "actor_user_id"),
  orphanQuery("agent_audit_events", "users", [["user_id", "id"]], "user_id"),
  orphanQuery("provider_models", "model_providers", [["provider_id", "id"]]),
  orphanQuery("user_model_grants", "users", [["user_id", "id"]]),
  orphanQuery("user_model_grants", "provider_models", [
    ["provider_id", "provider_id"],
    ["model_id", "model_id"],
  ]),
  orphanQuery("external_identities", "users", [["user_id", "id"]]),
  orphanQuery("external_session_contexts", "sessions", [["token_hash", "token_hash"]]),
] as const;

const UNIQUE_CHECKS = [
  duplicateQuery("users", ["id"]),
  duplicateQuery("users", ["username"]),
  duplicateQuery("sessions", ["id"]),
  duplicateQuery("sessions", ["token_hash"]),
  duplicateQuery("user_configs", ["user_id"]),
  duplicateQuery("tmux_monitors", ["id"]),
  duplicateQuery(
    "tmux_monitors",
    ["user_id", "host_id", "session_name", "window_index", "pane_index"],
    "status = 'active'",
  ),
  duplicateQuery("user_agent_runtimes", ["id"]),
  duplicateQuery("user_agent_runtimes", ["user_id"]),
  duplicateQuery("agent_audit_events", ["id"]),
  duplicateQuery("model_providers", ["id"]),
  duplicateQuery("provider_models", ["provider_id", "model_id"]),
  duplicateQuery("user_model_grants", ["user_id", "provider_id", "model_id"]),
  duplicateQuery("external_identities", ["provider", "external_subject"]),
  duplicateQuery("external_identities", ["user_id"]),
  duplicateQuery("external_session_contexts", ["token_hash"]),
] as const;

const AUTO_INCREMENT_TABLES = [
  "users",
  "sessions",
  "tmux_monitors",
  "user_agent_runtimes",
  "agent_audit_events",
] as const;

class DryRunRollback extends Error {}
class TargetNotEmptyError extends Error {}
class ImportVerificationError extends Error {}
class SqliteQuickCheckError extends Error {}

export async function importSqliteGatewayDatabase(
  options: SqliteImportOptions,
): Promise<SqliteImportVerificationReport> {
  requireEncryptionSecret();
  const snapshot = readSqliteSnapshot(options.sourcePath);
  const dryRunRollback = new DryRunRollback();
  let dryRunReport: SqliteImportVerificationReport | null = null;

  try {
    return await options.target.transaction(
      async (target) => {
        await assertTargetMigrated(target);
        await assertTargetEmpty(target);
        await insertSnapshot(target, snapshot);
        const report = await verifySnapshot(target, snapshot);
        if (!report.passed) {
          throw new ImportVerificationError("SQLite import verification failed");
        }
        if (options.dryRun) {
          dryRunReport = report;
          throw dryRunRollback;
        }
        return report;
      },
      { isolationLevel: "serializable" },
    );
  } catch (error) {
    if (error === dryRunRollback && dryRunReport !== null) return dryRunReport;
    if (
      error instanceof TargetNotEmptyError ||
      error instanceof ImportVerificationError ||
      error instanceof SqliteQuickCheckError
    ) {
      throw error;
    }
    throw new Error("SQLite import failed", { cause: error });
  }
}

export async function verifySqliteGatewayImport(
  options: SqliteVerifyOptions,
): Promise<SqliteImportVerificationReport> {
  requireEncryptionSecret();
  const snapshot = readSqliteSnapshot(options.sourcePath);
  await assertTargetMigrated(options.target);
  return await verifySnapshot(options.target, snapshot);
}

export function formatSqliteImportVerification(
  report: SqliteImportVerificationReport,
): readonly string[] {
  const lines = report.tables.map((table) => {
    return [
      table.table,
      `source_count=${table.sourceCount}`,
      `target_count=${table.targetCount}`,
      `source_keys=${table.keyChecksum}`,
      `target_keys=${table.targetKeyChecksum}`,
      `source_content=${table.sourceContentChecksum}`,
      `target_content=${table.targetContentChecksum}`,
      table.passed ? "PASS" : "FAIL",
    ].join(" ");
  });
  lines.push(
    checkLine(
      "foreign_keys",
      report.foreignKeys.sourceOrphans,
      report.foreignKeys.targetOrphans,
      report.foreignKeys.checksum,
      report.foreignKeys.passed,
    ),
    checkLine(
      "unique_relationships",
      report.uniqueRelationships.sourceDuplicates,
      report.uniqueRelationships.targetDuplicates,
      report.uniqueRelationships.checksum,
      report.uniqueRelationships.passed,
    ),
    `encrypted_values count=${report.encryptedValues.checked} checksum=${report.encryptedValues.checksum} ${report.encryptedValues.passed ? "PASS" : "FAIL"}`,
    `auto_increment count=${report.autoIncrements.checked} checksum=${report.autoIncrements.checksum} ${report.autoIncrements.passed ? "PASS" : "FAIL"}`,
  );
  const overallChecksum = sha256(
    lines.map((line) => line.replace(/ (?:PASS|FAIL)$/, "")).join("\n"),
  );
  lines.push(
    `overall count=${report.tables.length + 4} checksum=${overallChecksum} ${report.passed ? "PASS" : "FAIL"}`,
  );
  return lines;
}

function tableSpec(
  name: string,
  columns: readonly string[],
  primaryKey: readonly string[],
  integerColumns: readonly string[],
  sourceProjection?: string,
): TableSpec {
  return {
    name,
    columns,
    primaryKey,
    integerColumns: new Set(integerColumns),
    ...(sourceProjection === undefined ? {} : { sourceProjection }),
  };
}

function readSqliteSnapshot(sourcePath: string): SqliteSnapshot {
  let sqlite: DatabaseSync;
  try {
    sqlite = new DatabaseSync(sourcePath, { readOnly: true });
  } catch (error) {
    throw new SqliteQuickCheckError("SQLite quick_check failed", { cause: error });
  }

  try {
    assertSqliteQuickCheck(sqlite);
    assertSqliteSchemaVersion(sqlite);
    const tables = TABLE_SPECS.map((spec) => readSqliteTable(sqlite, spec));
    return {
      tables,
      sourceForeignKeyOrphans: countSqliteChecks(sqlite, FOREIGN_KEY_CHECKS),
      sourceUniqueDuplicates: countSqliteChecks(sqlite, UNIQUE_CHECKS),
    };
  } catch (error) {
    if (error instanceof SqliteQuickCheckError) throw error;
    throw new Error("SQLite source schema v8 is required", { cause: error });
  } finally {
    sqlite.close();
  }
}

function assertSqliteQuickCheck(sqlite: DatabaseSync): void {
  let rows: readonly DbRow[];
  try {
    rows = sqlite.prepare("PRAGMA quick_check").all();
  } catch (error) {
    throw new SqliteQuickCheckError("SQLite quick_check failed", { cause: error });
  }
  if (rows.length !== 1) throw new SqliteQuickCheckError("SQLite quick_check failed");
  const row = rows[0];
  if (row === undefined) throw new SqliteQuickCheckError("SQLite quick_check failed");
  const values = Object.values(row);
  if (values.length !== 1 || values[0] !== "ok") {
    throw new SqliteQuickCheckError("SQLite quick_check failed");
  }
}

function assertSqliteSchemaVersion(sqlite: DatabaseSync): void {
  const rows = sqlite.prepare("SELECT version FROM schema_migrations ORDER BY version ASC").all();
  const versions = rows.map((row) => Number(row.version));
  if (versions.length !== 8 || versions.some((version, index) => version !== index + 1)) {
    throw new Error("SQLite source must have schema migrations 1 through 8");
  }
}

function readSqliteTable(sqlite: DatabaseSync, spec: TableSpec): TableSnapshot {
  const projection = spec.sourceProjection ?? spec.columns.join(", ");
  const rows = sqlite
    .prepare(`SELECT ${projection} FROM ${spec.name} ORDER BY ${spec.primaryKey.join(", ")}`)
    .all()
    .map((row) => normalizeSqliteRow(spec, row));
  return { spec, rows };
}

function normalizeSqliteRow(spec: TableSpec, row: DbRow): SnapshotRow {
  const normalized: SnapshotRow = {};
  for (const column of spec.columns) {
    const value = row[column];
    if (value === undefined) throw new Error(`SQLite ${spec.name} is missing a required column`);
    if (value !== null && spec.integerColumns.has(column)) {
      if (
        (typeof value !== "number" && typeof value !== "bigint") ||
        (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) ||
        (typeof value === "bigint" && value < 0n)
      ) {
        throw new Error(`SQLite ${spec.name} contains an invalid integer`);
      }
    } else if (value !== null && typeof value !== "string") {
      throw new Error(`SQLite ${spec.name} contains an invalid text value`);
    }
    normalized[column] = sqlValue(value);
  }
  return normalized;
}

async function assertTargetMigrated(target: GatewayDb): Promise<void> {
  const rows = await target.many<{ version: number; checksum: string }>(
    "SELECT version, checksum FROM schema_migrations ORDER BY version ASC",
  );
  if (rows.length !== MYSQL_SCHEMA_MIGRATIONS.length) {
    throw new Error("Target MySQL schema migrations are incomplete");
  }
  for (const [index, migration] of MYSQL_SCHEMA_MIGRATIONS.entries()) {
    const row = rows[index];
    const checksum = sha256(migration.statements.join("\n"));
    if (row?.version !== migration.version || row.checksum !== checksum) {
      throw new Error("Target MySQL schema migration checksum mismatch");
    }
  }
}

async function assertTargetEmpty(target: GatewayDb): Promise<void> {
  for (const spec of TABLE_SPECS) {
    const rows = await target.many(
      `SELECT ${spec.primaryKey.join(", ")} FROM ${spec.name} FOR UPDATE`,
    );
    if (rows.length !== 0) {
      throw new TargetNotEmptyError("Target MySQL business tables must be empty");
    }
  }
}

async function insertSnapshot(target: GatewayDb, snapshot: SqliteSnapshot): Promise<void> {
  for (const table of snapshot.tables) {
    const placeholders = table.spec.columns.map(() => "?").join(", ");
    const sql = `INSERT INTO ${table.spec.name} (${table.spec.columns.join(", ")}) VALUES (${placeholders})`;
    for (const row of table.rows) {
      const params = table.spec.columns.map((column) => sqlValue(row[column]));
      await target.execute(sql, params);
    }
  }
}

async function verifySnapshot(
  target: GatewayDb,
  snapshot: SqliteSnapshot,
): Promise<SqliteImportVerificationReport> {
  const tables: TableVerification[] = [];
  for (const sourceTable of snapshot.tables) {
    const targetRows = await target.many(
      `SELECT ${sourceTable.spec.columns.join(", ")} FROM ${sourceTable.spec.name} ORDER BY ${sourceTable.spec.primaryKey.join(", ")}`,
    );
    const sourceKeyChecksum = manifestChecksum(sourceTable.rows, sourceTable.spec.primaryKey);
    const targetKeyChecksum = manifestChecksum(targetRows, sourceTable.spec.primaryKey);
    const sourceContentChecksum = manifestChecksum(sourceTable.rows, sourceTable.spec.columns);
    const targetContentChecksum = manifestChecksum(targetRows, sourceTable.spec.columns);
    tables.push({
      table: sourceTable.spec.name,
      sourceCount: sourceTable.rows.length,
      targetCount: targetRows.length,
      keyChecksum: sourceKeyChecksum,
      targetKeyChecksum,
      sourceContentChecksum,
      targetContentChecksum,
      passed:
        sourceTable.rows.length === targetRows.length &&
        sourceKeyChecksum === targetKeyChecksum &&
        sourceContentChecksum === targetContentChecksum,
    });
  }

  const targetOrphans = await countMysqlChecks(target, FOREIGN_KEY_CHECKS);
  const foreignKeys = {
    sourceOrphans: snapshot.sourceForeignKeyOrphans,
    targetOrphans,
    checksum: checkChecksum(snapshot.sourceForeignKeyOrphans, targetOrphans),
    passed: snapshot.sourceForeignKeyOrphans === 0 && targetOrphans === 0,
  };
  const targetDuplicates = await countMysqlChecks(target, UNIQUE_CHECKS);
  const uniqueRelationships = {
    sourceDuplicates: snapshot.sourceUniqueDuplicates,
    targetDuplicates,
    checksum: checkChecksum(snapshot.sourceUniqueDuplicates, targetDuplicates),
    passed: snapshot.sourceUniqueDuplicates === 0 && targetDuplicates === 0,
  };
  const encryptedValues = await verifyEncryptedSamples(target, snapshot);
  const autoIncrements = await verifyAutoIncrements(target, snapshot);
  const passed =
    tables.every((table) => table.passed) &&
    foreignKeys.passed &&
    uniqueRelationships.passed &&
    encryptedValues.passed &&
    autoIncrements.passed;
  return {
    passed,
    tables,
    foreignKeys,
    uniqueRelationships,
    encryptedValues,
    autoIncrements,
  };
}

async function verifyEncryptedSamples(
  target: GatewayDb,
  snapshot: SqliteSnapshot,
): Promise<CheckVerification> {
  const samples = [
    encryptedSample(snapshot, "user_configs", "user_id", "encrypted_config_json"),
    encryptedSample(snapshot, "model_providers", "id", "encrypted_api_key"),
  ].filter((sample) => sample !== null);
  let passed = true;
  for (const sample of samples) {
    if (sample === null) continue;
    const targetRow = await target.one(
      `SELECT ${sample.encryptedColumn} AS encrypted_value FROM ${sample.table} WHERE ${sample.keyColumn} = ?`,
      [sample.keyValue],
    );
    const targetEncrypted = targetRow?.encrypted_value;
    try {
      const sourceValue = decryptJson(sample.encryptedValue);
      const targetValue = typeof targetEncrypted === "string" ? decryptJson(targetEncrypted) : null;
      if (
        targetEncrypted !== sample.encryptedValue ||
        !validDecryptedSample(sample.table, sourceValue) ||
        !validDecryptedSample(sample.table, targetValue)
      ) {
        passed = false;
      }
    } catch {
      passed = false;
    }
  }
  return {
    checked: samples.length,
    checksum: sha256(`checked:${samples.length}:passed:${passed}`),
    passed,
  };
}

function encryptedSample(
  snapshot: SqliteSnapshot,
  tableName: string,
  keyColumn: string,
  encryptedColumn: string,
) {
  const table = snapshot.tables.find((candidate) => candidate.spec.name === tableName);
  const row = table?.rows[0];
  const keyValue = row?.[keyColumn];
  const encryptedValue = row?.[encryptedColumn];
  if (
    row === undefined ||
    encryptedValue === undefined ||
    typeof encryptedValue !== "string" ||
    keyValue === undefined ||
    keyValue === null
  ) {
    return null;
  }
  return { table: tableName, keyColumn, keyValue, encryptedColumn, encryptedValue };
}

function validDecryptedSample(table: string, value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (table !== "model_providers") return true;
  return typeof value.apiKey === "string" && value.apiKey.length > 0;
}

async function verifyAutoIncrements(
  target: GatewayDb,
  snapshot: SqliteSnapshot,
): Promise<AutoIncrementVerification> {
  let behind = 0;
  const positions: string[] = [];
  for (const tableName of AUTO_INCREMENT_TABLES) {
    const sourceTable = snapshot.tables.find((table) => table.spec.name === tableName);
    const maximum = Math.max(0, ...(sourceTable?.rows.map((row) => integer(row.id)) ?? []));
    const row = await target.one<{ autoIncrement: number | bigint | null }>(
      "SELECT AUTO_INCREMENT AS autoIncrement FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
      [tableName],
    );
    const next = integer(row?.autoIncrement);
    positions.push(`${tableName}:${maximum}:${next}`);
    if (next <= maximum) behind += 1;
  }
  return {
    checked: AUTO_INCREMENT_TABLES.length,
    behind,
    checksum: sha256(positions.join("\n")),
    passed: behind === 0,
  };
}

function countSqliteChecks(sqlite: DatabaseSync, checks: readonly string[]): number {
  return checks.reduce((total, sql) => {
    const row = sqlite.prepare(sql).get();
    return total + integer(row?.count);
  }, 0);
}

async function countMysqlChecks(target: GatewayDb, checks: readonly string[]): Promise<number> {
  let total = 0;
  for (const sql of checks) {
    const row = await target.one<{ count: number | bigint }>(sql);
    total += integer(row?.count);
  }
  return total;
}

function orphanQuery(
  childTable: string,
  parentTable: string,
  columns: readonly (readonly [string, string])[],
  nullableColumn?: string,
): string {
  const join = columns.map(([child, parent]) => `child.${child} = parent.${parent}`).join(" AND ");
  const required = nullableColumn === undefined ? "" : `child.${nullableColumn} IS NOT NULL AND `;
  return `SELECT COUNT(*) AS count FROM ${childTable} child LEFT JOIN ${parentTable} parent ON ${join} WHERE ${required}parent.${columns[0]?.[1]} IS NULL`;
}

function duplicateQuery(table: string, columns: readonly string[], where?: string): string {
  const whereClause = where === undefined ? "" : ` WHERE ${where}`;
  const fields = columns.join(", ");
  return `SELECT COUNT(*) AS count FROM (SELECT ${fields} FROM ${table}${whereClause} GROUP BY ${fields} HAVING COUNT(*) > 1) duplicate_rows`;
}

function manifestChecksum(rows: readonly DbRow[], columns: readonly string[]): string {
  const hash = createHash("sha256");
  for (const row of rows) {
    for (const column of columns) {
      hash.update(column);
      hash.update("=");
      hash.update(canonicalValue(row[column]));
      hash.update("\n");
    }
    hash.update("--\n");
  }
  return hash.digest("hex");
}

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `string:${Buffer.byteLength(value, "utf8")}:${value}`;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Manifest contains an unsafe number");
    return `integer:${value}`;
  }
  if (typeof value === "bigint") return `integer:${value}`;
  if (typeof value === "boolean") return `integer:${value ? 1 : 0}`;
  if (Buffer.isBuffer(value)) return `bytes:${value.toString("base64")}`;
  throw new Error("Manifest contains an unsupported value");
}

function checkChecksum(sourceCount: number, targetCount: number): string {
  return sha256(`source:${sourceCount}:target:${targetCount}`);
}

function checkLine(
  name: string,
  sourceCount: number,
  targetCount: number,
  checksum: string,
  passed: boolean,
): string {
  return `${name} source_count=${sourceCount} target_count=${targetCount} checksum=${checksum} ${passed ? "PASS" : "FAIL"}`;
}

function requireEncryptionSecret(): void {
  if ((process.env.CODEX_GATEWAY_CONFIG_SECRET ?? "").length === 0) {
    throw new Error("CODEX_GATEWAY_CONFIG_SECRET is required for SQLite import verification");
  }
}

function integer(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "bigint" && typeof value !== "string") {
    return 0;
  }
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0) {
    throw new Error("Database count is outside the safe integer range");
  }
  return converted;
}

function sqlValue(value: unknown): SqlValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    value instanceof Date ||
    Buffer.isBuffer(value)
  ) {
    return value;
  }
  throw new Error("SQLite row contains an unsupported value");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
