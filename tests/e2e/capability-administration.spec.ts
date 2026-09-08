import { expect, test, type APIRequestContext } from "@playwright/test";
import { authenticatedFetch, openApp } from "./helpers/app";
import {
  execManagedRuntime,
  loginGatewayUser,
  MANAGED_RUNTIME_A_USERNAME,
  MANAGED_RUNTIME_PASSWORD,
  startManagedRuntime,
  type GatewaySession,
} from "./helpers/managed-runtime";

const gatewayOrigin =
  process.env.E2E_MANAGED_RUNTIME_GATEWAY_URL ?? "http://gateway-under-test:3100";

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

test("ordinary users manage only their personal MCP while managed platform MCP stays hidden", async ({
  request,
}) => {
  test.setTimeout(4 * 60_000);
  const user = await loginGatewayUser(
    request,
    MANAGED_RUNTIME_A_USERNAME,
    MANAGED_RUNTIME_PASSWORD,
  );
  const capabilityId = "org__e2e_personal_mcp";
  const credentialId = "cred__e2e_personal_mcp";

  await userApi(request, user, "/api/capabilities/mcp", "POST", {
    id: capabilityId,
    kind: "mcp",
    displayName: "Personal E2E MCP",
    description: "User-owned E2E MCP",
    version: "1.0.0",
    source: { type: "internal", locator: "ignored-by-server" },
    config: { transport: "streamable_http", url: "http://test-business-mcp:8789/mcp" },
    sensitiveFields: ["PERSONAL_E2E_TOKEN"],
    enabled: true,
  });
  try {
    await userApi(
      request,
      user,
      `/api/capabilities/mcp/${capabilityId}/credentials`,
      "POST",
      {
        id: credentialId,
        capabilityId,
        userId: 999,
        projectId: 999,
        kind: "token",
        secret: { token: "personal-e2e-secret" },
        mappings: [
          { field: "token", target: { type: "env", name: "PERSONAL_E2E_TOKEN" } },
        ],
        notBefore: null,
        expiresAt: null,
      },
    );
    const catalog = await userApi(request, user, "/api/capabilities", "GET");
    const catalogText = JSON.stringify(catalog);
    expect(catalogText).toContain(capabilityId);
    expect(catalogText).not.toContain("org__dinky_mcp");
    expect(catalogText).not.toContain("org__infinity");
    expect(catalogText).not.toContain("personal-e2e-secret");

    await startManagedRuntime(request, user);
    const configured = await execManagedRuntime(user, "codex mcp list");
    expect(configured.code, configured.stderr).toBe(0);
    expect(configured.stdout).toContain(capabilityId);
  } finally {
    await userApi(request, user, `/api/capabilities/mcp/${capabilityId}`, "DELETE");
  }
});

async function userApi(
  request: APIRequestContext,
  session: GatewaySession,
  path: string,
  method: "GET" | "POST" | "DELETE",
  data?: unknown,
) {
  const options = {
    headers: { authorization: `Bearer ${session.token}` },
    ...(data === undefined ? {} : { data }),
  };
  const url = `${gatewayOrigin}${path}`;
  const response =
    method === "GET"
      ? await request.get(url, options)
      : method === "POST"
        ? await request.post(url, options)
        : await request.delete(url, options);
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return text === "" ? {} : (JSON.parse(text) as unknown);
}
