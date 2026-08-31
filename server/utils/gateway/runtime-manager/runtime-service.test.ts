import { describe, expect, it, vi } from "vitest";
import type {
  ManagedRuntimeEndpoint,
  RuntimeStatus,
  UserAgentRuntimeRecord,
} from "@codex-gateway/agent-runtime-contracts";
import type { AuditEventInput } from "~~/shared/types/audit";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { ManagedRuntimeService, ManagedRuntimeServiceError } from "./runtime-service";

describe("ManagedRuntimeService", () => {
  it("serializes starts per user, persists every readiness transition, and returns a safe DTO", async () => {
    const fixture = runtimeFixture();

    const [first, second] = await Promise.all([fixture.service.start(7), fixture.service.start(7)]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      userId: 7,
      hostId: MANAGED_RUNTIME_HOST_ID,
      status: "ready",
      imageVersion: "0.151.0",
      runtimeVersion: "0.151.0",
    });
    expect(first).not.toHaveProperty("containerId");
    expect(first).not.toHaveProperty("endpoint");
    expect(first).not.toHaveProperty("serviceToken");
    expect(fixture.manager.provision).toHaveBeenCalledOnce();
    expect(fixture.manager.start).toHaveBeenCalledOnce();
    expect(fixture.manager.inspect).toHaveBeenCalledOnce();
    expect(fixture.statuses).toEqual([
      "provisioning",
      "provisioning",
      "schema_checking",
      "syncing_capabilities",
      "ready",
    ]);
    expect(fixture.audit.map((event) => event.action)).toEqual([
      "runtime.provision",
      "runtime.start",
    ]);
    expect(JSON.stringify(fixture.audit)).not.toContain("runtime-token");
    expect(JSON.stringify(fixture.audit)).not.toContain("runtime-01:4500");
    expect(JSON.stringify(fixture.audit)).not.toContain("container-01");
  });

  it("persists and audits a compatibility failure using only a safe error code", async () => {
    const fixture = runtimeFixture({ runtimeVersion: "0.150.0" });

    await expect(fixture.service.start(7)).rejects.toEqual(
      expect.objectContaining<Partial<ManagedRuntimeServiceError>>({
        code: "runtime_version_incompatible",
      }),
    );

    expect(fixture.store.getByUserId(7)).toMatchObject({
      status: "incompatible",
      lastError: "runtime_version_incompatible",
    });
    expect(fixture.audit.at(-1)).toMatchObject({
      action: "runtime.compatibility",
      outcome: "failure",
      errorCode: "runtime_version_incompatible",
      userId: 7,
    });
    const metadata = fixture.audit.at(-1)?.metadata;
    expect(metadata?.runtimeId).toMatch(/^codex_[a-f0-9]{32}$/);
    expect(metadata).toEqual({
      userId: 7,
      runtimeId: metadata?.runtimeId,
      runtimeType: "codex-app-server",
      imageVersion: "0.151.0",
      runtimeVersion: "0.150.0",
      schemaHash: "schema-v1",
      runtimeStatus: "incompatible",
    });
  });

  it("audits stop, restart, and removal and never serializes managed connection details", async () => {
    const fixture = runtimeFixture();
    await fixture.service.start(7);
    fixture.audit.splice(0);

    expect(await fixture.service.stop(7)).toMatchObject({ status: "degraded" });
    expect(await fixture.service.restart(7, 1)).toMatchObject({ status: "ready" });
    const host = await fixture.service.resolveManagedHost(7);
    expect(host).toMatchObject({ id: MANAGED_RUNTIME_HOST_ID, connectionKind: "managed" });
    expect(JSON.stringify(host)).not.toContain("runtime-token");
    expect(JSON.stringify(host)).not.toContain("runtime-01:4500");
    expect(await fixture.service.remove(7, 1)).toBeNull();

    expect(fixture.closeConnections.mock.calls).toEqual([[7], [7], [7]]);
    expect(fixture.audit.map((event) => [event.action, event.actorUserId])).toEqual([
      ["runtime.stop", 7],
      ["runtime.restart", 1],
      ["runtime.remove", 1],
    ]);
    expect(fixture.store.getByUserId(7)).toBeNull();
  });

  it("records a safe provision failure without persisting an exception message", async () => {
    const fixture = runtimeFixture();
    fixture.manager.provision.mockRejectedValueOnce(
      Object.assign(new Error("secret-token ws://sensitive:4500"), {
        code: "runtime_identity_conflict",
      }),
    );

    await expect(fixture.service.start(7)).rejects.toBeTruthy();

    expect(fixture.store.getByUserId(7)).toMatchObject({
      status: "degraded",
      lastError: "runtime_identity_conflict",
    });
    expect(fixture.audit.at(-1)).toMatchObject({
      action: "runtime.provision",
      outcome: "failure",
      errorCode: "runtime_identity_conflict",
    });
    expect(JSON.stringify(fixture.audit)).not.toContain("secret-token");
    expect(JSON.stringify(fixture.audit)).not.toContain("sensitive:4500");
  });

  it("keeps the target user ID in an administrator's idempotent removal audit", async () => {
    const fixture = runtimeFixture();

    await fixture.service.remove(7, 1);

    expect(fixture.audit).toHaveLength(1);
    expect(fixture.audit[0]).toMatchObject({
      actorUserId: 1,
      userId: 7,
      action: "runtime.remove",
    });
    expect(fixture.audit[0]?.metadata).toMatchObject({ userId: 7, runtimeStatus: "absent" });
  });

  it("persists and audits an invalid start response as a safe lifecycle failure", async () => {
    const fixture = runtimeFixture();
    fixture.manager.start.mockResolvedValueOnce({
      runtimeId: "wrong-runtime",
      containerId: "container-01",
      imageAlias: "stable",
      imageVersion: "0.151.0",
      status: "running",
      endpoint: {
        runtimeId: "wrong-runtime",
        websocketUrl: "ws://runtime-01:4500",
        serviceToken: "runtime-token",
      },
    });

    await expect(fixture.service.start(7)).rejects.toEqual(
      expect.objectContaining({ code: "runtime_manager_invalid_response" }),
    );

    expect(fixture.store.getByUserId(7)).toMatchObject({
      status: "degraded",
      lastError: "runtime_manager_invalid_response",
    });
    expect(fixture.audit.at(-1)).toMatchObject({
      action: "runtime.start",
      outcome: "failure",
      errorCode: "runtime_manager_invalid_response",
      userId: 7,
    });
  });
});

function runtimeFixture(options: { runtimeVersion?: string } = {}) {
  const endpoint: ManagedRuntimeEndpoint = {
    runtimeId: "placeholder",
    websocketUrl: "ws://runtime-01:4500",
    serviceToken: "runtime-token",
  };
  const records = new Map<number, UserAgentRuntimeRecord>();
  const statuses: RuntimeStatus[] = [];
  const store = {
    getByUserId: (userId: number) => records.get(userId) ?? null,
    list: () => [...records.values()].sort((left, right) => left.userId - right.userId),
    upsert: (record: UserAgentRuntimeRecord) => {
      const copy = structuredClone(record);
      records.set(copy.userId, copy);
      statuses.push(copy.status);
      return copy;
    },
    deleteForUser: (userId: number) => records.delete(userId),
  };
  const manager = {
    provision: vi.fn(async (request: { runtimeId: string }) => ({
      runtimeId: request.runtimeId,
      containerId: "container-01",
      imageAlias: "stable",
      imageVersion: "0.151.0",
      status: "stopped" as const,
      endpoint: { ...endpoint, runtimeId: request.runtimeId },
    })),
    start: vi.fn(async (runtimeId: string) => ({
      runtimeId,
      containerId: "container-01",
      imageAlias: "stable",
      imageVersion: "0.151.0",
      status: "running" as const,
      endpoint: { ...endpoint, runtimeId },
    })),
    inspect: vi.fn(async (runtimeId: string) => ({
      runtimeId,
      containerId: "container-01",
      imageAlias: "stable",
      imageVersion: "0.151.0",
      status: "running" as const,
      endpoint: { ...endpoint, runtimeId },
    })),
    stop: vi.fn(async (runtimeId: string) => ({
      runtimeId,
      containerId: "container-01",
      imageAlias: "stable",
      imageVersion: "0.151.0",
      status: "stopped" as const,
      endpoint: { ...endpoint, runtimeId },
    })),
    restart: vi.fn(async (runtimeId: string) => ({
      runtimeId,
      containerId: "container-01",
      imageAlias: "stable",
      imageVersion: "0.151.0",
      status: "running" as const,
      endpoint: { ...endpoint, runtimeId },
    })),
    remove: vi.fn(async (runtimeId: string) => ({
      runtimeId,
      containerId: null,
      imageAlias: null,
      imageVersion: null,
      status: "absent" as const,
      endpoint: null,
    })),
  };
  const audit: AuditEventInput[] = [];
  const closeConnections = vi.fn();
  let tick = 0;
  const service = new ManagedRuntimeService({
    manager,
    store,
    audit: { record: (event: AuditEventInput) => audit.push(structuredClone(event)) },
    identitySecret: "identity-secret",
    imageAlias: "stable",
    expectedRuntimeVersion: "0.151.0",
    probe: vi.fn(async () => ({
      runtimeVersion: options.runtimeVersion ?? "0.151.0",
      schemaHash: "schema-v1",
      capabilities: { conversations: true },
    })),
    closeConnections,
    now: () => new Date(1_788_134_400_000 + tick++).toISOString(),
  });
  return { service, manager, store, audit, statuses, closeConnections };
}
