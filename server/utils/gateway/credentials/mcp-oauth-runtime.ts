import { createError } from "h3";
import { capabilityStore } from "../capabilities/store";
import { reconcileUserRuntime } from "../capabilities/reconciler";
import { threadBroker } from "../runtime/broker";
import { runtimeService } from "../runtime-manager/runtime-service";
import { McpOAuthService } from "./oauth-service";
import { mcpOAuthStateStore } from "./oauth-store";

export async function startMcpOAuthForUser(input: {
  userId: number;
  projectId: number | null;
  capabilityId: string;
  threadId: string | null;
}) {
  const desired = await capabilityStore.listDesiredForContext({
    userId: input.userId,
    projectId: input.projectId,
  });
  const capability = desired.find((item) => item.id === input.capabilityId);
  if (capability === undefined || (capability.kind !== "mcp" && capability.kind !== "search")) {
    throw createError({ statusCode: 404, statusMessage: "MCP capability not found" });
  }
  const host = await runtimeService.resolveManagedHost(input.userId);
  const service = oauthService(host);
  return await service.start({
    ...input,
    runtimeId: runtimeService.runtimeIdForUser(input.userId),
  });
}

export async function completeMcpOAuthForUser(input: {
  userId: number;
  state: string;
  query: string;
}) {
  return await oauthService(null).complete(input);
}

function oauthService(host: Awaited<ReturnType<typeof runtimeService.resolveManagedHost>> | null) {
  return new McpOAuthService({
    store: mcpOAuthStateStore,
    startLogin: async ({ capabilityId, threadId }) => {
      if (host === null) throw new Error("MCP OAuth login host is unavailable");
      return await threadBroker.capabilityRuntime().startMcpOAuth(host, capabilityId, threadId);
    },
    forwardCallback: async ({ userId, callbackPathAndQuery }) =>
      await runtimeService.forwardOAuthCallback(userId, callbackPathAndQuery),
    reconcile: reconcileUserRuntime,
  });
}
