import { describe, expect, it } from "vitest";
import type { ThreadHistoryItem } from "~~/shared/types";
import { presentToolCall } from "./tool-call-presenters";

const labels: Record<string, string> = {
  "app.arguments": "参数",
  "app.businessDataService": "业务数据服务",
  "app.businessDataUnavailable": "业务数据服务暂时不可用",
  "app.error": "错误",
  "app.result": "结果",
};

const t = (key: string) => labels[key] ?? key;

describe("MCP tool call presentation", () => {
  it.each(["org__infinity", "org__dinky_mcp"])(
    "hides internal diagnostics and offers retry when %s fails",
    (server) => {
      const presentation = presentToolCall(
        {
          type: "mcpToolCall",
          server,
          tool: "query_revenue",
          status: "failed",
          success: false,
          arguments: { month: "2026-09" },
          error: { message: "connect ECONNREFUSED 172.25.106.252:8000" },
        } satisfies ThreadHistoryItem,
        t,
      );

      expect(presentation).toMatchObject({
        title: "业务数据服务暂时不可用",
        retryable: true,
      });
      expect(JSON.stringify(presentation)).not.toContain(server);
      expect(JSON.stringify(presentation)).not.toContain("ECONNREFUSED");
      expect(JSON.stringify(presentation)).not.toContain("172.25.106.252");
    },
  );

  it("uses a friendly service name without exposing the managed MCP id", () => {
    const presentation = presentToolCall(
      {
        type: "mcpToolCall",
        server: "org__dinky_mcp",
        tool: "query_revenue",
        status: "completed",
        success: true,
        result: { text: '{"amount":12000}' },
      } satisfies ThreadHistoryItem,
      t,
    );

    expect(presentation.title).toBe("业务数据服务 · query_revenue");
    expect(presentation.retryable).toBe(false);
    expect(JSON.stringify(presentation)).not.toContain("org__dinky_mcp");
  });

  it("keeps ordinary user-configured MCP diagnostics unchanged", () => {
    const presentation = presentToolCall(
      {
        type: "mcpToolCall",
        server: "personal_docs",
        tool: "search",
        status: "failed",
        error: { message: "Personal MCP failed" },
      } satisfies ThreadHistoryItem,
      t,
    );

    expect(presentation.title).toBe("personal_docs · search");
    expect(presentation.retryable).toBe(false);
    expect(presentation.details).toContainEqual({
      label: "错误",
      kind: "markdown",
      content: "Personal MCP failed",
    });
  });
});
