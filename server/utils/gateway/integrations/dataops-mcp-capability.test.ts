import { describe, expect, it, vi } from "vitest";
import type { CapabilityDefinition } from "~~/shared/types";
import { DINKY_MCP_CAPABILITY_ID, createDinkyMcpCapabilityService } from "./dataops-mcp-capability";

describe("Dinky MCP capability", () => {
  it("upserts the protected capability from an active binding without secrets", async () => {
    const store = {
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn(async (value: Omit<CapabilityDefinition, "createdAt" | "updatedAt">) => ({
        ...value,
        createdAt: "now",
        updatedAt: "now",
      })),
      update: vi.fn(),
    };
    const service = createDinkyMcpCapabilityService(store);
    const result = await service.ensure({
      pairingId: "pairing-fixed",
      revision: 4,
      dataOpsBaseUrl: "https://dinky.example.test",
      sharedSecret: "secret",
    });
    expect(result).toMatchObject({
      id: DINKY_MCP_CAPABILITY_ID,
      config: { url: "https://dinky.example.test/api/infinity/mcp/transport" },
    });
    expect(JSON.stringify(store.create.mock.calls)).not.toContain("secret");
    await service.ensure({
      pairingId: "pairing-fixed",
      revision: 4,
      dataOpsBaseUrl: "https://dinky.example.test",
      sharedSecret: "secret",
    });
    expect(store.update).not.toHaveBeenCalled();
  });
});
