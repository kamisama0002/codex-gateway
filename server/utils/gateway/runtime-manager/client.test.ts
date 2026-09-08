import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { realtimeClientMessageSchema } from "~~/shared/runtime/realtime/client-message-schema";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { RuntimeManagerClient, RuntimeManagerClientError } from "./client";

function runtimePlacement(runtimeId = "runtime_01") {
  return { runtimeId, nodeId: "node__a", placementGeneration: 2 };
}

describe("RuntimeManagerClient", () => {
  it("signs node status requests and rejects a mismatched node identity", async () => {
    const timestamp = 1_788_131_200_000;
    const secret = "manager-shared-secret";
    const health = {
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
      agentImages: { stable: "0.153.4" },
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(health));
    const client = new RuntimeManagerClient({
      baseUrl: "https://node-a.runtime.internal",
      nodeId: "node__a",
      secret,
      fetch,
      now: () => timestamp,
      nonce: () => "node-status-nonce",
    });

    await expect(client.status()).resolves.toEqual(health);
    expect(fetch).toHaveBeenCalledWith(
      "https://node-a.runtime.internal/v1/node/status",
      expect.objectContaining({ method: "GET" }),
    );

    const mismatched = new RuntimeManagerClient({
      baseUrl: "https://node-a.runtime.internal",
      nodeId: "node__b",
      secret,
      fetch,
    });
    await expect(mismatched.status()).rejects.toMatchObject({
      code: "runtime_manager_invalid_response",
    });
  });

  it("creates a relay target with fresh signed headers for every connection", () => {
    let nonce = 0;
    const client = new RuntimeManagerClient({
      baseUrl: "https://node-a.runtime.internal",
      nodeId: "node__a",
      secret: "manager-secret",
      now: () => 1_788_134_400_000,
      nonce: () => `relay-${++nonce}`,
    });

    const target = client.relayTarget(runtimePlacement());
    const first = target.headers();
    const second = target.headers();

    expect(target).toMatchObject({
      runtimeId: "runtime_01",
      websocketUrl: "wss://node-a.runtime.internal/v1/runtimes/runtime_01/generations/2/rpc",
    });
    expect(first["x-runtime-nonce"]).toBe("relay-1");
    expect(second["x-runtime-nonce"]).toBe("relay-2");
    expect(first["x-runtime-signature"]).not.toBe(second["x-runtime-signature"]);
    expect(JSON.stringify(target)).not.toContain("manager-secret");
  });

  it("signs requested start resources in the exact request body", async () => {
    const timestamp = 1_788_131_200_000;
    const nonce = "resources-nonce";
    const secret = "manager-shared-secret";
    const resources = {
      memoryBytes: 1024 * 1024 * 1024,
      nanoCpus: 1_500_000_000,
      pidsLimit: 128,
    };
    const placement = { runtimeId: "runtime_01", nodeId: "node__a", placementGeneration: 2 };
    const requestBody = JSON.stringify({ ...placement, resources });
    const bodySha256 = createHash("sha256").update(requestBody).digest("hex");
    const signature = createHmac("sha256", secret)
      .update(`POST\n/v1/runtimes/start\n${timestamp}\n${nonce}\n${bodySha256}`)
      .digest("hex");
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        runtimeId: "runtime_01",
        containerId: "container-01",
        imageAlias: "stable",
        imageVersion: "0.151.0",
        status: "running",
        endpoint: {
          runtimeId: "runtime_01",
          websocketUrl: "ws://runtime-01:4500",
          serviceToken: "runtime-token",
        },
        actualResources: resources,
      }),
    );
    const client = new RuntimeManagerClient({
      baseUrl: "http://runtime-manager:8787",
      secret,
      fetch,
      now: () => timestamp,
      nonce: () => nonce,
    });

    await expect(client.start(placement, resources)).resolves.toMatchObject({
      actualResources: resources,
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      body: requestBody,
      headers: {
        "x-runtime-body-sha256": bodySha256,
        "x-runtime-signature": signature,
      },
    });
  });

  it("rejects a placement for a different node before sending credentials", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new RuntimeManagerClient({
      baseUrl: "https://node-a.runtime.internal",
      nodeId: "node__a",
      secret: "manager-secret",
      fetch,
    });

    expect(() =>
      client.provision({
        ...runtimePlacement(),
        nodeId: "node__b",
        workspaceKey: "ws__1234567890abcdef1234567890abcdef",
        userHash: "a".repeat(64),
        runtimeType: "codex-app-server",
        imageAlias: "stable",
      }),
    ).toThrow("runtime_manager_invalid_response");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("signs the exact request body and validates a lifecycle response", async () => {
    const timestamp = 1_788_131_200_000;
    const nonce = "fixed-nonce";
    const secret = "manager-shared-secret";
    const requestBody = JSON.stringify({
      ...runtimePlacement(),
      workspaceKey: "ws__1234567890abcdef1234567890abcdef",
      userHash: "a".repeat(64),
      runtimeType: "codex-app-server",
      imageAlias: "stable",
    });
    const bodySha256 = createHash("sha256").update(requestBody).digest("hex");
    const signature = createHmac("sha256", secret)
      .update(`POST\n/v1/runtimes/provision\n${timestamp}\n${nonce}\n${bodySha256}`)
      .digest("hex");
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        runtimeId: "runtime_01",
        containerId: "container-01",
        imageAlias: "stable",
        imageVersion: "0.151.0",
        status: "stopped",
        endpoint: {
          runtimeId: "runtime_01",
          websocketUrl: "ws://runtime-01:4500",
          serviceToken: "runtime-token",
        },
        actualResources: {
          memoryBytes: 2 * 1024 * 1024 * 1024,
          nanoCpus: 2_000_000_000,
          pidsLimit: 256,
        },
      }),
    );
    const client = new RuntimeManagerClient({
      baseUrl: "http://runtime-manager:8787",
      secret,
      fetch,
      now: () => timestamp,
      nonce: () => nonce,
    });

    const result = await client.provision({
      ...runtimePlacement(),
      workspaceKey: "ws__1234567890abcdef1234567890abcdef",
      userHash: "a".repeat(64),
      runtimeType: "codex-app-server",
      imageAlias: "stable",
    });

    expect(result.endpoint?.websocketUrl).toBe("ws://runtime-01:4500");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe("http://runtime-manager:8787/v1/runtimes/provision");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: requestBody,
      headers: {
        "content-type": "application/json",
        "x-runtime-body-sha256": bodySha256,
        "x-runtime-nonce": nonce,
        "x-runtime-signature": signature,
        "x-runtime-timestamp": String(timestamp),
      },
    });
  });

  it("validates Agent container stats without a container id", async () => {
    const timestamp = 1_788_131_200_000;
    const nonce = "stats-nonce";
    const secret = "manager-shared-secret";
    const bodySha256 = createHash("sha256").update("").digest("hex");
    const signature = createHmac("sha256", secret)
      .update(
        `GET\n/v1/runtimes/runtime_01/generations/2/stats\n${timestamp}\n${nonce}\n${bodySha256}`,
      )
      .digest("hex");
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        runtimeId: "runtime_01",
        status: "running",
        stats: {
          sampledAtMs: timestamp,
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
      }),
    );
    const client = new RuntimeManagerClient({
      baseUrl: "http://runtime-manager:8787",
      secret,
      fetch,
      now: () => timestamp,
      nonce: () => nonce,
    });

    const result = await client.stats(runtimePlacement());

    expect(result.stats?.memoryLimitBytes).toBe(256);
    expect(result).not.toHaveProperty("containerId");
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "http://runtime-manager:8787/v1/runtimes/runtime_01/generations/2/stats",
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: {
        "x-runtime-body-sha256": bodySha256,
        "x-runtime-nonce": nonce,
        "x-runtime-signature": signature,
        "x-runtime-timestamp": String(timestamp),
      },
    });
  });

  it("sends runtime secrets only in the signed synchronization body", async () => {
    const exactSecret = "signed-runtime-secret";
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        runtimeId: "runtime_01",
        containerId: "container-01",
        imageAlias: "stable",
        imageVersion: "0.153.4",
        status: "running",
        endpoint: {
          runtimeId: "runtime_01",
          websocketUrl: "ws://runtime-01:4500",
          serviceToken: "runtime-token",
        },
        actualResources: {
          memoryBytes: 8 * 1024 * 1024 * 1024,
          nanoCpus: 4_000_000_000,
          pidsLimit: 1024,
        },
      }),
    );
    const client = new RuntimeManagerClient({
      baseUrl: "http://runtime-manager:8787",
      secret: "manager-shared-secret",
      fetch,
      now: () => 1_788_131_200_000,
      nonce: () => "secret-sync-nonce",
    });

    const result = await client.syncSecrets({
      ...runtimePlacement(),
      runtimeSecrets: [
        {
          credentialId: "cred__business",
          capabilityId: "org__business",
          version: 2,
          target: { type: "env", name: "BUSINESS_TOKEN" },
          value: exactSecret,
        },
      ],
    });

    expect(result.status).toBe("running");
    expect(fetch.mock.calls[0]?.[0]).toBe("http://runtime-manager:8787/v1/runtimes/secrets");
    expect(fetch.mock.calls[0]?.[1]?.body).toContain(exactSecret);
    expect(JSON.stringify(result)).not.toContain(exactSecret);
  });

  it("forwards an OAuth callback through the fixed signed endpoint", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ok: true }));
    const client = new RuntimeManagerClient({
      baseUrl: "http://runtime-manager:8787",
      secret: "manager-shared-secret",
      fetch,
    });
    const callback = "/api/capabilities/mcp/oauth/callback?code=secret-code&state=secret-state";

    await expect(
      client.forwardOAuthCallback({ ...runtimePlacement(), pathAndQuery: callback }),
    ).resolves.toBeUndefined();

    expect(fetch.mock.calls[0]?.[0]).toBe("http://runtime-manager:8787/v1/runtimes/oauth-callback");
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ ...runtimePlacement(), pathAndQuery: callback }),
    );
  });

  it("fails closed when Runtime Manager returns an invalid endpoint", async () => {
    const client = new RuntimeManagerClient({
      baseUrl: "http://runtime-manager:8787",
      secret: "manager-shared-secret",
      fetch: async () =>
        Response.json({
          runtimeId: "runtime_01",
          containerId: "container-01",
          imageAlias: "stable",
          imageVersion: "0.151.0",
          status: "running",
          endpoint: {
            runtimeId: "runtime_01",
            websocketUrl: "not-a-url",
            serviceToken: "runtime-token",
          },
        }),
      nonce: () => "fixed-nonce",
    });

    await expect(client.inspect(runtimePlacement())).rejects.toBeInstanceOf(
      RuntimeManagerClientError,
    );
  });

  it("rejects a non-WebSocket internal endpoint", async () => {
    const client = new RuntimeManagerClient({
      baseUrl: "http://runtime-manager:8787",
      secret: "manager-shared-secret",
      fetch: async () =>
        Response.json({
          runtimeId: "runtime_01",
          containerId: "container-01",
          imageAlias: "stable",
          imageVersion: "0.151.0",
          status: "running",
          endpoint: {
            runtimeId: "runtime_01",
            websocketUrl: "https://runtime-01:4500",
            serviceToken: "runtime-token",
          },
        }),
      nonce: () => "fixed-nonce",
    });

    await expect(client.inspect(runtimePlacement())).rejects.toEqual(
      expect.objectContaining({ code: "runtime_manager_invalid_response" }),
    );
  });

  it("aborts a lifecycle request at the injected deadline with a fixed safe error", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      const signal = init?.signal;
      if (signal === null || signal === undefined) throw new Error("fetch received no AbortSignal");
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("abort from ws://sensitive-runtime:4500?token=secret-token"));
        });
      });
    });
    const client = new RuntimeManagerClient({
      baseUrl: "http://runtime-manager:8787",
      secret: "manager-shared-secret",
      timeoutMs: 5,
      fetch,
      nonce: () => "fixed-nonce",
    });

    const error: unknown = await client
      .inspect(runtimePlacement())
      .catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: "runtime_manager_timeout",
      message: "runtime_manager_timeout",
    });
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(JSON.stringify(error)).not.toContain("sensitive-runtime");
    expect(JSON.stringify(error)).not.toContain("secret-token");
  });

  it("signs an Agent exec request and returns stdout without a container id", async () => {
    const timestamp = 1_788_131_200_000;
    const nonce = "exec-nonce";
    const secret = "manager-shared-secret";
    const requestBody = JSON.stringify({
      ...runtimePlacement(),
      command: "git --version",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
    });
    const bodySha256 = createHash("sha256").update(requestBody).digest("hex");
    const signature = createHmac("sha256", secret)
      .update(`POST\n/v1/runtimes/exec\n${timestamp}\n${nonce}\n${bodySha256}`)
      .digest("hex");
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ code: 0, stdout: "git version 2.45.0\n", stderr: "" }),
    );
    const client = new RuntimeManagerClient({
      baseUrl: "http://runtime-manager:8787",
      secret,
      fetch,
      now: () => timestamp,
      nonce: () => nonce,
    });

    const result = await client.exec({
      ...runtimePlacement(),
      command: "git --version",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
    });

    expect(result).toEqual({ code: 0, stdout: "git version 2.45.0\n", stderr: "" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe("http://runtime-manager:8787/v1/runtimes/exec");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: requestBody,
      headers: {
        "content-type": "application/json",
        "x-runtime-body-sha256": bodySha256,
        "x-runtime-nonce": nonce,
        "x-runtime-signature": signature,
        "x-runtime-timestamp": String(timestamp),
      },
    });
    expect(JSON.stringify(result)).not.toContain("container");
  });
});

describe("managed runtime browser boundary", () => {
  it("rejects SSH-only workspace actions on the local Agent host", () => {
    const result = realtimeClientMessageSchema.safeParse({
      type: "terminal.open",
      requestId: "request-1",
      hostId: MANAGED_RUNTIME_HOST_ID,
      scope: "host",
      cols: 80,
      rows: 24,
    });

    expect(result.success).toBe(false);
  });

  it("allows thread turns and Agent runtime metrics on the local Agent host", () => {
    const turn = realtimeClientMessageSchema.safeParse({
      type: "turn.interrupt",
      requestId: "request-1",
      hostId: MANAGED_RUNTIME_HOST_ID,
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const subscribe = realtimeClientMessageSchema.safeParse({
      type: "host.metrics.subscribe",
      requestId: "request-1",
      hostId: MANAGED_RUNTIME_HOST_ID,
    });
    const unsubscribe = realtimeClientMessageSchema.safeParse({
      type: "host.metrics.unsubscribe",
      hostId: MANAGED_RUNTIME_HOST_ID,
    });

    expect(turn.success).toBe(true);
    expect(subscribe.success).toBe(true);
    expect(unsubscribe.success).toBe(true);
  });

  it("allows starting a conversation on the local Agent host", () => {
    const result = realtimeClientMessageSchema.safeParse({
      type: "thread.start",
      requestId: "request-1",
      hostId: MANAGED_RUNTIME_HOST_ID,
      projectId: 2_000_000_001,
      cwd: "/workspace",
    });

    expect(result.success).toBe(true);
  });

  it("allows Git inspect on the local Agent host", () => {
    const result = realtimeClientMessageSchema.safeParse({
      type: "file.git.workspace.inspect",
      requestId: "request-1",
      hostId: MANAGED_RUNTIME_HOST_ID,
      projectId: 2_000_000_001,
      rootPath: "/workspace",
    });

    expect(result.success).toBe(true);
  });
});
