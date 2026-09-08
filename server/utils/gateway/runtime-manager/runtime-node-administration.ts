import { decryptJson, encryptJson } from "../storage/crypto";
import { gatewayDatabase } from "../storage/database";
import { RuntimeManagerClient, runtimeNodeHealthSchema } from "./client";
import { createRuntimeNodeStore } from "./runtime-node-store";
import { runtimeNodeIdSchema, type RuntimeNodeRecord } from "./runtime-node-types";
import {
  runtimeNodeAdminCreateInputSchema,
  runtimeNodeAdminPatchInputSchema,
  runtimeNodeHealthViewFromRecord,
  runtimeNodeAdminViewSchema,
  type RuntimeNodeAdminCreateInput,
  type RuntimeNodeAdminPatchInput,
  type RuntimeNodeAdminView,
} from "./runtime-node-admin-types";

interface RuntimeNodeAdministrationOptions {
  db: ReturnType<typeof gatewayDatabase>;
  now?: () => string;
  allowInsecureHttp?: boolean;
  clientFactory?: (input: {
    baseUrl: string;
    nodeId: string;
    secret: string;
  }) => RuntimeManagerClient;
}

export class RuntimeNodeAdministrationServiceError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode = 502,
    message = code,
  ) {
    super(message);
    this.name = "RuntimeNodeAdministrationServiceError";
  }
}

export class RuntimeNodeAdministrationService {
  private readonly now: () => string;

  constructor(private readonly options: RuntimeNodeAdministrationOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async listNodes(): Promise<RuntimeNodeAdminView[]> {
    const [nodes, reservations] = await Promise.all([
      createRuntimeNodeStore(this.options.db).list(),
      runtimeNodeReservations(this.options.db),
    ]);
    return nodes.map((node) =>
      runtimeNodeAdminViewSchema.parse(this.viewForNode(node, reservations)),
    );
  }

  async createNode(input: RuntimeNodeAdminCreateInput): Promise<RuntimeNodeAdminView> {
    const parsed = runtimeNodeAdminCreateInputSchema.parse(input);
    validateRuntimeNodeBaseUrlPolicy(parsed.baseUrl, this.options.allowInsecureHttp === true);
    const nodeStore = createRuntimeNodeStore(this.options.db);
    const existing = await nodeStore.get(parsed.id);
    if (existing !== null) {
      throw new RuntimeNodeAdministrationServiceError("runtime_node_conflict", 409);
    }

    const client = this.clientFor({
      baseUrl: parsed.baseUrl,
      nodeId: parsed.id,
      secret: parsed.sharedSecret,
    });
    const health = runtimeNodeHealthSchema.parse(await client.status());
    const timestamp = this.now();
    const saved = await nodeStore.upsert({
      id: parsed.id,
      name: parsed.name,
      baseUrl: new URL(parsed.baseUrl).origin,
      encryptedSharedSecret: encryptJson({ secret: parsed.sharedSecret }),
      configRevision: 1,
      schedulingState: parsed.state,
      capacityCpuMillis: parsed.capacity.cpuMillis,
      capacityMemoryBytes: parsed.capacity.memoryBytes,
      maxRuntimes: parsed.capacity.maxRuntimes,
      minimumFreeDiskBytes: parsed.capacity.minimumFreeDiskBytes,
      lastSeenAt: health.sampledAt,
      lastError: null,
      healthJson: JSON.stringify(health),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return runtimeNodeAdminViewSchema.parse(this.viewForNode(saved));
  }

  async patchNode(
    nodeId: string,
    input: RuntimeNodeAdminPatchInput,
  ): Promise<RuntimeNodeAdminView> {
    const id = runtimeNodeIdSchema.parse(nodeId);
    const parsed = runtimeNodeAdminPatchInputSchema.parse(input);
    const nodeStore = createRuntimeNodeStore(this.options.db);
    const existing = await nodeStore.get(id);
    if (existing === null) {
      throw new RuntimeNodeAdministrationServiceError("runtime_node_not_found", 404);
    }

    if (parsed.sharedSecret !== undefined) {
      validateRuntimeNodeBaseUrlPolicy(existing.baseUrl, this.options.allowInsecureHttp === true);
      const client = this.clientFor({
        baseUrl: existing.baseUrl,
        nodeId: existing.id,
        secret: parsed.sharedSecret,
      });
      runtimeNodeHealthSchema.parse(await client.status());
    }

    const next = {
      ...existing,
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      ...(parsed.state === undefined ? {} : { schedulingState: parsed.state }),
      ...(parsed.capacity === undefined
        ? {}
        : {
            capacityCpuMillis: parsed.capacity.cpuMillis,
            capacityMemoryBytes: parsed.capacity.memoryBytes,
            maxRuntimes: parsed.capacity.maxRuntimes,
            minimumFreeDiskBytes: parsed.capacity.minimumFreeDiskBytes,
          }),
      ...(parsed.sharedSecret === undefined
        ? {}
        : { encryptedSharedSecret: encryptJson({ secret: parsed.sharedSecret }) }),
      configRevision: existing.configRevision + 1,
      updatedAt: this.now(),
    } satisfies RuntimeNodeRecord;

    const saved = await nodeStore.upsert(next);
    return runtimeNodeAdminViewSchema.parse(this.viewForNode(saved));
  }

  async probeNode(nodeId: string): Promise<RuntimeNodeAdminView> {
    const id = runtimeNodeIdSchema.parse(nodeId);
    const nodeStore = createRuntimeNodeStore(this.options.db);
    const node = await nodeStore.get(id);
    if (node === null) {
      throw new RuntimeNodeAdministrationServiceError("runtime_node_not_found", 404);
    }

    try {
      validateRuntimeNodeBaseUrlPolicy(node.baseUrl, this.options.allowInsecureHttp === true);
      const client = this.clientFor({
        baseUrl: node.baseUrl,
        nodeId: node.id,
        secret: this.secretFor(node),
      });
      const health = runtimeNodeHealthSchema.parse(await client.status());
      const updated = await nodeStore.updateHealth(id, {
        lastSeenAt: health.sampledAt,
        lastError: null,
        healthJson: JSON.stringify(health),
      });
      return runtimeNodeAdminViewSchema.parse(this.viewForNode(updated));
    } catch (error) {
      if (error instanceof RuntimeNodeAdministrationServiceError) throw error;
      throw new RuntimeNodeAdministrationServiceError("runtime_node_probe_failed", 502);
    }
  }

  private viewForNode(
    node: RuntimeNodeRecord,
    reservations = new Map<string, RuntimeNodeReservation>(),
  ) {
    const summary = runtimeNodeHealthViewFromRecord(node);
    const reservation = reservations.get(node.id) ?? emptyReservation;
    return {
      id: node.id,
      name: node.name,
      state: node.schedulingState,
      configRevision: node.configRevision,
      capacity: {
        cpuMillis: node.capacityCpuMillis,
        memoryBytes: node.capacityMemoryBytes,
        maxRuntimes: node.maxRuntimes,
        minimumFreeDiskBytes: node.minimumFreeDiskBytes,
      },
      reservation: {
        cpuMillis: reservation.cpuMillis,
        memoryBytes: reservation.memoryBytes,
        pids: reservation.pids,
        runtimes: reservation.runtimes,
      },
      health: summary.health,
    };
  }

  private secretFor(node: RuntimeNodeRecord) {
    try {
      const payload = decryptJson(node.encryptedSharedSecret);
      const secret =
        typeof payload === "object" && payload !== null
          ? (payload as { secret?: unknown }).secret
          : null;
      if (typeof secret === "string" && secret.length > 0) return secret;
    } catch {
      // fall through
    }
    throw new RuntimeNodeAdministrationServiceError("runtime_node_invalid_configuration", 400);
  }

  private clientFor(input: { baseUrl: string; nodeId: string; secret: string }) {
    return (
      this.options.clientFactory ??
      ((clientInput: { baseUrl: string; nodeId: string; secret: string }) =>
        new RuntimeManagerClient(clientInput))
    )(input);
  }
}

export const runtimeNodeAdministrationService = {
  listNodes() {
    return defaultRuntimeNodeAdministrationService().listNodes();
  },
  createNode(input: RuntimeNodeAdminCreateInput) {
    return defaultRuntimeNodeAdministrationService().createNode(input);
  },
  patchNode(nodeId: string, input: RuntimeNodeAdminPatchInput) {
    return defaultRuntimeNodeAdministrationService().patchNode(nodeId, input);
  },
  probeNode(nodeId: string) {
    return defaultRuntimeNodeAdministrationService().probeNode(nodeId);
  },
};

let productionRuntimeNodeAdministrationService: RuntimeNodeAdministrationService | null = null;

function defaultRuntimeNodeAdministrationService() {
  if (productionRuntimeNodeAdministrationService !== null) {
    return productionRuntimeNodeAdministrationService;
  }
  productionRuntimeNodeAdministrationService = new RuntimeNodeAdministrationService({
    db: gatewayDatabase(),
    allowInsecureHttp: process.env.RUNTIME_NODE_ALLOW_INSECURE_HTTP === "1",
  });
  return productionRuntimeNodeAdministrationService;
}

interface RuntimeNodeReservation {
  cpuMillis: number;
  memoryBytes: number;
  pids: number;
  runtimes: number;
}

const emptyReservation: RuntimeNodeReservation = {
  cpuMillis: 0,
  memoryBytes: 0,
  pids: 0,
  runtimes: 0,
};

async function runtimeNodeReservations(db: ReturnType<typeof gatewayDatabase>) {
  const rows = await db.many<{
    runtime_node_id: string;
    cpu_millis: number | string | null;
    memory_bytes: number | string | null;
    pids: number | string | null;
    runtimes: number | string | null;
  }>(
    `SELECT runtime_node_id,
            COALESCE(SUM(reserved_cpu_millis), 0) AS cpu_millis,
            COALESCE(SUM(reserved_memory_bytes), 0) AS memory_bytes,
            COALESCE(SUM(reserved_pids), 0) AS pids,
            COUNT(*) AS runtimes
     FROM user_agent_runtimes
     WHERE runtime_node_id IS NOT NULL
     GROUP BY runtime_node_id`,
  );
  return new Map(
    rows.map((row) => [
      row.runtime_node_id,
      {
        cpuMillis: Number(row.cpu_millis ?? 0),
        memoryBytes: Number(row.memory_bytes ?? 0),
        pids: Number(row.pids ?? 0),
        runtimes: Number(row.runtimes ?? 0),
      } satisfies RuntimeNodeReservation,
    ]),
  );
}

export function validateRuntimeNodeBaseUrlPolicy(baseUrl: string, allowInsecureHttp: boolean) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && !allowInsecureHttp) {
    throw new RuntimeNodeAdministrationServiceError("runtime_node_invalid_configuration", 400);
  }
}
