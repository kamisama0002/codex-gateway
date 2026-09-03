import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";
import {
  applyGatewayLiveEvent,
  capturedRealtimeInterrupt,
  capturedServerRequestResponse,
  interruptActiveTurnInStore,
  installRealtimeInterruptMock,
  installServerRequestResponderMock,
  seedGatewayThread,
} from "./helpers/gateway-store";

test("dynamic tool response submits through the server request responder and surfaces failures", async ({
  page,
}) => {
  await openApp(page);
  const threadId = "e2e-dynamic-tool-thread";
  await seedGatewayThread(page, {
    hostId: 7,
    projectId: 3,
    threadId,
    currentThread: { id: threadId, name: "Dynamic Tool" },
    status: "running",
    history: {
      thread: {
        id: threadId,
        turns: [
          {
            id: "turn-dynamic-tool",
            status: "running",
            items: [
              {
                id: "server-request-42",
                type: "dynamicToolClientRequest",
                turnId: "turn-dynamic-tool",
                status: "waitingForClient",
                requestId: 42,
                method: "item/tool/call",
                params: {
                  namespace: "codex_app",
                  tool: "read_thread_terminal",
                  arguments: {},
                },
              },
            ],
          },
        ],
      },
    },
  });

  await installServerRequestResponderMock(page, {
    mode: "capture",
  });

  await page.getByTestId("dynamic-tool-submit").click();
  await expect
    .poll(() => capturedServerRequestResponse(page))
    .toMatchObject({
      hostId: 7,
      threadId: "e2e-dynamic-tool-thread",
      serverRequestId: 42,
      result: {
        contentItems: [{ type: "inputText", text: "" }],
        success: true,
      },
    });
  await expect(page.getByTestId("dynamic-tool-submit")).toBeEnabled();

  await installServerRequestResponderMock(page, {
    mode: "fail",
    message: "pending app-server request was not found",
  });

  await page.getByTestId("dynamic-tool-submit").click();
  await expect(
    page
      .getByTestId("thread-runtime-notice")
      .getByText("pending app-server request was not found", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("chat-scroll-area").getByText("pending app-server request was not found"),
  ).toHaveCount(0);

  await applyGatewayLiveEvent(page, {
    id: 43,
    hostId: 7,
    threadId,
    method: "serverRequest/resolved",
    payload: { method: "serverRequest/resolved", params: { threadId, requestId: 42 } },
    createdAt: new Date().toISOString(),
  });
  await expect(page.getByTestId("dynamic-tool-submit")).toBeHidden();
  await expect(page.getByText("请求已处理")).toBeVisible();
});

test("app-server retry errors stay visible outside the timeline until recovery", async ({
  page,
}) => {
  await openApp(page);
  const threadId = "e2e-app-server-error-thread";
  await seedGatewayThread(page, {
    threadId,
    currentThread: { id: threadId, name: "Error Notification" },
    history: { thread: { id: threadId, turns: [] } },
  });
  await applyGatewayLiveEvent(page, {
    id: 101,
    hostId: 1,
    threadId,
    method: "error",
    payload: {
      method: "error",
      params: {
        threadId,
        turnId: "turn-error",
        willRetry: true,
        error: {
          message: "remote provider disconnected",
          codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } },
          additionalDetails: "stream closed before final response",
        },
      },
    },
    createdAt: new Date().toISOString(),
  });

  const chatScrollArea = page.getByTestId("chat-scroll-area");
  const notice = page.getByTestId("thread-runtime-notice");
  await expect(notice).toHaveAttribute("data-phase", "retrying");
  await expect(notice.getByText("正在重新连接模型")).toBeVisible();
  await expect(notice.getByText(/检查提供方地址/)).toBeVisible();
  await expect(notice.getByText(/系统正在自动重试/)).toBeVisible();
  await expect(chatScrollArea.getByText("remote provider disconnected")).toHaveCount(0);
  await notice.getByText("技术详情").click();
  await expect(notice.getByText(/remote provider disconnected/)).toBeVisible();

  await applyGatewayLiveEvent(page, {
    id: 1011,
    hostId: 1,
    threadId,
    method: "rawResponseItem/completed",
    payload: {
      method: "rawResponseItem/completed",
      params: {
        threadId,
        turnId: "turn-error",
        item: { type: "message", id: "raw-response-item" },
      },
    },
    createdAt: new Date().toISOString(),
  });
  await expect(chatScrollArea.getByText("模型原始响应项完成")).toHaveCount(0);

  await applyGatewayLiveEvent(page, {
    id: 102,
    hostId: 1,
    threadId,
    method: "item/agentMessage/delta",
    payload: {
      method: "item/agentMessage/delta",
      params: {
        threadId,
        turnId: "turn-error",
        itemId: "agent-recovered",
        delta: "retry recovered",
      },
    },
    createdAt: new Date().toISOString(),
  });

  await expect(chatScrollArea.getByText("retry recovered")).toBeVisible();
  await expect(notice).toBeHidden();
});

test("provider API key errors fail immediately with an actionable status", async ({ page }) => {
  await openApp(page);
  const threadId = "e2e-provider-auth-error-thread";
  await seedGatewayThread(page, {
    threadId,
    currentThread: { id: threadId, name: "Provider Auth Error" },
    history: { thread: { id: threadId, turns: [] } },
    status: "running",
  });
  await applyGatewayLiveEvent(page, {
    id: 111,
    hostId: 1,
    threadId,
    method: "error",
    payload: {
      method: "error",
      params: {
        threadId,
        turnId: "turn-auth-error",
        willRetry: false,
        error: {
          message: '{"error":{"code":"provider_unauthorized","message":"Invalid API key"}}',
          codexErrorInfo: "badRequest",
          additionalDetails: null,
        },
      },
    },
    createdAt: new Date().toISOString(),
  });

  const notice = page.getByTestId("thread-runtime-notice");
  await expect(notice).toHaveAttribute("data-phase", "failed");
  await expect(notice.getByText("模型 API Key 无效")).toBeVisible();
  await expect(notice.getByText(/更新 API Key 后重新发送/)).toBeVisible();
  await expect(page.getByTestId("thread-runtime-phase")).toContainText("失败");
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute("aria-label", "失败");
});

test("approval and user-input requests expose distinct thread phases", async ({ page }) => {
  await openApp(page);
  const threadId = "e2e-waiting-phase-thread";
  await seedGatewayThread(page, {
    threadId,
    currentThread: { id: threadId, name: "Waiting Phase" },
    history: { thread: { id: threadId, turns: [] } },
    status: "running",
  });
  await applyGatewayLiveEvent(page, {
    id: 121,
    hostId: 1,
    threadId,
    method: "item/permissions/requestApproval",
    payload: {
      id: 121,
      method: "item/permissions/requestApproval",
      params: { threadId, turnId: "turn-waiting", itemId: "permission-1" },
    },
    createdAt: new Date().toISOString(),
  });
  await expect(page.getByTestId("thread-runtime-phase")).toContainText("等待审批");
  await expect(page.getByTestId("thread-runtime-notice")).toContainText("需要你的审批");

  await applyGatewayLiveEvent(page, {
    id: 122,
    hostId: 1,
    threadId,
    method: "item/tool/requestUserInput",
    payload: {
      id: 122,
      method: "item/tool/requestUserInput",
      params: { threadId, turnId: "turn-waiting", itemId: "question-1", questions: [] },
    },
    createdAt: new Date().toISOString(),
  });
  await expect(page.getByTestId("thread-runtime-phase")).toContainText("等待输入");
  await expect(page.getByTestId("thread-runtime-notice")).toContainText("需要你的输入");
});

test("app-server moderation notifications render a readable summary before raw details", async ({
  page,
}) => {
  await openApp(page);
  const threadId = "e2e-moderation-notification-thread";
  await seedGatewayThread(page, {
    threadId,
    currentThread: { id: threadId, name: "Moderation Notification" },
    history: { thread: { id: threadId, turns: [] } },
  });
  await applyGatewayLiveEvent(page, {
    id: 201,
    hostId: 1,
    threadId,
    method: "turn/moderationMetadata",
    payload: {
      method: "turn/moderationMetadata",
      params: {
        threadId,
        turnId: "turn-moderation",
        metadata: {
          flagged: true,
          model: "omni-moderation-latest",
          categories: { self_harm: true, violence: false },
          raw: "only visible after expanding details",
        },
      },
    },
    createdAt: new Date().toISOString(),
  });

  const chatScrollArea = page.getByTestId("chat-scroll-area");
  await expect(chatScrollArea.getByText("安全审查元数据")).toBeVisible();
  await expect(chatScrollArea.getByText(/flagged=true/)).toBeVisible();
  await expect(chatScrollArea.getByText(/categories=self_harm/)).toBeVisible();
  await expect(chatScrollArea.getByText("only visible after expanding details")).toBeHidden();
  await chatScrollArea.getByRole("button", { name: "查看详情" }).click();
  await expect(chatScrollArea.getByText("only visible after expanding details")).toBeVisible();
});

test("terminal wait notifications mention the command being watched", async ({ page }) => {
  await openApp(page);
  await seedGatewayThread(page, {
    threadId: "e2e-terminal-wait-thread",
    currentThread: { id: "e2e-terminal-wait-thread", name: "Terminal Wait" },
    history: { thread: { id: "e2e-terminal-wait-thread", turns: [] } },
  });
  await applyGatewayLiveEvent(page, {
    id: 301,
    hostId: 1,
    threadId: "e2e-terminal-wait-thread",
    method: "item/started",
    payload: {
      method: "item/started",
      params: {
        threadId: "e2e-terminal-wait-thread",
        turnId: "turn-terminal",
        startedAtMs: Date.now(),
        item: {
          id: "cmd-watch",
          type: "commandExecution",
          command: "/bin/bash -lc 'pnpm dev'",
          cwd: "/workspace/codex-gateway",
          processId: "proc-123",
          status: "inProgress",
          aggregatedOutput: "",
          exitCode: null,
          durationMs: null,
        },
      },
    },
    createdAt: new Date().toISOString(),
  });
  await applyGatewayLiveEvent(page, {
    id: 302,
    hostId: 1,
    threadId: "e2e-terminal-wait-thread",
    method: "item/commandExecution/terminalInteraction",
    payload: {
      method: "item/commandExecution/terminalInteraction",
      params: {
        threadId: "e2e-terminal-wait-thread",
        turnId: "turn-terminal",
        itemId: "cmd-watch",
        processId: "proc-123",
        stdin: "",
      },
    },
    createdAt: new Date().toISOString(),
  });

  const chatScrollArea = page.getByTestId("chat-scroll-area");
  await expect(
    chatScrollArea.getByText("agent 正在等待命令：pnpm dev", { exact: true }),
  ).toBeVisible();

  await installRealtimeInterruptMock(page);

  await interruptActiveTurnInStore(page);

  await expect
    .poll(() => capturedRealtimeInterrupt(page))
    .toMatchObject({
      type: "turn.interrupt",
      hostId: 1,
      threadId: "e2e-terminal-wait-thread",
      turnId: "turn-terminal",
    });
});
