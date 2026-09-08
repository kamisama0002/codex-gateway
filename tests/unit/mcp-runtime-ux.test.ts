/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("MCP runtime user experience", () => {
  it("does not render the background MCP connection status in the chat workspace", () => {
    const source = readFileSync(resolve("app/components/chat/AgentWorkspacePane.vue"), "utf8");

    expect(source).not.toContain("McpRuntimeStatusBar");
    expect(source).not.toContain("mcp-runtime-status");
  });

  it("does not offer a misleading last-turn retry for an individual MCP item", () => {
    const source = readFileSync(resolve("app/components/thread/items/ToolCallItem.vue"), "utf8");

    expect(source).not.toContain("presentation.retryable");
    expect(source).not.toContain("threadTurns.retryLastTurn()");
    expect(source).not.toContain("retry-business-mcp-call");
  });
});
