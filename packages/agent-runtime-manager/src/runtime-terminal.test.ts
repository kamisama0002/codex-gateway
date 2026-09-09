import { createServer, type Server } from "node:http";
import { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { type RawData } from "ws";
import { createSignedHeaders, HmacRequestAuthenticator, type NonceStore } from "./auth.js";
import { attachRuntimeTerminal } from "./runtime-terminal.js";

const now = 1_788_131_200_000;
const servers: Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("Runtime Manager terminal WebSocket", () => {
  it("authenticates and bridges open, output, input, resize, and close frames", async () => {
    const input: string[] = [];
    const stream = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        input.push(Buffer.from(chunk).toString("utf8"));
        callback();
      },
    });
    const resize = vi.fn(async () => undefined);
    const close = vi.fn(() => stream.destroy());
    const openTerminal = vi.fn(async () => ({
      stream,
      resize,
      exitCode: async () => 0,
      close,
    }));
    const { server, url, path } = await startServer(openTerminal);
    servers.push(server);
    const socket = new WebSocket(url, {
      headers: createSignedHeaders({
        body: Buffer.alloc(0),
        method: "GET",
        path,
        nonce: "terminal-1",
        secret: "shared-secret",
        timestamp: now,
      }),
    });
    sockets.push(socket);
    await waitForOpen(socket);
    const ready = nextJson(socket);
    socket.send(JSON.stringify({ type: "open", cwd: "/workspace", cols: 80, rows: 24 }));

    await expect(ready).resolves.toEqual({ type: "ready" });
    expect(openTerminal).toHaveBeenCalledWith(
      { runtimeId: "runtime-a", placementGeneration: 1 },
      { type: "open", cwd: "/workspace", cols: 80, rows: 24 },
    );
    const outputPromise = nextJson(socket);
    stream.push(Buffer.from("terminal-ready\r\n"));
    await expect(outputPromise).resolves.toEqual({ type: "output", data: "terminal-ready\r\n" });

    socket.send(JSON.stringify({ type: "input", data: "pwd\r" }));
    socket.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    await vi.waitFor(() => {
      expect(input).toEqual(["pwd\r"]);
      expect(resize).toHaveBeenCalledWith(120, 40);
    });
    socket.send(JSON.stringify({ type: "close" }));
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it("rejects an unsigned terminal upgrade", async () => {
    const { server, url } = await startServer(async () => {
      throw new Error("must not open");
    });
    servers.push(server);
    const status = await new Promise<number>((resolve) => {
      const socket = new WebSocket(url);
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      socket.once("error", () => undefined);
    });

    expect(status).toBe(401);
  });
});

async function startServer(openTerminal: Parameters<typeof attachRuntimeTerminal>[1]["openTerminal"]) {
  const authenticator = new HmacRequestAuthenticator({
    nonceStore: new MemoryNonceStore(),
    now: () => now,
    secret: "shared-secret",
  });
  const server = createServer((_request, response) => response.end());
  attachRuntimeTerminal(server, { authenticator, openTerminal });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing server address");
  const path = "/v1/runtimes/runtime-a/generations/1/terminal";
  return { server, path, url: `ws://127.0.0.1:${address.port}${path}` };
}

function waitForOpen(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function nextJson(socket: WebSocket) {
  return new Promise<unknown>((resolve, reject) => {
    socket.once("message", (data: RawData) => {
      try {
        resolve(JSON.parse(data.toString()) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

class MemoryNonceStore implements NonceStore {
  private readonly nonces = new Set<string>();

  claim(nonce: string): boolean {
    if (this.nonces.has(nonce)) return false;
    this.nonces.add(nonce);
    return true;
  }
}
