import { createError, getQuery, getRouterParam, type H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { reconcileUserRuntime } from "../../../utils/gateway/capabilities/reconciler";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export async function retryRuntimeSyncForEvent(
  event: H3Event,
  reconcile: (
    input: Parameters<typeof reconcileUserRuntime>[0],
  ) => Promise<unknown> = reconcileUserRuntime,
) {
  requireAdminUser(event);
  const userId = Number(getRouterParam(event, "userId"));
  if (!Number.isInteger(userId) || userId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid user ID" });
  }
  const rawProjectId = getQuery(event).projectId;
  const projectId = rawProjectId === undefined ? null : Number(rawProjectId);
  if (projectId !== null && (!Number.isInteger(projectId) || projectId <= 0)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid project ID" });
  }
  return await reconcile({ userId, projectId, reason: "administratorRetry" });
}

export default defineGatewayEventHandler(async (event) => await retryRuntimeSyncForEvent(event));
