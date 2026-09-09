import WebSocket, { type RawData } from "ws";
import { Duplex } from "node:stream";
import type { RuntimeBrowserRelayTarget } from "../runtime-manager/client";
import type { BrowserPreviewSession } from "./browser-preview-manager";

const CONNECT_TIMEOUT_MS = 30_000;

export class RuntimeBrowserUpstreamConnector {
  async openSocket(session: BrowserPreviewSession): Promise<Duplex> {
    const target = requireRelay(session);
    const socket = await openWebSocket(target.rawWebsocketUrl, target.rawHeaders());
    return new RuntimeBrowserSocket(socket);
  }

  async openWebSocket(
    session: BrowserPreviewSession,
    path = "/websockify",
    _protocols?: string[],
    headers: Record<string, string> = {},
  ): Promise<WebSocket> {
    const target = requireRelay(session);
    return await openWebSocket(target.websocketUrl, {
      ...target.headers(),
      "x-browser-upstream-path": safeUpstreamPath(path),
      ...headers,
    });
  }
}

function safeUpstreamPath(value: string) {
  const url = new URL(value, "http://browser-path.invalid");
  if (url.origin !== "http://browser-path.invalid" || !url.pathname.startsWith("/")) {
    throw new Error("Browser upstream path is invalid");
  }
  return `${url.pathname}${url.search}`;
}

export const runtimeBrowserUpstreamConnector = new RuntimeBrowserUpstreamConnector();

function requireRelay(session: BrowserPreviewSession): RuntimeBrowserRelayTarget {
  if (session.runtimeRelayTarget === undefined) {
    throw new Error("Managed runtime browser relay is unavailable");
  }
  return session.runtimeRelayTarget;
}

function openWebSocket(url: string, headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers, perMessageDeflate: false });
    const deadline = setTimeout(() => {
      socket.terminate();
      reject(new Error("Managed runtime browser relay timed out"));
    }, CONNECT_TIMEOUT_MS);
    socket.once("open", () => {
      clearTimeout(deadline);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
  });
}

class RuntimeBrowserSocket extends Duplex {
  constructor(private readonly socket: WebSocket) {
    super();
    socket.on("message", (data: RawData) => {
      const buffer = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data);
      this.push(buffer);
    });
    socket.once("close", () => this.push(null));
    socket.once("error", (error) => this.destroy(error));
  }

  override _read() {}

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      callback(new Error("Managed runtime browser relay is closed"));
      return;
    }
    this.socket.send(chunk, { binary: true }, callback);
  }

  override _final(callback: (error?: Error | null) => void) {
    this.socket.close();
    callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.terminate();
    callback(error);
  }
}
