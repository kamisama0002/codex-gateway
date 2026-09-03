#!/usr/bin/env node
import { argon2Sync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateGatewayDatabase } from "../server/utils/gateway/storage/migrations.ts";

const [, , usernameArg = "", passwordArg = "", roleFlag, roleArg] = process.argv;
const username = usernameArg.trim().toLowerCase();
const password = passwordArg;
const explicitRole = parseRole(roleFlag, roleArg);

if (!username || !password) {
  console.error("Usage: node scripts/create-user.mjs <username> <password> [--role admin|user]");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters");
  process.exit(1);
}

const configuredDbPath = process.env.CODEX_GATEWAY_DB_PATH;
const dbPath = resolve(
  configuredDbPath === undefined || configuredDbPath.length === 0
    ? "/data/codex-gateway.db"
    : configuredDbPath,
);
const directory = dirname(dbPath);
if (!existsSync(directory)) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);
migrateGatewayDatabase(db);

const now = new Date().toISOString();
const role = explicitRole ?? (userCount(db) === 0 ? "admin" : "user");
db.prepare(
  `
    INSERT INTO users (username, password_hash, is_active, role, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      is_active = 1,
      role = CASE WHEN ? THEN excluded.role ELSE role END,
      updated_at = excluded.updated_at
  `,
).run(username, hashPassword(password), role, now, now, explicitRole !== null ? 1 : 0);

console.log(`User ${username} is ready in ${dbPath} with role ${role}`);

/** @param {string | undefined} flag @param {string | undefined} value @returns {"admin" | "user" | null} */
function parseRole(flag, value) {
  if (flag === undefined && value === undefined) return null;
  if (flag === "--role" && (value === "admin" || value === "user")) return value;
  console.error("Role must be admin or user");
  process.exit(1);
}

/** @param {DatabaseSync} database */
function userCount(database) {
  /** @type {unknown} */
  const row = database.prepare("SELECT COUNT(*) AS count FROM users").get();
  if (!isCountRow(row)) throw new Error("Could not count database users");
  return row.count;
}

/** @param {unknown} value @returns {value is { count: number }} */
function isCountRow(value) {
  return typeof value === "object" && value !== null && "count" in value && typeof value.count === "number";
}

/** @param {string} value */
function hashPassword(value) {
  const salt = randomBytes(16);
  const hash = argon2Sync("argon2id", {
    message: Buffer.from(value),
    nonce: salt,
    tagLength: 32,
    memory: 64 * 1024,
    passes: 3,
    parallelism: 1,
  });
  return `argon2id$${salt.toString("base64url")}$${Buffer.from(hash).toString("base64url")}`;
}
