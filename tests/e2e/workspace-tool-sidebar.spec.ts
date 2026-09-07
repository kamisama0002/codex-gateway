import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";

test("desktop keeps Agent primary and exposes a persistent tool workspace", async ({ page }) => {
  await openApp(page);

  const agentHeader = page.getByTestId("workspace-agent-header");
  await expect(agentHeader).toBeVisible();
  await expect(agentHeader).toContainText("新会话");
  await expect(agentHeader.getByText("Agent", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("workspace-tool-home")).toBeVisible();
  await expect(page.getByTestId("workspace-tool-menu-trigger")).toBeVisible();
  await expect(page.getByTestId("open-host-monitor-button")).toHaveCount(0);
  await expect(page.getByTestId("desktop-sidebar-collapse")).toBeVisible();

  const toolToggle = page.getByTestId("workspace-tool-sidebar-toggle").first();
  await toolToggle.click();
  await expect(page.getByTestId("workspace-tool-home")).toBeHidden();
  await expect(page.getByTestId("chat-main-pane")).toBeVisible();

  await page.getByTestId("workspace-tool-sidebar-toggle").click();
  await expect(page.getByTestId("workspace-tool-home")).toBeVisible();
});
