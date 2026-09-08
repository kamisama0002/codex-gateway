import { createError, getQuery, getRequestURL, sendRedirect, type H3Event } from "h3";
import { requireAuthenticatedUser } from "../../../../utils/gateway/auth/context";
import { completeMcpOAuthForUser } from "../../../../utils/gateway/credentials/mcp-oauth-runtime";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";

export async function completeMcpOAuthForEvent(
  event: H3Event,
  complete: (
    input: Parameters<typeof completeMcpOAuthForUser>[0],
  ) => Promise<unknown> = completeMcpOAuthForUser,
) {
  const user = requireAuthenticatedUser(event);
  const state = getQuery(event).state;
  if (typeof state !== "string" || state === "") {
    throw createError({ statusCode: 400, statusMessage: "Invalid OAuth state" });
  }
  return await complete({
    userId: user.id,
    state,
    query: getRequestURL(event).search.slice(1),
  });
}

export default defineGatewayEventHandler(async (event) => {
  await completeMcpOAuthForEvent(event);
  return await sendRedirect(event, "/?settings=capabilities&oauth=completed", 302);
});
