import { z } from "zod";
import { expect, test } from "./fixtures/remote-workspace";
import { openApp } from "./helpers/app";
import {
  installRealtimeSocketProbe,
  realtimeClientMessageCount,
  waitForRealtimeClientMessage,
} from "./helpers/realtime-socket-probe";
import { execRemoteSsh, waitForSelectedThreadId } from "./helpers/remote-codex";

test("creates a thread and sends the first message from the centered composer", async ({
  page,
  remoteWorkspace,
}) => {
  await installRealtimeSocketProbe(page);
  await openApp(page);
  const { project } = await remoteWorkspace.provision({
    hostName: `new-thread-composer-host-${Date.now()}`,
    projectName: `new-thread-composer-project-${Date.now()}`,
  });

  await expect(page.getByTestId("new-thread-empty-state")).toBeVisible();
  await expect(page.getByTestId("new-thread-welcome")).toHaveText("你好，今天想完成什么？");
  await expect(page.getByTestId("project-thread-list")).toHaveCount(0);
  await expect(page.getByText("项目会话", { exact: true })).toHaveCount(0);
  await expect(page.getByText("/workspace", { exact: true })).toHaveCount(0);

  const marker = `首条消息创建会话 ${Date.now()}`;
  const composer = page.getByTestId("composer-input");
  const sendButton = page.getByTestId("send-turn-button");
  await composer.fill(marker);
  await expect(sendButton).toBeEnabled();
  const messageOffset = await realtimeClientMessageCount(page);

  // Deliver two clicks in one task to prove the creation guard works before Vue can disable it.
  await sendButton.evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) throw new Error("Expected a button element");
    button.click();
    button.click();
  });

  const threadId = await waitForSelectedThreadId(page);
  const turnStart = z
    .object({
      type: z.literal("turn.start"),
      projectId: z.number(),
      threadId: z.string(),
      text: z.string(),
    })
    .loose()
    .parse(await waitForRealtimeClientMessage(page, "turn.start", messageOffset));
  expect(turnStart).toMatchObject({ projectId: project.id, threadId, text: marker });
  await expect(page.getByTestId(`thread-button-${threadId}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("chat-scroll-area").getByText(marker)).toBeVisible();
  await expect(composer).toHaveAttribute("data-value", "");

  const submittedTurns = await page.evaluate(
    (offset) =>
      (window.__gatewayRealtimeProbe?.messages ?? [])
        .slice(offset)
        .filter((message) => message.type === "turn.start").length,
    messageOffset,
  );
  expect(submittedTurns).toBe(1);
});

test("cancels pending first-thread creation without clearing the draft or starting a turn", async ({
  page,
  remoteWorkspace,
}) => {
  await installRealtimeSocketProbe(page);
  await openApp(page);
  await remoteWorkspace.provision({
    hostName: `cancel-new-thread-host-${Date.now()}`,
    projectName: `cancel-new-thread-project-${Date.now()}`,
  });

  const paused = await execRemoteSsh(
    remoteWorkspace.remote,
    `pids="$(pgrep -f '[c]odex app-server' | tr '\\n' ' ')"; test -n "$pids"; kill -STOP $pids; printf '%s' "$pids"`,
  );
  const pausedPids = paused.stdout
    .trim()
    .split(/\s+/)
    .filter((pid) => /^\d+$/.test(pid));
  expect(pausedPids.length).toBeGreaterThan(0);
  let resumed = false;

  try {
    const marker = `取消首次会话创建 ${Date.now()}`;
    const composer = page.getByTestId("composer-input");
    const sendButton = page.getByTestId("send-turn-button");
    await composer.fill(marker);
    const messageOffset = await realtimeClientMessageCount(page);
    await sendButton.click();

    const threadStart = z
      .object({ type: z.literal("thread.start"), requestId: z.string() })
      .loose()
      .parse(await waitForRealtimeClientMessage(page, "thread.start", messageOffset));
    await page.evaluate((requestId) => {
      const state = window as typeof window & {
        __threadStartedResponses?: Array<Record<string, unknown>>;
      };
      state.__threadStartedResponses = [];
      for (const socket of window.__gatewayRealtimeProbe?.sockets ?? []) {
        socket.addEventListener("message", (event) => {
          if (typeof event.data !== "string") return;
          try {
            const message: unknown = JSON.parse(event.data);
            if (
              message !== null &&
              typeof message === "object" &&
              "type" in message &&
              message.type === "thread.started" &&
              "requestId" in message &&
              message.requestId === requestId
            ) {
              state.__threadStartedResponses?.push(message);
            }
          } catch {
            // Ignore non-protocol frames.
          }
        });
      }
    }, threadStart.requestId);

    await expect(sendButton).toBeEnabled();
    await expect(sendButton).toHaveAttribute("aria-label", "取消创建会话");
    await expect(page.getByRole("button", { name: "附加文件" })).toBeDisabled();
    await sendButton.click();
    await expect(composer).toHaveAttribute("data-value", marker);

    await execRemoteSsh(remoteWorkspace.remote, `kill -CONT ${pausedPids.join(" ")}`);
    resumed = true;
    await page.waitForFunction(
      () =>
        ((window as typeof window & { __threadStartedResponses?: unknown[] })
          .__threadStartedResponses?.length ?? 0) > 0,
      undefined,
      { timeout: 30_000 },
    );

    await expect(page.getByTestId("new-thread-empty-state")).toBeVisible();
    await expect(composer).toHaveAttribute("data-value", marker);
    const submittedTurns = await page.evaluate(
      (offset) =>
        (window.__gatewayRealtimeProbe?.messages ?? [])
          .slice(offset)
          .filter((message) => message.type === "turn.start").length,
      messageOffset,
    );
    expect(submittedTurns).toBe(0);
  } finally {
    if (!resumed) {
      await execRemoteSsh(remoteWorkspace.remote, `kill -CONT ${pausedPids.join(" ")}`);
    }
  }
});
