import { z } from "zod";
import { decryptJson } from "../storage/crypto";
import { gatewayDatabase } from "../storage/database";
import { RuntimeManagerClient } from "./client";
import { createRuntimeNodeStore } from "./runtime-node-store";
import { runtimeNodeIdSchema, type RuntimeNodeRecord } from "./runtime-node-types";

const runtimeNodeSecretSchema = z.object({ secret: z.string().min(1).max(4096) }).strict();

interface RuntimeNodeStorePort {
  get(nodeId: string): Promise<RuntimeNodeRecord | null>;
}

interface RuntimeNodeClientRegistryOptions {
  nodeStore: RuntimeNodeStorePort;
  allowInsecureHttp?: boolean;
  createClient?: (input: { baseUrl: string; secret: string }) => RuntimeManagerClient;
}

export class RuntimeNodeClientRegistryError extends Error {
  constructor(
    readonly code:
      | "runtime_node_not_found"
      | "runtime_node_disabled"
      | "runtime_node_invalid_configuration"
      | "runtime_node_registry_unavailable",
  ) {
    super(code);
    this.name = "RuntimeNodeClientRegistryError";
  }
}

export class RuntimeNodeClientRegistry {
  private readonly clients = new Map<string, RuntimeManagerClient>();
  private readonly createClient: (input: {
    baseUrl: string;
    secret: string;
  }) => RuntimeManagerClient;

  constructor(private readonly options: RuntimeNodeClientRegistryOptions) {
    this.createClient = options.createClient ?? ((input) => new RuntimeManagerClient(input));
  }

  async get(nodeId: string): Promise<RuntimeManagerClient> {
    const id = parsedNodeId(nodeId);
    let node: RuntimeNodeRecord | null;
    try {
      node = await this.options.nodeStore.get(id);
    } catch {
      throw new RuntimeNodeClientRegistryError("runtime_node_registry_unavailable");
    }
    if (node === null) throw new RuntimeNodeClientRegistryError("runtime_node_not_found");
    if (node.schedulingState === "disabled") {
      throw new RuntimeNodeClientRegistryError("runtime_node_disabled");
    }

    const cacheKey = `${node.id}:${node.configRevision}`;
    const cached = this.clients.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const url = new URL(node.baseUrl);
      if (url.protocol !== "https:" && this.options.allowInsecureHttp !== true) {
        throw new Error("Insecure Runtime Manager URL");
      }
      const { secret } = runtimeNodeSecretSchema.parse(decryptJson(node.encryptedSharedSecret));
      const client = this.createClient({ baseUrl: url.origin, secret });
      for (const key of this.clients.keys()) {
        if (key.startsWith(`${node.id}:`)) this.clients.delete(key);
      }
      this.clients.set(cacheKey, client);
      return client;
    } catch {
      throw new RuntimeNodeClientRegistryError("runtime_node_invalid_configuration");
    }
  }
}

export const runtimeNodeClientRegistry = new RuntimeNodeClientRegistry({
  nodeStore: {
    get: async (nodeId) => await createRuntimeNodeStore(gatewayDatabase()).get(nodeId),
  },
  allowInsecureHttp: process.env.RUNTIME_NODE_ALLOW_INSECURE_HTTP === "1",
});

function parsedNodeId(value: string) {
  const parsed = runtimeNodeIdSchema.safeParse(value);
  if (!parsed.success) throw new RuntimeNodeClientRegistryError("runtime_node_not_found");
  return parsed.data;
}
