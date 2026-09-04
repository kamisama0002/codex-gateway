import { expect, test } from "@playwright/test";
import { z } from "zod";
import { authenticatedFetch, openApp } from "./helpers/app";

const providerListSchema = z.array(
  z.object({
    id: z.string(),
    models: z.array(z.object({ modelId: z.string(), enabled: z.boolean() })),
  }),
);

test("administrator can inspect and update a private-network model provider", async ({ page }) => {
  await openApp(page);
  const providerId = "e2e-ui-provider";
  await authenticatedFetch(
    page,
    {
      url: "/api/admin/providers",
      method: "POST",
      body: {
        id: providerId,
        name: "E2E Private Provider",
        baseUrl: "http://model-target:8080/v1",
        wireApi: "chat_completions",
        apiKey: "e2e-provider-key",
        enabled: false,
        requestTimeoutMs: 30_000,
      },
    },
    () => null,
  );
  await authenticatedFetch(
    page,
    {
      url: `/api/admin/providers/${providerId}/models`,
      method: "POST",
      body: {
        modelId: "e2e-ui-model",
        displayName: "E2E UI Model",
        enabled: true,
        capabilities: {
          tools: true,
          streamingTools: true,
          vision: false,
          reasoning: true,
          maxContextTokens: 64_000,
        },
      },
    },
    () => null,
  );

  await page.getByTestId("settings-toggle").click();
  const settings = page.getByTestId("settings-panel");
  await settings.getByRole("tab", { name: "模型提供方" }).click();
  await expect(settings.getByText("E2E Private Provider")).toBeVisible();
  await expect(settings.getByText("API Key 已配置")).toBeVisible();
  await settings.getByRole("button", { name: "展开或收起 E2E Private Provider 的模型" }).click();
  await expect(settings.getByText("E2E UI Model", { exact: false })).toBeVisible();

  const modelToggle = settings.getByTestId("model-enabled-toggle-e2e-ui-provider-e2e-ui-model");
  await expect(modelToggle).toBeChecked();
  await modelToggle.click();
  await expect(modelToggle).not.toBeChecked();
  const providers = await authenticatedFetch(page, { url: "/api/admin/providers" }, (value) =>
    providerListSchema.parse(value),
  );
  expect(
    providers
      .find((provider) => provider.id === providerId)
      ?.models.find((model) => model.modelId === "e2e-ui-model")?.enabled,
  ).toBe(false);
  await modelToggle.click();
  await expect(modelToggle).toBeChecked();

  await settings.getByRole("button", { name: "编辑提供方 E2E Private Provider" }).click();
  await page.getByLabel("API Key").fill("e2e-provider-key-updated");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "编辑提供方" })).toBeHidden();

  await authenticatedFetch(
    page,
    { url: `/api/admin/providers/${providerId}`, method: "DELETE" },
    () => null,
  );
});
