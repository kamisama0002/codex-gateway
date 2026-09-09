import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { z } from "zod";
import { HmacRequestAuthenticator, RuntimeAuthenticationError } from "./auth.js";

const relayPath = /^\/v1\/runtimes\/([^/]+)\/generations\/(\d+)\/rpc$/u;
const relayRequestSchema = z
  .object({
    runtimeId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u),
    placementGeneration: z.number().int().positive(),
  })
  .strict();
const relayTargetSchema = z
  .object({
    websocketUrl: z.url().refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "ws:" || protocol === "wss:";
    }),
    serviceToken: z.string().min(1).max(4096),
  })
  .strict();

export interface RuntimeRpcRelayRequest {
  runtimeId: string;
  placementGeneration: number;
}

export function attachRuntimeRpcRelay(
  server: Server,
  options: {
    authenticator: HmacRequestAuthenticator;
    resolveTarget(input: RuntimeRpcRelayRequest): Promise<{
      websocketUrl: string;
      serviceToken: string;
    }>;
  },
) {
  const websocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  server.on("upgrade", (request, socket, head) => {
    void handleUpgrade(request, socket, head, websocketServer, options);
  });
  server.on("close", () => websocketServer.close());
}

async function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  websocketServer: WebSocketServer,
  options: {
    authenticator: HmacRequestAuthenticator;
    resolveTarget(input: RuntimeRpcRelayRequest): Promise<{
      websocketUrl: string;
      serviceToken: string;
    }>;
  },
) {
  let downstream: WebSocket | null = null;
  try {
    const url = new URL(request.url ?? "/", "http://runtime-manager.internal");
    const match = relayPath.exec(url.pathname);
    if (match === null) return;
    if (request.method !== "GET" || url.search !== "") return rejectUpgrade(socket, 404);
    options.authenticator.authenticate(request.headers, Buffer.alloc(0), "GET", url.pathname);
    const input = relayRequestSchema.parse({
      runtimeId: decodeURIComponent(match[1] ?? ""),
      placementGeneration: Number(match[2]),
    });
    const target = relayTargetSchema.parse(await options.resolveTarget(input));
    downstream = new WebSocket(target.websocketUrl, {
      headers: { authorization: `Bearer ${target.serviceToken}` },
      perMessageDeflate: false,
    });
    await waitForOpen(downstream);
    websocketServer.handleUpgrade(request, socket, head, (upstream) => {
      bridgeWebSockets(upstream, downstream!);
    });
  } catch (error) {
    downstream?.terminate();
    rejectUpgrade(
      socket,
      error instanceof RuntimeAuthenticationError ? 401 : relayErrorStatus(error),
    );
  }
}

function waitForOpen(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
    socket.once("close", () => reject(new Error("Downstream App Server closed during handshake")));
  });
}

function bridgeWebSockets(upstream: WebSocket, downstream: WebSocket) {
  const forward = (target: WebSocket, data: RawData, isBinary: boolean) => {
    if (target.readyState === WebSocket.OPEN) target.send(data, { binary: isBinary });
  };
  upstream.on("message", (data, isBinary) => forward(downstream, data, isBinary));
  downstream.on("message", (data, isBinary) => forward(upstream, data, isBinary));
  upstream.on("close", (code, reason) => closePeer(downstream, code, reason));
  downstream.on("close", (code, reason) => closePeer(upstream, code, reason));
  upstream.on("error", () => terminatePeers(upstream, downstream));
  downstream.on("error", () => terminatePeers(upstream, downstream));
}

function closePeer(socket: WebSocket, code: number, reason: Buffer) {
  if (socket.readyState >= WebSocket.CLOSING) return;
  if (validWebSocketCloseCode(code)) socket.close(code, reason);
  else socket.close();
}

function validWebSocketCloseCode(code: number) {
  return (
    code === 1000 ||
    code === 1001 ||
    code === 1002 ||
    code === 1003 ||
    (code >= 1007 && code <= 1014) ||
    (code >= 3000 && code <= 4999)
  );
}

function terminatePeers(left: WebSocket, right: WebSocket) {
  if (left.readyState < WebSocket.CLOSED) left.terminate();
  if (right.readyState < WebSocket.CLOSED) right.terminate();
}

function rejectUpgrade(socket: Duplex, status: number) {
  if (socket.destroyed) return;
  const reason = status === 401 ? "Unauthorized" : status === 404 ? "Not Found" : "Conflict";
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function relayErrorStatus(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (
      error.code === "runtime_not_found" ||
      error.code === "runtime_identity_conflict" ||
      error.code === "stale_placement_generation"
    ) {
      return 409;
    }
  }
  return 502;
}
