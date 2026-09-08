import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("personal MCP settings", () => {
  it("keeps platform MCP hidden and routes user-owned MCP mutations through personal APIs", () => {
    const settings = read("./CapabilitySettingsTab.vue");
    const catalog = read("./capabilities/CapabilityCatalog.vue");
    const capabilityEditor = read("./capabilities/CapabilityEditor.vue");
    const credentialEditor = read("./capabilities/CredentialEditor.vue");
    const store = read("../../stores/gateway-capabilities/index.ts");

    expect(settings).toContain("createPersonalMcp");
    expect(settings).toContain(":mcp-only=\"!isAdmin\"");
    expect(catalog).toContain("isPersonalMcp");
    expect(capabilityEditor).toContain("mcpOnly");
    expect(capabilityEditor).toContain("bearerTokenEnvVar");
    expect(credentialEditor).toContain("personalUserId");
    expect(store).toContain("/api/capabilities/mcp");
    expect(store).toContain("createPersonalCredential");
  });
});
