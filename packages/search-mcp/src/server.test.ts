import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { RequestRateLimiter, createSearchMcpServer } from "./server";

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => await client.close()));
});

describe("Search MCP protocol", () => {
  it("lists and calls bounded web_search and web_fetch tools", async () => {
    const { client } = await connectedClient({
      search: async () => [
        { title: "Result", url: "https://example.test/result", snippet: "Snippet" },
      ],
      fetchText: async () => ({
        url: "https://example.test/page",
        contentType: "text/plain",
        text: "Page text",
      }),
    });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["web_fetch", "web_search"]);
    await expect(
      client.callTool({ name: "web_search", arguments: { query: "revenue", limit: 3 } }),
    ).resolves.toMatchObject({
      structuredContent: {
        results: [{ title: "Result", url: "https://example.test/result", snippet: "Snippet" }],
      },
    });
    await expect(
      client.callTool({ name: "web_fetch", arguments: { url: "https://example.test/page" } }),
    ).resolves.toMatchObject({
      structuredContent: {
        url: "https://example.test/page",
        contentType: "text/plain",
        text: "Page text",
      },
    });
  });

  it("limits each caller independently", () => {
    let now = 1_000;
    const limiter = new RequestRateLimiter(2, 1_000, () => now);
    expect(limiter.allow("user-a")).toBe(true);
    expect(limiter.allow("user-a")).toBe(true);
    expect(limiter.allow("user-a")).toBe(false);
    expect(limiter.allow("user-b")).toBe(true);
    now = 2_001;
    expect(limiter.allow("user-a")).toBe(true);
  });
});

async function connectedClient(dependencies: Parameters<typeof createSearchMcpServer>[0]) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createSearchMcpServer(dependencies);
  await server.connect(serverTransport);
  const client = new Client({ name: "search-test", version: "1" });
  await client.connect(clientTransport);
  clients.push(client);
  return { client, server };
}
