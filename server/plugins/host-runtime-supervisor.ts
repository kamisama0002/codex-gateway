import { hostRuntimeSupervisor } from "../utils/gateway/runtime/host-runtime-supervisor";
import { bootstrapLegacyRuntimeNodeFromEnvironment } from "../utils/gateway/runtime-manager/runtime-node-bootstrap";
import { runtimeNodeHealthMonitor } from "../utils/gateway/runtime-manager/runtime-node-health-monitor";
import {
  closeGatewayDatabase,
  databaseUnavailableError,
  verifyGatewayDatabase,
} from "../utils/gateway/storage/database";

let startupPhase = "database_verification";
let supervisorStarted = false;
let nodeHealthMonitorStarted = false;
try {
  try {
    await verifyGatewayDatabase();
  } catch (error) {
    throw databaseUnavailableError(error);
  }
  startupPhase = "legacy_runtime_node_bootstrap";
  await bootstrapLegacyRuntimeNodeFromEnvironment();
  hostRuntimeSupervisor.start();
  supervisorStarted = true;
  startupPhase = "stored_user_bootstrap";
  await hostRuntimeSupervisor.bootstrapStoredUsers();
  runtimeNodeHealthMonitor.start();
  nodeHealthMonitorStarted = true;
} catch (error) {
  if (nodeHealthMonitorStarted) {
    runtimeNodeHealthMonitor.stop();
  }
  if (supervisorStarted) {
    hostRuntimeSupervisor.stop();
  }
  try {
    await closeGatewayDatabase();
  } catch (closeError) {
    console.error("[gateway] database close after startup failure failed", {
      ...safeStartupError(closeError),
    });
  }
  console.error("[gateway] startup initialization failed", {
    phase: startupPhase,
    ...safeStartupError(error),
  });
  throw error;
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("close", async () => {
    runtimeNodeHealthMonitor.stop();
    hostRuntimeSupervisor.stop();
    await closeGatewayDatabase();
  });
});

function safeStartupError(error: unknown) {
  return {
    name: error instanceof Error ? error.name : "UnknownError",
    code: errorCode(error),
  };
}

function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}
