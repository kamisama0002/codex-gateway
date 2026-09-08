import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createSignedHeaders, HmacRequestAuthenticator, type NonceStore } from "./auth.js";
import { attachRuntimeRpcRelay } from "./rpc-relay.js";

const now = 1_788_134_400_000;
const secret = "manager-secret";
const servers: Array<Server | WebSocketServer> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (server instanceof WebSocketServer) {
            for (const client of server.clients) client.terminate();
          }
          server.close(() => resolve());
        }),
    ),
  );
});

describe("Runtime Manager RPC relay", () => {
  it("relays frames without exposing the App Server bearer token to the client", async () => {
    const downstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(downstream);
    await once(downstream, "listening");
    const authorization = new Promise<string | undefined>((resolve) => {
      downstream.once("connection", (socket, request) => {
        resolve(request.headers.authorization);
        socket.on("message", (data, isBinary) => socket.send(data, { binary: isBinary }));
      });
    });
    const manager = await startRelayServer({
      websocketUrl: `ws://127.0.0.1:${serverPort(downstream)}`,
      serviceToken: "container-only-token",
    });
    const client = await connect(manager, "relay-1");

    client.send(JSON.stringify({ id: 1, method: "initialize" }));
    expect(rawData(await nextMessage(client))).toBe('{"id":1,"method":"initialize"}');
    expect(await authorization).toBe("Bearer container-only-token");
    client.close();
  });

  it("rejects an invalid signature and a replayed nonce", async () => {
    const downstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(downstream);
    await once(downstream, "listening");
    const manager = await startRelayServer({
      websocketUrl: `ws://127.0.0.1:${serverPort(downstream)}`,
      serviceToken: "container-only-token",
    });
    const path = "/v1/runtimes/runtime-a/generations/1/rpc";
    const headers = createSignedHeaders({
      body: Buffer.alloc(0),
      method: "GET",
      path,
      nonce: "relay-replay",
      secret,
      timestamp: now,
    });
    const first = await connectWithHeaders(manager, path, headers);
    first.close();
    await once(first, "close");

    await expect(connectWithHeaders(manager, path, headers)).rejects.toMatchObject({ status: 401 });
    await expect(
      connectWithHeaders(manager, path, { ...headers, "x-runtime-signature": "0".repeat(64) }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("propagates downstream close to the Gateway connection", async () => {
    const downstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(downstream);
    await once(downstream, "listening");
    downstream.once("connection", (socket) => socket.close(1012, "app restart"));
    const manager = await startRelayServer({
      websocketUrl: `ws://127.0.0.1:${serverPort(downstream)}`,
      serviceToken: "container-only-token",
    });
    const client = await connect(manager, "relay-close");
    const code = await closeCode(client);

    expect(code).toBe(1012);
  });
});

async function startRelayServer(target: { websocketUrl: string; serviceToken: string }) {
  const server = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  servers.push(server);
  attachRuntimeRpcRelay(server, {
    authenticator: new HmacRequestAuthenticator({
      nonceStore: new MemoryNonceStore(),
      now: () => now,
      secret,
    }),
    resolveTarget: async (input) => {
      if (input.runtimeId !== "runtime-a" || input.placementGeneration !== 1) {
        throw Object.assign(new Error("runtime mismatch"), { code: "runtime_identity_conflict" });
      }
      return target;
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `ws://127.0.0.1:${serverPort(server)}`;
}

async function connect(managerUrl: string, nonce: string) {
  const path = "/v1/runtimes/runtime-a/generations/1/rpc";
  return await connectWithHeaders(
    managerUrl,
    path,
    createSignedHeaders({
      body: Buffer.alloc(0),
      method: "GET",
      path,
      nonce,
      secret,
      timestamp: now,
    }),
  );
}

function connectWithHeaders(managerUrl: string, path: string, headers: Record<string, string>) {
  return new Promise<WebSocket>((resolve, reject) => {
    const client = new WebSocket(`${managerUrl}${path}`, { headers, perMessageDeflate: false });
    client.once("open", () => resolve(client));
    client.once("unexpected-response", (_request, response) => {
      reject(new UnexpectedResponseError(response.statusCode ?? 0));
    });
    client.once("error", reject);
  });
}

function nextMessage(socket: WebSocket) {
  return new Promise<RawData>((resolve) => socket.once("message", resolve));
}

function closeCode(socket: WebSocket) {
  return new Promise<number>((resolve) => socket.once("close", resolve));
}

function rawData(data: RawData) {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function serverPort(server: Server | WebSocketServer) {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  return address.port;
}

class MemoryNonceStore implements NonceStore {
  private readonly nonces = new Set<string>();

  claim(nonce: string) {
    if (this.nonces.has(nonce)) return false;
    this.nonces.add(nonce);
    return true;
  }
}

class UnexpectedResponseError extends Error {
  constructor(readonly status: number) {
    super(`Unexpected WebSocket response: ${status}`);
    this.name = "UnexpectedResponseError";
  }
}
