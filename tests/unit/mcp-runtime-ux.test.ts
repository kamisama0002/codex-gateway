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

  it("lets the user retry a failed business MCP call from the timeline", () => {
    const source = readFileSync(resolve("app/components/thread/items/ToolCallItem.vue"), "utf8");

    expect(source).toContain("presentation.retryable");
    expect(source).toContain("threadTurns.retryLastTurn()");
    expect(source).toContain('t("app.retry")');
  });
});
