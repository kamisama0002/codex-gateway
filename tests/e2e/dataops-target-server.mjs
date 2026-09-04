import { createServer } from "node:http";

const port = Number(process.env.DATAOPS_TARGET_PORT ?? "8080");
const sharedSecret = process.env.DATAOPS_TARGET_SHARED_SECRET ?? "";

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function handleRequest(request, response) {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(204).end();
    return;
  }
  if (
    request.method !== "POST" ||
    request.url !== "/api/codex-gateway/portal-tickets/exchange" ||
    request.headers.authorization !== `Bearer ${sharedSecret}`
  ) {
    json(response, 404, { success: false, code: 1, msg: "not found", data: null });
    return;
  }
  const body = await readJson(request);
  if (!isOneTimeTicket(body)) {
    json(response, 200, { success: false, code: 1, msg: "ticket rejected", data: null });
    return;
  }
  json(response, 200, {
    success: true,
    code: 0,
    msg: "success",
    data: {
      audience: "codex-gateway",
      tenantId: 1,
      userId: 9,
      username: "dataops-e2e",
      externalSubject: "dataops:1:9",
      contextType: "PROJECT",
      projectId: 4,
      runtimeProfile: "DEVELOPMENT",
      platformAdmin: false,
      canDevelopAgents: false,
      canManageAgentStatus: false,
      canManageAgentRuntimeConfig: false,
      permissions: ["agent-center:view"],
      authzVersion: 1,
      issuedAt: "2026-09-04T00:00:00.000Z",
      ticket: null,
    },
  });
}

server.listen(port, "0.0.0.0");

/** @param {import("node:http").IncomingMessage} request */
async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    /** @type {unknown} */
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed;
  } catch {
    return null;
  }
}

/** @param {unknown} value */
function isOneTimeTicket(value) {
  return (
    typeof value === "object" && value !== null && "ticket" in value && value.ticket === "one-time"
  );
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} statusCode
 * @param {unknown} value
 */
function json(response, statusCode, value) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}
