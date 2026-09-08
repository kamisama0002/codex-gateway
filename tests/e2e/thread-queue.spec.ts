import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/remote-workspace";
import { openApp } from "./helpers/app";
import {
  installRealtimeSocketProbe,
  realtimeClientMessageCount,
  waitForRealtimeClientMessage,
} from "./helpers/realtime-socket-probe";

test.setTimeout(240_000);

test("queues a busy Enter submission and runs the edited message after the active turn", async ({
  page,
  remoteWorkspace,
}) => {
  await installRealtimeSocketProbe(page);
  await openApp(page);
  const { project } = await remoteWorkspace.provision();
  const threadId = await remoteWorkspace.startThread(project.id);
  const marker = String(Date.now());
  const activeMarker = `queue-active-${marker}`;
  const queuedMarker = `queue-original-${marker}`;
  const secondQueuedMarker = `queue-second-${marker}`;
  const editedMarker = `queue-edited-${marker}`;
  const composer = page.getByPlaceholder("输入后续修改要求");

  await composer.fill(
    [
      `执行长任务后回复 ${activeMarker}`,
      "运行 python - <<'PY'",
      "import time",
      "time.sleep(12)",
      `print('${activeMarker}')`,
      "PY",
    ].join("\n"),
  );
  await page.getByTestId("send-turn-button").click();
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute("aria-label", "停止生成");
  await expect.poll(() => activeTurnId(page), { timeout: 30_000 }).not.toBe("");

  const queueOffset = await realtimeClientMessageCount(page);
  await composer.fill(`用一句话回复：${queuedMarker}`);
  await composer.press("Enter");
  const queuedRequest = await waitForRealtimeClientMessage(page, "thread.queue.add", queueOffset);
  expect(queuedRequest.threadId).toBe(threadId);
  expect(JSON.stringify(queuedRequest.input)).toContain(queuedMarker);
  expect(await clientMessageTypes(page, queueOffset)).not.toContain("turn.steer");

  const dock = page.getByTestId("composer-queue-dock");
  await expect(dock).toContainText(queuedMarker);
  await expect(dock.getByRole("button", { name: "1 条排队消息" })).toHaveCount(0);
  await expect(
    page
      .getByTestId("chat-scroll-area")
      .getByTestId("steered-conversation-item")
      .getByText(queuedMarker),
  ).toHaveCount(0);

  const secondQueueOffset = await realtimeClientMessageCount(page);
  await composer.fill(`用一句话回复：${secondQueuedMarker}`);
  await composer.press("Enter");
  const secondQueuedRequest = await waitForRealtimeClientMessage(
    page,
    "thread.queue.add",
    secondQueueOffset,
  );
  expect(JSON.stringify(secondQueuedRequest.input)).toContain(secondQueuedMarker);
  await dock.getByRole("button", { name: "2 条排队消息" }).click();
  await expect(dock).toContainText(secondQueuedMarker);

  await dock.getByRole("button", { name: "编辑排队消息" }).first().click();
  const queueEditor = dock.getByRole("textbox", { name: "编辑排队消息" });
  await queueEditor.fill(`用一句话回复：${editedMarker}`);
  const updateOffset = await realtimeClientMessageCount(page);
  await dock.getByRole("button", { name: "保存排队消息" }).click();
  const updateRequest = await waitForRealtimeClientMessage(
    page,
    "thread.queue.update",
    updateOffset,
  );
  expect(JSON.stringify(updateRequest.input)).toContain(editedMarker);
  await expect(dock).toContainText(editedMarker);

  await expect(dock).toBeHidden({ timeout: 180_000 });
  await expect(
    page.getByTestId("chat-scroll-area").getByText(editedMarker, { exact: true }),
  ).toBeVisible({ timeout: 180_000 });
  await expect(
    page.getByTestId("chat-scroll-area").getByText(secondQueuedMarker, { exact: true }),
  ).toBeVisible({ timeout: 180_000 });
  await expect(
    page
      .getByTestId("chat-scroll-area")
      .getByTestId("steered-conversation-item")
      .getByText(editedMarker),
  ).toHaveCount(0);
});

async function activeTurnId(page: Page) {
  return page.evaluate(() => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    const { navigation, runtime, views } = driver;
    const active = [...(views.history?.thread.turns ?? [])].reverse().find((turn) => {
      const status = typeof turn.status === "string" ? turn.status : turn.status?.type;
      return status === "inProgress" || status === "running" || status === "active";
    });
    if (active?.id !== null && active?.id !== undefined) return String(active.id);
    const key =
      navigation.selectedHostId !== null && navigation.selectedThreadId !== null
        ? `${navigation.selectedHostId}:${navigation.selectedThreadId}`
        : "";
    return String(runtime.activeTerminalProcessByThreadKey[key]?.turnId ?? "");
  });
}

async function clientMessageTypes(page: Page, offset: number) {
  return page.evaluate(
    (start) =>
      (window.__gatewayRealtimeProbe?.messages ?? []).slice(start).map((message) => message.type),
    offset,
  );
}
