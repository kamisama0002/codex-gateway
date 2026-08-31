import { once } from "node:events";
import { WebSocketServer, type RawData } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostRecord } from "~~/shared/types";
import { CodexRpcTransport, createCodexRpcTransport } from "./rpc-transport";
import { CodexRpcClient } from "./rpc";
import { codexRuntime } from "../host-services";
import { assertGatewayHostConnectionIdentity } from "../../runtime/controller-registry";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { recordFromUnknown } from "~~/shared/utils/records";
import { createManagedRuntimeHost, ManagedCodexRpcTransport } from "./managed-rpc-transport";

const servers: WebSocketServer[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          for (const client of server.clients) client.terminate();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("createCodexRpcTransport", () => {
  it("defaults existing hosts to the SSH transport", () => {
    expect(createCodexRpcTransport(sshHost(), transportOptions())).toBeInstanceOf(
      CodexRpcTransport,
    );
  });

  it("prevents the reserved host identity from falling through to SSH", () => {
    expect(() =>
      assertGatewayHostConnectionIdentity({ ...sshHost(), id: MANAGED_RUNTIME_HOST_ID }),
    ).toThrow("reserved");
    expect(() =>
      assertGatewayHostConnectionIdentity(
        createManagedRuntimeHost(7, runtimeRecordTimes(), {
          runtimeId: "runtime_01",
          websocketUrl: "ws://runtime-01:4500",
          serviceToken: "runtime-token",
        }),
      ),
    ).not.toThrow();
  });

  it("selects the managed websocket transport without opening SSH", () => {
    const host = createManagedRuntimeHost(7, runtimeRecordTimes(), {
      runtimeId: "runtime_01",
      websocketUrl: "ws://runtime-01:4500",
      serviceToken: "runtime-token",
    });

    expect(createCodexRpcTransport(host, transportOptions())).toBeInstanceOf(
      ManagedCodexRpcTransport,
    );
  });
});

describe("ManagedCodexRpcTransport", () => {
  it("authenticates the direct internal websocket with a bearer token", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    await once(server, "listening");
    const port = serverPort(server);
    const authorization = new Promise<string | undefined>((resolve) => {
      server.once("connection", (_socket, request) => {
        resolve(request.headers.authorization);
      });
    });
    const host = createManagedRuntimeHost(7, runtimeRecordTimes(), {
      runtimeId: "runtime_01",
      websocketUrl: `ws://127.0.0.1:${port}`,
      serviceToken: "runtime-token",
    });
    const transport = createCodexRpcTransport(host, transportOptions());

    await transport.connect();

    expect(await authorization).toBe("Bearer runtime-token");
    transport.close();
  });

  it("initializes a managed RPC client without running the SSH version workflow", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    await once(server, "listening");
    const port = serverPort(server);
    server.on("connection", (socket) => {
      socket.on("message", (data) => {
        const parsed: unknown = JSON.parse(rawDataToString(data));
        const message = recordFromUnknown(parsed);
        if (message?.id !== undefined && message.method === "initialize") {
          socket.send(
            JSON.stringify({
              id: message.id,
              result: { userAgent: "codex_app_server/0.151.0" },
            }),
          );
        }
      });
    });
    const ensureVersion = vi
      .spyOn(codexRuntime, "ensureCodexVersion")
      .mockRejectedValue(new Error("SSH version workflow must not run"));
    const host = createManagedRuntimeHost(7, runtimeRecordTimes(), {
      runtimeId: "runtime_01",
      websocketUrl: `ws://127.0.0.1:${port}`,
      serviceToken: "runtime-token",
    });
    const client = new CodexRpcClient(host);

    await client.connect();

    expect(ensureVersion).not.toHaveBeenCalled();
    client.close();
    ensureVersion.mockRestore();
  });
});

function transportOptions() {
  return {
    requireExistingAppServer: false,
    onMessage: vi.fn(),
    onStderr: vi.fn(),
    onClose: vi.fn(),
  };
}

function sshHost(): HostRecord {
  return {
    id: 1,
    name: "SSH host",
    sshHost: "ssh.internal",
    username: "codex",
    port: 22,
    authMode: "agent",
    privateKeyPath: null,
    privateKey: null,
    password: null,
    proxyUrl: null,
    hasPassword: false,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}

function runtimeRecordTimes() {
  return {
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}

function serverPort(server: WebSocketServer): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test WebSocket server did not bind a TCP port");
  }
  return address.port;
}

function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}
