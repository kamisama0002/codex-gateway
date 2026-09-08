import type { CapabilityDefinition } from "~~/shared/types";

export const DINKY_MCP_CAPABILITY_ID = "org__dinky_mcp";

type CapabilityStore = {
  get(id: string): Promise<CapabilityDefinition | null>;
  create(
    input: Omit<CapabilityDefinition, "createdAt" | "updatedAt">,
  ): Promise<CapabilityDefinition>;
  update(
    id: string,
    input: Partial<Omit<CapabilityDefinition, "id" | "createdAt" | "updatedAt">>,
  ): Promise<CapabilityDefinition>;
};

export function createDinkyMcpCapabilityService(store: CapabilityStore) {
  return {
    async ensure(binding: {
      pairingId: string;
      revision: number;
      dataOpsBaseUrl: string;
      sharedSecret: string;
    }) {
      const url = new URL("/api/infinity/mcp/transport", binding.dataOpsBaseUrl).toString();
      const input = {
        id: DINKY_MCP_CAPABILITY_ID,
        kind: "mcp" as const,
        displayName: "Dinky Business MCP",
        description: "Protected MCP capability backed by the paired Dinky platform.",
        version: String(binding.revision),
        source: { type: "internal" as const, locator: "dataops-dinky-mcp" },
        config: {
          transport: "streamable_http" as const,
          url,
          bearerTokenEnvVar: "INFINITY_USER_TOKEN",
          envHttpHeaders: { "X-INFINITY-TENANT-ID": "INFINITY_TENANT_ID" },
        },
        sensitiveFields: ["INFINITY_TENANT_ID", "INFINITY_USER_TOKEN"],
        enabled: true,
        createdByUserId: null,
      };
      const existing = await store.get(DINKY_MCP_CAPABILITY_ID);
      if (existing === null) return await store.create(input);
      if (
        existing.version === input.version &&
        JSON.stringify(existing.config) === JSON.stringify(input.config)
      )
        return existing;
      return await store.update(DINKY_MCP_CAPABILITY_ID, input);
    },
  };
}
