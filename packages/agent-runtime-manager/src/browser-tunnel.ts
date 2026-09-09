import { Agent } from "node:http";
import { connect, type Socket } from "node:net";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer, type RawData } from "ws";

import { HmacRequestAuthenticator, RuntimeAuthenticationError } from "./auth.js";

const tunnelPath = /^\/v1\/runtimes\/([^/]+)\/generations\/(\d+)\/browser-tunnel(?<raw>\/raw)?$/u;
const MAX_TUNNEL_PREAMBLE_BYTES = 1024;

export interface RuntimeBrowserRelayRequest {
  runtimeId: string;
  placementGeneration: number;
  raw: boolean;
}

export function attachRuntimeBrowserTunnel(
  server: Server,
  options: {
    authenticator: HmacRequestAuthenticator;
    resolveTarget(input: RuntimeBrowserRelayRequest): Promise<{
      host: string;
      port: number;
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
    resolveTarget(input: RuntimeBrowserRelayRequest): Promise<{
      host: string;
      port: number;
      serviceToken: string;
    }>;
  },
) {
  let runtimeSocket: Socket | null = null;
  let upstream: WebSocket | null = null;
  try {
    const url = new URL(request.url ?? "/", "http://runtime-manager.internal");
    if (request.method !== "GET" || url.search !== "") return rejectUpgrade(socket, 404);
    options.authenticator.authenticate(request.headers, Buffer.alloc(0), "GET", url.pathname);
    const match = tunnelPath.exec(url.pathname);
    if (match === null) return rejectUpgrade(socket, 404);
    const input = {
      runtimeId: decodeURIComponent(match[1] ?? ""),
      placementGeneration: Number(match[2]),
      raw: match.groups?.raw === "/raw",
    };
    const target = await options.resolveTarget(input);
    runtimeSocket = connect({ host: target.host, port: target.port });
    await waitForSocket(runtimeSocket);
    runtimeSocket.write(browserPreamble(target.serviceToken));

    if (input.raw) {
      websocketServer.handleUpgrade(request, socket, head, (downstream) => {
        bridgeRawWebSocket(downstream, runtimeSocket!);
      });
      runtimeSocket = null;
      return;
    }

    const upstreamPath = browserUpstreamPath(request.headers["x-browser-upstream-path"]);
    upstream = new WebSocket(`ws://runtime-browser.internal:6081${upstreamPath}`, {
      agent: new ExistingSocketAgent(runtimeSocket),
      perMessageDeflate: false,
    });
    await waitForOpen(upstream);
    websocketServer.handleUpgrade(request, socket, head, (downstream) => {
      bridgeWebSockets(downstream, upstream!);
    });
    runtimeSocket = null;
  } catch (error) {
    upstream?.terminate();
    runtimeSocket?.destroy();
    rejectUpgrade(socket, error instanceof RuntimeAuthenticationError ? 401 : 502);
  }
}

function bridgeRawWebSocket(websocket: WebSocket, runtimeSocket: Socket) {
  websocket.on("message", (data, isBinary) => {
    if (runtimeSocket.destroyed) return;
    runtimeSocket.write(rawDataToBuffer(data, isBinary));
  });
  runtimeSocket.on("data", (data) => {
    if (websocket.readyState === WebSocket.OPEN) websocket.send(data, { binary: true });
  });
  websocket.on("close", () => runtimeSocket.destroy());
  websocket.on("error", () => runtimeSocket.destroy());
  runtimeSocket.on("close", () => closeWebSocket(websocket));
  runtimeSocket.on("error", () => closeWebSocket(websocket));
}

function bridgeWebSockets(upstream: WebSocket, downstream: WebSocket) {
  const forward = (target: WebSocket, data: RawData, isBinary: boolean) => {
    if (target.readyState === WebSocket.OPEN) target.send(data, { binary: isBinary });
  };
  downstream.on("message", (data, isBinary) => forward(upstream, data, isBinary));
  upstream.on("message", (data, isBinary) => forward(downstream, data, isBinary));
  downstream.on("close", (code, reason) => closeWebSocket(upstream, code, reason));
  upstream.on("close", (code, reason) => closeWebSocket(downstream, code, reason));
  downstream.on("error", () => terminateWebSockets(downstream, upstream));
  upstream.on("error", () => terminateWebSockets(downstream, upstream));
}

function waitForSocket(socket: Socket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
    socket.once("close", () => reject(new Error("Browser proxy closed during handshake")));
  });
}

function waitForOpen(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
    socket.once("close", () => reject(new Error("Browser upstream closed during handshake")));
  });
}

function browserPreamble(token: string) {
  const value = `BROWSER/1 ${token}\n`;
  if (Buffer.byteLength(value) > MAX_TUNNEL_PREAMBLE_BYTES)
    throw new Error("Browser token is too long");
  return value;
}

function browserUpstreamPath(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === undefined || candidate === "") return "/websockify";
  const url = new URL(candidate, "http://browser-path.invalid");
  if (url.origin !== "http://browser-path.invalid" || !url.pathname.startsWith("/")) {
    throw new Error("Browser upstream path is invalid");
  }
  return `${url.pathname}${url.search}`;
}

function rawDataToBuffer(data: RawData, isBinary: boolean) {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  const value = Buffer.from(data);
  return isBinary ? value : Buffer.from(value.toString("utf8"), "utf8");
}

function closeWebSocket(
  socket: WebSocket,
  code = 1000,
  reason: Buffer<ArrayBufferLike> = Buffer.alloc(0),
) {
  if (socket.readyState >= WebSocket.CLOSING) return;
  socket.close(validCloseCode(code) ? code : 1000, reason.toString("utf8"));
}

function terminateWebSockets(left: WebSocket, right: WebSocket) {
  if (left.readyState < WebSocket.CLOSED) left.terminate();
  if (right.readyState < WebSocket.CLOSED) right.terminate();
}

function validCloseCode(code: number) {
  return (
    code === 1000 ||
    code === 1001 ||
    code === 1002 ||
    code === 1003 ||
    (code >= 1007 && code <= 1014) ||
    (code >= 3000 && code <= 4999)
  );
}

function rejectUpgrade(socket: Duplex, status: number) {
  if (socket.destroyed) return;
  const reason = status === 401 ? "Unauthorized" : status === 404 ? "Not Found" : "Bad Gateway";
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

class ExistingSocketAgent extends Agent {
  constructor(private readonly socket: Socket) {
    super();
  }

  createConnection(_options: object, callback: (error: Error | null, socket?: Duplex) => void) {
    callback(null, this.socket);
    return this.socket;
  }
}
