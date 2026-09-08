#!/usr/bin/env node
import { resolve } from "node:path";
import { createMysqlGatewayDb } from "../../server/utils/gateway/storage/mysql.ts";
import { formatSqliteImportVerification, importSqliteGatewayDatabase } from "./sqlite-import.ts";

const USAGE = "Usage: pnpm db:import-sqlite -- --source <path> [--dry-run]";

/** @typedef {{ help: true } | { help: false, sourcePath: string, dryRun: boolean }} ImportCliOptions */

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const target = createMysqlGatewayDb(requiredDatabaseUrl());
  try {
    const report = await importSqliteGatewayDatabase({
      sourcePath: options.sourcePath,
      target,
      dryRun: options.dryRun,
    });
    for (const line of formatSqliteImportVerification(report)) console.log(line);
  } finally {
    await target.close();
  }
}

/**
 * @param {string[]} rawArgs
 * @returns {ImportCliOptions}
 */
function parseArguments(rawArgs) {
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((argument) => argument !== "--dry-run");
  if (positional.length !== 2 || positional[0] !== "--source" || positional[1] === undefined) {
    throw new CliUsageError(USAGE);
  }
  return { help: false, sourcePath: resolve(positional[1]), dryRun };
}

/** @returns {string} */
function requiredDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new CliUsageError("DATABASE_URL is required");
  }
  return databaseUrl;
}

class CliUsageError extends Error {}

void main().catch((error) => {
  console.error(error instanceof CliUsageError ? error.message : "SQLite import failed");
  process.exitCode = 1;
});
