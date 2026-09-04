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
  await expect(frame!.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeAttached();
  const token = await frame!.evaluate(() => sessionStorage.getItem("codex-gateway-auth-token"));
  expect(token).toBeTruthy();
  expect(await frame!.evaluate(() => localStorage.getItem("codex-gateway-auth-token"))).toBeNull();
  expect(await frame!.evaluate(() => location.hash)).toBe("");

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
