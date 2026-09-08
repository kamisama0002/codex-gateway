import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  McpOAuthService,
  type McpOAuthStateRecord,
  type McpOAuthStateStore,
} from "./oauth-service";

describe("McpOAuthService", () => {
  it("stores only a state hash, rejects another user, and consumes a callback once", async () => {
    const store = new MemoryOAuthStateStore(() => Date.parse("2026-09-07T00:00:00.000Z"));
    const forwardCallback = vi.fn(async () => undefined);
    const reconcile = vi.fn(async () => undefined);
    const service = new McpOAuthService({
      store,
      startLogin: async () => ({
        authorizationUrl: "https://auth.example.test/authorize?state=upstream-secret-state",
      }),
      forwardCallback,
      reconcile,
      now: () => Date.parse("2026-09-07T00:00:00.000Z"),
    });

    const started = await service.start({
      userId: 7,
      projectId: 10,
      capabilityId: "org__business",
      runtimeId: "runtime_7",
      threadId: null,
    });

    expect(started.authorizationUrl).toContain("state=upstream-secret-state");
    expect(JSON.stringify([...store.records.values()])).not.toContain("upstream-secret-state");
    expect([...store.records.keys()]).toEqual([
      createHash("sha256").update("upstream-secret-state").digest("hex"),
    ]);
    await expect(
      service.complete({ userId: 8, state: "upstream-secret-state", query: "code=abc" }),
    ).rejects.toThrow("OAuth state is invalid");
    await expect(
      service.complete({ userId: 7, state: "upstream-secret-state", query: "code=abc" }),
    ).resolves.toMatchObject({ capabilityId: "org__business", projectId: 10 });
    await expect(
      service.complete({ userId: 7, state: "upstream-secret-state", query: "code=abc" }),
    ).rejects.toThrow("OAuth state is invalid");
    expect(forwardCallback).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith({
      userId: 7,
      projectId: 10,
      reason: "credentialRotated",
    });
  });

  it("expires state after ten minutes without forwarding a callback", async () => {
    let currentTime = Date.parse("2026-09-07T00:00:00.000Z");
    const store = new MemoryOAuthStateStore(() => currentTime);
    const forwardCallback = vi.fn();
    const service = new McpOAuthService({
      store,
      startLogin: async () => ({
        authorizationUrl: "https://auth.example.test/authorize?state=expiring-state",
      }),
      forwardCallback,
      reconcile: vi.fn(),
      now: () => currentTime,
    });
    await service.start({
      userId: 7,
      projectId: null,
      capabilityId: "org__business",
      runtimeId: "runtime_7",
      threadId: null,
    });
    currentTime += 600_001;

    await expect(
      service.complete({ userId: 7, state: "expiring-state", query: "code=abc" }),
    ).rejects.toThrow("OAuth state is invalid");
    expect(forwardCallback).not.toHaveBeenCalled();
  });
});

class MemoryOAuthStateStore implements McpOAuthStateStore {
  readonly records = new Map<string, McpOAuthStateRecord>();

  constructor(private readonly now: () => number) {}

  async create(record: McpOAuthStateRecord) {
    this.records.set(record.stateHash, structuredClone(record));
  }

  async consume(stateHash: string, userId: number) {
    const record = this.records.get(stateHash);
    if (
      record === undefined ||
      record.userId !== userId ||
      record.consumedAt !== null ||
      Date.parse(record.expiresAt) <= this.now()
    ) {
      return null;
    }
    record.consumedAt = new Date(this.now()).toISOString();
    return structuredClone(record);
  }
}
