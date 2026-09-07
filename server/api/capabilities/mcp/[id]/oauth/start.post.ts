import { createError, getQuery, getRouterParam, type H3Event } from "h3";
import { requireAuthenticatedUser } from "../../../../../utils/gateway/auth/context";
import { startMcpOAuthForUser } from "../../../../../utils/gateway/credentials/mcp-oauth-runtime";
import { defineGatewayEventHandler } from "../../../../../utils/gateway/http/errors";

export async function startMcpOAuthForEvent(
  event: H3Event,
  start: typeof startMcpOAuthForUser = startMcpOAuthForUser,
) {
  const user = requireAuthenticatedUser(event);
  const capabilityId = getRouterParam(event, "id")?.trim() ?? "";
  if (capabilityId === "") throw createError({ statusCode: 400, statusMessage: "Invalid MCP ID" });
  const query = getQuery(event);
  const projectId = optionalPositiveId(query.projectId, "project ID");
  const threadId =
    typeof query.threadId === "string" && query.threadId !== "" ? query.threadId : null;
  return await start({ userId: user.id, projectId, capabilityId, threadId });
}

export default defineGatewayEventHandler(async (event) => await startMcpOAuthForEvent(event));

function optionalPositiveId(value: unknown, label: string) {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createError({ statusCode: 400, statusMessage: `Invalid ${label}` });
  }
  return parsed;
}
