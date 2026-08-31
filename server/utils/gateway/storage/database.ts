import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { trimmedOrFallback } from "~~/shared/utils/strings";
import { migrateGatewayDatabase } from "./migrations";

let database: DatabaseSync | null = null;
let ready = false;
const readyCallbacks = new Set<() => void>();

function gatewayDatabasePath() {
  return resolve(trimmedOrFallback(process.env.CODEX_GATEWAY_DB_PATH, "/data/codex-gateway.db"));
}
export function gatewayDatabaseExists() {
  return existsSync(gatewayDatabasePath());
}

export function gatewayDatabaseReady() {
  return ready;
}

export function onGatewayDatabaseReady(callback: () => void) {
  readyCallbacks.add(callback);
  if (ready) {
    callback();
  }
  return () => {
    readyCallbacks.delete(callback);
  };
}

export function gatewayDatabase() {
  if (database === null) {
    const path = gatewayDatabasePath();
    const directory = dirname(path);
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    database = new DatabaseSync(path);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    migrateGatewayDatabase(database);
    markGatewayDatabaseReady();
  }
  return database;
}

export function withGatewayDatabaseTransaction<T>(callback: (db: DatabaseSync) => T): T {
  const db = gatewayDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function markGatewayDatabaseReady() {
  if (ready) {
    return;
  }
  ready = true;
  for (const callback of Array.from(readyCallbacks)) {
    callback();
  }
}
