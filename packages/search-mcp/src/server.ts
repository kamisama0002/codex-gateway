import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { SearxSearchProvider, type SearchResult } from "./search-provider.js";
import { SafeWebFetcher } from "./url-policy.js";

export interface SearchMcpDependencies {
  search(query: string, limit: number): Promise<SearchResult[]>;
  fetchText(url: string): Promise<{ url: string; contentType: string; text: string }>;
}

export class RequestRateLimiter {
  private readonly requests = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string) {
    const currentTime = this.now();
    const retained = (this.requests.get(key) ?? []).filter(
      (timestamp) => currentTime - timestamp < this.windowMs,
    );
    if (retained.length >= this.limit) {
      this.requests.set(key, retained);
      return false;
    }
    retained.push(currentTime);
    this.requests.set(key, retained);
    return true;
  }
}

export function createSearchMcpServer(dependencies: SearchMcpDependencies) {
  const server = new McpServer({ name: "codex-gateway-search", version: "1.0.0" });
  server.registerTool(
    "web_search",
    {
      description: "Search the public web and return bounded titles, URLs, and snippets.",
      inputSchema: {
        query: z.string().trim().min(1).max(500),
        limit: z.number().int().min(1).max(10).default(5),
      },
      outputSchema: {
        results: z.array(
          z.object({ title: z.string(), url: z.string(), snippet: z.string() }).strict(),
        ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit }) => {
      const results = await dependencies.search(query, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
        structuredContent: { results },
      };
    },
  );
  server.registerTool(
    "web_fetch",
    {
      description: "Fetch bounded readable text from one public HTTP(S) URL.",
      inputSchema: { url: z.url() },
      outputSchema: {
        url: z.string(),
        contentType: z.string(),
        text: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url }) => {
      const result = await dependencies.fetchText(url);
      return {
        content: [{ type: "text", text: result.text }],
        structuredContent: result,
      };
    },
  );
  return server;
}

export function startSearchMcpServer(environment: NodeJS.ProcessEnv = process.env) {
  const provider = new SearxSearchProvider(environment.SEARXNG_URL ?? "http://searxng:8080");
  const fetcher = new SafeWebFetcher();
  const port = Number(environment.PORT ?? "8788");
  const host = environment.HOST ?? "0.0.0.0";
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid MCP port");
  const limiter = new RequestRateLimiter(60, 60_000);
  return createServer((request, response) => {
    void handleSearchRequest(request, response, limiter, provider, fetcher).catch(
      (error: unknown) => {
        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "search_mcp_request_failed" }));
        } else {
          response.destroy(error instanceof Error ? error : undefined);
        }
      },
    );
  }).listen(port, host);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  startSearchMcpServer();
}

async function handleSearchRequest(
  request: IncomingMessage,
  response: ServerResponse,
  limiter: RequestRateLimiter,
  provider: SearxSearchProvider,
  fetcher: SafeWebFetcher,
) {
  if (request.url !== "/mcp") {
    response.writeHead(404).end();
    return;
  }
  if (!limiter.allow(request.socket.remoteAddress ?? "unknown")) {
    response.writeHead(429, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "rate_limited" }));
    return;
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createSearchMcpServer({
    search: (query, limit) => provider.search(query, limit),
    fetchText: (url) => fetcher.fetchText(url),
  });
  await server.connect(transport);
  response.once("close", () => void server.close());
  await transport.handleRequest(request, response);
}
