import { createError, type H3Event } from "h3";
import { requireAuthenticatedUser } from "../../../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../../../utils/gateway/http/errors";

export function revokeMcpOAuthForEvent(event: H3Event) {
  requireAuthenticatedUser(event);
  throw createError({
    statusCode: 501,
    statusMessage: "MCP OAuth revoke is not supported by this Codex App Server",
    data: { code: "unsupportedCapability" },
  });
}

export default defineGatewayEventHandler((event) => revokeMcpOAuthForEvent(event));
