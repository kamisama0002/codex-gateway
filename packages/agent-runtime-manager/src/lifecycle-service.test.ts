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
import { createRuntimeManagerRequestHandler, loadRuntimeManagerPolicy } from "./http-server.js";
import {
  RuntimeLifecycleError,
  RuntimeLifecycleService,
  type RuntimeManagerPolicy,
} from "./lifecycle-service.js";

const userHash = "ab".repeat(32);
const now = 1_788_115_200_000;
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
  networkName: "agent-runtime",
};

function requestFor(runtimeId: string) {
  return {
    imageAlias: "stable",
    runtimeId,
    runtimeType: "codex-app-server" as const,
    userHash,
  };
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
  readonly removeCalls: string[] = [];
  readonly restartCalls: string[] = [];
  readonly startCalls: string[] = [];
  readonly stopCalls: string[] = [];
  private readonly containers = new Map<string, EngineContainerState>();

  constructor(options: { existingContainerId?: string } = {}) {
    if (options.existingContainerId !== undefined) {
      this.containers.set("runtime-a", {
        containerId: options.existingContainerId,
        containerName: "codex-runtime-existing",
        imageAlias: "stable",
        imageVersion: "1.2.3",
        internalPort: testPolicy.internalPort,
        running: false,
        runtimeId: "runtime-a",
        runtimeType: "codex-app-server",
        serviceToken: "existing-service-token",
        userHash,
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
    };
    this.containers.set(spec.runtimeId, state);
    return state;
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
    this.restartCalls.push(containerId);
    this.setRunning(containerId, true);
  }

  async startContainer(containerId: string): Promise<void> {
    this.startCalls.push(containerId);
    this.setRunning(containerId, true);
  }

  async stopContainer(containerId: string): Promise<void> {
    this.stopCalls.push(containerId);
    this.setRunning(containerId, false);
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
  it("uses the fixed 4500 endpoint when production environment attempts to override it", async () => {
    const policy = loadRuntimeManagerPolicy({
      RUNTIME_MANAGER_AGENT_NETWORK: "agent-runtime",
      RUNTIME_MANAGER_AGENT_PORT: "1234",
      RUNTIME_MANAGER_IMAGE_ALIASES: JSON.stringify(testPolicy.images),
    });
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, policy, {
      randomToken: () => "generated-service-token",
    });

    const result = await service.provision(requestFor("runtime-fixed-port"));

    expect(policy.internalPort).toBe(4500);
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
      networkName: "agent-runtime",
      runtimeId: "runtime-new",
      security: {
        CapDrop: ["ALL"],
        Memory: 2_147_483_648,
        NanoCpus: 2_000_000_000,
        PidsLimit: 256,
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ["no-new-privileges:true"],
        Tmpfs: { "/tmp": "rw,nosuid,nodev,noexec,size=64m" },
        User: "10001:10001",
      },
      serviceToken: "generated-service-token",
      userHash,
    });
  });

  it("rejects an unknown image alias before calling the engine", async () => {
    const engine = new RecordingDockerEngine();
    const service = new RuntimeLifecycleService(engine, testPolicy);

    await expect(
      service.provision({ ...requestFor("runtime-a"), imageAlias: "raw-registry-image" }),
    ).rejects.toMatchObject({ code: "unknown_image_alias" });
    expect(engine.createCalls).toHaveLength(0);
  });

  it("runs fixed start, stop, restart, and remove operations idempotently", async () => {
    const engine = new RecordingDockerEngine({ existingContainerId: "container-a" });
    const service = new RuntimeLifecycleService(engine, testPolicy);

    await service.start({ runtimeId: "runtime-a" });
    await service.start({ runtimeId: "runtime-a" });
    await service.restart({ runtimeId: "runtime-a" });
    await service.stop({ runtimeId: "runtime-a" });
    await service.stop({ runtimeId: "runtime-a" });
    const removed = await service.remove({ runtimeId: "runtime-a" });
    const removedAgain = await service.remove({ runtimeId: "runtime-a" });

    expect(engine.startCalls).toEqual(["container-a"]);
    expect(engine.restartCalls).toEqual(["container-a"]);
    expect(engine.stopCalls).toEqual(["container-a"]);
    expect(engine.removeCalls).toEqual(["container-a"]);
    expect(removed.status).toBe("absent");
    expect(removedAgain.status).toBe("absent");
  });

  it("upgrades by replacing only the managed container and preserving fixed volume names", async () => {
    const engine = new RecordingDockerEngine({ existingContainerId: "container-a" });
    const service = new RuntimeLifecycleService(engine, testPolicy, {
      randomToken: () => "replacement-token",
    });

    const upgraded = await service.upgrade({ imageAlias: "next", runtimeId: "runtime-a" });

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
});

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
      nonce: "nonce-1",
      secret: "shared-secret",
      timestamp: now,
    });

    expect(authenticator.authenticate(headers, body)).toEqual({ nonce: "nonce-1", timestamp: now });
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
      nonce: "nonce-old",
      secret: "shared-secret",
      timestamp: now - 300_001,
    });

    expect(() => authenticator.authenticate(headers, body)).toThrow(
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
      nonce: "nonce-replayed",
      secret: "shared-secret",
      timestamp: now,
    });

    authenticator.authenticate(headers, body);
    expect(() => authenticator.authenticate(headers, body)).toThrow(
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
      nonce: "nonce-future",
      secret: "shared-secret",
      timestamp: signedTimestamp,
    });

    authenticator.authenticate(headers, body);
    currentTime = now + 300_001;

    expect(() => authenticator.authenticate(headers, body)).toThrow(
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
      nonce: "nonce-tampered",
      secret: "shared-secret",
      timestamp: now,
    });

    for (const candidate of [
      () => authenticator.authenticate(headers, Buffer.from("changed")),
      () => authenticator.authenticate({ ...headers, "x-runtime-signature": "not-hex" }, body),
    ]) {
      expect(candidate).toThrow(new RuntimeAuthenticationError());
    }
    expect(
      createRequestSignature(
        "shared-secret",
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

  it("authenticates and serves the fixed provision and inspect routes", async () => {
    const baseUrl = await startTestServer();
    const body = Buffer.from(JSON.stringify(requestFor("runtime-http")));
    const provisionResponse = await fetch(`${baseUrl}/v1/runtimes/provision`, {
      body,
      headers: {
        "content-type": "application/json",
        ...createSignedHeaders({ body, nonce: "http-1", secret: "shared-secret", timestamp: now }),
      },
      method: "POST",
    });
    const inspectBody = Buffer.alloc(0);
    const inspectResponse = await fetch(`${baseUrl}/v1/runtimes/runtime-http`, {
      headers: createSignedHeaders({
        body: inspectBody,
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

  it("rejects unauthenticated requests with a safe fixed response", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/v1/runtimes/runtime-a`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a replay with the same safe fixed response", async () => {
    const baseUrl = await startTestServer();
    const body = Buffer.alloc(0);
    const headers = createSignedHeaders({
      body,
      nonce: "http-replay",
      secret: "shared-secret",
      timestamp: now,
    });
    const firstResponse = await fetch(`${baseUrl}/v1/runtimes/runtime-a`, { headers });
    const replayResponse = await fetch(`${baseUrl}/v1/runtimes/runtime-a`, { headers });

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
    const response = await fetch(`${baseUrl}/v1/runtimes/%`, {
      headers: createSignedHeaders({
        body,
        nonce: "http-malformed-path",
        secret: "shared-secret",
        timestamp: now,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });
});
