import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startDockerEnvironment } from "./docker-environment";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/app";
import {
  MANAGED_RUNTIME_A_USERNAME,
  MANAGED_RUNTIME_B_USERNAME,
  MANAGED_RUNTIME_PASSWORD,
} from "./helpers/managed-runtime-users";

const execFileAsync = promisify(execFile);

export default async function globalSetup() {
  process.env.CODEX_GATEWAY_CONFIG_SECRET ??= "e2e-config-secret";
  if (process.env.E2E_DATABASE_PREPARED !== "1") {
    if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === "") {
      throw new Error("DATABASE_URL is required for E2E database setup");
    }
    await execFileAsync("node", ["scripts/database/migrate.mjs"], { env: process.env });
    for (const [username, password, role] of [
      [E2E_USERNAME, E2E_PASSWORD, "admin"],
      [MANAGED_RUNTIME_A_USERNAME, MANAGED_RUNTIME_PASSWORD, "user"],
      [MANAGED_RUNTIME_B_USERNAME, MANAGED_RUNTIME_PASSWORD, "user"],
    ] as const) {
      await execFileAsync("node", ["scripts/create-user.mjs", username, password, "--role", role], {
        env: process.env,
      });
    }
  }
  await startDockerEnvironment();
}
