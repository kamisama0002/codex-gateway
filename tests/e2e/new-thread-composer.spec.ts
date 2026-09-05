import { z } from "zod";
import { expect, test } from "./fixtures/remote-workspace";
import { E2E_PASSWORD, E2E_USERNAME, openApp } from "./helpers/app";
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
  await expect(composer).toHaveAttribute("contenteditable", "true");
  await expect(page.locator('input[type="file"]').first()).toBeEnabled();
  await expect(page.getByTestId("workspace-file-input")).toBeEnabled();
  await expect(page.getByTestId("workspace-folder-input")).toBeEnabled();
  await expect(page.getByTestId("composer-add-content")).toBeEnabled();
  await expect(page.getByTestId("model-select")).toBeEnabled();
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
  await expect(
    page.getByTestId("chat-scroll-area").locator(".thread-user-message", { hasText: marker }),
  ).toBeVisible();
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

test("cancels pending first-thread creation through the server without clearing the draft", async ({
  page,
  remoteWorkspace,
}) => {
  await installRealtimeSocketProbe(page);
  await openApp(page);
  const { host } = await remoteWorkspace.provision({
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
    const uploadInput = page.locator('input[type="file"]').first();
    const workspaceFileInput = page.getByTestId("workspace-file-input");
    const workspaceFolderInput = page.getByTestId("workspace-folder-input");
    const addContentButton = page.getByTestId("composer-add-content");
    const modelSelect = page.getByTestId("model-select");
    const approvalSelect = page.getByRole("button", {
      name: /^(请求审批|帮我审批|完全访问|自定义)$/,
    });
    await uploadInput.setInputFiles({
      name: "frozen-preview.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    const attachment = page.getByAltText("frozen-preview.png");
    const removeAttachment = page.getByRole("button", { name: "移除附件" });
    await expect(attachment).toBeVisible();
    const approvalChoice = await approvalSelect.innerText();
    const modelChoice = await modelSelect.innerText();
    await composer.fill(marker);
    const messageOffset = await realtimeClientMessageCount(page);
    await composer.press("Enter");

    const threadStart = z
      .object({ type: z.literal("thread.start"), requestId: z.string() })
      .loose()
      .parse(await waitForRealtimeClientMessage(page, "thread.start", messageOffset));
    await page.evaluate(
      ({ requestId, hostId }) => {
        const state = window as typeof window & {
          __cancelledThreadServerMessages?: Array<Record<string, unknown>>;
        };
        state.__cancelledThreadServerMessages = [];
        for (const socket of window.__gatewayRealtimeProbe?.sockets ?? []) {
          socket.addEventListener("message", (event) => {
            if (typeof event.data !== "string") return;
            try {
              const message: unknown = JSON.parse(event.data);
              if (message === null || typeof message !== "object" || !("type" in message)) return;
              if (
                (message.type === "thread.started" &&
                  "requestId" in message &&
                  message.requestId === requestId) ||
                (message.type === "thread.catalog.updated" &&
                  "hostId" in message &&
                  message.hostId === hostId &&
                  "action" in message &&
                  message.action === "deleted")
              ) {
                state.__cancelledThreadServerMessages?.push(message);
              }
            } catch {
              // Ignore non-protocol frames.
            }
          });
        }
      },
      { requestId: threadStart.requestId, hostId: host.id },
    );

    await expect(sendButton).toBeEnabled();
    await expect(sendButton).toHaveAttribute("aria-label", "取消创建会话");
    await expect(composer).toHaveAttribute("contenteditable", "false");
    await expect(uploadInput).toBeDisabled();
    await expect(workspaceFileInput).toBeDisabled();
    await expect(workspaceFolderInput).toBeDisabled();
    await expect(addContentButton).toBeDisabled();
    await expect(removeAttachment).toBeDisabled();
    await expect(approvalSelect).toBeDisabled();
    await expect(modelSelect).toBeDisabled();
    await expect(sendButton).toBeFocused();
    await composer.evaluate((element) => {
      const clipboard = new DataTransfer();
      clipboard.items.add(new File(["late"], "late-paste.png", { type: "image/png" }));
      element.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }),
      );
    });
    await expect(page.getByRole("button", { name: "移除附件" })).toHaveCount(1);
    await sendButton.press("Enter");
    const cancellation = z
      .object({ type: z.literal("request.cancel"), targetRequestId: z.string() })
      .strict()
      .parse(await waitForRealtimeClientMessage(page, "request.cancel", messageOffset));
    expect(cancellation.targetRequestId).toBe(threadStart.requestId);

    await expect(composer).toHaveAttribute("data-value", marker);
    await expect(composer).toHaveAttribute("contenteditable", "true");
    await expect(uploadInput).toBeEnabled();
    await expect(workspaceFileInput).toBeEnabled();
    await expect(workspaceFolderInput).toBeEnabled();
    await expect(addContentButton).toBeEnabled();
    await expect(removeAttachment).toBeEnabled();
    await expect(approvalSelect).toBeEnabled();
    await expect.poll(() => approvalSelect.innerText()).toBe(approvalChoice);
    await expect(modelSelect).toBeEnabled();
    await expect.poll(() => modelSelect.innerText()).toBe(modelChoice);
    await expect(attachment).toBeVisible();

    await execRemoteSsh(remoteWorkspace.remote, `kill -CONT ${pausedPids.join(" ")}`);
    resumed = true;
    await page.waitForFunction(
      () =>
        (
          (
            window as typeof window & {
              __cancelledThreadServerMessages?: Array<Record<string, unknown>>;
            }
          ).__cancelledThreadServerMessages ?? []
        ).some(
          (message) => message.type === "thread.catalog.updated" && message.action === "deleted",
        ),
      undefined,
      { timeout: 30_000 },
    );

    const lateServerMessages = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __cancelledThreadServerMessages?: Array<Record<string, unknown>>;
          }
        ).__cancelledThreadServerMessages ?? [],
    );
    expect(lateServerMessages.filter((message) => message.type === "thread.started")).toEqual([]);
    expect(
      lateServerMessages.filter(
        (message) => message.type === "thread.catalog.updated" && message.action === "deleted",
      ),
    ).toHaveLength(1);
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

test("restores an unthreaded project text draft after the session expires", async ({
  page,
  remoteWorkspace,
}) => {
  await installRealtimeSocketProbe(page);
  await openApp(page, { interceptRealtime: false });
  await remoteWorkspace.provision({
    hostName: `expired-draft-host-${Date.now()}`,
    projectName: `expired-draft-project-${Date.now()}`,
  });

  const marker = `登录失效草稿 ${Date.now()}`;
  const composer = page.getByTestId("composer-input");
  await composer.fill(marker);
  const projectUrl = page.url();
  const revoked = await page.evaluate(async () => {
    const token = localStorage.getItem("codex-gateway-auth-token");
    if (token === null || token === "") throw new Error("Missing E2E auth token");
    return (
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      })
    ).ok;
  });

  expect(revoked).toBe(true);
  await expect(page.getByRole("heading", { name: "登录 Codex Gateway" })).toBeVisible();
  await page.getByTestId("login-username").fill(E2E_USERNAME);
  await page.getByTestId("login-password").fill(E2E_PASSWORD);
  await page.getByTestId("login-submit").click();

  await expect(page.getByTestId("new-thread-empty-state")).toBeVisible({ timeout: 30_000 });
  expect(page.url()).toBe(projectUrl);
  await expect(page.getByTestId("composer-input")).toHaveAttribute("data-value", marker);
});
