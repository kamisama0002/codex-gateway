import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptJson } from "../storage/crypto";
import { RuntimeManagerClient } from "./client";
import {
  RuntimeNodeClientRegistry,
  RuntimeNodeClientRegistryError,
} from "./runtime-node-client-registry";
import type { RuntimeNodeRecord } from "./runtime-node-types";

const timestamp = "2026-09-08T00:00:00.000Z";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runtime node client registry", () => {
  it("keeps one client per node revision and invalidates only the changed node", async () => {
    vi.stubEnv("CODEX_GATEWAY_CONFIG_SECRET", "gateway-config-secret");
    const nodes = new Map([
      ["node__a", node("node__a", 1, "secret-a")],
      ["node__b", node("node__b", 1, "secret-b")],
    ]);
    const createClient = vi.fn(
      (input: { baseUrl: string; secret: string }) => new RuntimeManagerClient(input),
    );
    const registry = new RuntimeNodeClientRegistry({
      nodeStore: { get: async (nodeId) => nodes.get(nodeId) ?? null },
      createClient,
    });

    const firstA = await registry.get("node__a");
    const firstB = await registry.get("node__b");
    nodes.set("node__b", node("node__b", 2, "secret-b-rotated"));

    expect(await registry.get("node__a")).toBe(firstA);
    expect(await registry.get("node__b")).not.toBe(firstB);
    expect(createClient).toHaveBeenCalledTimes(3);
    expect(createClient).toHaveBeenLastCalledWith({
      baseUrl: "https://node-b.runtime.internal",
      nodeId: "node__b",
      secret: "secret-b-rotated",
    });
  });

  it("rejects disabled, missing, insecure, and unreadable nodes with fixed error codes", async () => {
    vi.stubEnv("CODEX_GATEWAY_CONFIG_SECRET", "gateway-config-secret");
    const records = new Map<string, RuntimeNodeRecord>([
      ["node__disabled", { ...node("node__disabled", 1, "secret"), schedulingState: "disabled" }],
      ["node__http", { ...node("node__http", 1, "secret"), baseUrl: "http://10.1.250.8:8787" }],
      ["node__broken", { ...node("node__broken", 1, "secret"), encryptedSharedSecret: "broken" }],
    ]);
    const registry = new RuntimeNodeClientRegistry({
      nodeStore: { get: async (nodeId) => records.get(nodeId) ?? null },
    });

    await expect(registry.get("node__missing")).rejects.toMatchObject({
      code: "runtime_node_not_found",
      message: "runtime_node_not_found",
    });
    await expect(registry.get("node__disabled")).rejects.toMatchObject({
      code: "runtime_node_disabled",
      message: "runtime_node_disabled",
    });
    for (const nodeId of ["node__http", "node__broken"]) {
      await expect(registry.get(nodeId)).rejects.toEqual(
        new RuntimeNodeClientRegistryError("runtime_node_invalid_configuration"),
      );
    }
  });
});

function node(id: string, configRevision: number, secret: string): RuntimeNodeRecord {
  return {
    id,
    name: id,
    baseUrl: `https://${id.replaceAll("__", "-")}.runtime.internal`,
    encryptedSharedSecret: encryptJson({ secret }),
    configRevision,
    schedulingState: "active",
    capacityCpuMillis: 16_000,
    capacityMemoryBytes: 64 * 1024 * 1024 * 1024,
    maxRuntimes: 30,
    minimumFreeDiskBytes: 20 * 1024 * 1024 * 1024,
    lastSeenAt: timestamp,
    lastError: null,
    healthJson: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
