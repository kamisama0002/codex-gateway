import WebSocket, { type RawData } from "ws";
import type { ManagedRuntimeEndpoint } from "@codex-gateway/agent-runtime-contracts";
import type { HostRecord, RpcEnvelope } from "~~/shared/types";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { createRpcTransportError, type RpcTransportCloseDetail } from "./rpc-errors";
import type { CodexRpcTransportOptions, RpcTransport } from "./rpc-transport";

const managedEndpoints = new WeakMap<HostRecord, ManagedRuntimeEndpoint>();
const DEFAULT_MANAGED_RPC_HANDSHAKE_TIMEOUT_MS = 30_000;

export function createManagedRuntimeHost(
  userId: number,
  timestamps: { createdAt: string; updatedAt: string },
  endpoint: ManagedRuntimeEndpoint,
): HostRecord {
  if (!Number.isInteger(userId) || userId <= 0)
    throw new Error("Managed runtime user ID is invalid");
  const host: HostRecord = {
    id: MANAGED_RUNTIME_HOST_ID,
    connectionKind: "managed",
    name: "Managed Codex Runtime",
    sshHost: "managed-runtime.internal",
    username: null,
    port: null,
    authMode: "agent",
    privateKeyPath: null,
    privateKey: null,
    password: null,
    proxyUrl: null,
    hasPassword: false,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  };
  managedEndpoints.set(host, endpoint);
  return host;
}

export class ManagedCodexRpcTransport implements RpcTransport {
  private closed = false;
  private ws: WebSocket | null = null;

  constructor(
    private readonly host: HostRecord,
    private readonly endpoint: ManagedRuntimeEndpoint,
    private readonly options: CodexRpcTransportOptions,
    private readonly handshakeTimeoutMs = DEFAULT_MANAGED_RPC_HANDSHAKE_TIMEOUT_MS,
  ) {
    if (!Number.isInteger(this.handshakeTimeoutMs) || this.handshakeTimeoutMs <= 0) {
      throw new Error("Managed Codex RPC handshake timeout must be a positive integer");
    }
  }

  async connect(): Promise<void> {
    this.closed = false;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let opened = false;
      const ws = new WebSocket(this.endpoint.websocketUrl, {
        headers: { authorization: `Bearer ${this.endpoint.serviceToken}` },
        perMessageDeflate: false,
      });
      this.ws = ws;
      const deadline = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.closed = true;
        this.ws = null;
        ws.terminate();
        reject(new ManagedCodexRpcHandshakeTimeoutError());
      }, this.handshakeTimeoutMs);
      ws.on("open", () => {
        if (settled) return;
        settled = true;
        opened = true;
        clearTimeout(deadline);
        resolve();
      });
      ws.on("message", (data) => this.options.onMessage(rawWebSocketDataToString(data)));
      ws.on("error", () => {
        const detail = { code: null, signal: null };
        const error = managedTransportError(this.host, "websocketHandshake", detail);
        if (!settled) {
          settled = true;
          this.closed = true;
          clearTimeout(deadline);
          reject(error);
          return;
        }
        if (opened) this.closeFromRemote(error, detail);
      });
      ws.on("close", (code) => {
        const detail = { code, signal: null };
        const error = managedTransportError(this.host, "transport", detail);
        if (!settled) {
          settled = true;
          this.closed = true;
          clearTimeout(deadline);
          reject(error);
          return;
        }
        if (opened) this.closeFromRemote(error, detail);
      });
    });
  }

  send(message: RpcEnvelope): void {
    if (this.ws === null) throw new Error("Codex RPC transport is not connected");
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Codex RPC transport is not open: readyState ${this.ws.readyState}`);
    }
    this.ws.send(JSON.stringify(message));
  }

  close(): void {
    this.closed = true;
    const ws = this.ws;
    this.ws = null;
    if (ws === null) return;
    if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
    else if (ws.readyState === WebSocket.OPEN) ws.close();
  }

  private closeFromRemote(error: Error, detail: RpcTransportCloseDetail): void {
    if (this.closed) return;
    this.closed = true;
    this.ws = null;
    this.options.onClose(error, detail);
  }
}

export class ManagedCodexRpcHandshakeTimeoutError extends Error {
  readonly code = "managed_rpc_handshake_timeout";

  constructor() {
    super("managed_rpc_handshake_timeout");
    this.name = "ManagedCodexRpcHandshakeTimeoutError";
  }
}

export function managedRuntimeEndpointForHost(host: HostRecord): ManagedRuntimeEndpoint {
  const endpoint = managedEndpoints.get(host);
  if (endpoint === undefined) throw new Error("Managed runtime endpoint is unavailable");
  return endpoint;
}

function managedTransportError(
  host: HostRecord,
  phase: "websocketHandshake" | "transport",
  detail: RpcTransportCloseDetail,
) {
  const message =
    phase === "websocketHandshake"
      ? "Managed Codex RPC WebSocket connection failed"
      : "Managed Codex RPC WebSocket closed";
  return createRpcTransportError(host, phase, "", detail, new Error(message));
}

function rawWebSocketDataToString(data: RawData) {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}
