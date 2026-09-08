import { expect, test } from "@playwright/test";
import { authenticatedFetch, openApp } from "./helpers/app";

test("administrator manages capability assignments and credentials without exposing secrets", async ({
  page,
}) => {
  await openApp(page);
  const capabilityId = "org__e2e_business";
  await authenticatedFetch(
    page,
    {
      url: "/api/admin/capabilities",
      method: "POST",
      body: {
        id: capabilityId,
        kind: "mcp",
        displayName: "E2E Business MCP",
        description: "E2E capability administration fixture",
        version: "1.0.0",
        source: { type: "internal", locator: "test-business-mcp" },
        config: { transport: "streamable_http", url: "http://test-business-mcp:8789/mcp" },
        sensitiveFields: ["E2E_BUSINESS_TOKEN"],
        enabled: false,
      },
    },
    () => null,
  );

  await page.getByTestId("settings-toggle").click();
  const settings = page.getByTestId("settings-panel");
  await settings.getByRole("tab", { name: "Agent 能力" }).click();
  const row = settings.getByTestId(`capability-row-${capabilityId}`);
  await expect(row.getByText("E2E Business MCP")).toBeVisible();

  const enabled = row.getByTestId(`capability-enabled-${capabilityId}`);
  await expect(enabled).not.toBeChecked();
  await enabled.click();
  await expect(enabled).toBeChecked();

  await row.getByRole("button", { name: "分配 E2E Business MCP" }).click();
  const assignmentDialog = page.getByRole("dialog", { name: "分配能力" });
  await assignmentDialog.getByLabel("用户").click();
  await page.getByRole("option", { name: /runtime-a/ }).click();
  await assignmentDialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(assignmentDialog).toBeHidden();

  await row.getByRole("button", { name: "添加凭据 E2E Business MCP" }).click();
  const credentialDialog = page.getByRole("dialog", { name: "添加凭据" });
  await credentialDialog.getByLabel("凭据 ID").fill("cred__e2e_business");
  await credentialDialog.getByLabel("Token").fill("e2e-secret-token");
  await credentialDialog.getByLabel("环境变量").fill("E2E_BUSINESS_TOKEN");
  await credentialDialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(credentialDialog).toBeHidden();

  const catalogText = JSON.stringify(
    await authenticatedFetch(page, { url: "/api/admin/capabilities" }, (value) => value),
  );
  expect(catalogText).not.toContain("e2e-secret-token");
  expect(catalogText).toContain("cred__e2e_business");

  await authenticatedFetch(
    page,
    { url: `/api/admin/capabilities/${capabilityId}`, method: "DELETE" },
    () => null,
  );
});
