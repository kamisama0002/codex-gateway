import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  parseAppsInstalledResponse,
  parseAppsListResponse,
  parseMarketplaceAddResponse,
  parsePluginInstallResponse,
  parsePluginListResponse,
} from "../../shared/runtime/app-server/capabilities";
import { buildTurnStartParams } from "../../server/utils/gateway/protocol/thread-payload";
import {
  execManagedRuntime,
  inspectManagedRuntime,
  loginGatewayUser,
  MANAGED_RUNTIME_A_USERNAME,
  MANAGED_RUNTIME_B_USERNAME,
  MANAGED_RUNTIME_PASSWORD,
  ManagedRuntimeRpcSession,
  restartManagedRuntimeAsAdmin,
  startManagedRuntime,
  type GatewaySession,
} from "./helpers/managed-runtime";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/app";

const gatewayOrigin =
  process.env.E2E_MANAGED_RUNTIME_GATEWAY_URL ?? "http://gateway-under-test:3100";
const secretFixture = process.env.E2E_RUNTIME_SECRET_FIXTURE ?? "full-e2e-runtime-secret-fixture";

test("full Agent runtime exposes tools, search, business MCP, Skills, credentials, persistence, and a real Turn", async ({
  request,
}) => {
  test.setTimeout(8 * 60_000);
  const [admin, userA, userB] = await Promise.all([
    loginGatewayUser(request, E2E_USERNAME, E2E_PASSWORD),
    loginGatewayUser(request, MANAGED_RUNTIME_A_USERNAME, MANAGED_RUNTIME_PASSWORD),
    loginGatewayUser(request, MANAGED_RUNTIME_B_USERNAME, MANAGED_RUNTIME_PASSWORD),
  ]);
  await configureProvider(request, admin, userA);
  await configureCapabilities(request, admin, userA);

  await Promise.all([startManagedRuntime(request, userA), startManagedRuntime(request, userB)]);
  const [runtimeA, runtimeB] = await Promise.all([
    inspectManagedRuntime(userA),
    inspectManagedRuntime(userB),
  ]);
  expect(runtimeA.containerId).not.toBe(runtimeB.containerId);

  const runtimeSmoke = await execManagedRuntime(
    userA,
    "node /usr/local/lib/smoke-agent-runtime.mjs",
    { timeoutMs: 60_000 },
  );
  expect(runtimeSmoke.code, runtimeSmoke.stderr).toBe(0);
  expect(runtimeSmoke.stdout).toContain('"status":"ok"');

  const configuredA = await execManagedRuntime(userA, "codex mcp list");
  expect(configuredA.code, configuredA.stderr).toBe(0);
  expect(configuredA.stdout).toContain("org__browser");
  expect(configuredA.stdout).toContain("org__web_search");
  expect(configuredA.stdout).toContain("org__e2e_business");
  const configuredB = await execManagedRuntime(userB, "codex mcp list");
  expect(configuredB.code, configuredB.stderr).toBe(0);
  expect(configuredB.stdout).toContain("org__browser");
  expect(configuredB.stdout).toContain("org__web_search");
  expect(configuredB.stdout).not.toContain("org__e2e_business");

  const expectedSecretHash = createHash("sha256").update(secretFixture).digest("hex");
  const isolation = await execManagedRuntime(
    userA,
    "test -f /codex-home/skills/org__e2e_revenue/1.0.0/SKILL.md && " +
      "test -f /run/codex-secrets/business-token && " +
      "sha256sum /run/codex-secrets/business-token | cut -d' ' -f1 && " +
      "mkdir -p /codex-home/memories && printf persisted > /codex-home/memories/full-e2e && " +
      "printf workspace-a > /workspace/full-e2e-user-a",
  );
  expect(isolation.code, isolation.stderr).toBe(0);
  expect(isolation.stdout.trim()).toBe(expectedSecretHash);
  const isolatedB = await execManagedRuntime(
    userB,
    "test ! -e /run/codex-secrets/business-token && " +
      "test ! -e /codex-home/skills/org__e2e_revenue && " +
      "test ! -e /workspace/full-e2e-user-a",
  );
  expect(isolatedB.code, isolatedB.stderr).toBe(0);

  const dataTools = await execManagedRuntime(userA, dataToolCommand(), { timeoutMs: 60_000 });
  expect(dataTools.code, dataTools.stderr).toBe(0);
  expect(dataTools.stdout).toContain("FULL_DATA_TOOLS_OK");

  const mcpSmoke = await execManagedRuntime(userA, mcpSmokeCommand(), { timeoutMs: 60_000 });
  expect(mcpSmoke.code, mcpSmoke.stderr).toBe(0);
  expect(mcpSmoke.stdout).toContain("FULL_MCP_OK");
  const pluginFixture = await execManagedRuntime(userA, pluginFixtureCommand());
  expect(pluginFixture.code, pluginFixture.stderr).toBe(0);

  const rpc = new ManagedRuntimeRpcSession(userA.user.id, runtimeA.endpoint);
  try {
    await rpc.connect();
    const marketplace = parseMarketplaceAddResponse(
      await rpc.request("marketplace/add", { source: "/workspace/org__e2e-marketplace" }),
    );
    expect(marketplace.marketplaceName).toBe("org__e2e");
    const pluginsBefore = parsePluginListResponse(
      await rpc.request("plugin/list", { cwds: ["/workspace"], forceRefetch: true }),
    );
    const installedMarketplace = pluginsBefore.marketplaces.find(
      (entry) => entry.name === "org__e2e",
    );
    expect(installedMarketplace?.path).toBeTruthy();
    expect(
      installedMarketplace?.plugins.find((plugin) => plugin.name === "org-e2e-runtime")
        ?.installed,
    ).toBe(false);
    const pluginInstall = parsePluginInstallResponse(
      await rpc.request("plugin/install", {
        marketplacePath: installedMarketplace?.path,
        pluginName: "org-e2e-runtime",
      }),
    );
    expect(pluginInstall.appsNeedingAuth).toEqual([]);
    const pluginsAfter = parsePluginListResponse(
      await rpc.request("plugin/list", { cwds: ["/workspace"], forceRefetch: true }),
    );
    expect(
      pluginsAfter.marketplaces
        .find((entry) => entry.name === "org__e2e")
        ?.plugins.find((plugin) => plugin.name === "org-e2e-runtime")?.installed,
    ).toBe(true);
    await configurePluginCapability(request, admin, userA);
    const apps = parseAppsListResponse(
      await rpc.request("app/list", {
        cursor: null,
        limit: 100,
        threadId: null,
        forceRefetch: false,
      }),
    );
    const installedApps = parseAppsInstalledResponse(
      await rpc.request("app/installed", { threadId: null, forceRefresh: false }),
    );
    expect(apps.data).toEqual(expect.any(Array));
    expect(installedApps.apps).toEqual(expect.any(Array));

    const threadId = await rpc.startThread();
    const completed = rpc.waitForNotification("turn/completed");
    await rpc.request(
      "turn/start",
      buildTurnStartParams(
        threadId,
        "full-agent-e2e-turn",
        {
          text: "回复：FULL_AGENT_TURN_OK",
          cwd: "/workspace",
          approvalPolicy: "never",
        },
        { managedRuntime: true },
      ),
    );
    expect(JSON.stringify(await completed)).toContain("FULL_AGENT_TURN_OK");
  } finally {
    rpc.close();
  }

  const beforeRestart = runtimeA.containerId;
  await restartManagedRuntimeAsAdmin(request, admin, userA);
  const restarted = await inspectManagedRuntime(userA);
  expect(restarted.containerId).not.toBe(beforeRestart);
  const persisted = await execManagedRuntime(
    userA,
    'test "$(cat /codex-home/memories/full-e2e)" = persisted && ' +
      'test "$(cat /workspace/full-e2e-user-a)" = workspace-a && ' +
      "test -f /codex-home/skills/org__e2e_revenue/1.0.0/SKILL.md && " +
      "codex mcp list | grep -q org__e2e_business",
  );
  expect(persisted.code, persisted.stderr).toBe(0);
  const restartedRpc = new ManagedRuntimeRpcSession(userA.user.id, restarted.endpoint);
  try {
    await restartedRpc.connect();
    const plugins = parsePluginListResponse(
      await restartedRpc.request("plugin/list", { cwds: ["/workspace"], forceRefetch: false }),
    );
    expect(
      plugins.marketplaces
        .find((entry) => entry.name === "org__e2e")
        ?.plugins.find((plugin) => plugin.name === "org-e2e-runtime")?.installed,
    ).toBe(true);
  } finally {
    restartedRpc.close();
  }
});

async function configureProvider(
  request: APIRequestContext,
  admin: GatewaySession,
  user: GatewaySession,
) {
  await gatewayPost(request, admin, "/api/admin/providers", {
    id: "full-e2e-provider",
    name: "Full E2E Provider",
    baseUrl: "http://model-target:8080/v1",
    wireApi: "responses",
    apiKey: "full-e2e-provider-key",
    enabled: true,
    requestTimeoutMs: 30_000,
  });
  await gatewayPost(request, admin, "/api/admin/providers/full-e2e-provider/models", {
    modelId: process.env.E2E_CODEX_MODEL ?? "gpt-5.6-luna",
    displayName: "Full E2E Model",
    enabled: true,
    capabilities: {
      tools: true,
      streamingTools: true,
      vision: true,
      reasoning: true,
      maxContextTokens: 64_000,
    },
  });
  await gatewayPost(request, admin, "/api/admin/providers/full-e2e-provider/grants", {
    userId: user.user.id,
    modelId: process.env.E2E_CODEX_MODEL ?? "gpt-5.6-luna",
    granted: true,
  });
}

async function configureCapabilities(
  request: APIRequestContext,
  admin: GatewaySession,
  user: GatewaySession,
) {
  const skillId = "org__e2e_revenue";
  await gatewayPost(request, admin, "/api/admin/capabilities", {
    id: skillId,
    kind: "skill",
    displayName: "E2E Revenue Skill",
    description: "Deterministic organization Skill fixture",
    version: "1.0.0",
    source: { type: "upload", locator: `artifact:${skillId}:1.0.0` },
    config: { entryPath: "SKILL.md" },
    enabled: true,
  });
  await gatewayPutRaw(
    request,
    admin,
    `/api/admin/capabilities/${skillId}/artifact`,
    Buffer.from(
      "---\nname: org__e2e_revenue\ndescription: Analyze deterministic revenue data.\n---\n\nUse the assigned business MCP.\n",
    ),
  );
  await gatewayPost(request, admin, `/api/admin/capabilities/${skillId}/assignments`, {
    userId: user.user.id,
    projectId: null,
    assigned: true,
  });

  const businessId = "org__e2e_business";
  await gatewayPost(request, admin, "/api/admin/capabilities", {
    id: businessId,
    kind: "mcp",
    displayName: "E2E Business MCP",
    description: "Deterministic business query and write fixture",
    version: "1.0.0",
    source: { type: "internal", locator: "test-business-mcp" },
    config: { transport: "streamable_http", url: "http://test-business-mcp:8789/mcp" },
    sensitiveFields: ["BUSINESS_TOKEN"],
    enabled: true,
  });
  await gatewayPost(request, admin, `/api/admin/capabilities/${businessId}/assignments`, {
    userId: user.user.id,
    projectId: null,
    assigned: true,
  });
  await gatewayPost(request, admin, "/api/admin/credentials", {
    id: "cred__full_e2e_business",
    capabilityId: businessId,
    userId: user.user.id,
    projectId: null,
    kind: "token",
    secret: { token: secretFixture },
    mappings: [
      {
        field: "token",
        target: { type: "file", path: "/run/codex-secrets/business-token" },
      },
    ],
    notBefore: null,
    expiresAt: null,
  });
}

async function configurePluginCapability(
  request: APIRequestContext,
  admin: GatewaySession,
  user: GatewaySession,
) {
  const capabilityId = "org__e2e_plugin";
  const marketplaceUrl = "https://example.com/org__e2e-marketplace.git";
  await gatewayPost(request, admin, "/api/admin/capabilities", {
    id: capabilityId,
    kind: "plugin",
    displayName: "E2E Runtime Plugin",
    description: "Deterministic organization plugin fixture",
    version: "0.1.0",
    source: { type: "git", locator: marketplaceUrl },
    config: { marketplaceName: "org__e2e", marketplaceUrl, pluginName: "org-e2e-runtime" },
    enabled: true,
  });
  await gatewayPost(request, admin, `/api/admin/capabilities/${capabilityId}/assignments`, {
    userId: user.user.id,
    projectId: null,
    assigned: true,
  });
}

async function gatewayPost(
  request: APIRequestContext,
  session: GatewaySession,
  path: string,
  data: unknown,
) {
  const response = await request.post(new URL(path, gatewayOrigin).toString(), {
    headers: { authorization: `Bearer ${session.token}` },
    data,
  });
  expect(response.ok(), `${path} returned ${response.status()}: ${await response.text()}`).toBe(
    true,
  );
}

async function gatewayPutRaw(
  request: APIRequestContext,
  session: GatewaySession,
  path: string,
  data: Buffer,
) {
  const response = await request.put(new URL(path, gatewayOrigin).toString(), {
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "text/markdown; charset=utf-8",
    },
    data,
  });
  expect(response.ok(), `${path} returned ${response.status()}: ${await response.text()}`).toBe(
    true,
  );
}

function dataToolCommand() {
  const python = [
    "from pathlib import Path",
    "import pandas as pd",
    "from docx import Document",
    "from PIL import Image, ImageDraw, ImageFont",
    "assert int(pd.DataFrame({'amount':[60000,68000]}).amount.sum()) == 128000",
    "doc=Document(); doc.add_heading('Revenue report', 0); doc.add_paragraph('Total 128000 CNY'); doc.save('/workspace/full-e2e.docx')",
    "img=Image.new('RGB',(900,220),'white')",
    "draw=ImageDraw.Draw(img)",
    "font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',72)",
    "draw.text((40,60),'REVENUE 128000',font=font,fill='black')",
    "img.save('/workspace/full-e2e-ocr.png')",
  ].join("\n");
  const encoded = Buffer.from(python).toString("base64");
  return (
    `python3 -c "import base64;exec(base64.b64decode('${encoded}'))" && ` +
    "libreoffice --headless --convert-to pdf --outdir /workspace /workspace/full-e2e.docx >/tmp/full-e2e-libreoffice.log && " +
    "test -s /workspace/full-e2e.pdf && " +
    "tesseract /workspace/full-e2e-ocr.png stdout 2>/dev/null | grep -q 'REVENUE 128000' && " +
    "curl -fsSL https://example.com -o /workspace/full-e2e-example.html && " +
    "test -s /workspace/full-e2e-example.html && echo FULL_DATA_TOOLS_OK"
  );
}

function mcpSmokeCommand() {
  const script = `
    const call = async (url, id, name, args) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const text = await response.text();
      const data = text.split("\\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (!data) throw new Error("missing MCP response");
      const payload = JSON.parse(data);
      if (payload.error) throw new Error(payload.error.message);
      return payload.result.structuredContent;
    };
    (async () => {
      const search = await call("http://search-mcp:8788/mcp", 1, "web_search", { query: "OpenAI Codex GitHub", limit: 2 });
      const revenue = await call("http://test-business-mcp:8789/mcp", 2, "revenue_query", { projectId: 10, from: "2026-09-01", to: "2026-09-07" });
      const write = await call("http://test-business-mcp:8789/mcp", 3, "revenue_adjustment_write", { projectId: 10, idempotencyKey: "full-e2e-write", amount: 100, reason: "full E2E" });
      if (!search.results.length || revenue.total !== 128000 || !write.adjustmentId) throw new Error("MCP assertion failed");
      console.log("FULL_MCP_OK");
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
  const encoded = Buffer.from(script).toString("base64");
  return `node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`;
}

function pluginFixtureCommand() {
  const marketplace = readFileSync(
    new URL("./fixtures/plugin-marketplace/.agents/plugins/marketplace.json", import.meta.url),
  ).toString("base64");
  const plugin = readFileSync(
    new URL(
      "./fixtures/plugin-marketplace/plugins/org-e2e-runtime/.codex-plugin/plugin.json",
      import.meta.url,
    ),
  ).toString("base64");
  const skill = readFileSync(
    new URL(
      "./fixtures/plugin-marketplace/plugins/org-e2e-runtime/skills/org-e2e-check/SKILL.md",
      import.meta.url,
    ),
  ).toString("base64");
  const skillUi = readFileSync(
    new URL(
      "./fixtures/plugin-marketplace/plugins/org-e2e-runtime/skills/org-e2e-check/agents/openai.yaml",
      import.meta.url,
    ),
  ).toString("base64");
  return (
    "mkdir -p /workspace/org__e2e-marketplace/.agents/plugins " +
    "/workspace/org__e2e-marketplace/plugins/org-e2e-runtime/.codex-plugin " +
    "/workspace/org__e2e-marketplace/plugins/org-e2e-runtime/skills/org-e2e-check/agents && " +
    `printf %s '${marketplace}' | base64 -d > /workspace/org__e2e-marketplace/.agents/plugins/marketplace.json && ` +
    `printf %s '${plugin}' | base64 -d > /workspace/org__e2e-marketplace/plugins/org-e2e-runtime/.codex-plugin/plugin.json && ` +
    `printf %s '${skill}' | base64 -d > /workspace/org__e2e-marketplace/plugins/org-e2e-runtime/skills/org-e2e-check/SKILL.md && ` +
    `printf %s '${skillUi}' | base64 -d > /workspace/org__e2e-marketplace/plugins/org-e2e-runtime/skills/org-e2e-check/agents/openai.yaml`
  );
}
