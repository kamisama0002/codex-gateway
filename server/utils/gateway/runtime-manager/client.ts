import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  managedRuntimeEndpointSchema,
  runtimeTypeSchema,
  type ManagedRuntimeEndpoint,
  type RuntimeType,
} from "@codex-gateway/agent-runtime-contracts";
import { z } from "zod";

const runtimeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const imageAliasSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);
const providerIdSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9_-]*$/);
const runtimeActionRequestSchema = z.object({ runtimeId: runtimeIdSchema }).strict();
const provisionRuntimeRequestSchema = z
  .object({
    runtimeId: runtimeIdSchema,
    userHash: z.string().regex(/^[a-f0-9]{64}$/),
    runtimeType: runtimeTypeSchema,
    imageAlias: imageAliasSchema,
    providerConfig: z
      .object({
        providerId: providerIdSchema,
        modelId: z.string().min(1).max(256),
        baseUrl: z.url(),
        wireApi: z.literal("responses"),
        token: z.string().min(1).max(4096),
      })
      .strict()
      .optional(),
  })
  .strict();
const upgradeRuntimeRequestSchema = z
  .object({ runtimeId: runtimeIdSchema, imageAlias: imageAliasSchema })
  .strict();
const internalManagedRuntimeEndpointSchema = managedRuntimeEndpointSchema.refine((endpoint) => {
  try {
    const protocol = new URL(endpoint.websocketUrl).protocol;
    return protocol === "ws:" || protocol === "wss:";
  } catch {
    return false;
  }
}, "Managed runtime endpoint must use WebSocket");
const runtimeLifecycleResultSchema = z
  .object({
    runtimeId: runtimeIdSchema,
    containerId: z.string().min(1).nullable(),
    imageAlias: imageAliasSchema.nullable(),
    imageVersion: z.string().min(1).nullable(),
    status: z.enum(["absent", "stopped", "running"]),
    endpoint: internalManagedRuntimeEndpointSchema.nullable(),
  })
  .strict();
const agentContainerStatsSchema = z
  .object({
    sampledAtMs: z.number().int().nonnegative(),
    cpuUsage: z.number().nonnegative(),
    systemCpuUsage: z.number().nonnegative(),
    preCpuUsage: z.number().nonnegative(),
    preSystemCpuUsage: z.number().nonnegative(),
    onlineCpus: z.number().int().positive(),
    memoryUsageBytes: z.number().nonnegative(),
    memoryLimitBytes: z.number().positive(),
    rxBytes: z.number().nonnegative(),
    txBytes: z.number().nonnegative(),
    diskReadBytes: z.number().nonnegative(),
    diskWriteBytes: z.number().nonnegative(),
    interfaces: z.array(z.string().min(1)).min(1),
    cpuQuotaCpus: z.number().positive(),
  })
  .strict();
const agentRuntimeStatsResultSchema = z
  .object({
    runtimeId: runtimeIdSchema,
    status: z.enum(["absent", "stopped", "running"]),
    stats: agentContainerStatsSchema.nullable(),
  })
  .strict();
const execRuntimeRequestSchema = z
  .object({
    runtimeId: runtimeIdSchema,
    command: z.string().min(1).max(64 * 1024),
    timeoutMs: z.number().int().positive().max(60_000),
    maxOutputBytes: z.number().int().positive().max(4 * 1024 * 1024),
  })
  .strict();
const execRuntimeResultSchema = z
  .object({
    code: z.number().int().nullable(),
    stdout: z.string(),
    stderr: z.string(),
  })
  .strict();
const managerErrorSchema = z.object({ error: z.string().min(1) }).strict();
const DEFAULT_RUNTIME_MANAGER_TIMEOUT_MS = 30_000;

export interface ProvisionRuntimeRequest {
  runtimeId: string;
  userHash: string;
  runtimeType: RuntimeType;
  imageAlias: string;
  providerConfig?: {
    providerId: string;
    modelId: string;
    baseUrl: string;
    wireApi: "responses";
    token: string;
  };
}

export interface RuntimeLifecycleResult {
  runtimeId: string;
  containerId: string | null;
  imageAlias: string | null;
  imageVersion: string | null;
  status: "absent" | "stopped" | "running";
  endpoint: ManagedRuntimeEndpoint | null;
}

export type AgentRuntimeStatsResult = z.infer<typeof agentRuntimeStatsResultSchema>;
export type ExecRuntimeResult = z.infer<typeof execRuntimeResultSchema>;

interface RuntimeManagerClientOptions {
  baseUrl: string;
  secret: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  nonce?: () => string;
  timeoutMs?: number;
}

export class RuntimeManagerClientError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number | null = null,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "RuntimeManagerClientError";
  }
}

export class RuntimeManagerClient {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly nonce: () => string;
  private readonly now: () => number;
  private readonly secret: string;
  private readonly timeoutMs: number;

  constructor(options: RuntimeManagerClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    if (options.secret.length === 0) throw new Error("Runtime Manager shared secret is required");
    this.secret = options.secret;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.nonce = options.nonce ?? randomUUID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_RUNTIME_MANAGER_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Runtime Manager timeout must be a positive integer");
    }
  }

  inspect(runtimeId: string): Promise<RuntimeLifecycleResult> {
    const input = runtimeActionRequestSchema.parse({ runtimeId });
    return this.request("GET", `/v1/runtimes/${encodeURIComponent(input.runtimeId)}`);
  }

  stats(runtimeId: string): Promise<AgentRuntimeStatsResult> {
    const input = runtimeActionRequestSchema.parse({ runtimeId });
    return this.requestParsed(
      "GET",
      `/v1/runtimes/${encodeURIComponent(input.runtimeId)}/stats`,
      undefined,
      agentRuntimeStatsResultSchema,
    );
  }

  exec(input: {
    runtimeId: string;
    command: string;
    timeoutMs: number;
    maxOutputBytes: number;
  }): Promise<ExecRuntimeResult> {
    const parsed = execRuntimeRequestSchema.parse(input);
    return this.requestParsed(
      "POST",
      "/v1/runtimes/exec",
      parsed,
      execRuntimeResultSchema,
      parsed.timeoutMs + 5_000,
    );
  }

  provision(input: ProvisionRuntimeRequest): Promise<RuntimeLifecycleResult> {
    return this.request(
      "POST",
      "/v1/runtimes/provision",
      provisionRuntimeRequestSchema.parse(input),
    );
  }

  start(runtimeId: string): Promise<RuntimeLifecycleResult> {
    return this.action("start", runtimeId);
  }

  stop(runtimeId: string): Promise<RuntimeLifecycleResult> {
    return this.action("stop", runtimeId);
  }

  restart(runtimeId: string): Promise<RuntimeLifecycleResult> {
    return this.action("restart", runtimeId);
  }

  remove(runtimeId: string): Promise<RuntimeLifecycleResult> {
    return this.action("remove", runtimeId);
  }

  upgrade(runtimeId: string, imageAlias: string): Promise<RuntimeLifecycleResult> {
    return this.request(
      "POST",
      "/v1/runtimes/upgrade",
      upgradeRuntimeRequestSchema.parse({ runtimeId, imageAlias }),
    );
  }

  private action(action: "start" | "stop" | "restart" | "remove", runtimeId: string) {
    return this.request(
      "POST",
      `/v1/runtimes/${action}`,
      runtimeActionRequestSchema.parse({ runtimeId }),
    );
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    payload?: Record<string, unknown>,
  ): Promise<RuntimeLifecycleResult> {
    return this.requestParsed(method, path, payload, runtimeLifecycleResultSchema);
  }

  private async requestParsed<T>(
    method: "GET" | "POST",
    path: string,
    payload: Record<string, unknown> | undefined,
    schema: z.ZodType<T>,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const timestamp = this.now();
    const nonce = this.nonce();
    const bodySha256 = createHash("sha256").update(body).digest("hex");
    const headers: Record<string, string> = {
      "x-runtime-body-sha256": bodySha256,
      "x-runtime-nonce": nonce,
      "x-runtime-signature": createHmac("sha256", this.secret)
        .update(
          `${method}\n${normalizeRequestPath(path)}\n${timestamp}\n${nonce}\n${bodySha256}`,
          "utf8",
        )
        .digest("hex"),
      "x-runtime-timestamp": String(timestamp),
    };
    if (payload !== undefined) headers["content-type"] = "application/json";

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        signal: controller.signal,
        ...(payload === undefined ? {} : { body }),
      });
      const value = await parseJsonResponse(response);
      if (!response.ok) {
        const parsedError = managerErrorSchema.safeParse(value);
        throw new RuntimeManagerClientError(
          parsedError.success ? parsedError.data.error : "runtime_manager_request_failed",
          response.status,
        );
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new RuntimeManagerClientError("runtime_manager_invalid_response", response.status, {
          cause: parsed.error,
        });
      }
      return parsed.data;
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new RuntimeManagerClientError("runtime_manager_timeout");
      }
      if (cause instanceof RuntimeManagerClientError) throw cause;
      throw new RuntimeManagerClientError("runtime_manager_unavailable", null, { cause });
    } finally {
      clearTimeout(deadline);
    }
  }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new RuntimeManagerClientError("runtime_manager_invalid_response", response.status, {
      cause,
    });
  }
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("Runtime Manager base URL must be an HTTP origin");
  }
  return url.origin;
}

function normalizeRequestPath(path: string): string {
  const origin = new URL("http://runtime-manager.internal");
  const normalized = new URL(path, origin);
  if (normalized.origin !== origin.origin || normalized.search !== "" || normalized.hash !== "") {
    throw new Error("Runtime Manager request path is invalid");
  }
  return normalized.pathname;
}
