import { describe, expect, it, vi } from "vitest";
import type {
  ManagedRuntimeEndpoint,
  RuntimeStatus,
  UserAgentRuntimeRecord,
} from "@codex-gateway/agent-runtime-contracts";
import type { AuditEventInput } from "~~/shared/types/audit";
import type { CapabilitySyncReason, HostRecord, UserProviderModel } from "~~/shared/types";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import type { ProvisionRuntimeRequest, SyncRuntimeSecretsRequest } from "./client";
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

  it("samples Agent container stats by user identity without requiring a store record", async () => {
    const fixture = runtimeFixture();

    const sampled = await fixture.service.sampleAgentStats(7);

    expect(sampled.status).toBe("running");
    expect(sampled.stats?.memoryLimitBytes).toBe(256);
    expect(sampled).not.toHaveProperty("containerId");
    expect(JSON.stringify(sampled)).not.toContain("container-01");
    expect(fixture.manager.stats).toHaveBeenCalledOnce();
    expect(fixture.manager.stats.mock.calls[0]?.[0]).toMatch(/^codex_[a-f0-9]{32}$/);
  });

  it("executes a command in the user's Agent container by identity", async () => {
    const fixture = runtimeFixture();

    const result = await fixture.service.execAgentCommand(7, "git --version", {
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
    });

    expect(result).toEqual({ code: 0, stdout: "ok\n", stderr: "" });
    expect(fixture.manager.exec).toHaveBeenCalledOnce();
    expect(fixture.manager.exec.mock.calls[0]?.[0]).toMatchObject({
      command: "git --version",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
    });
    expect(fixture.manager.exec.mock.calls[0]?.[0]?.runtimeId).toMatch(/^codex_[a-f0-9]{32}$/);
  });

  it("persists and audits a compatibility failure using only a safe error code", async () => {
    const fixture = runtimeFixture({ runtimeVersion: "0.150.0" });

    await expect(fixture.service.start(7)).rejects.toEqual(
      expect.objectContaining<Partial<ManagedRuntimeServiceError>>({
        code: "runtime_version_incompatible",
      }),
    );

    expect(await fixture.store.getByUserId(7)).toMatchObject({
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

  it("retries compatibility probing while a newly started app-server becomes ready", async () => {
    const fixture = runtimeFixture({
      probeFailures: 2,
      probeRetryOptions: { retries: 2, minTimeout: 0, maxTimeout: 0, factor: 1 },
    });

    await expect(fixture.service.start(7)).resolves.toMatchObject({
      status: "ready",
      runtimeVersion: "0.151.0",
    });

    expect(fixture.probe).toHaveBeenCalledTimes(3);
    expect(fixture.audit.some((event) => event.outcome === "failure")).toBe(false);
  });

  it("waits for capability reconciliation before start and restart become ready", async () => {
    const syncCapabilities = vi.fn(
      async (
        _host: HostRecord,
        _input: { userId: number; projectId: null; reason: CapabilitySyncReason },
      ) => ({ status: "succeeded" as const }),
    );
    const fixture = runtimeFixture({ syncCapabilities });

    await expect(fixture.service.start(7)).resolves.toMatchObject({ status: "ready" });
    await expect(fixture.service.restart(7, 1)).resolves.toMatchObject({ status: "ready" });

    expect(syncCapabilities.mock.calls.map(([, input]) => input)).toEqual([
      { userId: 7, projectId: null, reason: "runtimeStart" },
      { userId: 7, projectId: null, reason: "runtimeRestart" },
    ]);
    expect(fixture.statuses.filter((status) => status === "syncing_capabilities")).toHaveLength(2);
  });

  it("keeps a runtime degraded when mandatory capability reconciliation fails", async () => {
    const fixture = runtimeFixture({
      syncCapabilities: async () => ({ status: "failed" as const }),
    });

    await expect(fixture.service.start(7)).rejects.toMatchObject({
      code: "capability_sync_failed",
    });
    expect(await fixture.store.getByUserId(7)).toMatchObject({
      status: "degraded",
      lastError: "capability_sync_failed",
    });
    expect(fixture.audit.at(-1)).toMatchObject({
      action: "runtime.capabilities",
      outcome: "failure",
      errorCode: "capability_sync_failed",
    });
  });

  it("passes scoped runtime secrets only in the authenticated provision request", async () => {
    const exactSecret = "gateway-scoped-runtime-secret";
    const runtimeSecretsFor = vi.fn(async () => [
      {
        credentialId: "cred__business",
        capabilityId: "org__business",
        version: 1,
        target: { type: "env" as const, name: "BUSINESS_TOKEN" },
        value: exactSecret,
      },
    ]);
    const fixture = runtimeFixture({ runtimeSecretsFor });

    await fixture.service.start(7);

    expect(runtimeSecretsFor).toHaveBeenCalledWith(7, null);
    expect(fixture.manager.provision.mock.calls[0]?.[0].runtimeSecrets).toEqual([
      expect.objectContaining({ value: exactSecret }),
    ]);
    expect(JSON.stringify(fixture.audit)).not.toContain(exactSecret);
  });

  it("syncs rotated credentials for one user and project then reconciles capabilities", async () => {
    const exactSecret = "rotated-gateway-secret";
    const runtimeSecretsFor = vi.fn(async () => [
      {
        credentialId: "cred__business",
        capabilityId: "org__business",
        version: 2,
        target: { type: "env" as const, name: "BUSINESS_TOKEN" },
        value: exactSecret,
      },
    ]);
    const syncCapabilities = vi.fn(
      async (
        _host: HostRecord,
        _input: { userId: number; projectId: number | null; reason: CapabilitySyncReason },
      ) => ({ status: "succeeded" as const }),
    );
    const fixture = runtimeFixture({ runtimeSecretsFor, syncCapabilities });
    await fixture.service.start(7);
    fixture.manager.syncSecrets.mockClear();
    syncCapabilities.mockClear();
    fixture.closeConnections.mockClear();

    await expect(fixture.service.syncSecrets(7, 10, 1)).resolves.toMatchObject({
      status: "ready",
    });

    expect(runtimeSecretsFor).toHaveBeenLastCalledWith(7, 10);
    const syncRequest = fixture.manager.syncSecrets.mock.calls[0]?.[0];
    expect(syncRequest?.runtimeId).toMatch(/^codex_/);
    expect(syncRequest?.runtimeSecrets).toEqual([expect.objectContaining({ value: exactSecret })]);
    expect(fixture.closeConnections).toHaveBeenCalledWith(7);
    expect(syncCapabilities.mock.calls.at(-1)?.[1]).toEqual({
      userId: 7,
      projectId: 10,
      reason: "credentialRotated",
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
    expect(await fixture.store.getByUserId(7)).toBeNull();
  });

  it("reprovisions a managed container on restart so current runtime configuration is applied", async () => {
    const fixture = runtimeFixture();
    await fixture.service.start(7);
    fixture.manager.remove.mockClear();
    fixture.manager.provision.mockClear();
    fixture.manager.start.mockClear();
    fixture.manager.restart.mockClear();

    await expect(fixture.service.restart(7, 1)).resolves.toMatchObject({ status: "ready" });

    expect(fixture.manager.remove).toHaveBeenCalledOnce();
    expect(fixture.manager.remove.mock.calls[0]?.[0]).toMatch(/^codex_[a-f0-9]{32}$/);
    expect(fixture.manager.provision).toHaveBeenCalledOnce();
    const provisionRequest = fixture.manager.provision.mock.calls[0]?.[0];
    expect(provisionRequest).toMatchObject({
      imageAlias: "stable",
      runtimeType: "codex-app-server",
    });
    expect(provisionRequest?.userHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.manager.start).toHaveBeenCalledOnce();
    expect(fixture.manager.restart).not.toHaveBeenCalled();
  });

  it("records a safe provision failure without persisting an exception message", async () => {
    const fixture = runtimeFixture();
    fixture.manager.provision.mockRejectedValueOnce(
      Object.assign(new Error("secret-token ws://sensitive:4500"), {
        code: "runtime_identity_conflict",
      }),
    );

    await expect(fixture.service.start(7)).rejects.toBeTruthy();

    expect(await fixture.store.getByUserId(7)).toMatchObject({
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

    expect(await fixture.store.getByUserId(7)).toMatchObject({
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

  it("persists a failed stop as degraded and audits the updated safe record", async () => {
    const fixture = runtimeFixture();
    await fixture.service.start(7);
    fixture.audit.splice(0);
    fixture.manager.stop.mockRejectedValueOnce(
      new Error("secret-token ws://sensitive-runtime:4500"),
    );

    await expect(fixture.service.stop(7)).rejects.toEqual(
      expect.objectContaining({ code: "runtime_operation_failed" }),
    );

    expect(await fixture.store.getByUserId(7)).toMatchObject({
      status: "degraded",
      lastError: "runtime_operation_failed",
    });
    expect(fixture.audit).toHaveLength(1);
    expect(fixture.audit[0]).toMatchObject({
      actorUserId: 7,
      userId: 7,
      action: "runtime.stop",
      outcome: "failure",
      errorCode: "runtime_operation_failed",
    });
    expect(fixture.audit[0]?.metadata).toMatchObject({
      userId: 7,
      runtimeStatus: "degraded",
    });
    expect(JSON.stringify(fixture.audit)).not.toContain("secret-token");
    expect(JSON.stringify(fixture.audit)).not.toContain("sensitive-runtime");
  });

  it("persists a failed removal as degraded and audits the updated safe record", async () => {
    const fixture = runtimeFixture();
    await fixture.service.start(7);
    fixture.audit.splice(0);
    fixture.manager.remove.mockRejectedValueOnce(
      new Error("secret-token ws://sensitive-runtime:4500"),
    );

    await expect(fixture.service.remove(7, 1)).rejects.toEqual(
      expect.objectContaining({ code: "runtime_operation_failed" }),
    );

    expect(await fixture.store.getByUserId(7)).toMatchObject({
      status: "degraded",
      lastError: "runtime_operation_failed",
    });
    expect(fixture.audit).toHaveLength(1);
    expect(fixture.audit[0]).toMatchObject({
      actorUserId: 1,
      userId: 7,
      action: "runtime.remove",
      outcome: "failure",
      errorCode: "runtime_operation_failed",
    });
    expect(fixture.audit[0]?.metadata).toMatchObject({
      userId: 7,
      runtimeStatus: "degraded",
    });
    expect(JSON.stringify(fixture.audit)).not.toContain("secret-token");
    expect(JSON.stringify(fixture.audit)).not.toContain("sensitive-runtime");
  });

  it("releases the per-user mutex after a timed-out lifecycle request", async () => {
    const fixture = runtimeFixture();
    fixture.manager.provision.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw Object.assign(new Error("manager request timed out"), {
        code: "runtime_manager_timeout",
      });
    });

    const timedOut = fixture.service.start(7);
    const queued = fixture.service.start(7);

    await expect(timedOut).rejects.toEqual(
      expect.objectContaining({ code: "runtime_manager_timeout" }),
    );
    await expect(queued).resolves.toMatchObject({ status: "ready", userId: 7 });
    expect(fixture.manager.provision).toHaveBeenCalledTimes(2);
    expect(fixture.manager.start).toHaveBeenCalledOnce();
  });

  it("awaits usernames when listing admin statuses without container identity", async () => {
    const fixture = runtimeFixture();
    await fixture.service.start(7);

    const statuses = await fixture.service.listStatuses();
    expect(statuses).toEqual([
      expect.objectContaining({
        userId: 7,
        username: "runtime-a",
        status: "ready",
      }),
    ]);
    expect(JSON.stringify(statuses)).not.toContain("container-01");
    expect(JSON.stringify(statuses)).not.toContain("runtime-token");
  });

  it("awaits a state write before sending the next lifecycle request", async () => {
    const fixture = runtimeFixture();
    const gate = deferred<void>();
    const upsert = fixture.store.upsert.getMockImplementation();
    fixture.store.upsert.mockImplementationOnce(async (record) => {
      await gate.promise;
      if (upsert === undefined) throw new Error("Missing store implementation");
      return await upsert(record);
    });

    const starting = fixture.service.start(7);
    await vi.waitFor(() => expect(fixture.store.upsert).toHaveBeenCalledOnce());
    expect(fixture.manager.provision).not.toHaveBeenCalled();

    gate.resolve();
    await expect(starting).resolves.toMatchObject({ status: "ready" });
    expect(fixture.manager.provision).toHaveBeenCalledOnce();
  });

  it("awaits the user's provider model before building the provision request", async () => {
    const models = deferred<UserProviderModel[]>();
    const fixture = runtimeFixture({
      listProviderModels: async () => await models.promise,
    });

    const starting = fixture.service.start(7);
    await vi.waitFor(() => expect(fixture.providerStore.listForUser).toHaveBeenCalledWith(7));
    expect(fixture.manager.provision).not.toHaveBeenCalled();

    models.resolve([providerModel()]);
    await expect(starting).resolves.toMatchObject({ status: "ready" });
    expect(fixture.manager.provision.mock.calls[0]?.[0].providerConfig).toMatchObject({
      providerId: "provider-1",
      modelId: "model-1",
      wireApi: "responses",
    });
  });

  it("preserves the operational error when recording its audit event fails", async () => {
    const fixture = runtimeFixture();
    fixture.manager.provision.mockRejectedValueOnce(
      Object.assign(new Error("manager failure"), { code: "runtime_identity_conflict" }),
    );
    fixture.auditRecord.mockRejectedValueOnce(new Error("database secret must stay private"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(fixture.service.start(7)).rejects.toMatchObject({
        code: "runtime_identity_conflict",
      });
      expect(logged).toHaveBeenCalledOnce();
      expect(JSON.stringify(logged.mock.calls)).not.toContain("database secret");
    } finally {
      logged.mockRestore();
    }
  });
});

function runtimeFixture(
  options: {
    runtimeVersion?: string;
    probeFailures?: number;
    probeRetryOptions?: {
      retries: number;
      minTimeout: number;
      maxTimeout: number;
      factor: number;
    };
    listProviderModels?: (userId: number) => Promise<UserProviderModel[]>;
    syncCapabilities?: ConstructorParameters<typeof ManagedRuntimeService>[0]["syncCapabilities"];
    runtimeSecretsFor?: ConstructorParameters<typeof ManagedRuntimeService>[0]["runtimeSecretsFor"];
  } = {},
) {
  const endpoint: ManagedRuntimeEndpoint = {
    runtimeId: "placeholder",
    websocketUrl: "ws://runtime-01:4500",
    serviceToken: "runtime-token",
  };
  const records = new Map<number, UserAgentRuntimeRecord>();
  const statuses: RuntimeStatus[] = [];
  const store = {
    getByUserId: vi.fn(async (userId: number) => records.get(userId) ?? null),
    list: vi.fn(async () =>
      [...records.values()].sort((left, right) => left.userId - right.userId),
    ),
    upsert: vi.fn(async (record: UserAgentRuntimeRecord) => {
      const copy = structuredClone(record);
      records.set(copy.userId, copy);
      statuses.push(copy.status);
      return copy;
    }),
    deleteForUser: vi.fn(async (userId: number) => records.delete(userId)),
  };
  const manager = {
    provision: vi.fn(async (request: ProvisionRuntimeRequest) => ({
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
    stats: vi.fn(async (runtimeId: string) => ({
      runtimeId,
      status: "running" as const,
      stats: {
        sampledAtMs: 1_788_134_400_000,
        cpuUsage: 20,
        systemCpuUsage: 100,
        preCpuUsage: 10,
        preSystemCpuUsage: 80,
        onlineCpus: 2,
        memoryUsageBytes: 128,
        memoryLimitBytes: 256,
        rxBytes: 8,
        txBytes: 4,
        diskReadBytes: 0,
        diskWriteBytes: 0,
        interfaces: ["eth0"],
        cpuQuotaCpus: 2,
      },
    })),
    exec: vi.fn(
      async (_input: {
        runtimeId: string;
        command: string;
        timeoutMs: number;
        maxOutputBytes: number;
      }) => ({ code: 0, stdout: "ok\n", stderr: "" }),
    ),
    restart: vi.fn(async (runtimeId: string) => ({
      runtimeId,
      containerId: "container-01",
      imageAlias: "stable",
      imageVersion: "0.151.0",
      status: "running" as const,
      endpoint: { ...endpoint, runtimeId },
    })),
    syncSecrets: vi.fn(async (input: SyncRuntimeSecretsRequest) => ({
      runtimeId: input.runtimeId,
      containerId: "container-01",
      imageAlias: "stable",
      imageVersion: "0.151.0",
      status: "running" as const,
      endpoint: { ...endpoint, runtimeId: input.runtimeId },
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
  const auditRecord = vi.fn(async (event: AuditEventInput) => {
    audit.push(structuredClone(event));
  });
  const providerStore = {
    listForUser: vi.fn(options.listProviderModels ?? (async () => [])),
  };
  const closeConnections = vi.fn();
  let probeFailures = options.probeFailures ?? 0;
  const probe = vi.fn(async () => {
    if (probeFailures > 0) {
      probeFailures -= 1;
      throw new Error("app-server is still starting");
    }
    return {
      runtimeVersion: options.runtimeVersion ?? "0.151.0",
      schemaHash: "schema-v1",
      capabilities: { conversations: true },
    };
  });
  let tick = 0;
  const service = new ManagedRuntimeService({
    manager,
    store,
    audit: { record: auditRecord },
    providerStore,
    identitySecret: "identity-secret",
    imageAlias: "stable",
    expectedRuntimeVersion: "0.151.0",
    probe,
    probeRetryOptions: options.probeRetryOptions,
    closeConnections,
    syncCapabilities: options.syncCapabilities,
    runtimeSecretsFor: options.runtimeSecretsFor,
    now: () => new Date(1_788_134_400_000 + tick++).toISOString(),
    usernameFor: async (userId) => (userId === 7 ? "runtime-a" : null),
  });
  return {
    service,
    manager,
    store,
    audit,
    auditRecord,
    providerStore,
    statuses,
    closeConnections,
    probe,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function providerModel(): UserProviderModel {
  return {
    providerId: "provider-1",
    modelId: "model-1",
    displayName: "Model 1",
    enabled: true,
    capabilities: {
      tools: false,
      streamingTools: false,
      vision: false,
      reasoning: true,
      maxContextTokens: null,
    },
    provider: {
      id: "provider-1",
      name: "Provider",
      baseUrl: "https://provider.test/v1",
      wireApi: "responses",
      enabled: true,
      hasApiKey: true,
      requestTimeoutMs: 30_000,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
