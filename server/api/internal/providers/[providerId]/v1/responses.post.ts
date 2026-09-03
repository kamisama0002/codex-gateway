import { getRequestURL, getRouterParam, readRawBody, type H3Event } from "h3";
import { defineGatewayEventHandler } from "../../../../../utils/gateway/http/errors";
import { handleProviderResponses } from "../../../../../utils/gateway/providers/provider-proxy";

export default defineGatewayEventHandler(async (event: H3Event) => {
  const providerId = getRouterParam(event, "providerId");
  if (providerId === undefined) return new Response(null, { status: 404 });
  const body = await readRawBody(event, false);
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.node.req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  // Node's IncomingMessage URL is commonly relative (for example `/api/...`).
  // The Fetch Request constructor requires an absolute URL, so use h3's trusted
  // request URL resolver instead of passing the raw path through unchanged.
  return handleProviderResponses(new Request(getRequestURL(event), {
    method: event.method,
    headers,
    body: body === undefined ? undefined : body.toString("utf8"),
  }), providerId);
});
