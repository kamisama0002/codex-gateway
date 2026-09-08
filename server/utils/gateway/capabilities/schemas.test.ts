import { describe, expect, it } from "vitest";
import { parseCapabilityCreateInput } from "./schemas";

const definition = {
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
    envHttpHeaders: { "X-INFINITY-TENANT-ID": "INFINITY_TENANT_ID" },
  },
};

describe("authenticated HTTP MCP schema", () => {
  it("accepts standard HTTP token header names", () => {
    expect(parseCapabilityCreateInput(definition)).toMatchObject({ kind: "mcp" });
  });

  it.each(["X Header", ":authority", "X-租户"])("rejects non-token header %s", (header) => {
    expect(() =>
      parseCapabilityCreateInput({
        ...definition,
        config: { ...definition.config, envHttpHeaders: { [header]: "INFINITY_TENANT_ID" } },
      }),
    ).toThrow();
  });
});
