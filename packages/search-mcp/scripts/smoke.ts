export {};

const endpoint = process.env.SEARCH_MCP_SMOKE_URL ?? "http://127.0.0.1:8788/mcp";

const initialize = object(
  (
    await call({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "search-mcp-smoke", version: "1.0.0" },
      },
    })
  ).result,
  "initialize result",
);
const serverInfo = object(initialize.serverInfo, "server info");
assert(serverInfo.name === "codex-gateway-search", "initialize failed");

const toolsResult = object(
  (await call({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })).result,
  "tools result",
);
const tools = array(toolsResult.tools, "tools").map((tool) => object(tool, "tool"));
const toolNames = tools.map((tool) => text(tool.name, "tool name")).sort();
assert(
  JSON.stringify(toolNames) === JSON.stringify(["web_fetch", "web_search"]),
  "tool list failed",
);

const searchResult = object(
  (
    await call({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "web_search", arguments: { query: "OpenAI Codex GitHub", limit: 3 } },
    })
  ).result,
  "search result",
);
const searchContent = object(searchResult.structuredContent, "search content");
const searchResults = array(searchContent.results, "search results");
assert(searchResults.length > 0, "public search returned no results");

const fetchResult = object(
  (
    await call({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "web_fetch", arguments: { url: "https://example.com" } },
    })
  ).result,
  "fetch result",
);
const fetched = object(fetchResult.structuredContent, "fetch content");
const fetchedUrl = text(fetched.url, "fetched URL");
const fetchedText = text(fetched.text, "fetched text");
assert(fetchedUrl === "https://example.com/" && fetchedText !== "", "public fetch failed");

console.log(
  JSON.stringify({
    server: serverInfo,
    tools: toolNames,
    searchResults: searchResults.length,
    fetchedUrl,
    fetchedBytes: new TextEncoder().encode(fetchedText).byteLength,
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

function text(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} is invalid`);
  return value;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
