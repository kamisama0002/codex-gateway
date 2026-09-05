import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";
import {
  activeRealtimeSocketCount,
  closeRealtimeSockets,
  dispatchRealtimeServerFrame,
  installRealtimeSocketProbe,
  realtimeSocketCloseCalls,
} from "./helpers/realtime-socket-probe";

test("shows reconnecting state in the main conversation pane", async ({ page }) => {
  await installRealtimeSocketProbe(page);
  await openApp(page);
  await expect.poll(() => activeRealtimeSocketCount(page)).toBe(1);

  await closeRealtimeSockets(page);

  await expect(
    page.getByTestId("chat-main-pane").getByTestId("realtime-connection-indicator"),
  ).toHaveText(/^正在重连 \d+$/);
});

test("closes the protocol stream instead of ignoring a malformed server frame", async ({
  page,
}) => {
  await installRealtimeSocketProbe(page);
  // This case verifies the browser's close/reconnect handshake, so it must not use Playwright's
  // transparent WebSocketRoute: that route intentionally owns and virtualizes close propagation.
  await openApp(page, { interceptRealtime: false });
  await expect.poll(() => activeRealtimeSocketCount(page)).toBe(1);

  const closeCallCount = (await realtimeSocketCloseCalls(page)).length;
  await dispatchRealtimeServerFrame(page, "{not-json");

  // Strict parsing deliberately closes the compromised protocol stream. Assert the protocol close
  // directly instead of coupling parser coverage to the remote peer's close-handshake timing.
  await expect
    .poll(async () => (await realtimeSocketCloseCalls(page)).slice(closeCallCount))
    .toContainEqual({ code: 1002, reason: "Invalid realtime server frame" });
  await expect(page.getByTestId("app-ready")).toBeAttached();
});

test("stops automatic reconnect after the DSH retry schedule and allows manual recovery", async ({
  page,
}) => {
  let connectionAttempts = 0;
  let allowRecovery = false;
  await page.routeWebSocket(/\/api\/realtime$/, (route) => {
    connectionAttempts += 1;
    if (allowRecovery) {
      route.connectToServer();
      return;
    }
    void route.close({ code: 1012, reason: "E2E connection generation failure" });
  });
  await openApp(page, { interceptRealtime: false, resetConfig: false });
  await expect.poll(() => connectionAttempts, { timeout: 45_000 }).toBe(7);

  const indicator = page.getByTestId("chat-main-pane").getByTestId("realtime-connection-indicator");
  await expect(indicator).toHaveAccessibleName("实时连接已断开，立即重连");
  await expect(indicator).toBeEnabled();
  await page.waitForTimeout(11_000);
  expect(connectionAttempts).toBe(7);

  allowRecovery = true;
  await indicator.click();
  await expect.poll(() => connectionAttempts).toBe(8);
  await expect(indicator).toBeHidden();
});
