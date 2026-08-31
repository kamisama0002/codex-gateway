import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { ZodError } from "zod";

import {
  HmacRequestAuthenticator,
  resolveRuntimeManagerNonceStorePath,
  RuntimeAuthenticationError,
  SqliteNonceStore,
} from "./auth.js";
import {
  provisionRuntimeRequestSchema,
  runtimeActionRequestSchema,
  type RuntimeLifecycleResult,
  runtimeManagerPolicySchema,
  upgradeRuntimeRequestSchema,
} from "./contracts.js";
import { DockerodeEngine } from "./docker-engine.js";
import { RuntimeLifecycleError, RuntimeLifecycleService } from "./lifecycle-service.js";

const MAX_BODY_BYTES = 64 * 1024;
export const CODEX_APP_SERVER_PORT = 4500;

export function createRuntimeManagerRequestHandler(options: {
  authenticator: HmacRequestAuthenticator;
  service: RuntimeLifecycleService;
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
  },
): Promise<void> {
  try {
    const body = await readBody(request);
    options.authenticator.authenticate(request.headers, body);
    const url = new URL(request.url ?? "/", "http://runtime-manager.internal");
    if (url.search) return sendJson(response, 404, { error: "not_found" });

    if (request.method === "GET") {
      const match = /^\/v1\/runtimes\/([^/]+)$/.exec(url.pathname);
      if (!match) return sendJson(response, 404, { error: "not_found" });
      const result = await options.service.inspect(
        runtimeActionRequestSchema.parse({ runtimeId: decodeURIComponent(match[1] ?? "") }),
      );
      return sendJson(response, 200, result);
    }

    if (request.method !== "POST") return sendJson(response, 404, { error: "not_found" });
    if (!isJsonContentType(request.headers["content-type"])) {
      return sendJson(response, 400, { error: "invalid_request" });
    }
    const payload: unknown = JSON.parse(body.toString("utf8"));
    const actionMatch = /^\/v1\/runtimes\/(provision|start|stop|restart|upgrade|remove)$/.exec(
      url.pathname,
    );
    if (actionMatch === null) return sendJson(response, 404, { error: "not_found" });
    const action = actionMatch[1];
    if (!isLifecycleAction(action)) return sendJson(response, 404, { error: "not_found" });
    let result: RuntimeLifecycleResult;
    switch (action) {
      case "provision":
        result = await options.service.provision(provisionRuntimeRequestSchema.parse(payload));
        break;
      case "start":
        result = await options.service.start(runtimeActionRequestSchema.parse(payload));
        break;
      case "stop":
        result = await options.service.stop(runtimeActionRequestSchema.parse(payload));
        break;
      case "restart":
        result = await options.service.restart(runtimeActionRequestSchema.parse(payload));
        break;
      case "upgrade":
        result = await options.service.upgrade(upgradeRuntimeRequestSchema.parse(payload));
        break;
      case "remove":
        result = await options.service.remove(runtimeActionRequestSchema.parse(payload));
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
  return runtimeManagerPolicySchema.parse({
    images,
    internalPort: CODEX_APP_SERVER_PORT,
    networkName: requiredEnvironment(environment, "RUNTIME_MANAGER_AGENT_NETWORK"),
  });
}

export function startRuntimeManager(environment: NodeJS.ProcessEnv = process.env): void {
  const secret = requiredEnvironment(environment, "RUNTIME_MANAGER_SHARED_SECRET");
  const authenticator = new HmacRequestAuthenticator({
    nonceStore: new SqliteNonceStore(resolveRuntimeManagerNonceStorePath(environment)),
    secret,
  });
  const service = new RuntimeLifecycleService(
    new DockerodeEngine(),
    loadRuntimeManagerPolicy(environment),
  );
  const server = createServer(createRuntimeManagerRequestHandler({ authenticator, service }));
  const port = Number(environment.RUNTIME_MANAGER_PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("RUNTIME_MANAGER_PORT must be a valid TCP port");
  }
  server.listen(port, environment.RUNTIME_MANAGER_HOST ?? "0.0.0.0");
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key];
  if (value === undefined || value.length === 0) throw new Error(`${key} is required`);
  return value;
}

function isLifecycleAction(
  value: string | undefined,
): value is "provision" | "start" | "stop" | "restart" | "upgrade" | "remove" {
  return (
    value === "provision" ||
    value === "start" ||
    value === "stop" ||
    value === "restart" ||
    value === "upgrade" ||
    value === "remove"
  );
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) startRuntimeManager();
