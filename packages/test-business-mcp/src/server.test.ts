import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBusinessMcpServer } from "./server";

const clients: Client[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => await client.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) => await rm(directory, { recursive: true })),
  );
});

describe("test business MCP protocol", () => {
  it("exposes deterministic revenue query and idempotent approved write tools", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createBusinessMcpServer();
    await server.connect(serverTransport);
    const client = new Client({ name: "business-test", version: "1" });
    await client.connect(clientTransport);
    clients.push(client);

    const tools = await client.listTools();
    expect(
      tools.tools.find((tool) => tool.name === "revenue_adjustment_write")?.annotations,
    ).toMatchObject({ destructiveHint: true, idempotentHint: true, readOnlyHint: false });
    await expect(
      client.callTool({
        name: "revenue_query",
        arguments: { projectId: 10, from: "2026-09-01", to: "2026-09-07" },
      }),
    ).resolves.toMatchObject({ structuredContent: { total: 128000, currency: "CNY" } });
    const first = await client.callTool({
      name: "revenue_adjustment_write",
      arguments: { projectId: 10, idempotencyKey: "adjust-1", amount: 100, reason: "test" },
    });
    const repeated = await client.callTool({
      name: "revenue_adjustment_write",
      arguments: { projectId: 10, idempotencyKey: "adjust-1", amount: 100, reason: "test" },
    });
    expect(repeated.structuredContent).toEqual(first.structuredContent);
  });

  it("keeps idempotency state in the configured fixture directory", async () => {
    const firstDirectory = await fixtureDirectory();
    const secondDirectory = await fixtureDirectory();
    const first = await connectedClient(firstDirectory);
    const second = await connectedClient(secondDirectory);

    const original = await first.callTool({
      name: "revenue_adjustment_write",
      arguments: { projectId: 10, idempotencyKey: "shared-key", amount: 100, reason: "first" },
    });
    const isolated = await second.callTool({
      name: "revenue_adjustment_write",
      arguments: { projectId: 20, idempotencyKey: "shared-key", amount: 200, reason: "second" },
    });

    expect(original.structuredContent).toMatchObject({ projectId: 10, amount: 100 });
    expect(isolated.structuredContent).toMatchObject({ projectId: 20, amount: 200 });
  });
});

async function connectedClient(stateDirectory?: string) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createBusinessMcpServer({ stateDirectory });
  await server.connect(serverTransport);
  const client = new Client({ name: "business-test", version: "1" });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

async function fixtureDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "codex-business-mcp-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
