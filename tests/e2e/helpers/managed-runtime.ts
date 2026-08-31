import { createHmac } from "node:crypto";

import type { APIRequestContext } from "@playwright/test";
import {
  managedRuntimeStatusSchema,
  type ManagedRuntimeEndpoint,
} from "@codex-gateway/agent-runtime-contracts";
import { z } from "zod";

import { parseThreadListPage, parseThreadStartResult } from "../../../shared/runtime/app-server";
import { createManagedRuntimeHost } from "../../../server/utils/gateway/infra/rpc/managed-rpc-transport";
import { CodexRpcClient } from "../../../server/utils/gateway/infra/rpc/rpc";
import { RuntimeManagerClient } from "../../../server/utils/gateway/runtime-manager/client";
export {
  MANAGED_RUNTIME_A_USERNAME,
  MANAGED_RUNTIME_B_USERNAME,
  MANAGED_RUNTIME_PASSWORD,
} from "./managed-runtime-users";

const authSessionSchema = z
  .object({
    token: z.string().min(1),
    expiresAt: z.iso.datetime(),
    user: z
      .object({
        id: z.number().int().positive(),
        username: z.string().min(1),
        role: z.enum(["admin", "user"]),
      })
      .strict(),
  })
  .strict();

const gatewayProcessSchema = z.object({ bootId: z.uuid() }).strict();

export type GatewaySession = z.infer<typeof authSessionSchema>;

export class ManagedRuntimeRpcSession {
  private readonly client: CodexRpcClient;
  private transportCloseCount = 0;

  constructor(userId: number, endpoint: ManagedRuntimeEndpoint) {
    const timestamp = new Date().toISOString();
    const host = createManagedRuntimeHost(
      userId,
      { createdAt: timestamp, updatedAt: timestamp },
      endpoint,
    );
    this.client = new CodexRpcClient(host);
    this.client.on("close", () => {
      this.transportCloseCount += 1;
    });
  }

  get closeCount() {
    return this.transportCloseCount;
  }

  async connect() {
    await this.client.connect();
  }

  async startThread() {
    const result = parseThreadStartResult(
      await this.client.request("thread/start", {
        cwd: "/workspace",
        experimentalRawEvents: true,
        historyMode: "paginated",
      }),
    );
    return result.thread.id;
  }

  async listThreads() {
    const page = parseThreadListPage(
      await this.client.request("thread/list", { limit: 100, sortDirection: "desc" }),
    );
    return page.data;
  }

  close() {
    this.client.close();
  }
}

export async function loginGatewayUser(
  request: APIRequestContext,
  username: string,
  password: string,
) {
  const response = await request.post("/api/auth/login", { data: { username, password } });
  return authSessionSchema.parse(await successfulJson(response, "Gateway login"));
}

export async function startManagedRuntime(request: APIRequestContext, session: GatewaySession) {
  return await eventually(async () => {
    const response = await request.post("/api/runtime/start", {
      headers: bearerHeaders(session),
    });
    if (!response.ok()) throw new RetryableE2eError(`Runtime start returned ${response.status()}`);
    const status = managedRuntimeStatusSchema.parse(await response.json());
    if (status.status !== "ready") {
      throw new RetryableE2eError(`Runtime is ${status.status}`);
    }
    return status;
  });
}

export async function readManagedRuntimeStatus(
  request: APIRequestContext,
  session: GatewaySession,
) {
  const response = await request.get("/api/runtime/me", { headers: bearerHeaders(session) });
  return managedRuntimeStatusSchema
    .nullable()
    .parse(await successfulJson(response, "Runtime status"));
}

export async function restartManagedRuntimeAsAdmin(
  request: APIRequestContext,
  admin: GatewaySession,
  target: GatewaySession,
) {
  // Docker restart returns when the process is running, before App Server necessarily accepts its
  // first WebSocket. A failed compatibility probe leaves the one real restart in degraded state;
  // the user's idempotent start endpoint completes readiness once that same Agent is listening.
  await request.post(`/api/admin/runtimes/${target.user.id}/restart`, {
    headers: bearerHeaders(admin),
  });
  return await startManagedRuntime(request, target);
}

export async function inspectManagedRuntime(session: GatewaySession) {
  const secret = requiredEnvironment("RUNTIME_MANAGER_SHARED_SECRET");
  const runtimeId = `codex_${createHmac("sha256", secret)
    .update(`codex-runtime-user:${session.user.id}`)
    .digest("hex")
    .slice(0, 32)}`;
  const client = new RuntimeManagerClient({
    baseUrl: requiredEnvironment("RUNTIME_MANAGER_BASE_URL"),
    secret,
  });
  const runtime = await client.inspect(runtimeId);
  const { containerId, endpoint } = runtime;
  if (runtime.status !== "running" || containerId === null || endpoint === null) {
    throw new Error("Managed Runtime Manager returned a non-running E2E runtime");
  }
  return { ...runtime, containerId, endpoint };
}

export async function isManagedRuntimeTokenRejected(
  userId: number,
  endpoint: ManagedRuntimeEndpoint,
  candidateToken: string,
) {
  const wrongTokenClient = new ManagedRuntimeRpcSession(userId, {
    ...endpoint,
    serviceToken: candidateToken,
  });
  try {
    await wrongTokenClient.connect();
    return false;
  } catch {
    return true;
  } finally {
    wrongTokenClient.close();
  }
}

export async function restartGateway(request: APIRequestContext, admin: GatewaySession) {
  const before = gatewayProcessSchema.parse(
    await successfulJson(
      await request.get("/api/e2e/gateway-process", { headers: bearerHeaders(admin) }),
      "Gateway process identity",
    ),
  );
  const response = await request.post("/api/e2e/gateway-restart", {
    headers: bearerHeaders(admin),
  });
  if (response.status() !== 202) {
    throw new Error(`Gateway restart returned ${response.status()}`);
  }

  return await eventually(async () => {
    try {
      const currentResponse = await request.get("/api/e2e/gateway-process", {
        headers: bearerHeaders(admin),
      });
      if (!currentResponse.ok()) {
        throw new RetryableE2eError(`Gateway recovery returned ${currentResponse.status()}`);
      }
      const current = gatewayProcessSchema.parse(await currentResponse.json());
      if (current.bootId === before.bootId) {
        throw new RetryableE2eError("Gateway process has not restarted yet");
      }
      return current;
    } catch (error) {
      if (error instanceof RetryableE2eError) throw error;
      throw new RetryableE2eError("Gateway is restarting", { cause: error });
    }
  }, 90_000);
}

function bearerHeaders(session: GatewaySession) {
  return { authorization: `Bearer ${session.token}` };
}

async function successfulJson(
  response: Awaited<ReturnType<APIRequestContext["get"]>>,
  operation: string,
) {
  if (!response.ok()) throw new Error(`${operation} returned ${response.status()}`);
  return (await response.json()) as unknown;
}

async function eventually<T>(operation: () => Promise<T>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Timed out waiting for the managed Runtime E2E condition", { cause: lastError });
}

class RetryableE2eError extends Error {}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for managed Runtime E2E`);
  }
  return value;
}
