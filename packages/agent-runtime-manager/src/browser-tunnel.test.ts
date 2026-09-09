import { createServer, type Server } from "node:http";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { attachRuntimeBrowserTunnel } from "./browser-tunnel.js";
import { createSignedHeaders, HmacRequestAuthenticator, type NonceStore } from "./auth.js";

const now = 1_788_134_400_000;
const secret = "manager-secret";
const servers: Array<Server | NetServer> = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("Runtime Manager browser tunnel", () => {
  it("authenticates the private runtime preamble and relays raw browser bytes", async () => {
    const runtime = createNetServer((socket) => {
      let buffer = Buffer.alloc(0);
      let authenticated = false;
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        const newline = buffer.indexOf(0x0a);
        if (newline < 0) return;
        if (!authenticated) {
          expect(buffer.subarray(0, newline + 1).toString()).toBe("BROWSER/1 runtime-token\n");
          authenticated = true;
          buffer = buffer.subarray(newline + 1);
        }
        if (buffer.length > 0) socket.write(buffer);
        buffer = Buffer.alloc(0);
      });
    });
    servers.push(runtime);
    await new Promise<void>((resolve) => runtime.listen(0, "127.0.0.1", resolve));

    const manager = createServer((_request, response) => response.writeHead(404).end());
    servers.push(manager);
    attachRuntimeBrowserTunnel(manager, {
      authenticator: new HmacRequestAuthenticator({
        nonceStore: new MemoryNonceStore(),
        now: () => now,
        secret,
      }),
      resolveTarget: async () => ({
        host: "127.0.0.1",
        port: serverPort(runtime),
        serviceToken: "runtime-token",
      }),
    });
    await new Promise<void>((resolve) => manager.listen(0, "127.0.0.1", resolve));

    const path = "/v1/runtimes/runtime-a/generations/1/browser-tunnel/raw";
    const client = await connect(manager, path, "browser-raw");
    const message = new Promise<Buffer>((resolve) =>
      client.once("message", (data) =>
        resolve(
          Buffer.isBuffer(data)
            ? data
            : Array.isArray(data)
              ? Buffer.concat(data)
              : Buffer.from(data),
        ),
      ),
    );
    client.send(Buffer.from("GET /health HTTP/1.1\r\n\r\n"));
    expect((await message).toString()).toBe("GET /health HTTP/1.1\r\n\r\n");
    client.close();
  });
});

async function connect(server: Server, path: string, nonce: string) {
  const headers = createSignedHeaders({
    body: Buffer.alloc(0),
    method: "GET",
    path,
    nonce,
    secret,
    timestamp: now,
  });
  return await new Promise<WebSocket>((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${serverPort(server)}${path}`, { headers });
    client.once("open", () => resolve(client));
    client.once("error", reject);
  });
}

function serverPort(server: Server | NetServer) {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  return address.port;
}

class MemoryNonceStore implements NonceStore {
  private readonly values = new Set<string>();

  claim(nonce: string) {
    if (this.values.has(nonce)) return false;
    this.values.add(nonce);
    return true;
  }
}
