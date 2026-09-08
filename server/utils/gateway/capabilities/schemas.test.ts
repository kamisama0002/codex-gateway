import { describe, expect, it } from "vitest";
import { parseCapabilityCreateInput, parseCapabilityUpdateInput } from "./schemas";

const dinkyDefinition = {
  id: "org__dinky_mcp",
  kind: "mcp" as const,
  displayName: "Dinky Business MCP",
  description: "Dinky hosted MCP",
  version: "1.0.0",
  source: { type: "internal" as const, locator: "dataops-dinky-mcp" },
  sensitiveFields: ["INFINITY_USER_TOKEN", "INFINITY_TENANT_ID"],
  enabled: true,
  createdByUserId: null,
  config: {
    transport: "streamable_http" as const,
    url: "https://dinky.example.test/api/infinity/mcp/transport",
    bearerTokenEnvVar: "INFINITY_USER_TOKEN",
    envHttpHeaders: { "X-INFINITY-TENANT-ID": "INFINITY_TENANT_ID" },
  },
};

describe("capability schemas", () => {
  it("accepts literal and environment-backed authentication for a private HTTP MCP", () => {
    expect(
      parseCapabilityCreateInput({
        id: "org__infinity",
        kind: "mcp",
        displayName: "Infinity Dinky",
        description: "Dinky MCP",
        version: "1.0.0",
        source: { type: "internal", locator: "infinity-mcp" },
        config: {
          transport: "streamable_http",
          url: "http://172.25.106.252:8000/api/v1/mcp/",
          bearerTokenEnvVar: "INFINITY_MCP_TOKEN",
          httpHeaders: { "X-Infinity-Tenant-ID": "1" },
        },
        sensitiveFields: ["INFINITY_MCP_TOKEN"],
      }),
    ).toMatchObject({
      config: {
        bearerTokenEnvVar: "INFINITY_MCP_TOKEN",
        httpHeaders: { "X-Infinity-Tenant-ID": "1" },
      },
    });
    expect(parseCapabilityCreateInput(dinkyDefinition)).toMatchObject({ kind: "mcp" });
  });

  it.each(["X Header", ":authority", "X-租户"])("rejects non-token header %s", (header) => {
    expect(() =>
      parseCapabilityCreateInput({
        ...dinkyDefinition,
        config: {
          ...dinkyDefinition.config,
          envHttpHeaders: { [header]: "INFINITY_TENANT_ID" },
        },
      }),
    ).toThrow();
  });

  it("does not clear sensitive fields when an update only changes enabled state", () => {
    expect(parseCapabilityUpdateInput({ enabled: false })).toEqual({ enabled: false });
  });
});
