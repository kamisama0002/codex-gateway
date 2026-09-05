import { expect, test } from "@playwright/test";
import { z } from "zod";
import { authenticatedFetch, openApp } from "./helpers/app";
import { installRealtimeSocketProbe } from "./helpers/realtime-socket-probe";

test("requires bearer auth for protected HTTP APIs", async ({ page }) => {
  await openApp(page);
  const unauthorized = await page.evaluate(async () => {
    const response = await fetch("/api/config/export");
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text().catch(() => ""),
    };
  });
  expect(unauthorized.ok).toBe(false);
  expect(unauthorized.status).toBe(401);

  const config = await authenticatedFetch(page, { url: "/api/config/export" }, (value) =>
    z.object({ version: z.number().int() }).loose().parse(value),
  );
  expect(config.version).toBe(1);
});

test("defaults to Chinese and can switch to English", async ({ page }) => {
  await openApp(page);
  await expect(page.getByText("设置")).toBeVisible();
  await page.getByTestId("settings-toggle").click();
  await page.getByRole("tab", { name: "外观" }).click();
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Appearance" })).toBeVisible();
});

test("opens pet settings from the main settings panel", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("settings-toggle").click();
  const settingsPanel = page.getByTestId("settings-panel");
  const petTab = settingsPanel.getByRole("tab", { name: "桌宠" });

  await expect(petTab).toBeVisible();
  await petTab.click();
  await expect(settingsPanel.getByTestId("pet-enabled")).toBeChecked();
  await settingsPanel.getByTestId("pet-option-fireball").click();
  await settingsPanel.getByTestId("pet-animations").click();
  await settingsPanel.getByTestId("save-pet-settings").click();
  await expect(page.getByText("桌宠设置已保存")).toBeVisible();

  const config = await authenticatedFetch(page, { url: "/api/config/export" }, (value) =>
    z
      .object({
        pet: z.object({
          enabled: z.boolean(),
          petId: z.string(),
          animations: z.boolean(),
        }),
      })
      .loose()
      .parse(value),
  );
  expect(config.pet).toEqual({ enabled: true, petId: "fireball", animations: false });
});

test("can revoke the current session from appearance settings", async ({ page }) => {
  await openApp(page);
  const token = await page.evaluate(() => localStorage.getItem("codex-gateway-auth-token"));
  expect(token).toBeTruthy();

  await page.getByTestId("settings-toggle").click();
  await page.getByRole("tab", { name: "外观" }).click();
  await page.getByRole("button", { name: "退出登录" }).click();

  await expect(page.getByRole("heading", { name: "登录 Codex Gateway" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const revokedStatus = await page.evaluate(async (authorization) => {
    const response = await fetch("/api/config/export", {
      headers: { authorization: `Bearer ${authorization}` },
    });
    return response.status;
  }, token!);
  expect(revokedStatus).toBe(401);
});

test("synchronizes logout state across same-origin tabs", async ({ page }) => {
  await openApp(page);
  const secondPage = await page.context().newPage();
  await openApp(secondPage, { resetConfig: false });
  await expect(secondPage.getByTestId("desktop-layout")).toBeVisible();

  await page.evaluate(() => {
    localStorage.removeItem("codex-gateway-auth-token");
    localStorage.removeItem("codex-gateway-auth-token:username");
  });

  await expect(secondPage.getByRole("heading", { name: "登录 Codex Gateway" })).toBeVisible();
  await expect(secondPage.getByTestId("desktop-layout")).toBeHidden();
});

test("returns to login when the realtime session is revoked", async ({ page }) => {
  await installRealtimeSocketProbe(page);
  await openApp(page, { interceptRealtime: false });
  const routeBeforeExpiry = page.url();

  const revoked = await page.evaluate(async () => {
    const token = localStorage.getItem("codex-gateway-auth-token");
    if (token === null || token === "") throw new Error("Missing E2E auth token");
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    return response.ok;
  });

  expect(revoked).toBe(true);
  await expect(page.getByRole("heading", { name: "登录 Codex Gateway" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("登录状态已失效，请重新登录。");
  expect(page.url()).toBe(routeBeforeExpiry);
  expect(await page.evaluate(() => localStorage.getItem("codex-gateway-auth-token"))).toBeNull();
});

test("config JSON editor shows current config by default and scrolls", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("settings-toggle").click();
  const settingsPanel = page.getByTestId("settings-panel");
  await expect(settingsPanel.getByRole("tab")).toHaveCount(7);
  await settingsPanel.getByRole("tab", { name: "配置 JSON" }).click();
  const editor = page.getByTestId("config-json-editor");
  await expect(editor).toContainText('"version"');
  const largeConfig = JSON.stringify(
    {
      version: 1,
      hosts: Array.from({ length: 80 }, (_, index) => ({
        id: index + 1,
        name: `host-${index}`,
        sshHost: `host-${index}.example.test`,
        username: "codex",
        port: 22,
        authMode: "password",
        password: "redacted",
        proxyUrl: null,
        hasPassword: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
      pinnedThreads: [],
    },
    null,
    2,
  );
  await editor.locator(".cm-content").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(largeConfig);
  const scroller = editor.locator(".cm-scroller");
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () =>
      scroller.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThan(4);
});

test("Bark notification settings are saved to server config", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("settings-toggle").click();
  await page.getByRole("tab", { name: "通知" }).click();
  const barkSwitch = page.getByRole("switch", { name: "启用 Bark" });
  await barkSwitch.click();
  await expect(barkSwitch).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Bark 服务地址").fill("https://bark.e2e.test");
  await page.getByLabel("Bark 设备 Key").fill("e2e-device-key");
  await page.getByLabel("Bark 分组").fill("E2E Group");
  await page.getByRole("button", { name: "保存通知设置" }).click();
  await expect(page.getByText("通知设置已保存")).toBeVisible();

  const config = await authenticatedFetch(page, { url: "/api/config/export" }, (value) =>
    z
      .object({
        notifications: z.object({
          bark: z.object({
            enabled: z.boolean(),
            serverUrl: z.string(),
            deviceKey: z.string(),
            group: z.string(),
          }),
        }),
      })
      .loose()
      .parse(value),
  );
  expect(config.notifications).toEqual({
    bark: {
      enabled: true,
      serverUrl: "https://bark.e2e.test",
      deviceKey: "e2e-device-key",
      group: "E2E Group",
    },
  });
});
