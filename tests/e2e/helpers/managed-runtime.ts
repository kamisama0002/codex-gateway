import { createHash, createHmac, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import type { APIRequestContext } from "@playwright/test";
import {
  managedRuntimeStatusViewSchema,
  runtimeResourcePolicySchema,
  type ManagedRuntimeEndpoint,
} from "@codex-gateway/agent-runtime-contracts";
import { z } from "zod";

import { parseThreadListPage, parseThreadStartResult } from "../../../shared/runtime/app-server";
import type { RpcEnvelope } from "../../../shared/types";
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
        dataOps: z
          .object({
            provider: z.literal("dataops"),
            externalSubject: z.string().min(1),
            tenantId: z.number().int().positive(),
            dataOpsUserId: z.number().int().positive(),
            projectId: z.number().int().positive(),
            authzVersion: z.number().int().positive(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

const gatewayProcessSchema = z.object({ bootId: z.uuid() }).strict();
const e2eDockerInspectionSchema = z
  .object({
    containerId: z.string().min(1),
    memoryBytes: z.number().int().nonnegative(),
    nanoCpus: z.number().int().nonnegative(),
    pidsLimit: z.number().int().nonnegative(),
    workspaceVolume: z.string().min(1),
  })
  .strict();
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

  request(method: string, params: unknown = {}, timeoutMs = 120_000) {
    return this.client.request(method, params, timeoutMs);
  }

  waitForNotification(method: string, timeoutMs = 120_000): Promise<RpcEnvelope> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        off();
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const off = this.client.on("notification", (message) => {
        if (message.method !== method) return;
        clearTimeout(timeout);
        off();
        resolve(message);
      });
    });
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

export async function loginDataOpsUser(request: ManagedGatewayRequestContext, ticket: string) {
  const response = await request.post(managedRuntimeGatewayUrl("/api/auth/dataops"), {
    data: { ticket },
  });
  return authSessionSchema.parse(await successfulJson(response, "DataOps login"));
}

export async function expectDataOpsTicketRejected(
  request: ManagedGatewayRequestContext,
  ticket: string,
) {
  const response = await request.post(managedRuntimeGatewayUrl("/api/auth/dataops"), {
    data: { ticket },
  });
  if (response.status() !== 401) {
    throw new Error(`DataOps Ticket replay returned ${response.status()}`);
  }
}

export async function recordManagedRuntimeResourceExpectations(
  expectations: Array<{
    session: GatewaySession;
    resources: z.infer<typeof runtimeResourcePolicySchema>;
  }>,
  writer: typeof writeFile = writeFile,
) {
  const secret = runtimeIdentitySecret();
  const artifact = Object.fromEntries(
    expectations.map(({ session, resources }) => [
      runtimeIdForSession(session, secret),
      runtimeResourcePolicySchema.parse(resources),
    ]),
  );
  await writer(
    requiredEnvironment("E2E_MANAGED_RUNTIME_RESOURCE_EXPECTATIONS_FILE"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
  return artifact;
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
    const view = managedRuntimeStatusViewSchema.parse(await response.json());
    const status = view.runtime;
    if (status === null || status.status !== "ready") {
      throw new RetryableE2eError(`Runtime is ${status?.status ?? "absent"}`);
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
  const view = managedRuntimeStatusViewSchema.parse(
    await successfulJson(response, "Runtime status"),
  );
  return view.runtime;
}

export async function readManagedRuntimeStatusView(
  request: ManagedGatewayRequestContext,
  session: GatewaySession,
) {
  const response = await request.get(managedRuntimeGatewayUrl("/api/runtime/me"), {
    headers: bearerHeaders(session),
  });
  return managedRuntimeStatusViewSchema.parse(
    await successfulJson(response, "Runtime status view"),
  );
}

export async function restartManagedRuntime(
  request: ManagedGatewayRequestContext,
  session: GatewaySession,
) {
  const response = await request.post(managedRuntimeGatewayUrl("/api/runtime/restart"), {
    headers: bearerHeaders(session),
  });
  return managedRuntimeStatusViewSchema.parse(await successfulJson(response, "Runtime restart"));
}

export async function restartManagedRuntimeAsAdmin(
  request: ManagedGatewayRequestContext,
  admin: GatewaySession,
  target: GatewaySession,
) {
  // Docker restart returns when the process is running, before App Server necessarily accepts its
  // first WebSocket. A failed compatibility probe leaves the one real restart in degraded state;
  // the user's idempotent start endpoint completes readiness once that same Agent is listening.
  await request.post(managedRuntimeGatewayUrl(`/api/admin/runtimes/${target.user.id}/restart`), {
    headers: bearerHeaders(admin),
  });
  return await startManagedRuntime(request, target);
}

export async function inspectManagedRuntime(session: GatewaySession) {
  const secret = requiredEnvironment("RUNTIME_MANAGER_SHARED_SECRET");
  const placement = defaultPlacement(session);
  const client = new RuntimeManagerClient({
    baseUrl: requiredEnvironment("RUNTIME_MANAGER_BASE_URL"),
    nodeId: placement.nodeId,
    secret,
  });
  const runtime = await client.inspect(placement);
  const { containerId, endpoint } = runtime;
  if (runtime.status !== "running" || containerId === null || endpoint === null) {
    throw new Error("Managed Runtime Manager returned a non-running E2E runtime");
  }
  return { ...runtime, containerId, endpoint };
}

export async function inspectManagedRuntimeDocker(
  session: GatewaySession,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
) {
  const secret = requiredEnvironment("RUNTIME_MANAGER_SHARED_SECRET");
  const runtimeId = runtimeIdForSession(session, runtimeIdentitySecret());
  const path = `/v1/e2e/runtimes/${encodeURIComponent(runtimeId)}/docker`;
  const timestamp = Date.now();
  const nonce = randomUUID();
  const bodySha256 = createHash("sha256").update("").digest("hex");
  const response = await fetcher(`${requiredEnvironment("RUNTIME_MANAGER_BASE_URL")}${path}`, {
    headers: {
      "x-runtime-body-sha256": bodySha256,
      "x-runtime-nonce": nonce,
      "x-runtime-signature": createHmac("sha256", secret)
        .update(`GET\n${path}\n${timestamp}\n${nonce}\n${bodySha256}`, "utf8")
        .digest("hex"),
      "x-runtime-timestamp": String(timestamp),
    },
  });
  if (!response.ok) throw new Error(`Runtime Manager E2E inspection returned ${response.status}`);
  return e2eDockerInspectionSchema.parse(await response.json());
}

export async function execManagedRuntime(
  session: GatewaySession,
  command: string,
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
) {
  const secret = requiredEnvironment("RUNTIME_MANAGER_SHARED_SECRET");
  const placement = defaultPlacement(session);
  return await new RuntimeManagerClient({
    baseUrl: requiredEnvironment("RUNTIME_MANAGER_BASE_URL"),
    nodeId: placement.nodeId,
    secret,
  }).exec({
    ...placement,
    command,
    timeoutMs: options.timeoutMs ?? 60_000,
    maxOutputBytes: options.maxOutputBytes ?? 2 * 1024 * 1024,
  });
}

export async function execManagedRuntimeText(session: GatewaySession, command: string) {
  const result = await execManagedRuntime(session, command, {
    timeoutMs: 10_000,
    maxOutputBytes: 64 * 1024,
  });
  if (result.code !== 0) throw new Error("Managed Runtime E2E command failed");
  return result.stdout.trimEnd();
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

export async function restartGateway(request: ManagedGatewayRequestContext, admin: GatewaySession) {
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

async function successfulJson(response: ManagedGatewayApiResponse, operation: string) {
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

function runtimeIdForUser(userId: number, secret: string) {
  return `codex_${createHmac("sha256", secret)
    .update(`codex-runtime-user:${userId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function runtimeIdForSession(session: GatewaySession, secret: string) {
  return runtimeIdForUser(session.user.id, secret);
}

function defaultPlacement(session: GatewaySession) {
  return {
    runtimeId: runtimeIdForSession(session, runtimeIdentitySecret()),
    nodeId: process.env.RUNTIME_MANAGER_DEFAULT_NODE_ID ?? "node__default",
    placementGeneration: 1,
  };
}

function runtimeIdentitySecret() {
  return (
    process.env.RUNTIME_IDENTITY_SECRET ?? requiredEnvironment("RUNTIME_MANAGER_SHARED_SECRET")
  );
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for managed Runtime E2E`);
  }
  return value;
}
