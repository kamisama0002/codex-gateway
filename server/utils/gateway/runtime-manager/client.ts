import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  managedRuntimeEndpointSchema,
  runtimeTypeSchema,
  type ManagedRuntimeEndpoint,
  type RuntimeType,
} from "@codex-gateway/agent-runtime-contracts";
import type { ResolvedRuntimeSecret } from "~~/shared/types";
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
const providerIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
const runtimeNodeIdSchema = z
  .string()
  .min(7)
  .max(128)
  .regex(/^node__[a-z0-9][a-z0-9_.-]*$/u);
const runtimePlacementIdentitySchema = z
  .object({
    runtimeId: runtimeIdSchema,
    nodeId: runtimeNodeIdSchema,
    placementGeneration: z.number().int().positive(),
  })
  .strict();
export const runtimeNodeHealthSchema = z
  .object({
    nodeId: runtimeNodeIdSchema,
    protocolVersion: z.literal(1),
    managerVersion: z.string().min(1).max(128),
    sampledAt: z.iso.datetime(),
    capacityCpuMillis: z.number().int().positive(),
    capacityMemoryBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxRuntimes: z.number().int().positive(),
    dockerAvailable: z.boolean(),
    dataRootWritable: z.boolean(),
    availableDiskBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    totalDiskBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    managedRuntimeCount: z.number().int().nonnegative(),
    runningRuntimeCount: z.number().int().nonnegative(),
    agentImages: z.record(imageAliasSchema, z.string().min(1).max(255)),
  })
  .strict()
  .refine((health) => health.runningRuntimeCount <= health.managedRuntimeCount);
const runtimeActionRequestSchema = runtimePlacementIdentitySchema;
export const runtimeResourcePolicySchema = z
  .object({
    memoryBytes: z
      .number()
      .int()
      .min(128 * 1024 * 1024)
      .max(16 * 1024 * 1024 * 1024),
    nanoCpus: z.number().int().min(250_000_000).max(8_000_000_000),
    pidsLimit: z.number().int().min(32).max(4096),
  })
  .strict();
export type RuntimeResourcePolicy = z.infer<typeof runtimeResourcePolicySchema>;
const runtimeResourceActionRequestSchema = z
  .object({
    ...runtimePlacementIdentitySchema.shape,
    resources: runtimeResourcePolicySchema.optional(),
  })
  .strict();
const provisionRuntimeRequestSchema = z
  .object({
    ...runtimePlacementIdentitySchema.shape,
    workspaceKey: z
      .string()
      .length(36)
      .regex(/^ws__[a-f0-9]{32}$/u),
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
    runtimeSecrets: z
      .array(
        z
          .object({
            credentialId: z.string().regex(/^cred__[a-z0-9][a-z0-9_.-]*$/u),
            capabilityId: z.string().regex(/^org__[a-z0-9][a-z0-9_.-]*$/u),
            version: z.number().int().positive(),
            target: z.discriminatedUnion("type", [
              z
                .object({
                  type: z.literal("env"),
                  name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u),
                })
                .strict(),
              z
                .object({
                  type: z.literal("file"),
                  path: z
                    .string()
                    .regex(/^\/run\/codex-secrets\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u),
                })
                .strict(),
            ]),
            value: z
              .string()
              .min(1)
              .max(1024 * 1024),
          })
          .strict(),
      )
      .max(64)
      .optional(),
    resources: runtimeResourcePolicySchema.optional(),
  })
  .strict();
const upgradeRuntimeRequestSchema = z
  .object({
    ...runtimePlacementIdentitySchema.shape,
    imageAlias: imageAliasSchema,
    resources: runtimeResourcePolicySchema.optional(),
  })
  .strict();
const forwardOAuthCallbackRequestSchema = z
  .object({
    ...runtimePlacementIdentitySchema.shape,
    pathAndQuery: z
      .string()
      .min(1)
      .max(32 * 1024)
      .refine((value) => {
        try {
          const url = new URL(value, "http://callback.invalid");
          return (
            url.origin === "http://callback.invalid" &&
            url.pathname === "/api/capabilities/mcp/oauth/callback" &&
            url.hash === "" &&
            url.searchParams.has("state") &&
            (url.searchParams.has("code") || url.searchParams.has("error"))
          );
        } catch {
          return false;
        }
      }),
  })
  .strict();
const okResponseSchema = z.object({ ok: z.literal(true) }).strict();
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
    actualResources: runtimeResourcePolicySchema.nullable(),
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
    ...runtimePlacementIdentitySchema.shape,
    command: z
      .string()
      .min(1)
      .max(64 * 1024),
    timeoutMs: z.number().int().positive().max(60_000),
    maxOutputBytes: z
      .number()
      .int()
      .positive()
      .max(4 * 1024 * 1024),
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

export interface RuntimePlacementIdentity {
  runtimeId: string;
  nodeId: string;
  placementGeneration: number;
}

export interface ProvisionRuntimeRequest extends RuntimePlacementIdentity {
  workspaceKey: string;
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
  runtimeSecrets?: ResolvedRuntimeSecret[];
  resources?: RuntimeResourcePolicy;
}

export interface SyncRuntimeSecretsRequest extends RuntimePlacementIdentity {
  runtimeSecrets: ResolvedRuntimeSecret[];
}

export interface ForwardOAuthCallbackRequest extends RuntimePlacementIdentity {
  pathAndQuery: string;
}

export interface RuntimeRelayTarget {
  runtimeId: string;
  websocketUrl: string;
  headers(): Record<string, string>;
}

export type RuntimeTerminalTarget = RuntimeRelayTarget;

export interface RuntimeLifecycleResult {
  runtimeId: string;
  containerId: string | null;
  imageAlias: string | null;
  imageVersion: string | null;
  status: "absent" | "stopped" | "running";
  endpoint: ManagedRuntimeEndpoint | null;
  actualResources: RuntimeResourcePolicy | null;
}

export type AgentRuntimeStatsResult = z.infer<typeof agentRuntimeStatsResultSchema>;
export type ExecRuntimeResult = z.infer<typeof execRuntimeResultSchema>;
export type RuntimeNodeHealth = z.infer<typeof runtimeNodeHealthSchema>;

interface RuntimeManagerClientOptions {
  baseUrl: string;
  nodeId?: string;
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
  private readonly nodeId: string | null;
  private readonly now: () => number;
  private readonly secret: string;
  private readonly timeoutMs: number;

  constructor(options: RuntimeManagerClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.nodeId = options.nodeId === undefined ? null : runtimeNodeIdSchema.parse(options.nodeId);
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

  inspect(input: RuntimePlacementIdentity): Promise<RuntimeLifecycleResult> {
    const placement = this.placement(input);
    return this.request(
      "GET",
      `/v1/runtimes/${encodeURIComponent(placement.runtimeId)}/generations/${placement.placementGeneration}`,
    );
  }

  async status(): Promise<RuntimeNodeHealth> {
    const health = await this.requestParsed(
      "GET",
      "/v1/node/status",
      undefined,
      runtimeNodeHealthSchema,
    );
    if (this.nodeId !== null && health.nodeId !== this.nodeId) {
      throw new RuntimeManagerClientError("runtime_manager_invalid_response");
    }
    return health;
  }

  relayTarget(input: RuntimePlacementIdentity): RuntimeRelayTarget {
    const placement = this.placement(input);
    const path = `/v1/runtimes/${encodeURIComponent(placement.runtimeId)}/generations/${placement.placementGeneration}/rpc`;
    const managerUrl = new URL(this.baseUrl);
    const protocol = managerUrl.protocol === "https:" ? "wss:" : "ws:";
    return {
      runtimeId: placement.runtimeId,
      websocketUrl: `${protocol}//${managerUrl.host}${path}`,
      headers: () => this.signedHeaders("GET", path, ""),
    };
  }

  terminalTarget(input: RuntimePlacementIdentity): RuntimeTerminalTarget {
    const placement = this.placement(input);
    const path = `/v1/runtimes/${encodeURIComponent(placement.runtimeId)}/generations/${placement.placementGeneration}/terminal`;
    const managerUrl = new URL(this.baseUrl);
    const protocol = managerUrl.protocol === "https:" ? "wss:" : "ws:";
    return {
      runtimeId: placement.runtimeId,
      websocketUrl: `${protocol}//${managerUrl.host}${path}`,
      headers: () => this.signedHeaders("GET", path, ""),
    };
  }

  stats(input: RuntimePlacementIdentity): Promise<AgentRuntimeStatsResult> {
    const placement = this.placement(input);
    return this.requestParsed(
      "GET",
      `/v1/runtimes/${encodeURIComponent(placement.runtimeId)}/generations/${placement.placementGeneration}/stats`,
      undefined,
      agentRuntimeStatsResultSchema,
    );
  }

  exec(input: {
    runtimeId: string;
    nodeId: string;
    placementGeneration: number;
    command: string;
    timeoutMs: number;
    maxOutputBytes: number;
  }): Promise<ExecRuntimeResult> {
    const parsed = execRuntimeRequestSchema.parse({ ...input, ...this.placement(input) });
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
      provisionRuntimeRequestSchema.parse({ ...input, ...this.placement(input) }),
    );
  }

  syncSecrets(input: SyncRuntimeSecretsRequest): Promise<RuntimeLifecycleResult> {
    return this.request(
      "POST",
      "/v1/runtimes/secrets",
      provisionRuntimeRequestSchema
        .pick({
          runtimeId: true,
          nodeId: true,
          placementGeneration: true,
          runtimeSecrets: true,
        })
        .required({ runtimeSecrets: true })
        .parse({ ...input, ...this.placement(input) }),
    );
  }

  async forwardOAuthCallback(input: ForwardOAuthCallbackRequest): Promise<void> {
    await this.requestParsed(
      "POST",
      "/v1/runtimes/oauth-callback",
      forwardOAuthCallbackRequestSchema.parse({ ...input, ...this.placement(input) }),
      okResponseSchema,
    );
  }

  start(
    placement: RuntimePlacementIdentity,
    resources?: RuntimeResourcePolicy,
  ): Promise<RuntimeLifecycleResult> {
    return this.resourceAction("start", placement, resources);
  }

  stop(placement: RuntimePlacementIdentity): Promise<RuntimeLifecycleResult> {
    return this.action("stop", placement);
  }

  restart(
    placement: RuntimePlacementIdentity,
    resources?: RuntimeResourcePolicy,
  ): Promise<RuntimeLifecycleResult> {
    return this.resourceAction("restart", placement, resources);
  }

  remove(placement: RuntimePlacementIdentity): Promise<RuntimeLifecycleResult> {
    return this.action("remove", placement);
  }

  upgrade(
    placement: RuntimePlacementIdentity,
    imageAlias: string,
    resources?: RuntimeResourcePolicy,
  ): Promise<RuntimeLifecycleResult> {
    return this.request(
      "POST",
      "/v1/runtimes/upgrade",
      upgradeRuntimeRequestSchema.parse({ ...this.placement(placement), imageAlias, resources }),
    );
  }

  private action(
    action: "start" | "stop" | "restart" | "remove",
    placement: RuntimePlacementIdentity,
  ) {
    return this.request(
      "POST",
      `/v1/runtimes/${action}`,
      runtimeActionRequestSchema.parse(this.placement(placement)),
    );
  }

  private resourceAction(
    action: "start" | "restart",
    placement: RuntimePlacementIdentity,
    resources?: RuntimeResourcePolicy,
  ) {
    return this.request(
      "POST",
      `/v1/runtimes/${action}`,
      runtimeResourceActionRequestSchema.parse({ ...this.placement(placement), resources }),
    );
  }

  private placement(input: RuntimePlacementIdentity) {
    const placement = runtimePlacementIdentitySchema.parse({
      runtimeId: input.runtimeId,
      nodeId: input.nodeId,
      placementGeneration: input.placementGeneration,
    });
    if (this.nodeId !== null && placement.nodeId !== this.nodeId) {
      throw new RuntimeManagerClientError("runtime_manager_invalid_response");
    }
    return placement;
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
    const headers = this.signedHeaders(method, path, body);
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

  private signedHeaders(
    method: "GET" | "POST",
    path: string,
    body: string,
  ): Record<string, string> {
    const timestamp = this.now();
    const nonce = this.nonce();
    const bodySha256 = createHash("sha256").update(body).digest("hex");
    return {
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
