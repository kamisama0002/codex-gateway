import { expect, test, type APIRequestContext } from "@playwright/test";
import { createPool, type RowDataPacket } from "mysql2/promise";
import {
  loginGatewayUser,
  MANAGED_RUNTIME_A_USERNAME,
  MANAGED_RUNTIME_B_USERNAME,
  MANAGED_RUNTIME_PASSWORD,
  ManagedRuntimeRpcSession,
  restartGateway,
  startManagedRuntime,
  type GatewaySession,
} from "./helpers/managed-runtime";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/app";
import { RuntimeManagerClient } from "../../server/utils/gateway/runtime-manager/client";

const gatewayOrigin = "http://gateway-under-test:3100";

test("routes durable users across two Runtime Managers without failover drift", async ({
  request,
}) => {
  test.setTimeout(4 * 60_000);
  const [admin, userA, userB, userC, userD] = await Promise.all([
    loginGatewayUser(request, E2E_USERNAME, E2E_PASSWORD),
    loginGatewayUser(request, MANAGED_RUNTIME_A_USERNAME, MANAGED_RUNTIME_PASSWORD),
    loginGatewayUser(request, MANAGED_RUNTIME_B_USERNAME, MANAGED_RUNTIME_PASSWORD),
    loginGatewayUser(request, "runtime-c", MANAGED_RUNTIME_PASSWORD),
    loginGatewayUser(request, "runtime-d", MANAGED_RUNTIME_PASSWORD),
  ]);
  await waitForNodeA(request, admin);
  await createNodeB(request, admin);

  await Promise.all([startManagedRuntime(request, userA), startManagedRuntime(request, userB)]);
  const initial = await placements([userA.user.id, userB.user.id]);
  expect(new Set(initial.map((placement) => placement.runtimeNodeId))).toEqual(
    new Set(["node__a", "node__b"]),
  );

  const threads = new Map<number, string>();
  for (const session of [userA, userB]) {
    const placement = requiredPlacement(initial, session.user.id);
    const rpc = new ManagedRuntimeRpcSession(session.user.id, relayTarget(placement));
    try {
      await rpc.connect();
      threads.set(session.user.id, await rpc.startThread());
    } finally {
      rpc.close();
    }
  }

  await restartGateway(request, admin);
  const afterRestart = await placements([userA.user.id, userB.user.id]);
  expect(afterRestart).toEqual(initial);
  for (const session of [userA, userB]) {
    const placement = requiredPlacement(afterRestart, session.user.id);
    const rpc = new ManagedRuntimeRpcSession(session.user.id, relayTarget(placement));
    try {
      await rpc.connect();
      expect((await rpc.listThreads()).map((thread) => thread.id)).toContain(
        threads.get(session.user.id),
      );
    } finally {
      rpc.close();
    }
  }

  await patchNode(request, admin, "node__a", { state: "draining", maxRuntimes: 1 });
  await patchNode(request, admin, "node__b", { state: "active", maxRuntimes: 2 });
  await startManagedRuntime(request, userC);
  expect(requiredPlacement(await placements([userC.user.id]), userC.user.id).runtimeNodeId).toBe(
    "node__b",
  );

  const capacityFailure = await request.post(
    new URL("/api/runtime/start", gatewayOrigin).toString(),
    {
      headers: bearerHeaders(userD),
    },
  );
  expect(capacityFailure.ok()).toBe(false);
  expect(await capacityFailure.text()).toContain("runtime_node_capacity_unavailable");

  await patchNode(request, admin, "node__b", { state: "disabled", maxRuntimes: 2 });
  const disabledFailure = await request.post(
    new URL("/api/runtime/restart", gatewayOrigin).toString(),
    { headers: bearerHeaders(userB) },
  );
  expect(disabledFailure.ok()).toBe(false);
  expect(await disabledFailure.text()).toContain("runtime_node_disabled");
  expect(await placements([userA.user.id, userB.user.id, userC.user.id])).toEqual([
    ...initial,
    expect.objectContaining({ userId: userC.user.id, runtimeNodeId: "node__b" }),
  ]);
});

async function createNodeB(request: APIRequestContext, admin: GatewaySession) {
  const response = await request.post(
    new URL("/api/admin/runtime-nodes", gatewayOrigin).toString(),
    {
      headers: bearerHeaders(admin),
      data: {
        id: "node__b",
        name: "Runtime Node B",
        baseUrl: process.env.RUNTIME_MANAGER_B_BASE_URL ?? "http://agent-runtime-manager-b:8787",
        sharedSecret: requiredEnvironment("RUNTIME_MANAGER_B_SHARED_SECRET"),
        state: "active",
        capacity: capacity(1),
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
}

async function patchNode(
  request: APIRequestContext,
  admin: GatewaySession,
  nodeId: string,
  input: { state: "active" | "draining" | "disabled"; maxRuntimes: number },
) {
  const response = await request.patch(
    new URL(`/api/admin/runtime-nodes/${nodeId}`, gatewayOrigin).toString(),
    {
      headers: bearerHeaders(admin),
      data: { state: input.state, capacity: capacity(input.maxRuntimes) },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
}

async function waitForNodeA(request: APIRequestContext, admin: GatewaySession) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await request.get(
      new URL("/api/admin/runtime-nodes", gatewayOrigin).toString(),
      { headers: bearerHeaders(admin) },
    );
    if (response.ok()) {
      const nodes = (await response.json()) as Array<{
        id: string;
        health: { dockerAvailable: boolean; dataRootWritable: boolean } | null;
      }>;
      const node = nodes.find((candidate) => candidate.id === "node__a");
      if (node?.health?.dockerAvailable && node.health.dataRootWritable) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Runtime node A did not become healthy");
}

interface PlacementRow extends RowDataPacket {
  user_id: number;
  runtime_id: string;
  runtime_node_id: string;
  placement_generation: number;
}

interface Placement {
  userId: number;
  runtimeId: string;
  runtimeNodeId: string;
  placementGeneration: number;
}

async function placements(userIds: number[]): Promise<Placement[]> {
  const databaseUrl = requiredEnvironment("DATABASE_URL");
  const pool = createPool(databaseUrl);
  try {
    const placeholders = userIds.map(() => "?").join(",");
    const [rows] = await pool.query<PlacementRow[]>(
      `SELECT user_id, runtime_id, runtime_node_id, placement_generation
       FROM user_agent_runtimes
       WHERE user_id IN (${placeholders})
       ORDER BY user_id`,
      userIds,
    );
    return rows.map((row) => ({
      userId: Number(row.user_id),
      runtimeId: row.runtime_id,
      runtimeNodeId: row.runtime_node_id,
      placementGeneration: Number(row.placement_generation),
    }));
  } finally {
    await pool.end();
  }
}

function requiredPlacement(values: Placement[], userId: number) {
  const placement = values.find((candidate) => candidate.userId === userId);
  if (placement === undefined) throw new Error(`Missing placement for user ${userId}`);
  return placement;
}

function relayTarget(placement: Placement) {
  const isNodeB = placement.runtimeNodeId === "node__b";
  const client = new RuntimeManagerClient({
    baseUrl: isNodeB
      ? (process.env.RUNTIME_MANAGER_B_BASE_URL ?? "http://agent-runtime-manager-b:8787")
      : requiredEnvironment("RUNTIME_MANAGER_BASE_URL"),
    nodeId: placement.runtimeNodeId,
    secret: isNodeB
      ? requiredEnvironment("RUNTIME_MANAGER_B_SHARED_SECRET")
      : requiredEnvironment("RUNTIME_MANAGER_SHARED_SECRET"),
  });
  return client.relayTarget({
    runtimeId: placement.runtimeId,
    nodeId: placement.runtimeNodeId,
    placementGeneration: placement.placementGeneration,
  });
}

function capacity(maxRuntimes: number) {
  return {
    cpuMillis: 8_000,
    memoryBytes: 16 * 1024 * 1024 * 1024,
    maxRuntimes,
    minimumFreeDiskBytes: 0,
  };
}

function bearerHeaders(session: GatewaySession) {
  return { authorization: `Bearer ${session.token}` };
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}
