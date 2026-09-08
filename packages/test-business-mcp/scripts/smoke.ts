export {};

const endpoint = process.env.BUSINESS_MCP_SMOKE_URL ?? "http://127.0.0.1:8789/mcp";

const initialize = object(
  (
    await call({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "business-mcp-smoke", version: "1.0.0" },
      },
    })
  ).result,
  "initialize result",
);
const serverInfo = object(initialize.serverInfo, "server info");
assert(serverInfo.name === "codex-gateway-test-business", "initialize failed");

const toolsResult = object(
  (await call({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })).result,
  "tools result",
);
const tools = array(toolsResult.tools, "tools").map((tool) => object(tool, "tool"));
const writeTool = tools.find((tool) => tool.name === "revenue_adjustment_write");
assert(writeTool !== undefined, "write tool is missing");
const writeAnnotations = object(writeTool.annotations, "write annotations");
assert(writeAnnotations.destructiveHint === true, "write tool is not marked destructive");
assert(writeAnnotations.idempotentHint === true, "write tool is not marked idempotent");

const queryResult = object(
  (
    await call({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "revenue_query",
        arguments: { projectId: 10, from: "2026-09-01", to: "2026-09-07" },
      },
    })
  ).result,
  "query result",
);
const queryContent = object(queryResult.structuredContent, "query content");
assert(queryContent.total === 128_000, "revenue query failed");

const writeArguments = {
  projectId: 10,
  idempotencyKey: "task10-smoke-write",
  amount: 100,
  reason: "Task 10 smoke test",
};
const firstWrite = object(
  (
    await call({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "revenue_adjustment_write", arguments: writeArguments },
    })
  ).result,
  "first write result",
);
const repeatedWrite = object(
  (
    await call({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "revenue_adjustment_write", arguments: writeArguments },
    })
  ).result,
  "repeated write result",
);
const firstWriteContent = object(firstWrite.structuredContent, "first write content");
const repeatedWriteContent = object(repeatedWrite.structuredContent, "repeated write content");
assert(
  JSON.stringify(firstWriteContent) === JSON.stringify(repeatedWriteContent),
  "idempotent write returned different results",
);

console.log(
  JSON.stringify({
    server: serverInfo,
    revenueTotal: queryContent.total,
    adjustmentId: firstWriteContent.adjustmentId,
    writeAnnotations,
  }),
);

async function call(body: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  assert(response.ok, `MCP request failed with status ${response.status}`);
  const data = (await response.text())
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  assert(data !== undefined, "MCP response did not contain an SSE data event");
  const result = object(JSON.parse(data) as unknown, "MCP response");
  if (result.error !== undefined) {
    const error = object(result.error, "MCP error");
    throw new Error(typeof error.message === "string" ? error.message : "MCP request failed");
  }
  return result;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} is invalid`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} is invalid`);
  return value;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
