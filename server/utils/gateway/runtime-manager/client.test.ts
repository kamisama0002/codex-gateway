import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { realtimeClientMessageSchema } from "~~/shared/runtime/realtime/client-message-schema";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { RuntimeManagerClient, RuntimeManagerClientError } from "./client";

describe("RuntimeManagerClient", () => {
  it("signs the exact request body and validates a lifecycle response", async () => {
    const timestamp = 1_788_131_200_000;
    const nonce = "fixed-nonce";
    const secret = "manager-shared-secret";
    const requestBody = JSON.stringify({
      runtimeId: "runtime_01",
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
      runtimeId: "runtime_01",
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

    await expect(client.inspect("runtime_01")).rejects.toBeInstanceOf(RuntimeManagerClientError);
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

    await expect(client.inspect("runtime_01")).rejects.toEqual(
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

    const error: unknown = await client.inspect("runtime_01").catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: "runtime_manager_timeout",
      message: "runtime_manager_timeout",
    });
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(JSON.stringify(error)).not.toContain("sensitive-runtime");
    expect(JSON.stringify(error)).not.toContain("secret-token");
  });
});

describe("managed runtime browser boundary", () => {
  it("rejects the hidden managed host identity in browser realtime messages", () => {
    const result = realtimeClientMessageSchema.safeParse({
      type: "turn.interrupt",
      requestId: "request-1",
      hostId: MANAGED_RUNTIME_HOST_ID,
      threadId: "thread-1",
      turnId: "turn-1",
    });

    expect(result.success).toBe(false);
  });
});
