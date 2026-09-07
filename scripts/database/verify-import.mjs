#!/usr/bin/env node
import { resolve } from "node:path";
import { createMysqlGatewayDb } from "../../server/utils/gateway/storage/mysql.ts";
import { formatSqliteImportVerification, verifySqliteGatewayImport } from "./sqlite-import.ts";

const USAGE = "Usage: pnpm db:verify-import -- --source <path>";

/** @typedef {{ help: true } | { help: false, sourcePath: string }} VerifyCliOptions */

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const target = createMysqlGatewayDb(requiredDatabaseUrl());
  try {
    const report = await verifySqliteGatewayImport({ sourcePath: options.sourcePath, target });
    for (const line of formatSqliteImportVerification(report)) console.log(line);
    if (!report.passed) process.exitCode = 1;
  } finally {
    await target.close();
  }
}

/**
 * @param {string[]} rawArgs
 * @returns {VerifyCliOptions}
 */
function parseArguments(rawArgs) {
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  if (args.length === 1 && args[0] === "--help") return { help: true };
  if (args.length !== 2 || args[0] !== "--source" || args[1] === undefined) {
    throw new CliUsageError(USAGE);
  }
  return { help: false, sourcePath: resolve(args[1]) };
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
  console.error(
    error instanceof CliUsageError ? error.message : "SQLite import verification failed",
  );
  process.exitCode = 1;
});
