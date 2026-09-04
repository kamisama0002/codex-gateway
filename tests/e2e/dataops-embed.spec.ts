import { expect, test } from "@playwright/test";

const gatewayUrl = "http://codex.127.0.0.1.nip.io:3100/?embedded=1";

test("keeps a DataOps session in one embedded tab without showing password login", async ({
  browser,
  page,
}) => {
  const gatewayResponsePromise = page.waitForResponse(
    (response) =>
      response.request().resourceType() === "document" &&
      response.url().startsWith("http://codex.127.0.0.1.nip.io:3100/?embedded=1"),
  );
  await page.goto("http://dataops.127.0.0.1.nip.io:3100/e2e/dataops-host", {
    waitUntil: "domcontentloaded",
  });
  const gatewayResponse = await gatewayResponsePromise;
  expect(await gatewayResponse.headerValue("content-security-policy")).toBe(
    "frame-ancestors 'self' http://dataops.127.0.0.1.nip.io:3100",
  );
  await expect(page.locator("#gateway-status")).toHaveAttribute("data-status", "authenticated");

  const frame = page.frames().find((candidate) => candidate.url().includes("embedded=1"));
  expect(frame).toBeDefined();
  await expect(frame!.getByTestId("login-form")).toHaveCount(0);
  await expect(frame!.getByTestId("desktop-layout")).toBeVisible();
  await expect(frame!.locator('[data-slot="sidebar"][data-state="expanded"]')).toBeAttached();
  await expect(frame!.getByRole("button", { name: "新会话" })).toBeVisible();
  const token = await frame!.evaluate(() => sessionStorage.getItem("codex-gateway-auth-token"));
  expect(token).toBeTruthy();
  expect(await frame!.evaluate(() => localStorage.getItem("codex-gateway-auth-token"))).toBeNull();
  expect(await frame!.evaluate(() => location.hash)).toBe("");

  await frame!.getByTestId("settings-toggle").click();
  const settings = frame!.getByTestId("settings-panel");
  for (const name of ["外观", "桌宠", "Agent 运行时", "通知"]) {
    await expect(settings.getByRole("tab", { name })).toBeVisible();
  }
  for (const name of ["模型提供方", "主机", "配置 JSON"]) {
    await expect(settings.getByRole("tab", { name })).toHaveCount(0);
  }
  await settings.getByRole("tab", { name: "Agent 运行时" }).click();
  await expect(settings.getByTestId("runtime-self-restart-button")).toBeVisible();
  await expect(settings.getByTestId("runtime-admin-row")).toHaveCount(0);
  await frame!.getByTestId("settings-close-button").click();

  const policyStatuses = await frame!.evaluate(async (authorization) => {
    const headers = { authorization: `Bearer ${authorization}`, "content-type": "application/json" };
    const [host, config, restart] = await Promise.all([
      fetch("/api/hosts", { method: "POST", headers, body: "{}" }),
      fetch("/api/config/sync", { method: "POST", headers, body: "{}" }),
      fetch("/api/runtime/restart", { method: "POST", headers }),
    ]);
    return { host: host.status, config: config.status, restart: restart.status };
  }, token!);
  expect(policyStatuses).toEqual({ host: 403, config: 403, restart: 200 });

  await frame!.goto(gatewayUrl, { waitUntil: "domcontentloaded" });
  await expect(frame!.getByTestId("desktop-layout")).toBeVisible();
  expect(await frame!.evaluate(() => sessionStorage.getItem("codex-gateway-auth-token"))).toBe(
    token,
  );

  const isolatedContext = await browser.newContext();
  const isolatedPage = await isolatedContext.newPage();
  await isolatedPage.goto(gatewayUrl, { waitUntil: "domcontentloaded" });
  await expect(isolatedPage.getByTestId("login-form")).toHaveCount(0);
  await expect(isolatedPage.getByTestId("dataops-auth-state")).toHaveAttribute(
    "data-phase",
    "error",
  );
  expect(
    await isolatedPage.evaluate(() => sessionStorage.getItem("codex-gateway-auth-token")),
  ).toBeNull();
  await isolatedContext.close();
});
