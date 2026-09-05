#!/usr/bin/env node
import { UserRepository } from "../server/utils/gateway/auth/user-repository.ts";
import { hashPassword } from "../server/utils/gateway/storage/crypto.ts";
import { createMysqlGatewayDb } from "../server/utils/gateway/storage/mysql.ts";

async function main() {
  const { username, password, explicitRole } = parseArguments(process.argv);
  const db = createMysqlGatewayDb(requiredDatabaseUrl());

  try {
    await db.one("SELECT version FROM schema_migrations WHERE version = 1");
    const users = new UserRepository(db);
    const existing = await users.findByUsername(username);
    const now = new Date().toISOString();
    let role;

    if (existing === null) {
      if (explicitRole === null) {
        role = (
          await users.createWithAutomaticRole({
            username,
            passwordHash: hashPassword(password),
            now,
          })
        ).role;
      } else {
        role = (
          await users.create({
            username,
            passwordHash: hashPassword(password),
            role: explicitRole,
            now,
          })
        ).role;
      }
    } else {
      role = explicitRole ?? existing.role;
      await users.updateCredentials({
        userId: existing.id,
        passwordHash: hashPassword(password),
        role: explicitRole,
        now,
      });
    }

    console.log(`User ${username} is ready with role ${role}`);
  } finally {
    await db.close();
  }
}

function parseArguments(argv) {
  const [, , usernameArg = "", password = "", roleFlag, roleArg] = argv;
  const username = usernameArg.trim().toLowerCase();
  if (username === "" || password === "") {
    throw new CliUsageError(
      "Usage: node scripts/create-user.mjs <username> <password> [--role admin|user]",
    );
  }
  if (password.length < 8) {
    throw new CliUsageError("Password must be at least 8 characters");
  }
  return { username, password, explicitRole: parseRole(roleFlag, roleArg) };
}

function requiredDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new CliUsageError("DATABASE_URL is required");
  }
  return databaseUrl;
}

function parseRole(flag, value) {
  if (flag === undefined && value === undefined) return null;
  if (flag === "--role" && (value === "admin" || value === "user")) return value;
  throw new CliUsageError("Role must be admin or user");
}

class CliUsageError extends Error {}

void main().catch((error) => {
  console.error(error instanceof CliUsageError ? error.message : "Could not create user");
  process.exitCode = 1;
});
