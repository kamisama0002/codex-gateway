import { describe, expect, it, vi } from "vitest";
import type {
  ActualCapabilityState,
  CapabilityChange,
  CapabilityChangeResult,
  CapabilityDefinition,
  CapabilitySyncRecord,
  HostRecord,
} from "~~/shared/types";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { CapabilityReconciler, type CapabilitySyncStorePort } from "./reconciler";

describe("CapabilityReconciler", () => {
  it("serializes one user, lets another user progress, and skips repeated changes", async () => {
    const desiredByUser = new Map<number, CapabilityDefinition[]>([
      [7, [mcpDefinition("org__sales")]],
      [8, [mcpDefinition("org__knowledge")]],
    ]);
    const actualByUser = new Map<number, ActualCapabilityState>();
    const activeByUser = new Map<number, number>();
    const maxActiveByUser = new Map<number, number>();
    let activeGlobal = 0;
    let maxActiveGlobal = 0;
    const applyChange = vi.fn(async (host: HostRecord, change: CapabilityChange) => {
      const userId = Number(host.name.slice("user-".length));
      const current = actualByUser.get(userId) ?? emptyActual();
      if (change.operation === "configureMcp") {
        current.mcpServers = [
          {
            name: change.capabilityId,
            config: change.config,
            runtimeStatus: "connected",
            authStatus: "unsupported",
          },
        ];
      }
      actualByUser.set(userId, current);
      return applied(change);
    });
    const syncStore = new MemorySyncStore();
    const reconciler = new CapabilityReconciler({
      catalog: {
        listDesiredForContext: async ({ userId }) => desiredByUser.get(userId) ?? [],
      },
      adapter: {
        readActual: async (host) => {
          const userId = Number(host.name.slice("user-".length));
          const active = (activeByUser.get(userId) ?? 0) + 1;
          activeByUser.set(userId, active);
          maxActiveByUser.set(userId, Math.max(maxActiveByUser.get(userId) ?? 0, active));
          activeGlobal += 1;
          maxActiveGlobal = Math.max(maxActiveGlobal, activeGlobal);
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeByUser.set(userId, active - 1);
          activeGlobal -= 1;
          return actualByUser.get(userId) ?? emptyActual();
        },
        applyChange,
      },
      syncStore,
      resolveHost: async (userId) => hostForUser(userId),
      resolveContext: async () => ({ cwd: "/workspace", threadId: null }),
      runInUserScope: async (_userId, operation) => await operation(),
    });

    const [first, duplicate, other] = await Promise.all([
      reconciler.reconcile({ userId: 7, projectId: null, reason: "runtimeStart" }),
      reconciler.reconcile({ userId: 7, projectId: null, reason: "assignmentChanged" }),
      reconciler.reconcile({ userId: 8, projectId: null, reason: "runtimeStart" }),
    ]);
    const applyCount = applyChange.mock.calls.length;
    const repeated = await reconciler.reconcile({
      userId: 7,
      projectId: null,
      reason: "administratorRetry",
    });

    expect([first.status, duplicate.status, other.status]).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect(maxActiveByUser).toEqual(
      new Map([
        [7, 1],
        [8, 1],
      ]),
    );
    expect(maxActiveGlobal).toBeGreaterThanOrEqual(2);
    expect(applyCount).toBe(2);
    expect(applyChange).toHaveBeenCalledTimes(applyCount);
    expect(repeated.skipped).toBe(true);
    expect(syncStore.records.get("7:0")?.attemptCount).toBe(1);
    expect(syncStore.records.get("8:0")?.attemptCount).toBe(1);
  });

  it("records a safe failed result when App Server cannot apply a required change", async () => {
    const syncStore = new MemorySyncStore();
    const reconciler = new CapabilityReconciler({
      catalog: { listDesiredForContext: async () => [mcpDefinition("org__sales")] },
      adapter: {
        readActual: async () => emptyActual(),
        applyChange: async (_host, change) => ({
          capabilityId: change.capabilityId,
          operation: change.operation,
          status: "unsupportedCapability",
          safeMessage: "Unsupported capability",
        }),
      },
      syncStore,
      resolveHost: async () => hostForUser(7),
      resolveContext: async () => ({ cwd: "/workspace", threadId: null }),
      runInUserScope: async (_userId, operation) => await operation(),
    });

    const result = await reconciler.reconcile({
      userId: 7,
      projectId: 10,
      reason: "administratorRetry",
    });

    expect(result.status).toBe("failed");
    expect(result.results).toEqual([
      expect.objectContaining({ capabilityId: "org__sales", status: "unsupportedCapability" }),
    ]);
    expect(syncStore.records.get("7:10")).toMatchObject({
      status: "failed",
      safeError: "capability_sync_incomplete",
    });
  });
});

class MemorySyncStore implements CapabilitySyncStorePort {
  readonly records = new Map<string, CapabilitySyncRecord>();

  async get(userId: number, projectId: number | null) {
    return this.records.get(key(userId, projectId)) ?? null;
  }

  async begin(userId: number, projectId: number | null, desiredHash: string) {
    const current = await this.get(userId, projectId);
    const now = new Date().toISOString();
    const record: CapabilitySyncRecord = {
      id: current?.id ?? this.records.size + 1,
      userId,
      projectId,
      desiredHash,
      actualHash: null,
      status: "running",
      results: [],
      safeError: null,
      attemptCount: (current?.attemptCount ?? 0) + 1,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.records.set(key(userId, projectId), record);
    return record;
  }

  async finish(
    userId: number,
    projectId: number | null,
    input: {
      actualHash: string;
      status: "succeeded" | "failed";
      results: CapabilityChangeResult[];
      safeError: string | null;
    },
  ) {
    const current = await this.get(userId, projectId);
    if (current === null) throw new Error("Missing sync");
    const record = { ...current, ...input, updatedAt: new Date().toISOString() };
    this.records.set(key(userId, projectId), record);
    return record;
  }

  async list(userId?: number) {
    return [...this.records.values()].filter(
      (record) => userId === undefined || record.userId === userId,
    );
  }
}

function mcpDefinition(id: string): CapabilityDefinition {
  return {
    id,
    kind: "mcp",
    displayName: id,
    description: id,
    version: "1",
    source: { type: "internal", locator: `internal:${id}` },
    config: { transport: "streamable_http", url: `https://${id}.example.test` },
    sensitiveFields: [],
    enabled: true,
    createdByUserId: null,
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  };
}

function hostForUser(userId: number): HostRecord {
  return {
    id: MANAGED_RUNTIME_HOST_ID,
    connectionKind: "managed",
    name: `user-${userId}`,
    sshHost: "localhost",
    username: null,
    port: null,
    authMode: "agent",
    privateKeyPath: null,
    privateKey: null,
    password: null,
    proxyUrl: null,
    hasPassword: false,
    createdAt: "",
    updatedAt: "",
  };
}

function emptyActual(): ActualCapabilityState {
  return { skills: [], marketplaces: [], plugins: [], apps: [], mcpServers: [] };
}

function applied(change: CapabilityChange): CapabilityChangeResult {
  return {
    capabilityId: change.capabilityId,
    operation: change.operation,
    status: "applied",
    safeMessage: "Applied",
  };
}

function key(userId: number, projectId: number | null) {
  return `${userId}:${projectId ?? 0}`;
}
