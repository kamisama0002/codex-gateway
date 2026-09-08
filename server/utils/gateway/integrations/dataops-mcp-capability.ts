import type { CapabilityDefinition } from "~~/shared/types";
import { capabilityStore } from "../capabilities/store";

export const DINKY_MCP_CAPABILITY_ID = "org__dinky_mcp";

type DinkyMcpBinding = { revision: number; dataOpsBaseUrl: string };

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
    async ensure(binding: DinkyMcpBinding) {
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
          envHttpHeaders: {
            "X-INFINITY-TENANT-ID": "INFINITY_TENANT_ID",
            "X-INFINITY-DEFAULT-PROJECT-ID": "INFINITY_PROJECT_ID",
          },
        },
        sensitiveFields: ["INFINITY_PROJECT_ID", "INFINITY_TENANT_ID", "INFINITY_USER_TOKEN"],
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

export function dinkyMcpCapabilityMatches(
  capability: CapabilityDefinition | null,
  binding: { revision: number; dataOpsBaseUrl: string },
) {
  const config = capability?.config;
  return (
    capability?.id === DINKY_MCP_CAPABILITY_ID &&
    capability.version === String(binding.revision) &&
    config !== undefined &&
    "transport" in config &&
    config.transport === "streamable_http" &&
    "url" in config &&
    config.url === new URL("/api/infinity/mcp/transport", binding.dataOpsBaseUrl).toString()
  );
}

export async function ensureDinkyMcpCapability(
  binding: DinkyMcpBinding,
): Promise<CapabilityDefinition> {
  return await createDinkyMcpCapabilityService(capabilityStore).ensure(binding);
}
