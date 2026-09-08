import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRequestSignature,
  createSignedHeaders,
  HmacRequestAuthenticator,
  type NonceStore,
  RuntimeAuthenticationError,
} from "./auth.js";
import type {
  DockerContainerCreateSpec,
  DockerEngine,
  EngineContainerState,
} from "./docker-engine.js";
import {
  createRuntimeManagerRequestHandler,
  loadRuntimeManagerPolicy,
  loadRuntimeNodeStatusConfig,
} from "./http-server.js";
import {
  RuntimeLifecycleError,
  RuntimeLifecycleService,
  type RuntimeManagerPolicy,
} from "./lifecycle-service.js";

const userHash = "ab".repeat(32);
const now = 1_788_115_200_000;
const requestedResources = {
  memoryBytes: 1024 * 1024 * 1024,
  nanoCpus: 1_500_000_000,
  pidsLimit: 128,
};
const testPolicy: RuntimeManagerPolicy = {
  images: {
    stable: {
      image: "registry.internal/codex-agent@sha256:stable",
      imageVersion: "1.2.3",
    },
    next: {
      image: "registry.internal/codex-agent@sha256:next",
      imageVersion: "1.3.0",
    },
  },
  internalPort: 4_555,
  networkNames: ["agent-runtime", "agent-egress"],
  oauthCallbackUrl: "https://gateway.example.test/api/capabilities/mcp/oauth/callback",
};

function requestFor(runtimeId: string) {
  return {
    imageAlias: "stable",
    runtimeId,
    runtimeType: "codex-app-server" as const,
    userHash,
    nodeId: "node__default",
    placementGeneration: 1,
    workspaceKey: "ws__1234567890abcdef1234567890abcdef",
  };
}

function actionFor(runtimeId: string, placementGeneration = 1) {
  return { runtimeId, nodeId: "node__default", placementGeneration };
}

function lookupFor(runtimeId: string, placementGeneration = 1) {
  return { runtimeId, placementGeneration };
}

function resourceActionFor(
  runtimeId: string,
  resources: typeof requestedResources,
  placementGeneration = 1,
) {
  return { ...actionFor(runtimeId, placementGeneration), resources };
}

class MemoryNonceStore implements NonceStore {
  private readonly nonces = new Map<string, number>();

  claim(nonce: string, expiresAt: number, currentTime: number): boolean {
    for (const [storedNonce, storedExpiry] of this.nonces) {
      if (storedExpiry < currentTime) this.nonces.delete(storedNonce);
    }
    if (this.nonces.has(nonce)) return false;
    this.nonces.set(nonce, expiresAt);
    return true;
  }
}

class RecordingDockerEngine implements DockerEngine {
  readonly createCalls: DockerContainerCreateSpec[] = [];
  readonly operationCalls: string[] = [];
  readonly removeCalls: string[] = [];
  readonly restartCalls: string[] = [];
  readonly startCalls: string[] = [];
  readonly stopCalls: string[] = [];
  readonly secretCalls: Array<{
    containerId: string;
    secrets: Array<{
      credentialId: string;
      capabilityId: string;
      version: number;
      target: { type: "env"; name: string } | { type: "file"; path: string };
      value: string;
    }>;
  }> = [];
  readonly oauthCallbackCalls: Array<{ containerId: string; pathAndQuery: string }> = [];
  readonly updateCalls: Array<{
    containerId: string;
    Memory: number;
    NanoCpus: number;
    PidsLimit: number;
  }> = [];
  private readonly containers = new Map<string, EngineContainerState>();
  updateError: Error | null = null;
  statsPayload: unknown = null;
  execResult: { code: number | null; stdout: string; stderr: string } = {
    code: 0,
    stdout: "",
    stderr: "",
  };
  readonly execCalls: Array<{
    containerId: string;
    command: string;
    timeoutMs: number;
    maxOutputBytes: number;
  }> = [];
  nodeInspection = {
    dockerAvailable: true,
    dataRootWritable: true,
    availableDiskBytes: 100 * 1024 * 1024 * 1024,
    totalDiskBytes: 200 * 1024 * 1024 * 1024,
    managedRuntimeCount: 2,
    runningRuntimeCount: 1,
  };
  inspectedDataRoot: string | null = null;

  constructor(options: { existingContainerId?: string; existingRunning?: boolean } = {}) {
    if (options.existingContainerId !== undefined) {
      this.containers.set("runtime-a", {
        containerId: options.existingContainerId,
        containerName: "codex-runtime-existing",
        imageAlias: "stable",
        imageVersion: "1.2.3",
        internalPort: testPolicy.internalPort,
        running: options.existingRunning ?? false,
        runtimeId: "runtime-a",
        runtimeType: "codex-app-server",
        serviceToken: "existing-service-token",
        userHash,
        nodeId: "node__default",
        placementGeneration: 1,
        workspaceKey: "ws__1234567890abcdef1234567890abcdef",
        memoryBytes: 2 * 1024 * 1024 * 1024,
        nanoCpus: 0,
        pidsLimit: 256,
      });
    }
  }

  async createManagedContainer(spec: DockerContainerCreateSpec): Promise<EngineContainerState> {
    this.createCalls.push(spec);
    const state: EngineContainerState = {
      containerId: `container-${this.createCalls.length}`,
      containerName: spec.containerName,
      imageAlias: spec.imageAlias,
      imageVersion: spec.imageVersion,
      internalPort: spec.internalPort,
      running: false,
      runtimeId: spec.runtimeId,
      runtimeType: spec.runtimeType,
      serviceToken: spec.serviceToken,
      userHash: spec.userHash,
      nodeId: spec.nodeId,
      placementGeneration: spec.placementGeneration,
      workspaceKey: spec.workspaceKey,
      memoryBytes: spec.security.Memory,
      nanoCpus: spec.security.NanoCpus,
      pidsLimit: spec.security.PidsLimit,
    };
    this.containers.set(spec.runtimeId, state);
    return state;
  }

  async inspectNode(dataRoot: string) {
    this.inspectedDataRoot = dataRoot;
    return this.nodeInspection;
  }

  async findManagedContainer(runtimeId: string): Promise<EngineContainerState | null> {
    return this.containers.get(runtimeId) ?? null;
  }

  async removeContainer(containerId: string): Promise<void> {
    this.removeCalls.push(containerId);
    for (const [runtimeId, container] of this.containers) {
      if (container.containerId === containerId) this.containers.delete(runtimeId);
    }
  }

  async restartContainer(containerId: string): Promise<void> {
    this.operationCalls.push("restart");
    this.restartCalls.push(containerId);
    this.setRunning(containerId, true);
  }

  async startContainer(containerId: string): Promise<void> {
    this.operationCalls.push("start");
    this.startCalls.push(containerId);
    this.setRunning(containerId, true);
  }

  async stopContainer(containerId: string): Promise<void> {
    this.operationCalls.push("stop");
    this.stopCalls.push(containerId);
    this.setRunning(containerId, false);
  }

  async writeRuntimeSecrets(
    containerId: string,
    secrets: RecordingDockerEngine["secretCalls"][number]["secrets"],
  ): Promise<void> {
    this.secretCalls.push({ containerId, secrets });
  }

  async forwardOAuthCallback(containerId: string, pathAndQuery: string): Promise<void> {
    this.oauthCallbackCalls.push({ containerId, pathAndQuery });
  }

  async sampleContainerStats(containerId: string): Promise<unknown> {
    for (const container of this.containers.values()) {
      if (container.containerId === containerId) {
        if (!container.running) throw new Error("container is not running");
        return this.statsPayload;
      }
    }
    throw new Error("container not found");
  }

  async execInContainer(
    containerId: string,
    command: string,
    options: { timeoutMs: number; maxOutputBytes: number },
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    this.execCalls.push({ containerId, command, ...options });
    for (const container of this.containers.values()) {
      if (container.containerId === containerId) {
        if (!container.running) throw new Error("container is not running");
        return this.execResult;
      }
    }
    throw new Error("container not found");
  }

  async updateContainerResources(
    containerId: string,
    resources: { Memory: number; NanoCpus: number; PidsLimit: number },
  ): Promise<EngineContainerState> {
    this.operationCalls.push("update");
    this.updateCalls.push({ containerId, ...resources });
    if (this.updateError !== null) throw this.updateError;
    for (const [runtimeId, container] of this.containers) {
      if (container.containerId === containerId) {
        const updated = {
          ...container,
          memoryBytes: resources.Memory,
          nanoCpus: resources.NanoCpus,
          pidsLimit: resources.PidsLimit,
        };
        this.containers.set(runtimeId, updated);
        return updated;
      }
    }
    throw new Error("container not found");
  }

  private setRunning(containerId: string, running: boolean): void {
    for (const [runtimeId, container] of this.containers) {
      if (container.containerId === containerId) {
        this.containers.set(runtimeId, { ...container, running });
      }
    }
  }
}

describe("RuntimeLifecycleService", () => {
  it("stops a running container, updates resources, then starts and freshly inspects it", async () => {
    const engine = new RecordingDockerEngine({
      existingContainerId: "container-a",
      existingRunning: true,
    });
    const service = new RuntimeLifecycleService(engine, testPolicy);

    await expect(
      service.start(resourceActionFor("runtime-a", requestedResources)),
    ).resolves.toMatchObject({ status: "running", actualResources: requestedResources });

    expect(engine.operationCalls).toEqual(["stop", "update", "start"]);
    expect(engine.restartCalls).toEqual([]);
    expect(engine.removeCalls).toEqual([]);
    expect(engine.createCalls).toEqual([]);
  });

  it("updates a stopped container before starting it", async () => {
    const engine = new RecordingDockerEngine({ existingContainerId: "container-a" });
    const service = new RuntimeLifecycleService(engine, testPolicy);

    await expect(
      service.start(resourceActionFor("runtime-a", requestedResources)),
    ).resolves.toMatchObject({ status: "running", actualResources: requestedResources });

    expect(engine.operationCalls).toEqual(["update", "start"]);
  });

  it("restarts without recreating by stopping, updating, and starting the same container", async () => {
    const engine = new RecordingDockerEngine({
      existingContainerId: "container-a",
      existingRunning: true,
    });
    const service = new RuntimeLifecycleService(engine, testPolicy);

    await expect(
      service.restart(resourceActionFor("runtime-a", requestedResources)),
    ).resolves.toMatchObject({
      containerId: "container-a",
      status: "running",
      actualResources: requestedResources,
    });

    expect(engine.operationCalls).toEqual(["stop", "update", "start"]);
    expect(engine.restartCalls).toEqual([]);
    expect(engine.removeCalls).toEqual([]);
    expect(engine.createCalls).toEqual([]);
  });

  it("leaves a running container stopped when a start resource update fails", async () => {
    const engine = new RecordingDockerEngine({
      existingContainerId: "container-a",
      existingRunning: true,
    });
    engine.updateError = new Error("resource update failed");
    const service = new RuntimeLifecycleService(engine, testPolicy);

    await expect(service.start(resourceActionFor("runtime-a", requestedResources))).rejects.toThrow(
      "resource update failed",
    );

    expect(engine.operationCalls).toEqual(["stop", "update"]);
    expect(engine.startCalls).toEqual([]);
    await expect(service.inspect(lookupFor("runtime-a"))).resolves.toMatchObject({
      status: "stopped",
    });
  });

  it("leaves a stopped container stopped when a restart resource update fails", async () => {
    const engine = new RecordingDockerEngine({ existingContainerId: "container-a" });
    engine.updateError = new Error("resource update failed");
    const service = new RuntimeLifecycleService(engine, testPolicy);

    await expect(
      service.restart(resourceActionFor("runtime-a", requestedResources)),
    ).rejects.toThrow("resource update failed");

    expect(engine.operationCalls).toEqual(["update"]);
    expect(engine.startCalls).toEqual([]);
    expect(engine.restartCalls).toEqual([]);
    await expect(service.inspect(lookupFor("runtime-a"))).resolves.toMatchObject({
      status: "stopped",
    });
  });

  it("applies requested runtime resources and reports the inspected values", async () => {
    const engine = new RecordingDockerEngine({ existingContainerId: "container-a" });
    const service = new RuntimeLifecycleService(engine, testPolicy);

    await expect(
      service.provision({ ...requestFor("runtime-requested"), resources: requestedResources }),
    ).resolves.toMatchObject({ actualResources: requestedResources });
    await expect(
      service.start(resourceActionFor("runtime-a", requestedResources)),
    ).resolves.toMatchObject({ actualResources: requestedResources });
    await expect(
      service.restart(resourceActionFor("runtime-a", requestedResources)),
    ).resolves.toMatchObject({ actualResources: requestedResources });

    expect(engine.createCalls[0]?.security).toMatchObject({
      Memory: requestedResources.memoryBytes,
      NanoCpus: requestedResources.nanoCpus,
      PidsLimit: requestedResources.pidsLimit,
    });
    expect(engine.updateCalls).toEqual([
      {
        containerId: "container-a",
        Memory: requestedResources.memoryBytes,
        NanoCpus: requestedResources.nanoCpus,
        PidsLimit: requestedResources.pidsLimit,
      },
      {
        containerId: "container-a",
        Memory: requestedResources.memoryBytes,
        NanoCpus: requestedResources.nanoCpus,
        PidsLimit: requestedResources.pidsLimit,
      },
    ]);
  });

  it("rejects requested resources above the deployment ceiling", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, {
      ...testPolicy,
      agentMemoryBytes: 1024 * 1024 * 1024,
    });

    await expect(
      service.provision({
        ...requestFor("runtime-too-large"),
        resources: { ...requestedResources, memoryBytes: 2 * 1024 * 1024 * 1024 },
      }),
    ).rejects.toMatchObject({ code: "runtime_policy_exceeds_platform_limit" });
    expect(engine.createCalls).toHaveLength(0);
  });

  it("rejects over-limit start and restart requests before changing container state", async () => {
    const engine = new RecordingDockerEngine({ existingContainerId: "container-a" });
    const service = new RuntimeLifecycleService(engine, {
      ...testPolicy,
      agentMemoryBytes: 1024 * 1024 * 1024,
    });
    const overLimitResources = {
      ...requestedResources,
      memoryBytes: 2 * 1024 * 1024 * 1024,
    };

    await expect(
      service.start(resourceActionFor("runtime-a", overLimitResources)),
    ).rejects.toMatchObject({ code: "runtime_policy_exceeds_platform_limit" });
    await expect(
      service.restart(resourceActionFor("runtime-a", overLimitResources)),
    ).rejects.toMatchObject({ code: "runtime_policy_exceeds_platform_limit" });
    expect(engine.startCalls).toEqual([]);
    expect(engine.restartCalls).toEqual([]);
    expect(engine.updateCalls).toEqual([]);
  });

  it("uses deployment resource defaults when a request omits resources", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, testPolicy);

    await expect(service.provision(requestFor("runtime-defaults"))).resolves.toMatchObject({
      actualResources: {
        memoryBytes: 8 * 1024 * 1024 * 1024,
        nanoCpus: 4_000_000_000,
        pidsLimit: 1024,
      },
    });
    expect(engine.createCalls[0]?.security).toMatchObject({
      Memory: 8 * 1024 * 1024 * 1024,
      NanoCpus: 4_000_000_000,
      PidsLimit: 1024,
    });
  });

  it("executes a command in a running managed container", async () => {
    const engine = new RecordingDockerEngine();
    engine.execResult = { code: 0, stdout: "git version 2.45.0\n", stderr: "" };
    const service = new RuntimeLifecycleService(engine, testPolicy);
    await service.provision(requestFor("runtime-git"));
    await service.start(actionFor("runtime-git"));

    await expect(
      service.exec({
        ...actionFor("runtime-git"),
        command: "git --version",
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      }),
    ).resolves.toEqual({ code: 0, stdout: "git version 2.45.0\n", stderr: "" });
    expect(engine.execCalls).toEqual([
      {
        containerId: "container-1",
        command: "git --version",
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      },
    ]);
  });

  it("does not exec into a stopped managed container", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, testPolicy);
    await service.provision(requestFor("runtime-git"));

    await expect(
      service.exec({
        ...actionFor("runtime-git"),
        command: "git --version",
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow("Agent runtime is not running");
  });

  it("uses the fixed 4500 endpoint when production environment attempts to override it", async () => {
    const policy = loadRuntimeManagerPolicy({
      RUNTIME_MANAGER_AGENT_NETWORK: "agent-runtime",
      RUNTIME_MANAGER_AGENT_EGRESS_NETWORK: "agent-egress",
      RUNTIME_MANAGER_AGENT_PORT: "1234",
      RUNTIME_MANAGER_IMAGE_ALIASES: JSON.stringify(testPolicy.images),
      RUNTIME_MANAGER_RESOURCE_LABELS: JSON.stringify({
        "com.codex-gateway.e2e-managed": "isolated-test-run",
      }),
    });
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, policy, {
      randomToken: () => "generated-service-token",
    });

    const result = await service.provision(requestFor("runtime-fixed-port"));

    expect(policy.internalPort).toBe(4500);
    expect(policy.agentMemoryBytes).toBe(8_589_934_592);
    expect(policy.agentNanoCpus).toBe(4_000_000_000);
    expect(policy.agentPidsLimit).toBe(1_024);
    expect(policy.networkNames).toEqual(["agent-runtime", "agent-egress"]);
    expect(policy.resourceLabels).toEqual({
      "com.codex-gateway.e2e-managed": "isolated-test-run",
    });
    expect(engine.createCalls[0]?.internalPort).toBe(4500);
    expect(result.endpoint?.websocketUrl).toMatch(/^ws:\/\/codex-runtime-[a-f0-9-]+:4500$/);
  });

  it("reuses the existing labeled container for the same runtime id", async () => {
    const engine = new RecordingDockerEngine({ existingContainerId: "container-a" });
    const service = new RuntimeLifecycleService(engine, testPolicy);

    const first = await service.provision(requestFor("runtime-a"));
    const second = await service.provision(requestFor("runtime-a"));

    expect(first.containerId).toBe("container-a");
    expect(second.containerId).toBe("container-a");
    expect(engine.createCalls).toHaveLength(0);
  });

  it("returns container stats without leaking the container id", async () => {
    const engine = new RecordingDockerEngine({ existingContainerId: "secret-container" });
    engine.statsPayload = {
      read: "2026-09-02T07:00:00.000Z",
      cpu_stats: {
        cpu_usage: { total_usage: 20 },
        system_cpu_usage: 100,
        online_cpus: 2,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 10 },
        system_cpu_usage: 80,
      },
      memory_stats: { usage: 128, limit: 256, stats: {} },
      networks: { eth0: { rx_bytes: 8, tx_bytes: 4 } },
    };
    await engine.startContainer("secret-container");
    const service = new RuntimeLifecycleService(engine, testPolicy);

    const running = await service.stats(lookupFor("runtime-a"));
    const stopped = await service
      .stop(actionFor("runtime-a"))
      .then(() => service.stats(lookupFor("runtime-a")));
    const absent = await service.stats(lookupFor("missing"));

    expect(running).toEqual({
      runtimeId: "runtime-a",
      status: "running",
      stats: {
        sampledAtMs: Date.parse("2026-09-02T07:00:00.000Z"),
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
    });
    expect(JSON.stringify(running)).not.toContain("secret-container");
    expect(stopped).toEqual({ runtimeId: "runtime-a", status: "stopped", stats: null });
    expect(absent).toEqual({ runtimeId: "missing", status: "absent", stats: null });
  });

  it("builds the fixed security, network, volume, and label policy internally", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, testPolicy, {
      randomToken: () => "generated-service-token",
    });

    const result = await service.provision(requestFor("runtime-new"));

    expect(result.status).toBe("stopped");
    expect(result.endpoint?.websocketUrl).toMatch(/^ws:\/\/codex-runtime-[a-f0-9-]+:4555$/);
    expect(engine.createCalls).toHaveLength(1);
    expect(engine.createCalls[0]).toMatchObject({
      image: "registry.internal/codex-agent@sha256:stable",
      imageAlias: "stable",
      imageVersion: "1.2.3",
      internalPort: 4_555,
      labels: {
        "com.codex-gateway.image-version": "1.2.3",
        "com.codex-gateway.managed": "true",
        "com.codex-gateway.runtime-id": "runtime-new",
        "com.codex-gateway.user-hash": userHash,
      },
      mounts: [
        expect.objectContaining({ containerPath: "/codex-home", kind: "codex-home" }),
        expect.objectContaining({ containerPath: "/workspace", kind: "workspace" }),
      ],
      networkNames: ["agent-runtime", "agent-egress"],
      runtimeId: "runtime-new",
      security: {
        CapDrop: ["ALL"],
        Memory: 8_589_934_592,
        NanoCpus: 4_000_000_000,
        PidsLimit: 1_024,
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ["no-new-privileges:true"],
        Tmpfs: {
          "/dev/shm": "rw,nosuid,nodev,noexec,size=1073741824",
          "/run/codex-secrets":
            "rw,nosuid,nodev,noexec,size=16777216,mode=0700,uid=10001,gid=10001",
          "/tmp": "rw,nosuid,nodev,size=2147483648",
        },
        User: "10001:10001",
      },
      serviceToken: "generated-service-token",
      userHash,
      oauthCallbackUrl: "https://gateway.example.test/api/capabilities/mcp/oauth/callback",
    });
  });

  it("injects runtime secrets only after container start and never in create metadata", async () => {
    const exactSecret = "runtime-secret-must-not-be-inspectable";
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, testPolicy, {
      randomToken: () => "generated-service-token",
    });

    await service.provision({
      ...requestFor("runtime-secret"),
      runtimeSecrets: [
        {
          credentialId: "cred__business",
          capabilityId: "org__business",
          version: 1,
          target: { type: "env", name: "BUSINESS_TOKEN" },
          value: exactSecret,
        },
      ],
    });
    expect(JSON.stringify(engine.createCalls)).not.toContain(exactSecret);
    expect(engine.secretCalls).toEqual([]);

    await service.start(actionFor("runtime-secret"));

    expect(engine.startCalls).toEqual(["container-1"]);
    expect(engine.secretCalls).toEqual([
      {
        containerId: "container-1",
        secrets: [
          expect.objectContaining({
            target: { type: "env", name: "BUSINESS_TOKEN" },
            value: exactSecret,
          }),
        ],
      },
    ]);
  });

  it("rejects unsafe runtime secret targets before creating a container", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, testPolicy);

    await expect(
      service.provision({
        ...requestFor("runtime-secret-invalid"),
        runtimeSecrets: [
          {
            credentialId: "cred__business",
            capabilityId: "org__business",
            version: 1,
            target: { type: "file", path: "/run/codex-secrets/nested/key" },
            value: "secret",
          },
        ],
      }),
    ).rejects.toThrow();
    expect(engine.createCalls).toEqual([]);
  });

  it("hot-syncs file secrets and restarts only when an environment secret changes", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, testPolicy);
    await service.provision(requestFor("runtime-rotation"));
    await service.start(actionFor("runtime-rotation"));
    engine.secretCalls.splice(0);

    await service.syncSecrets({
      ...actionFor("runtime-rotation"),
      runtimeSecrets: [
        {
          credentialId: "cred__file",
          capabilityId: "org__business",
          version: 2,
          target: { type: "file", path: "/run/codex-secrets/business-key" },
          value: "rotated-file",
        },
      ],
    });
    expect(engine.restartCalls).toEqual([]);
    expect(engine.secretCalls.at(-1)?.secrets[0]?.value).toBe("rotated-file");

    await service.syncSecrets({
      ...actionFor("runtime-rotation"),
      runtimeSecrets: [
        {
          credentialId: "cred__env",
          capabilityId: "org__business",
          version: 3,
          target: { type: "env", name: "BUSINESS_TOKEN" },
          value: "rotated-env",
        },
      ],
    });
    expect(engine.restartCalls).toEqual(["container-1"]);
    expect(engine.secretCalls.at(-1)?.secrets[0]?.value).toBe("rotated-env");
  });

  it("forwards an OAuth callback only to a running target container", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, testPolicy);
    await service.provision(requestFor("runtime-oauth"));

    await expect(
      service.forwardOAuthCallback({
        ...actionFor("runtime-oauth"),
        pathAndQuery: "/api/capabilities/mcp/oauth/callback?code=abc&state=state-value",
      }),
    ).rejects.toThrow("not running");
    await service.start(actionFor("runtime-oauth"));
    await service.forwardOAuthCallback({
      ...actionFor("runtime-oauth"),
      pathAndQuery: "/api/capabilities/mcp/oauth/callback?code=abc&state=state-value",
    });

    expect(engine.oauthCallbackCalls).toEqual([
      {
        containerId: "container-1",
        pathAndQuery: "/api/capabilities/mcp/oauth/callback?code=abc&state=state-value",
      },
    ]);
  });

  it("uses operator-configured agent CPU, memory, and PID limits", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(
      engine,
      {
        ...testPolicy,
        agentMemoryBytes: 4 * 1024 * 1024 * 1024,
        agentNanoCpus: 4_000_000_000,
        agentPidsLimit: 512,
      },
      { randomToken: () => "generated-service-token" },
    );

    await service.provision(requestFor("runtime-limits"));

    expect(engine.createCalls[0]?.security).toMatchObject({
      Memory: 4_294_967_296,
      NanoCpus: 4_000_000_000,
      PidsLimit: 512,
    });
  });

  it("loads agent resource limits from runtime-manager environment", () => {
    const policy = loadRuntimeManagerPolicy({
      RUNTIME_MANAGER_AGENT_NETWORK: "agent-runtime",
      RUNTIME_MANAGER_AGENT_EGRESS_NETWORK: "agent-egress",
      RUNTIME_MANAGER_IMAGE_ALIASES: JSON.stringify(testPolicy.images),
      RUNTIME_AGENT_MEMORY: "4g",
      RUNTIME_AGENT_CPUS: "1",
      RUNTIME_AGENT_PIDS: "128",
      RUNTIME_MANAGER_MCP_OAUTH_CALLBACK_URL:
        "https://gateway.example.test/api/capabilities/mcp/oauth/callback",
    });
    expect(policy.agentMemoryBytes).toBe(4_294_967_296);
    expect(policy.agentNanoCpus).toBe(1_000_000_000);
    expect(policy.agentPidsLimit).toBe(128);
    expect(policy.networkNames).toEqual(["agent-runtime", "agent-egress"]);
    expect(policy.oauthCallbackUrl).toBe(
      "https://gateway.example.test/api/capabilities/mcp/oauth/callback",
    );
  });

  it("requires a stable runtime node id and loads node health capacity", () => {
    expect(() => loadRuntimeNodeStatusConfig({})).toThrow(/RUNTIME_NODE_ID is required/);
    expect(
      loadRuntimeNodeStatusConfig({
        RUNTIME_NODE_ID: "node__a",
        RUNTIME_MANAGER_VERSION: "0.153.4",
        RUNTIME_NODE_DATA_ROOT: "/runtime-data",
        RUNTIME_NODE_CAPACITY_CPU_MILLIS: "24000",
        RUNTIME_NODE_CAPACITY_MEMORY_BYTES: String(96 * 1024 * 1024 * 1024),
        RUNTIME_NODE_MAX_RUNTIMES: "40",
      }),
    ).toEqual({
      nodeId: "node__a",
      managerVersion: "0.153.4",
      dataRoot: "/runtime-data",
      capacityCpuMillis: 24_000,
      capacityMemoryBytes: 96 * 1024 * 1024 * 1024,
      maxRuntimes: 40,
    });
  });

  it("rejects duplicate and Docker-reserved Agent networks", () => {
    const environment = {
      RUNTIME_MANAGER_AGENT_NETWORK: "agent-runtime",
      RUNTIME_MANAGER_AGENT_EGRESS_NETWORK: "agent-runtime",
      RUNTIME_MANAGER_IMAGE_ALIASES: JSON.stringify(testPolicy.images),
    };
    expect(() => loadRuntimeManagerPolicy(environment)).toThrow(/different networks/i);
    expect(() =>
      loadRuntimeManagerPolicy({
        ...environment,
        RUNTIME_MANAGER_AGENT_EGRESS_NETWORK: "host",
      }),
    ).toThrow(/reserved Docker network/i);
  });

  it("adds configured deployment labels to each managed container and volume", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(
      engine,
      {
        ...testPolicy,
        resourceLabels: {
          "com.codex-gateway.e2e-managed": "isolated-test-run",
        },
      },
      { randomToken: () => "generated-service-token" },
    );

    await service.provision(requestFor("runtime-e2e-label"));

    expect(engine.createCalls[0]?.labels).toMatchObject({
      "com.codex-gateway.e2e-managed": "isolated-test-run",
      "com.codex-gateway.managed": "true",
    });
    for (const mount of engine.createCalls[0]?.mounts ?? []) {
      expect(mount.labels).toMatchObject({
        "com.codex-gateway.runtime-node-id": "node__default",
        "com.codex-gateway.placement-generation": "1",
        "com.codex-gateway.workspace-key": "ws__1234567890abcdef1234567890abcdef",
      });
    }
    expect(engine.createCalls[0]?.mounts).toHaveLength(2);
    for (const mount of engine.createCalls[0]?.mounts ?? []) {
      expect(mount.labels).toMatchObject({
        "com.codex-gateway.e2e-managed": "isolated-test-run",
        "com.codex-gateway.managed": "true",
      });
    }
  });

  it("rejects an unknown image alias before calling the engine", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, testPolicy);

    await expect(
      service.provision({ ...requestFor("runtime-a"), imageAlias: "raw-registry-image" }),
    ).rejects.toMatchObject({ code: "unknown_image_alias" });
    expect(engine.createCalls).toHaveLength(0);
  });

  it("runs start and restart through the fixed resource-safe lifecycle", async () => {
    const engine = new RecordingDockerEngine({ existingContainerId: "container-a" });
    const service = new RuntimeLifecycleService(engine, testPolicy);

    await service.start(actionFor("runtime-a"));
    await service.start(actionFor("runtime-a"));
    await service.restart(actionFor("runtime-a"));
    await service.stop(actionFor("runtime-a"));
    await service.stop(actionFor("runtime-a"));
    const removed = await service.remove(actionFor("runtime-a"));
    const removedAgain = await service.remove(actionFor("runtime-a"));

    expect(engine.startCalls).toEqual(["container-a", "container-a", "container-a"]);
    expect(engine.restartCalls).toEqual([]);
    expect(engine.stopCalls).toEqual(["container-a", "container-a", "container-a"]);
    expect(engine.removeCalls).toEqual(["container-a"]);
    expect(engine.operationCalls).toEqual([
      "update",
      "start",
      "stop",
      "update",
      "start",
      "stop",
      "update",
      "start",
      "stop",
    ]);
    expect(engine.updateCalls).toEqual([
      {
        containerId: "container-a",
        Memory: 8_589_934_592,
        NanoCpus: 4_000_000_000,
        PidsLimit: 1_024,
      },
      {
        containerId: "container-a",
        Memory: 8_589_934_592,
        NanoCpus: 4_000_000_000,
        PidsLimit: 1_024,
      },
      {
        containerId: "container-a",
        Memory: 8_589_934_592,
        NanoCpus: 4_000_000_000,
        PidsLimit: 1_024,
      },
    ]);
    expect(removed.status).toBe("absent");
    expect(removedAgain.status).toBe("absent");
  });

  it("upgrades by replacing only the managed container and preserving fixed volume names", async () => {
    const engine = new RecordingDockerEngine({ existingContainerId: "container-a" });
    const service = new RuntimeLifecycleService(engine, testPolicy, {
      randomToken: () => "replacement-token",
    });

    const upgraded = await service.upgrade({ ...actionFor("runtime-a"), imageAlias: "next" });

    expect(engine.stopCalls).toEqual([]);
    expect(engine.removeCalls).toEqual(["container-a"]);
    expect(engine.createCalls[0]?.mounts.map((mount) => mount.volumeName)).toEqual([
      "codex-home-abababababababab-c23240e6876e",
      "workspace-abababababababab-c23240e6876e",
    ]);
    expect(upgraded.imageVersion).toBe("1.3.0");
  });

  it("rejects a runtime id collision with a different user hash", async () => {
    const engine = new RecordingDockerEngine({ existingContainerId: "container-a" });
    const service = new RuntimeLifecycleService(engine, testPolicy);

    await expect(
      service.provision({ ...requestFor("runtime-a"), userHash: "cd".repeat(32) }),
    ).rejects.toBeInstanceOf(RuntimeLifecycleError);
    expect(engine.createCalls).toHaveLength(0);
  });

  it("labels placement identity and rejects stale or conflicting generations", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, testPolicy, {
      nodeStatus: {
        nodeId: "node__a",
        managerVersion: "0.153.4",
        dataRoot: "/data",
        capacityCpuMillis: 16_000,
        capacityMemoryBytes: 64 * 1024 * 1024 * 1024,
        maxRuntimes: 30,
      },
    });
    await service.provision(placedRequest("runtime-generation", 2));

    expect(engine.createCalls[0]?.labels).toMatchObject({
      "com.codex-gateway.runtime-node-id": "node__a",
      "com.codex-gateway.placement-generation": "2",
      "com.codex-gateway.workspace-key": "ws__1234567890abcdef1234567890abcdef",
    });
    await expect(service.start(placedAction("runtime-generation", 1))).rejects.toMatchObject({
      code: "stale_placement_generation",
    });
    await expect(service.start(placedAction("runtime-generation", 3))).rejects.toMatchObject({
      code: "runtime_identity_conflict",
    });
  });
});

function placedRequest(runtimeId: string, placementGeneration: number) {
  return {
    ...requestFor(runtimeId),
    nodeId: "node__a",
    placementGeneration,
    workspaceKey: "ws__1234567890abcdef1234567890abcdef",
  };
}

function placedAction(runtimeId: string, placementGeneration: number) {
  return { runtimeId, nodeId: "node__a", placementGeneration };
}

describe("HmacRequestAuthenticator", () => {
  it("accepts a matching timestamp, nonce, body digest, and signature", () => {
    const body = Buffer.from('{"runtimeId":"runtime-a"}');
    const authenticator = new HmacRequestAuthenticator({
      nonceStore: new MemoryNonceStore(),
      now: () => now,
      secret: "shared-secret",
    });
    const headers = createSignedHeaders({
      body,
      method: "POST",
      path: "/v1/runtimes/start",
      nonce: "nonce-1",
      secret: "shared-secret",
      timestamp: now,
    });

    expect(authenticator.authenticate(headers, body, "POST", "/v1/runtimes/start")).toEqual({
      nonce: "nonce-1",
      timestamp: now,
    });
  });

  it("rejects timestamps outside the five-minute window with a fixed error", () => {
    const body = Buffer.alloc(0);
    const authenticator = new HmacRequestAuthenticator({
      nonceStore: new MemoryNonceStore(),
      now: () => now,
      secret: "shared-secret",
    });
    const headers = createSignedHeaders({
      body,
      method: "POST",
      path: "/v1/runtimes/start",
      nonce: "nonce-old",
      secret: "shared-secret",
      timestamp: now - 300_001,
    });

    expect(() => authenticator.authenticate(headers, body, "POST", "/v1/runtimes/start")).toThrow(
      new RuntimeAuthenticationError(),
    );
  });

  it("rejects a replayed nonce", () => {
    const body = Buffer.alloc(0);
    const authenticator = new HmacRequestAuthenticator({
      nonceStore: new MemoryNonceStore(),
      now: () => now,
      secret: "shared-secret",
    });
    const headers = createSignedHeaders({
      body,
      method: "POST",
      path: "/v1/runtimes/start",
      nonce: "nonce-replayed",
      secret: "shared-secret",
      timestamp: now,
    });

    authenticator.authenticate(headers, body, "POST", "/v1/runtimes/start");
    expect(() => authenticator.authenticate(headers, body, "POST", "/v1/runtimes/start")).toThrow(
      new RuntimeAuthenticationError(),
    );
  });

  it("blocks a future-dated nonce through the signed timestamp validity window", () => {
    const body = Buffer.alloc(0);
    let currentTime = now;
    const signedTimestamp = now + 300_000;
    const authenticator = new HmacRequestAuthenticator({
      nonceStore: new MemoryNonceStore(),
      now: () => currentTime,
      secret: "shared-secret",
    });
    const headers = createSignedHeaders({
      body,
      method: "POST",
      path: "/v1/runtimes/start",
      nonce: "nonce-future",
      secret: "shared-secret",
      timestamp: signedTimestamp,
    });

    authenticator.authenticate(headers, body, "POST", "/v1/runtimes/start");
    currentTime = now + 300_001;

    expect(() => authenticator.authenticate(headers, body, "POST", "/v1/runtimes/start")).toThrow(
      new RuntimeAuthenticationError(),
    );
  });

  it("rejects body tampering and malformed signatures without revealing the reason", () => {
    const body = Buffer.from("original");
    const authenticator = new HmacRequestAuthenticator({
      nonceStore: new MemoryNonceStore(),
      now: () => now,
      secret: "shared-secret",
    });
    const headers = createSignedHeaders({
      body,
      method: "POST",
      path: "/v1/runtimes/start",
      nonce: "nonce-tampered",
      secret: "shared-secret",
      timestamp: now,
    });

    for (const candidate of [
      () =>
        authenticator.authenticate(headers, Buffer.from("changed"), "POST", "/v1/runtimes/start"),
      () =>
        authenticator.authenticate(
          { ...headers, "x-runtime-signature": "not-hex" },
          body,
          "POST",
          "/v1/runtimes/start",
        ),
    ]) {
      expect(candidate).toThrow(new RuntimeAuthenticationError());
    }
    expect(
      createRequestSignature(
        "shared-secret",
        "POST",
        "/v1/runtimes/start",
        now,
        "nonce-tampered",
        headers["x-runtime-body-sha256"],
      ),
    ).toBe(headers["x-runtime-signature"]);
  });
});

describe("Runtime Manager HTTP API", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  });

  async function startTestServer() {
    const service = new RuntimeLifecycleService(new RecordingDockerEngine(), testPolicy, {
      randomToken: () => "http-service-token",
    });
    const authenticator = new HmacRequestAuthenticator({
      nonceStore: new MemoryNonceStore(),
      now: () => now,
      secret: "shared-secret",
    });
    const server = createServer(createRuntimeManagerRequestHandler({ authenticator, service }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("missing test server address");
    }
    return `http://127.0.0.1:${address.port}`;
  }

  it("returns authenticated node identity, capacity, Docker state, and disk state", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, testPolicy, {
      now: () => "2026-09-08T00:00:00.000Z",
      nodeStatus: {
        nodeId: "node__a",
        managerVersion: "0.153.4",
        dataRoot: "/data",
        capacityCpuMillis: 16_000,
        capacityMemoryBytes: 64 * 1024 * 1024 * 1024,
        maxRuntimes: 30,
      },
    });
    const authenticator = new HmacRequestAuthenticator({
      nonceStore: new MemoryNonceStore(),
      now: () => now,
      secret: "shared-secret",
    });
    const server = createServer(createRuntimeManagerRequestHandler({ authenticator, service }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test server");
    const path = "/v1/node/status";
    const body = Buffer.alloc(0);
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: createSignedHeaders({
        body,
        method: "GET",
        path,
        nonce: "node-status",
        secret: "shared-secret",
        timestamp: now,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      nodeId: "node__a",
      protocolVersion: 1,
      managerVersion: "0.153.4",
      sampledAt: "2026-09-08T00:00:00.000Z",
      capacityCpuMillis: 16_000,
      capacityMemoryBytes: 64 * 1024 * 1024 * 1024,
      maxRuntimes: 30,
      dockerAvailable: true,
      dataRootWritable: true,
      availableDiskBytes: 100 * 1024 * 1024 * 1024,
      totalDiskBytes: 200 * 1024 * 1024 * 1024,
      managedRuntimeCount: 2,
      runningRuntimeCount: 1,
      agentImages: { stable: "1.2.3", next: "1.3.0" },
    });
    expect(engine.inspectedDataRoot).toBe("/data");
  });

  it("authenticates and serves the fixed provision and inspect routes", async () => {
    const baseUrl = await startTestServer();
    const body = Buffer.from(JSON.stringify(requestFor("runtime-http")));
    const provisionResponse = await fetch(`${baseUrl}/v1/runtimes/provision`, {
      body,
      headers: {
        "content-type": "application/json",
        ...createSignedHeaders({
          body,
          method: "POST",
          path: "/v1/runtimes/provision",
          nonce: "http-1",
          secret: "shared-secret",
          timestamp: now,
        }),
      },
      method: "POST",
    });
    const inspectBody = Buffer.alloc(0);
    const inspectPath = "/v1/runtimes/runtime-http/generations/1";
    const inspectResponse = await fetch(`${baseUrl}${inspectPath}`, {
      headers: createSignedHeaders({
        body: inspectBody,
        method: "GET",
        path: inspectPath,
        nonce: "http-2",
        secret: "shared-secret",
        timestamp: now,
      }),
    });

    expect(provisionResponse.status).toBe(200);
    expect(await provisionResponse.json()).toMatchObject({
      runtimeId: "runtime-http",
      status: "stopped",
    });
    expect(inspectResponse.status).toBe(200);
    expect(await inspectResponse.json()).toMatchObject({
      runtimeId: "runtime-http",
      status: "stopped",
    });
  });

  it("serves only sanitized Docker state from the explicitly enabled E2E inspection route", async () => {
    const service = new RuntimeLifecycleService(new RecordingDockerEngine(), testPolicy);
    const authenticator = new HmacRequestAuthenticator({
      nonceStore: new MemoryNonceStore(),
      now: () => now,
      secret: "shared-secret",
    });
    const server = createServer(
      createRuntimeManagerRequestHandler({
        authenticator,
        service,
        environment: {
          NODE_ENV: "test",
          RUNTIME_MANAGER_E2E_INSPECTION: "1",
        },
        e2eInspector: {
          async inspectRuntime() {
            return {
              containerId: "container-policy",
              memoryBytes: 1024 * 1024 * 1024,
              nanoCpus: 1_000_000_000,
              pidsLimit: 128,
              workspaceVolume: "workspace-policy",
            };
          },
        },
      }),
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("missing test server address");
    }
    const path = "/v1/e2e/runtimes/runtime-policy/docker";
    const body = Buffer.alloc(0);
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: createSignedHeaders({
        body,
        method: "GET",
        path,
        nonce: "http-e2e-inspect",
        secret: "shared-secret",
        timestamp: now,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      containerId: "container-policy",
      memoryBytes: 1024 * 1024 * 1024,
      nanoCpus: 1_000_000_000,
      pidsLimit: 128,
      workspaceVolume: "workspace-policy",
    });
  });

  it("keeps the E2E Docker inspection route absent in production despite explicit opt-in", async () => {
    const service = new RuntimeLifecycleService(new RecordingDockerEngine(), testPolicy);
    const authenticator = new HmacRequestAuthenticator({
      nonceStore: new MemoryNonceStore(),
      now: () => now,
      secret: "shared-secret",
    });
    const server = createServer(
      createRuntimeManagerRequestHandler({
        authenticator,
        service,
        environment: {
          NODE_ENV: "production",
          RUNTIME_MANAGER_E2E_INSPECTION: "1",
        },
        e2eInspector: {
          async inspectRuntime() {
            return {
              containerId: "container-policy",
              memoryBytes: 1024 * 1024 * 1024,
              nanoCpus: 1_000_000_000,
              pidsLimit: 128,
              workspaceVolume: "workspace-policy",
            };
          },
        },
      }),
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("missing test server address");
    }
    const path = "/v1/e2e/runtimes/runtime-policy/docker";
    const body = Buffer.alloc(0);
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: createSignedHeaders({
        body,
        method: "GET",
        path,
        nonce: "http-e2e-production",
        secret: "shared-secret",
        timestamp: now,
      }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("keeps the E2E Docker inspection route absent unless explicitly enabled", async () => {
    const baseUrl = await startTestServer();
    const path = "/v1/e2e/runtimes/runtime-policy/docker";
    const body = Buffer.alloc(0);
    const response = await fetch(`${baseUrl}${path}`, {
      headers: createSignedHeaders({
        body,
        method: "GET",
        path,
        nonce: "http-e2e-disabled",
        secret: "shared-secret",
        timestamp: now,
      }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("serves signed container stats without a container id", async () => {
    const engine = new RecordingDockerEngine();
    engine.statsPayload = {
      read: "2026-09-02T07:00:00.000Z",
      cpu_stats: {
        cpu_usage: { total_usage: 20 },
        system_cpu_usage: 100,
        online_cpus: 1,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 10 },
        system_cpu_usage: 80,
      },
      memory_stats: { usage: 64, limit: 128, stats: {} },
      networks: { eth0: { rx_bytes: 1, tx_bytes: 2 } },
    };
    const service = new RuntimeLifecycleService(engine, testPolicy, {
      randomToken: () => "http-service-token",
    });
    await service.provision(requestFor("runtime-stats"));
    await service.start(actionFor("runtime-stats"));
    const authenticator = new HmacRequestAuthenticator({
      nonceStore: new MemoryNonceStore(),
      now: () => now,
      secret: "shared-secret",
    });
    const server = createServer(createRuntimeManagerRequestHandler({ authenticator, service }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("missing test server address");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const body = Buffer.alloc(0);
    const statsPath = "/v1/runtimes/runtime-stats/generations/1/stats";
    const response = await fetch(`${baseUrl}${statsPath}`, {
      headers: createSignedHeaders({
        body,
        method: "GET",
        path: statsPath,
        nonce: "http-stats",
        secret: "shared-secret",
        timestamp: now,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      runtimeId: "runtime-stats",
      status: "running",
      stats: { memoryUsageBytes: 64, memoryLimitBytes: 128 },
    });
    expect(JSON.stringify(payload)).not.toContain("container-");
  });

  it("serves authenticated runtime secret synchronization without echoing values", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, testPolicy);
    await service.provision(requestFor("runtime-secret-http"));
    await service.start(actionFor("runtime-secret-http"));
    const authenticator = new HmacRequestAuthenticator({
      nonceStore: new MemoryNonceStore(),
      now: () => now,
      secret: "shared-secret",
    });
    const server = createServer(createRuntimeManagerRequestHandler({ authenticator, service }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test server");
    const exactSecret = "http-runtime-secret";
    const body = Buffer.from(
      JSON.stringify({
        ...actionFor("runtime-secret-http"),
        runtimeSecrets: [
          {
            credentialId: "cred__business",
            capabilityId: "org__business",
            version: 2,
            target: { type: "file", path: "/run/codex-secrets/business" },
            value: exactSecret,
          },
        ],
      }),
    );
    const path = "/v1/runtimes/secrets";
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        ...createSignedHeaders({
          body,
          method: "POST",
          path,
          nonce: "http-secrets",
          secret: "shared-secret",
          timestamp: now,
        }),
      },
    });

    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(exactSecret);
    expect(engine.secretCalls.at(-1)?.secrets[0]?.value).toBe(exactSecret);
  });

  it("serves an authenticated OAuth callback forward without echoing query data", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, testPolicy);
    await service.provision(requestFor("runtime-oauth-http"));
    await service.start(actionFor("runtime-oauth-http"));
    const authenticator = new HmacRequestAuthenticator({
      nonceStore: new MemoryNonceStore(),
      now: () => now,
      secret: "shared-secret",
    });
    const server = createServer(createRuntimeManagerRequestHandler({ authenticator, service }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test server");
    const callback = "/api/capabilities/mcp/oauth/callback?code=secret-code&state=secret-state";
    const body = Buffer.from(
      JSON.stringify({ ...actionFor("runtime-oauth-http"), pathAndQuery: callback }),
    );
    const path = "/v1/runtimes/oauth-callback";
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        ...createSignedHeaders({
          body,
          method: "POST",
          path,
          nonce: "http-oauth-callback",
          secret: "shared-secret",
          timestamp: now,
        }),
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(engine.oauthCallbackCalls).toEqual([
      { containerId: "container-1", pathAndQuery: callback },
    ]);
  });

  it("rejects unauthenticated requests with a safe fixed response", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/v1/runtimes/runtime-a/generations/1`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a replay with the same safe fixed response", async () => {
    const baseUrl = await startTestServer();
    const body = Buffer.alloc(0);
    const path = "/v1/runtimes/runtime-a/generations/1";
    const headers = createSignedHeaders({
      body,
      method: "GET",
      path,
      nonce: "http-replay",
      secret: "shared-secret",
      timestamp: now,
    });
    const firstResponse = await fetch(`${baseUrl}${path}`, { headers });
    const replayResponse = await fetch(`${baseUrl}${path}`, { headers });

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(401);
    expect(await replayResponse.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects arbitrary Docker options in strict request payloads", async () => {
    const baseUrl = await startTestServer();
    const body = Buffer.from(
      JSON.stringify({
        ...requestFor("runtime-http"),
        command: ["sh"],
        image: "attacker/image:latest",
        mounts: ["/:/host"],
        network: "host",
        ports: [22],
      }),
    );
    const response = await fetch(`${baseUrl}/v1/runtimes/provision`, {
      body,
      headers: {
        "content-type": "application/json",
        ...createSignedHeaders({
          body,
          method: "POST",
          path: "/v1/runtimes/provision",
          nonce: "http-strict",
          secret: "shared-secret",
          timestamp: now,
        }),
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("returns a fixed client error for malformed runtime path encoding", async () => {
    const baseUrl = await startTestServer();
    const body = Buffer.alloc(0);
    const path = "/v1/runtimes/%/generations/1";
    const response = await fetch(`${baseUrl}${path}`, {
      headers: createSignedHeaders({
        body,
        method: "GET",
        path,
        nonce: "http-malformed-path",
        secret: "shared-secret",
        timestamp: now,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });
});
