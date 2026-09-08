import { describe, expect, it } from "vitest";
import { parseCapabilityCreateInput } from "./schemas";

describe("capability schemas", () => {
  it("accepts environment-backed authentication for a private HTTP MCP", () => {
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
  });
});
