import { expect, test } from "@playwright/test";

import {
  inspectManagedRuntime,
  isManagedRuntimeTokenRejected,
  loginGatewayUser,
  MANAGED_RUNTIME_A_USERNAME,
  MANAGED_RUNTIME_B_USERNAME,
  MANAGED_RUNTIME_PASSWORD,
  ManagedRuntimeRpcSession,
  readManagedRuntimeStatus,
  restartGateway,
  restartManagedRuntimeAsAdmin,
  startManagedRuntime,
} from "./helpers/managed-runtime";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/app";

test("two Gateway users keep isolated Agent containers, tokens, history, and streams across restarts", async ({
  request,
}) => {
  const [admin, userA, userB] = await Promise.all([
    loginGatewayUser(request, E2E_USERNAME, E2E_PASSWORD),
    loginGatewayUser(request, MANAGED_RUNTIME_A_USERNAME, MANAGED_RUNTIME_PASSWORD),
    loginGatewayUser(request, MANAGED_RUNTIME_B_USERNAME, MANAGED_RUNTIME_PASSWORD),
  ]);

  const [statusA, statusB] = await Promise.all([
    startManagedRuntime(request, userA),
    startManagedRuntime(request, userB),
  ]);
  for (const status of [statusA, statusB]) {
    expect(status.status).toBe("ready");
    expect(status).not.toHaveProperty("containerId");
    expect(status).not.toHaveProperty("endpoint");
    expect(status).not.toHaveProperty("serviceToken");
    expect(status).not.toHaveProperty("websocketUrl");
  }

  const [runtimeA, runtimeB] = await Promise.all([
    inspectManagedRuntime(userA),
    inspectManagedRuntime(userB),
  ]);
  expect(runtimeA.containerId).not.toBe(runtimeB.containerId);
  expect(runtimeA.endpoint.websocketUrl).not.toBe(runtimeB.endpoint.websocketUrl);
  expect(runtimeA.endpoint.serviceToken).not.toBe(runtimeB.endpoint.serviceToken);

  const rpcA = new ManagedRuntimeRpcSession(userA.user.id, runtimeA.endpoint);
  const rpcB = new ManagedRuntimeRpcSession(userB.user.id, runtimeB.endpoint);
  try {
    await Promise.all([rpcA.connect(), rpcB.connect()]);
    const [threadA, threadB] = await Promise.all([rpcA.startThread(), rpcB.startThread()]);

    const [threadsA, threadsB] = await Promise.all([rpcA.listThreads(), rpcB.listThreads()]);
    expect(threadsA).toContainEqual(expect.objectContaining({ id: threadA }));
    expect(threadsA).not.toContainEqual(expect.objectContaining({ id: threadB }));
    expect(threadsB).toContainEqual(expect.objectContaining({ id: threadB }));
    expect(threadsB).not.toContainEqual(expect.objectContaining({ id: threadA }));

    expect(
      await isManagedRuntimeTokenRejected(
        userB.user.id,
        runtimeB.endpoint,
        runtimeA.endpoint.serviceToken,
      ),
    ).toBe(true);

    await restartGateway(request, admin);
    const [gatewayStatusA, gatewayStatusB] = await Promise.all([
      readManagedRuntimeStatus(request, userA),
      readManagedRuntimeStatus(request, userB),
    ]);
    expect(gatewayStatusA?.status).toBe("ready");
    expect(gatewayStatusB?.status).toBe("ready");
    expect((await rpcA.listThreads()).map((thread) => thread.id)).toContain(threadA);
    expect((await rpcB.listThreads()).map((thread) => thread.id)).toContain(threadB);

    const streamBClosureCount = rpcB.closeCount;
    const restartedStatusA = await restartManagedRuntimeAsAdmin(request, admin, userA);
    expect(restartedStatusA.status).toBe("ready");
    expect(rpcB.closeCount).toBe(streamBClosureCount);
    const threadsBAfterAgentRestart = await rpcB.listThreads();
    expect(threadsBAfterAgentRestart).toContainEqual(expect.objectContaining({ id: threadB }));
    expect(threadsBAfterAgentRestart).not.toContainEqual(expect.objectContaining({ id: threadA }));

    const restartedRuntimeA = await inspectManagedRuntime(userA);
    expect(restartedRuntimeA.containerId).not.toBe(runtimeA.containerId);
    expect(restartedRuntimeA.endpoint.serviceToken).not.toBe(runtimeA.endpoint.serviceToken);
    expect(
      await isManagedRuntimeTokenRejected(
        userA.user.id,
        restartedRuntimeA.endpoint,
        runtimeA.endpoint.serviceToken,
      ),
    ).toBe(true);
    const recoveredRpcA = new ManagedRuntimeRpcSession(userA.user.id, restartedRuntimeA.endpoint);
    try {
      await recoveredRpcA.connect();
      const threadsAAfterAgentRestart = await recoveredRpcA.listThreads();
      expect(threadsAAfterAgentRestart).toContainEqual(expect.objectContaining({ id: threadA }));
      expect(threadsAAfterAgentRestart).not.toContainEqual(
        expect.objectContaining({ id: threadB }),
      );
    } finally {
      recoveredRpcA.close();
    }
  } finally {
    rpcA.close();
    rpcB.close();
  }
});
