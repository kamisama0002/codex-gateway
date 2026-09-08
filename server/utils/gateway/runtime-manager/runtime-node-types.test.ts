import { describe, expect, it } from "vitest";
import { runtimeNodeRecordSchema, runtimePlacementRecordSchema } from "./runtime-node-types";

const timestamp = "2026-09-08T00:00:00.000Z";

describe("runtime node records", () => {
  it("accepts a private HTTP node record for an explicitly allowed test deployment", () => {
    expect(runtimeNodeRecordSchema.parse(validNode())).toMatchObject({
      id: "node__primary",
      baseUrl: "http://10.1.250.10:8787",
      schedulingState: "active",
    });
  });

  it("rejects node URLs containing credentials, paths, query strings, or fragments", () => {
    for (const baseUrl of [
      "https://user:password@runtime.internal",
      "https://runtime.internal/v1",
      "https://runtime.internal?node=a",
      "https://runtime.internal#node-a",
    ]) {
      expect(() => runtimeNodeRecordSchema.parse({ ...validNode(), baseUrl })).toThrow();
    }
  });

  it("requires opaque node and workspace identifiers", () => {
    expect(() => runtimeNodeRecordSchema.parse({ ...validNode(), id: "10.1.250.10" })).toThrow();
    expect(() =>
      runtimePlacementRecordSchema.parse({ ...validPlacement(), workspaceKey: "user-7" }),
    ).toThrow();
  });

  it("accepts a durable placement with explicit reservations", () => {
    expect(runtimePlacementRecordSchema.parse(validPlacement())).toEqual(validPlacement());
  });
});

function validNode() {
  return {
    id: "node__primary",
    name: "Primary Runtime Node",
    baseUrl: "http://10.1.250.10:8787",
    encryptedSharedSecret: "v1$encrypted",
    configRevision: 1,
    schedulingState: "active",
    capacityCpuMillis: 32_000,
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

function validPlacement() {
  return {
    userId: 7,
    runtimeId: "codex_1234567890abcdef1234567890abcdef",
    runtimeNodeId: "node__primary",
    placementGeneration: 1,
    workspaceKey: "ws__1234567890abcdef1234567890abcdef",
    reservedCpuMillis: 5_000,
    reservedMemoryBytes: 10 * 1024 * 1024 * 1024,
    reservedPids: 1_024,
  };
}
