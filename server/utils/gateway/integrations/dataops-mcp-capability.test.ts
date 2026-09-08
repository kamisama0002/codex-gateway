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
      revision: 4,
      dataOpsBaseUrl: "https://dinky.example.test",
    });
    expect(result).toMatchObject({
      id: DINKY_MCP_CAPABILITY_ID,
      config: { url: "https://dinky.example.test/api/infinity/mcp/transport" },
    });
    expect(JSON.stringify(store.create.mock.calls)).not.toContain("secret");
    await service.ensure({
      revision: 4,
      dataOpsBaseUrl: "https://dinky.example.test",
    });
    expect(store.update).not.toHaveBeenCalled();
  });

  it("updates the same system capability when a re-pair changes revision and URL", async () => {
    let current: CapabilityDefinition | null = null;
    const store = {
      get: vi.fn(async () => current),
      create: vi.fn(async (value: Omit<CapabilityDefinition, "createdAt" | "updatedAt">) => {
        current = { ...value, createdAt: "now", updatedAt: "now" };
        return current;
      }),
      update: vi.fn(async (_id: string, value: Partial<CapabilityDefinition>) => {
        current = { ...current!, ...value, updatedAt: "later" } as CapabilityDefinition;
        return current;
      }),
    };
    const service = createDinkyMcpCapabilityService(store);

    await service.ensure({
      revision: 4,
      dataOpsBaseUrl: "https://old.example.test",
    });
    await service.ensure({
      revision: 5,
      dataOpsBaseUrl: "https://new.example.test",
    });
    await service.ensure({
      revision: 5,
      dataOpsBaseUrl: "https://new.example.test",
    });

    expect(store.create).toHaveBeenCalledTimes(1);
    expect(store.update).toHaveBeenCalledTimes(1);
    expect(current).toMatchObject({
      version: "5",
      config: { url: "https://new.example.test/api/infinity/mcp/transport" },
    });
  });
});
