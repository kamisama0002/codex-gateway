import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { z, ZodError } from "zod";

import {
  HmacRequestAuthenticator,
  resolveRuntimeManagerNonceStorePath,
  RuntimeAuthenticationError,
  SqliteNonceStore,
} from "./auth.js";
import {
  provisionRuntimeRequestSchema,
  runtimeActionRequestSchema,
  runtimeLookupRequestSchema,
  runtimeResourceActionRequestSchema,
  execRuntimeRequestSchema,
  forwardOAuthCallbackRequestSchema,
  type RuntimeLifecycleResult,
  runtimeManagerPolicySchema,
  syncRuntimeSecretsRequestSchema,
  upgradeRuntimeRequestSchema,
} from "./contracts.js";
import { DockerodeEngine } from "./docker-engine.js";
import type { E2eDockerInspection } from "./docker-engine.js";
import { RuntimeLifecycleError, RuntimeLifecycleService } from "./lifecycle-service.js";
import {
  parseAgentMemoryBytes,
  parseAgentNanoCpus,
  parseAgentPidsLimit,
} from "./resource-limits.js";

const MAX_BODY_BYTES = 10 * 1024 * 1024;
export const CODEX_APP_SERVER_PORT = 4500;

const e2eDockerInspectionSchema = z
  .object({
    containerId: z.string().min(1),
    memoryBytes: z.number().int().nonnegative(),
    nanoCpus: z.number().int().nonnegative(),
    pidsLimit: z.number().int().nonnegative(),
    workspaceVolume: z.string().min(1),
  })
  .strict();

interface E2eRuntimeInspector {
  inspectRuntime(runtimeId: string): Promise<E2eDockerInspection>;
}

export function createRuntimeManagerRequestHandler(options: {
  authenticator: HmacRequestAuthenticator;
  service: RuntimeLifecycleService;
  environment?: NodeJS.ProcessEnv;
  e2eInspector?: E2eRuntimeInspector;
}): RequestListener {
  return (request, response) => {
    void handleRequest(request, response, options);
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    authenticator: HmacRequestAuthenticator;
    service: RuntimeLifecycleService;
    environment?: NodeJS.ProcessEnv;
    e2eInspector?: E2eRuntimeInspector;
  },
): Promise<void> {
  try {
    const body = await readBody(request);
    const url = new URL(request.url ?? "/", "http://runtime-manager.internal");
    options.authenticator.authenticate(request.headers, body, request.method ?? "", url.pathname);
    if (url.search) return sendJson(response, 404, { error: "not_found" });

    if (request.method === "GET") {
      if (url.pathname === "/v1/node/status") {
        return sendJson(response, 200, await options.service.status());
      }
      const e2eInspectMatch = /^\/v1\/e2e\/runtimes\/([^/]+)\/docker$/.exec(url.pathname);
      if (e2eInspectMatch) {
        if (
          options.e2eInspector === undefined ||
          !e2eInspectionEnabled(options.environment ?? process.env)
        ) {
          return sendJson(response, 404, { error: "not_found" });
        }
        const requestData = runtimeLookupRequestSchema.pick({ runtimeId: true }).parse({
          runtimeId: decodeURIComponent(e2eInspectMatch[1] ?? ""),
        });
        const result = e2eDockerInspectionSchema.parse(
          await options.e2eInspector.inspectRuntime(requestData.runtimeId),
        );
        return sendJson(response, 200, result);
      }
      const statsMatch = /^\/v1\/runtimes\/([^/]+)\/generations\/(\d+)\/stats$/.exec(url.pathname);
      if (statsMatch) {
        const result = await options.service.stats(
          runtimeLookupRequestSchema.parse({
            runtimeId: decodeURIComponent(statsMatch[1] ?? ""),
            placementGeneration: Number(statsMatch[2]),
          }),
        );
        return sendJson(response, 200, result);
      }
      const match = /^\/v1\/runtimes\/([^/]+)\/generations\/(\d+)$/.exec(url.pathname);
      if (!match) return sendJson(response, 404, { error: "not_found" });
      const result = await options.service.inspect(
        runtimeLookupRequestSchema.parse({
          runtimeId: decodeURIComponent(match[1] ?? ""),
          placementGeneration: Number(match[2]),
        }),
      );
      return sendJson(response, 200, result);
    }

    if (request.method !== "POST") return sendJson(response, 404, { error: "not_found" });
    if (!isJsonContentType(request.headers["content-type"])) {
      return sendJson(response, 400, { error: "invalid_request" });
    }
    const payload: unknown = JSON.parse(body.toString("utf8"));
    if (url.pathname === "/v1/runtimes/exec") {
      return sendJson(
        response,
        200,
        await options.service.exec(execRuntimeRequestSchema.parse(payload)),
      );
    }
    if (url.pathname === "/v1/runtimes/oauth-callback") {
      await options.service.forwardOAuthCallback(forwardOAuthCallbackRequestSchema.parse(payload));
      return sendJson(response, 200, { ok: true });
    }
    const actionMatch =
      /^\/v1\/runtimes\/(provision|start|stop|restart|upgrade|remove|secrets)$/.exec(url.pathname);
    if (actionMatch === null) return sendJson(response, 404, { error: "not_found" });
    const action = actionMatch[1];
    if (!isLifecycleAction(action)) return sendJson(response, 404, { error: "not_found" });
    let result: RuntimeLifecycleResult;
    switch (action) {
      case "provision":
        result = await options.service.provision(provisionRuntimeRequestSchema.parse(payload));
        break;
      case "start":
        result = await options.service.start(runtimeResourceActionRequestSchema.parse(payload));
        break;
      case "stop":
        result = await options.service.stop(runtimeActionRequestSchema.parse(payload));
        break;
      case "restart":
        result = await options.service.restart(runtimeResourceActionRequestSchema.parse(payload));
        break;
      case "upgrade":
        result = await options.service.upgrade(upgradeRuntimeRequestSchema.parse(payload));
        break;
      case "remove":
        result = await options.service.remove(runtimeActionRequestSchema.parse(payload));
        break;
      case "secrets":
        result = await options.service.syncSecrets(syncRuntimeSecretsRequestSchema.parse(payload));
        break;
    }
    return sendJson(response, 200, result);
  } catch (error) {
    if (error instanceof RuntimeAuthenticationError) {
      return sendJson(response, 401, { error: "unauthorized" });
    }
    if (
      error instanceof ZodError ||
      error instanceof SyntaxError ||
      error instanceof URIError ||
      error instanceof RequestBodyError
    ) {
      return sendJson(response, 400, { error: "invalid_request" });
    }
    if (error instanceof RuntimeLifecycleError) {
      const status = error.code === "runtime_not_found" ? 404 : 409;
      return sendJson(response, status, { error: error.code });
    }
    console.error("[runtime-manager] request failed", {
      method: request.method ?? "",
      path: request.url?.split("?", 1)[0] ?? "",
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    });
    return sendJson(response, 500, { error: "internal_error" });
  }
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectBody(new RequestBodyError());
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", () => rejectBody(new RequestBodyError()));
  });
}

class RequestBodyError extends Error {}

function isJsonContentType(value: string | string[] | undefined): boolean {
  return (
    typeof value === "string" && value.toLowerCase().split(";", 1)[0]?.trim() === "application/json"
  );
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

export function loadRuntimeManagerPolicy(
  environment: NodeJS.ProcessEnv,
): ReturnType<typeof runtimeManagerPolicySchema.parse> {
  const images = JSON.parse(
    requiredEnvironment(environment, "RUNTIME_MANAGER_IMAGE_ALIASES"),
  ) as unknown;
  const resourceLabels = JSON.parse(environment.RUNTIME_MANAGER_RESOURCE_LABELS ?? "{}") as unknown;
  return runtimeManagerPolicySchema.parse({
    images,
    internalPort: CODEX_APP_SERVER_PORT,
    networkNames: [
      requiredEnvironment(environment, "RUNTIME_MANAGER_AGENT_NETWORK"),
      requiredEnvironment(environment, "RUNTIME_MANAGER_AGENT_EGRESS_NETWORK"),
    ],
    oauthCallbackUrl: optionalEnvironment(environment, "RUNTIME_MANAGER_MCP_OAUTH_CALLBACK_URL"),
    resourceLabels,
    agentMemoryBytes: parseAgentMemoryBytes(environment.RUNTIME_AGENT_MEMORY),
    agentNanoCpus: parseAgentNanoCpus(environment.RUNTIME_AGENT_CPUS),
    agentPidsLimit: parseAgentPidsLimit(environment.RUNTIME_AGENT_PIDS),
  });
}

export function startRuntimeManager(environment: NodeJS.ProcessEnv = process.env): void {
  const secret = requiredEnvironment(environment, "RUNTIME_MANAGER_SHARED_SECRET");
  const authenticator = new HmacRequestAuthenticator({
    nonceStore: new SqliteNonceStore(resolveRuntimeManagerNonceStorePath(environment)),
    secret,
  });
  const engine = new DockerodeEngine();
  const service = new RuntimeLifecycleService(engine, loadRuntimeManagerPolicy(environment), {
    nodeStatus: loadRuntimeNodeStatusConfig(environment),
  });
  const e2eInspector = e2eInspectionEnabled(environment)
    ? { inspectRuntime: (runtimeId: string) => engine.inspectRuntimeForE2e(runtimeId) }
    : undefined;
  const server = createServer(
    createRuntimeManagerRequestHandler({ authenticator, service, environment, e2eInspector }),
  );
  const port = Number(environment.RUNTIME_MANAGER_PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("RUNTIME_MANAGER_PORT must be a valid TCP port");
  }
  server.listen(port, environment.RUNTIME_MANAGER_HOST ?? "0.0.0.0");
}

export function loadRuntimeNodeStatusConfig(environment: NodeJS.ProcessEnv) {
  return {
    nodeId: requiredEnvironment(environment, "RUNTIME_NODE_ID"),
    managerVersion: optionalEnvironment(environment, "RUNTIME_MANAGER_VERSION") ?? "unknown",
    dataRoot: optionalEnvironment(environment, "RUNTIME_NODE_DATA_ROOT") ?? "/data",
    capacityCpuMillis: positiveIntegerEnvironment(
      environment,
      "RUNTIME_NODE_CAPACITY_CPU_MILLIS",
      16_000,
    ),
    capacityMemoryBytes: positiveIntegerEnvironment(
      environment,
      "RUNTIME_NODE_CAPACITY_MEMORY_BYTES",
      64 * 1024 * 1024 * 1024,
    ),
    maxRuntimes: positiveIntegerEnvironment(environment, "RUNTIME_NODE_MAX_RUNTIMES", 30),
  };
}

function e2eInspectionEnabled(environment: NodeJS.ProcessEnv): boolean {
  return (
    environment.RUNTIME_MANAGER_E2E_INSPECTION === "1" && environment.NODE_ENV !== "production"
  );
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key];
  if (value === undefined || value.length === 0) throw new Error(`${key} is required`);
  return value;
}

function optionalEnvironment(environment: NodeJS.ProcessEnv, key: string) {
  const value = environment[key]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function positiveIntegerEnvironment(environment: NodeJS.ProcessEnv, key: string, fallback: number) {
  const value = environment[key];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${key} must be positive`);
  return parsed;
}

function isLifecycleAction(
  value: string | undefined,
): value is "provision" | "start" | "stop" | "restart" | "upgrade" | "remove" | "secrets" {
  return (
    value === "provision" ||
    value === "start" ||
    value === "stop" ||
    value === "restart" ||
    value === "upgrade" ||
    value === "remove" ||
    value === "secrets"
  );
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) startRuntimeManager();
