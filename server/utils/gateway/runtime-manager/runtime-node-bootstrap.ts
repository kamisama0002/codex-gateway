import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import type { GatewayDb } from "../storage/contracts";
import { encryptJson } from "../storage/crypto";
import { gatewayDatabase } from "../storage/database";
import { createRuntimeNodeStore } from "./runtime-node-store";
import {
  runtimeIdSchema,
  runtimeNodeIdSchema,
  runtimeNodeRecordSchema,
  runtimeWorkspaceKeySchema,
} from "./runtime-node-types";

const GIB = 1024 * 1024 * 1024;
const DEFAULT_AGENT_MEMORY_BYTES = 8 * GIB;
const DEFAULT_AGENT_CPU_MILLIS = 4_000;
const DEFAULT_AGENT_PIDS = 1_024;
const DEFAULT_NODE_CAPACITY_CPU_MILLIS = 16_000;
const DEFAULT_NODE_CAPACITY_MEMORY_BYTES = 64 * GIB;
const DEFAULT_NODE_MAX_RUNTIMES = 30;
const DEFAULT_NODE_MINIMUM_FREE_DISK_BYTES = 20 * GIB;

const bootstrapCapacitySchema = z
  .object({
    cpuMillis: z.number().int().positive(),
    memoryBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxRuntimes: z.number().int().positive(),
    minimumFreeDiskBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const bootstrapResourcesSchema = z
  .object({
    cpuMillis: z.number().int().positive(),
    memoryBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    pids: z.number().int().positive(),
  })
  .strict();

export interface BootstrapLegacyRuntimeNodeInput {
  db: GatewayDb;
  defaultNodeId: string;
  baseUrl: string;
  sharedSecret: string;
  identitySecret: string;
  capacity: z.infer<typeof bootstrapCapacitySchema>;
  defaultResources: z.infer<typeof bootstrapResourcesSchema>;
  now?: () => string;
  workspaceKey?: () => string;
}

export interface BootstrapLegacyRuntimeNodeResult {
  nodeCreated: boolean;
  placementsBackfilled: number;
}

export class RuntimeNodeBootstrapError extends Error {
  constructor(
    readonly code:
      | "runtime_node_bootstrap_conflict"
      | "runtime_node_bootstrap_invalid_configuration"
      | "runtime_identity_secret_mismatch",
  ) {
    super(code);
    this.name = "RuntimeNodeBootstrapError";
  }
}

export async function bootstrapLegacyRuntimeNode(
  input: BootstrapLegacyRuntimeNodeInput,
): Promise<BootstrapLegacyRuntimeNodeResult> {
  const defaultNodeId = runtimeNodeIdSchema.parse(input.defaultNodeId);
  const capacity = bootstrapCapacitySchema.parse(input.capacity);
  const defaultResources = bootstrapResourcesSchema.parse(input.defaultResources);
  const identitySecret = requiredSecret(input.identitySecret);
  const now = input.now ?? (() => new Date().toISOString());
  const workspaceKey = input.workspaceKey ?? randomWorkspaceKey;

  return await input.db.transaction(
    async (tx) => {
      const nodeStore = createRuntimeNodeStore(tx);
      const existingNodes = await nodeStore.listForUpdate();
      const unplaced = await tx.many<{ user_id: number }>(
        `SELECT user_id
         FROM user_agent_runtimes
         WHERE runtime_node_id IS NULL
         ORDER BY user_id ASC
         FOR UPDATE`,
      );
      let defaultNode = existingNodes.find((node) => node.id === defaultNodeId) ?? null;
      let nodeCreated = false;
      if (defaultNode === null) {
        if (existingNodes.length > 0) {
          throw new RuntimeNodeBootstrapError("runtime_node_bootstrap_conflict");
        }
        const sharedSecret = requiredSecret(input.sharedSecret);
        if (unplaced.length > 0 && identitySecret !== sharedSecret) {
          throw new RuntimeNodeBootstrapError("runtime_identity_secret_mismatch");
        }
        const timestamp = new Date(now()).toISOString();
        defaultNode = await nodeStore.upsert(
          runtimeNodeRecordSchema.parse({
            id: defaultNodeId,
            name: "Default Runtime Node",
            baseUrl: input.baseUrl,
            encryptedSharedSecret: encryptJson({ secret: sharedSecret }),
            configRevision: 1,
            schedulingState: "active",
            capacityCpuMillis: capacity.cpuMillis,
            capacityMemoryBytes: capacity.memoryBytes,
            maxRuntimes: capacity.maxRuntimes,
            minimumFreeDiskBytes: capacity.minimumFreeDiskBytes,
            lastSeenAt: null,
            lastError: null,
            healthJson: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        );
        nodeCreated = true;
      }
      let placementsBackfilled = 0;
      for (const row of unplaced) {
        const userId = positiveInteger(Number(row.user_id));
        const policy = await tx.one<{
          memory_mib: number;
          cpu_millicores: number;
          pids_limit: number;
        }>(
          `SELECT memory_mib, cpu_millicores, pids_limit
           FROM user_runtime_policies
           WHERE user_id = ?`,
          [userId],
        );
        const resources =
          policy === null
            ? defaultResources
            : bootstrapResourcesSchema.parse({
                cpuMillis: Number(policy.cpu_millicores),
                memoryBytes: Number(policy.memory_mib) * 1024 * 1024,
                pids: Number(policy.pids_limit),
              });
        const result = await tx.execute(
          `UPDATE user_agent_runtimes
           SET runtime_id = ?, runtime_node_id = ?, placement_generation = 1,
               workspace_key = ?, reserved_cpu_millis = ?, reserved_memory_bytes = ?,
               reserved_pids = ?
           WHERE user_id = ? AND runtime_node_id IS NULL`,
          [
            runtimeIdForUser(identitySecret, userId),
            defaultNode.id,
            runtimeWorkspaceKeySchema.parse(workspaceKey()),
            resources.cpuMillis,
            resources.memoryBytes,
            resources.pids,
            userId,
          ],
        );
        if (result.affectedRows !== 1) {
          throw new RuntimeNodeBootstrapError("runtime_node_bootstrap_conflict");
        }
        placementsBackfilled += 1;
      }
      return { nodeCreated, placementsBackfilled };
    },
    { isolationLevel: "serializable" },
  );
}

export async function bootstrapLegacyRuntimeNodeFromEnvironment() {
  return await bootstrapLegacyRuntimeNode({
    db: gatewayDatabase(),
    defaultNodeId: process.env.RUNTIME_MANAGER_DEFAULT_NODE_ID ?? "node__default",
    baseUrl: process.env.RUNTIME_MANAGER_BASE_URL ?? "",
    sharedSecret: process.env.RUNTIME_MANAGER_SHARED_SECRET ?? "",
    identitySecret: requiredEnvironment("RUNTIME_IDENTITY_SECRET"),
    capacity: {
      cpuMillis: positiveEnvironmentInteger(
        "RUNTIME_NODE_CAPACITY_CPU_MILLIS",
        DEFAULT_NODE_CAPACITY_CPU_MILLIS,
      ),
      memoryBytes: positiveEnvironmentInteger(
        "RUNTIME_NODE_CAPACITY_MEMORY_BYTES",
        DEFAULT_NODE_CAPACITY_MEMORY_BYTES,
      ),
      maxRuntimes: positiveEnvironmentInteger(
        "RUNTIME_NODE_MAX_RUNTIMES",
        DEFAULT_NODE_MAX_RUNTIMES,
      ),
      minimumFreeDiskBytes: nonnegativeEnvironmentInteger(
        "RUNTIME_NODE_MINIMUM_FREE_DISK_BYTES",
        DEFAULT_NODE_MINIMUM_FREE_DISK_BYTES,
      ),
    },
    defaultResources: runtimeAgentResourcesFromEnvironment(),
  });
}

export function runtimeAgentResourcesFromEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  return {
    cpuMillis: agentCpuMillis(environment.RUNTIME_AGENT_CPUS),
    memoryBytes: agentMemoryBytes(environment.RUNTIME_AGENT_MEMORY),
    pids: positiveEnvironmentIntegerFromValue(environment.RUNTIME_AGENT_PIDS, DEFAULT_AGENT_PIDS),
  };
}

function runtimeIdForUser(secret: string, userId: number) {
  const userHash = createHmac("sha256", secret)
    .update(`codex-runtime-user:${userId}`)
    .digest("hex");
  return runtimeIdSchema.parse(`codex_${userHash.slice(0, 32)}`);
}

function randomWorkspaceKey() {
  return runtimeWorkspaceKeySchema.parse(`ws__${randomBytes(16).toString("hex")}`);
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim() ?? "";
  if (value === "") {
    throw new RuntimeNodeBootstrapError("runtime_node_bootstrap_invalid_configuration");
  }
  return value;
}

function requiredSecret(value: string) {
  if (value.trim() === "") {
    throw new RuntimeNodeBootstrapError("runtime_node_bootstrap_invalid_configuration");
  }
  return value;
}

function positiveEnvironmentInteger(name: string, fallback: number) {
  return positiveEnvironmentIntegerFromValue(process.env[name], fallback);
}

function positiveEnvironmentIntegerFromValue(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RuntimeNodeBootstrapError("runtime_node_bootstrap_invalid_configuration");
  }
  return parsed;
}

function nonnegativeEnvironmentInteger(name: string, fallback: number) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RuntimeNodeBootstrapError("runtime_node_bootstrap_invalid_configuration");
  }
  return parsed;
}

function agentCpuMillis(value: string | undefined) {
  if (value === undefined || value.trim() === "") return DEFAULT_AGENT_CPU_MILLIS;
  const cores = Number(value);
  const cpuMillis = Math.round(cores * 1_000);
  if (!Number.isFinite(cores) || cpuMillis < 250 || cpuMillis > 8_000) {
    throw new RuntimeNodeBootstrapError("runtime_node_bootstrap_invalid_configuration");
  }
  return cpuMillis;
}

function agentMemoryBytes(value: string | undefined) {
  if (value === undefined || value.trim() === "") return DEFAULT_AGENT_MEMORY_BYTES;
  const match = /^(\d+(?:\.\d+)?)\s*(b|k|kb|ki|m|mb|mi|g|gb|gi)?$/iu.exec(value.trim());
  if (match === null) {
    throw new RuntimeNodeBootstrapError("runtime_node_bootstrap_invalid_configuration");
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  const multiplier =
    unit === "g" || unit === "gb" || unit === "gi"
      ? GIB
      : unit === "m" || unit === "mb" || unit === "mi"
        ? 1024 * 1024
        : unit === "k" || unit === "kb" || unit === "ki"
          ? 1024
          : 1;
  const bytes = Math.round(amount * multiplier);
  if (!Number.isSafeInteger(bytes) || bytes < 128 * 1024 * 1024 || bytes > 16 * GIB) {
    throw new RuntimeNodeBootstrapError("runtime_node_bootstrap_invalid_configuration");
  }
  return bytes;
}

function positiveInteger(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RuntimeNodeBootstrapError("runtime_node_bootstrap_conflict");
  }
  return value;
}
