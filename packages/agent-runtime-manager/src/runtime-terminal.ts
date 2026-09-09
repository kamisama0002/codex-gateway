import type { IncomingMessage, Server } from "node:http";
import { StringDecoder } from "node:string_decoder";
import type { Duplex } from "node:stream";
import {
  runtimeTerminalClientMessageSchema,
  runtimeTerminalOpenSchema,
  type RuntimeTerminalOpen,
  type RuntimeTerminalServerMessage,
} from "@codex-gateway/agent-runtime-contracts";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { z } from "zod";
import type { DockerTerminalProcess } from "./docker-engine.js";
import { HmacRequestAuthenticator, RuntimeAuthenticationError } from "./auth.js";

const TERMINAL_OPEN_TIMEOUT_MS = 5_000;
const terminalPath = /^\/v1\/runtimes\/([^/]+)\/generations\/(\d+)\/terminal$/u;
const terminalTargetSchema = z
  .object({
    runtimeId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u),
    placementGeneration: z.number().int().positive(),
  })
  .strict();

export interface RuntimeTerminalRequest {
  runtimeId: string;
  placementGeneration: number;
}

export function isRuntimeTerminalPath(pathname: string) {
  return terminalPath.test(pathname);
}

export function attachRuntimeTerminal(
  server: Server,
  options: {
    authenticator: HmacRequestAuthenticator;
    openTerminal(
      request: RuntimeTerminalRequest,
      input: RuntimeTerminalOpen,
    ): Promise<DockerTerminalProcess>;
  },
) {
  const websocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://runtime-manager.internal");
    if (!isRuntimeTerminalPath(url.pathname)) return;
    handleUpgrade(request, socket, head, websocketServer, options, url);
  });
  server.on("close", () => websocketServer.close());
}

function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  websocketServer: WebSocketServer,
  options: {
    authenticator: HmacRequestAuthenticator;
    openTerminal(
      request: RuntimeTerminalRequest,
      input: RuntimeTerminalOpen,
    ): Promise<DockerTerminalProcess>;
  },
  url: URL,
) {
  try {
    if (request.method !== "GET" || url.search !== "") return rejectUpgrade(socket, 404);
    options.authenticator.authenticate(request.headers, Buffer.alloc(0), "GET", url.pathname);
    const match = terminalPath.exec(url.pathname);
    if (match === null) return rejectUpgrade(socket, 404);
    const target = terminalTargetSchema.parse({
      runtimeId: decodeURIComponent(match[1] ?? ""),
      placementGeneration: Number(match[2]),
    });
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      runTerminalSession(websocket, target, options);
    });
  } catch (error) {
    rejectUpgrade(socket, error instanceof RuntimeAuthenticationError ? 401 : 409);
  }
}

function runTerminalSession(
  websocket: WebSocket,
  target: RuntimeTerminalRequest,
  options: {
    openTerminal(
      request: RuntimeTerminalRequest,
      input: RuntimeTerminalOpen,
    ): Promise<DockerTerminalProcess>;
  },
) {
  let terminal: DockerTerminalProcess | null = null;
  let opening = false;
  let terminalClosed = false;
  const openTimer = setTimeout(
    () => fail("runtime_terminal_open_timeout"),
    TERMINAL_OPEN_TIMEOUT_MS,
  );

  const closeTerminal = () => {
    if (terminalClosed) return;
    terminalClosed = true;
    terminal?.close();
  };
  const fail = (code: string) => {
    send(websocket, { type: "error", code: safeErrorCode(code) });
    closeTerminal();
    if (websocket.readyState < WebSocket.CLOSING) websocket.close(1011);
  };

  websocket.on("message", (raw: RawData, isBinary: boolean) => {
    void (async () => {
      try {
        if (isBinary) throw new Error("runtime_terminal_message_invalid");
        const message = runtimeTerminalClientMessageSchema.parse(
          JSON.parse(rawWebSocketDataToString(raw)),
        );
        if (terminal === null) {
          if (message.type !== "open" || opening) throw new Error("runtime_terminal_open_required");
          opening = true;
          const open = runtimeTerminalOpenSchema.parse(message);
          terminal = await options.openTerminal(target, open);
          clearTimeout(openTimer);
          bindTerminal(websocket, terminal, closeTerminal);
          send(websocket, { type: "ready" });
          return;
        }
        if (message.type === "input") terminal.stream.write(message.data);
        else if (message.type === "resize") await terminal.resize(message.cols, message.rows);
        else if (message.type === "close") {
          closeTerminal();
          if (websocket.readyState < WebSocket.CLOSING) websocket.close(1000);
        } else {
          throw new Error("runtime_terminal_already_open");
        }
      } catch (error) {
        fail(errorCode(error));
      }
    })();
  });
  websocket.on("close", () => {
    clearTimeout(openTimer);
    closeTerminal();
  });
  websocket.on("error", closeTerminal);
}

function bindTerminal(
  websocket: WebSocket,
  terminal: DockerTerminalProcess,
  closeTerminal: () => void,
) {
  const decoder = new StringDecoder("utf8");
  let exited = false;
  const finish = () => {
    if (exited) return;
    exited = true;
    const trailing = decoder.end();
    if (trailing) send(websocket, { type: "output", data: trailing });
    void terminal
      .exitCode()
      .then((code) => send(websocket, { type: "exit", code }))
      .catch(() => send(websocket, { type: "error", code: "runtime_terminal_failed" }))
      .finally(() => {
        closeTerminal();
        if (websocket.readyState < WebSocket.CLOSING) websocket.close(1000);
      });
  };
  terminal.stream.on("data", (chunk: Buffer) => {
    const data = decoder.write(Buffer.from(chunk));
    if (data) send(websocket, { type: "output", data });
  });
  terminal.stream.once("end", finish);
  terminal.stream.once("close", finish);
  terminal.stream.once("error", () => {
    send(websocket, { type: "error", code: "runtime_terminal_failed" });
    finish();
  });
}

function send(websocket: WebSocket, message: RuntimeTerminalServerMessage) {
  if (websocket.readyState === WebSocket.OPEN) websocket.send(JSON.stringify(message));
}

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : error instanceof Error
      ? error.message
      : "runtime_terminal_failed";
}

function safeErrorCode(code: string) {
  return /^[a-z][a-z0-9_]{2,127}$/u.test(code) ? code : "runtime_terminal_failed";
}

function rejectUpgrade(socket: Duplex, status: number) {
  if (socket.destroyed) return;
  const reason = status === 401 ? "Unauthorized" : status === 404 ? "Not Found" : "Conflict";
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function rawWebSocketDataToString(data: RawData) {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}
