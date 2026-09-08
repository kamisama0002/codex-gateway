import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const adjustmentSchema = z
  .object({
    adjustmentId: z.string(),
    projectId: z.number().int().positive(),
    amount: z.number(),
    reason: z.string(),
  })
  .strict();

type Adjustment = z.infer<typeof adjustmentSchema>;

export interface BusinessMcpOptions {
  stateDirectory?: string;
}

class FileAdjustmentStore {
  constructor(private readonly directory: string) {}

  async getOrCreate(
    idempotencyKey: string,
    input: Omit<Adjustment, "adjustmentId">,
  ): Promise<Adjustment> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
    const path = join(this.directory, `${keyHash}.json`);
    const adjustment: Adjustment = {
      adjustmentId: `adjustment-${keyHash.slice(0, 16)}`,
      ...input,
    };
    try {
      await writeFile(path, JSON.stringify(adjustment), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return adjustment;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      return adjustmentSchema.parse(JSON.parse(await readFile(path, "utf8")));
    }
  }
}

export function createBusinessMcpServer(options: BusinessMcpOptions = {}) {
  const store = new FileAdjustmentStore(
    options.stateDirectory ?? join(tmpdir(), "codex-test-business-mcp"),
  );
  const server = new McpServer({ name: "codex-gateway-test-business", version: "1.0.0" });
  server.registerTool(
    "revenue_query",
    {
      description: "Return deterministic revenue fixtures for one project and date range.",
      inputSchema: {
        projectId: z.number().int().positive(),
        from: z.iso.date(),
        to: z.iso.date(),
      },
      outputSchema: {
        projectId: z.number(),
        from: z.string(),
        to: z.string(),
        currency: z.string(),
        total: z.number(),
        rows: z.array(z.object({ date: z.string(), amount: z.number() }).strict()),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ projectId, from, to }) => {
      const result = {
        projectId,
        from,
        to,
        currency: "CNY",
        total: 128_000,
        rows: [
          { date: "2026-09-01", amount: 60_000 },
          { date: "2026-09-02", amount: 68_000 },
        ],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
  server.registerTool(
    "revenue_adjustment_write",
    {
      description: "Create one deterministic test revenue adjustment using an idempotency key.",
      inputSchema: {
        projectId: z.number().int().positive(),
        idempotencyKey: z.string().trim().min(1).max(128),
        amount: z.number(),
        reason: z.string().trim().min(1).max(500),
      },
      outputSchema: {
        adjustmentId: z.string(),
        projectId: z.number(),
        amount: z.number(),
        reason: z.string(),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId, idempotencyKey, amount, reason }) => {
      const result = await store.getOrCreate(idempotencyKey, { projectId, amount, reason });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
  return server;
}

export function startBusinessMcpServer(environment: NodeJS.ProcessEnv = process.env) {
  const port = Number(environment.PORT ?? "8789");
  const host = environment.HOST ?? "0.0.0.0";
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid MCP port");
  return createServer((request, response) => {
    void handleBusinessRequest(request, response, environment.BUSINESS_MCP_STATE_DIR).catch(
      (error: unknown) => {
        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "business_mcp_request_failed" }));
        } else {
          response.destroy(error instanceof Error ? error : undefined);
        }
      },
    );
  }).listen(port, host);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  startBusinessMcpServer();
}

async function handleBusinessRequest(
  request: IncomingMessage,
  response: ServerResponse,
  stateDirectory: string | undefined,
) {
  if (request.url !== "/mcp") {
    response.writeHead(404).end();
    return;
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createBusinessMcpServer({ stateDirectory });
  await server.connect(transport);
  response.once("close", () => void server.close());
  await transport.handleRequest(request, response);
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
