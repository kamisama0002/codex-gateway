import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
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
  const dbPath = join(process.cwd(), ".data-e2e", "codex-gateway.db");
  process.env.CODEX_GATEWAY_DB_PATH = dbPath;
  process.env.CODEX_GATEWAY_CONFIG_SECRET ??= "e2e-config-secret";
  if (process.env.E2E_DATABASE_PREPARED !== "1") {
    await rm(dirname(dbPath), { recursive: true, force: true });
    await mkdir(dirname(dbPath), { recursive: true });
    for (const [username, password, role] of [
      [E2E_USERNAME, E2E_PASSWORD, "admin"],
      [MANAGED_RUNTIME_A_USERNAME, MANAGED_RUNTIME_PASSWORD, "user"],
      [MANAGED_RUNTIME_B_USERNAME, MANAGED_RUNTIME_PASSWORD, "user"],
    ] as const) {
      await execFileAsync("node", ["scripts/create-user.mjs", username, password, "--role", role], {
        env: {
          ...process.env,
          CODEX_GATEWAY_DB_PATH: dbPath,
        },
      });
    }
  }
  await startDockerEnvironment();
}
