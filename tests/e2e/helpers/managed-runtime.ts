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
const threadSectionSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    appearance: z
      .object({
        icon: z.string().nullable().optional(),
        color: z.string().nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
const threadSectionListResponseSchema = z
  .object({
    data: z.array(threadSectionSchema),
    nextCursor: z.string().nullable().optional(),
  })
  .strict();
const threadSectionMoveResponseSchema = z.object({}).strict();
const BUILT_IN_PINNED_SECTION_NAME = "Pinned";
// The runner shares Gateway's original network namespace for browser-preview loopback routing.
// After the Gateway container restarts, that old namespace cannot reach the new process on 127.0.0.1,
// but Compose service DNS resolves the restarted container's current address on the default network.
const MANAGED_RUNTIME_GATEWAY_ORIGIN =
  process.env.E2E_MANAGED_RUNTIME_GATEWAY_URL ?? "http://gateway-under-test:3100";
const ALL_THREAD_SOURCE_KINDS = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
  "unknown",
] as const;

interface ManagedRuntimeRpcClient {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
}

interface ManagedGatewayApiResponse {
  ok(): boolean;
  status(): number;
  json(): Promise<unknown>;
}

interface ManagedGatewayRequestContext {
  get(
    url: string,
    options?: Parameters<APIRequestContext["get"]>[1],
  ): Promise<ManagedGatewayApiResponse>;
  post(
    url: string,
    options?: Parameters<APIRequestContext["post"]>[1],
  ): Promise<ManagedGatewayApiResponse>;
}

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
    const threadId = result.thread.id;
    await materializeManagedRuntimeThread(this.client, threadId);
    return threadId;
  }

  async listThreads() {
    return await listManagedRuntimeThreads(this.client);
  }

  close() {
    this.client.close();
  }
}

export async function listManagedRuntimeThreads(client: ManagedRuntimeRpcClient) {
  const sectionId = await discoverPinnedSectionId(client);
  const page = parseThreadListPage(
    await client.request("thread/list", {
      limit: 100,
      sectionId,
      sortDirection: "desc",
      // Before its first turn, a Section move materializes the state-DB row before source metadata
      // is reliable enough for appServer-only post-filtering. Send every recognized kind to avoid
      // both that false exclusion and thread/list's omitted-filter interactive-only default.
      sourceKinds: [...ALL_THREAD_SOURCE_KINDS],
      useStateDbOnly: true,
    }),
  );
  return page.data;
}

export async function materializeManagedRuntimeThread(
  client: ManagedRuntimeRpcClient,
  threadId: string,
) {
  const sectionId = await discoverPinnedSectionId(client);
  threadSectionMoveResponseSchema.parse(
    await client.request("thread/section/move", {
      beforeThreadId: null,
      sectionId,
      threadId,
    }),
  );
  return sectionId;
}

async function discoverPinnedSectionId(client: ManagedRuntimeRpcClient) {
  let cursor: string | undefined;
  const matches: string[] = [];
  do {
    const page = threadSectionListResponseSchema.parse(
      await client.request("threadSection/list", {
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      }),
    );
    matches.push(
      ...page.data
        .filter(
          (section) =>
            section.name === BUILT_IN_PINNED_SECTION_NAME &&
            (section.appearance === null || section.appearance === undefined),
        )
        .map((section) => section.id),
    );
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  if (matches.length !== 1) {
    throw new Error("Expected exactly one built-in pinned Thread section");
  }
  return matches[0]!;
}

export async function loginGatewayUser(
  request: ManagedGatewayRequestContext,
  username: string,
  password: string,
) {
  const response = await request.post(managedRuntimeGatewayUrl("/api/auth/login"), {
    data: { username, password },
  });
  return authSessionSchema.parse(await successfulJson(response, "Gateway login"));
}

export async function startManagedRuntime(
  request: ManagedGatewayRequestContext,
  session: GatewaySession,
) {
  return await eventually(async () => {
    const response = await request.post(managedRuntimeGatewayUrl("/api/runtime/start"), {
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
  request: ManagedGatewayRequestContext,
  session: GatewaySession,
) {
  const response = await request.get(managedRuntimeGatewayUrl("/api/runtime/me"), {
    headers: bearerHeaders(session),
  });
  return managedRuntimeStatusSchema
    .nullable()
    .parse(await successfulJson(response, "Runtime status"));
}

export async function restartManagedRuntimeAsAdmin(
  request: ManagedGatewayRequestContext,
  admin: GatewaySession,
  target: GatewaySession,
) {
  // Docker restart returns when the process is running, before App Server necessarily accepts its
  // first WebSocket. A failed compatibility probe leaves the one real restart in degraded state;
  // the user's idempotent start endpoint completes readiness once that same Agent is listening.
  await request.post(
    managedRuntimeGatewayUrl(`/api/admin/runtimes/${target.user.id}/restart`),
    { headers: bearerHeaders(admin) },
  );
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

export async function restartGateway(
  request: ManagedGatewayRequestContext,
  admin: GatewaySession,
) {
  const before = gatewayProcessSchema.parse(
    await successfulJson(
      await request.get(managedRuntimeGatewayUrl("/api/e2e/gateway-process"), {
        headers: bearerHeaders(admin),
      }),
      "Gateway process identity",
    ),
  );
  const response = await request.post(managedRuntimeGatewayUrl("/api/e2e/gateway-restart"), {
    headers: bearerHeaders(admin),
  });
  if (response.status() !== 202) {
    throw new Error(`Gateway restart returned ${response.status()}`);
  }

  return await eventually(async () => {
    try {
      const currentResponse = await request.get(
        managedRuntimeGatewayUrl("/api/e2e/gateway-process"),
        { headers: bearerHeaders(admin) },
      );
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
  response: ManagedGatewayApiResponse,
  operation: string,
) {
  if (!response.ok()) throw new Error(`${operation} returned ${response.status()}`);
  return await response.json();
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

function managedRuntimeGatewayUrl(path: string) {
  return new URL(path, MANAGED_RUNTIME_GATEWAY_ORIGIN).toString();
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for managed Runtime E2E`);
  }
  return value;
}
