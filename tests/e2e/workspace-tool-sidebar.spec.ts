import { expect, test, type Page } from "@playwright/test";
import { Orientation, type SerializedDockview } from "dockview-vue";
import { openApp, reloadApp } from "./helpers/app";
import { seedGatewayThread } from "./helpers/gateway-store";

test("desktop keeps Agent primary and exposes a persistent tool workspace", async ({ page }) => {
  await openApp(page);

  const agentHeader = page.getByTestId("workspace-agent-header");
  await expect(agentHeader).toBeVisible();
  await expect(agentHeader).toContainText("新会话");
  await expect(agentHeader.getByText("Agent", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("workspace-tool-home")).toBeHidden();
  await expect(page.getByTestId("workspace-tool-menu-trigger")).toBeHidden();
  await expect(page.getByTestId("open-host-monitor-button")).toHaveCount(0);
  await expect(page.getByTestId("desktop-sidebar-collapse")).toBeVisible();

  const toolToggle = page
    .getByRole("region", { name: "Agent" })
    .getByTestId("workspace-tool-sidebar-toggle");
  await toolToggle.click();
  await expect(page.getByTestId("workspace-tool-home")).toBeVisible();
  await expect(page.getByTestId("chat-main-pane")).toBeVisible();

  await toolToggle.click();
  await expect(page.getByTestId("workspace-tool-home")).toBeHidden();
});

test("restoring an active tool does not reopen an explicitly hidden sidebar", async ({ page }) => {
  await openApp(page);
  const scopeKey = await currentWorkspaceScopeKey(page);
  const hiddenToolsLayout: SerializedDockview = {
    grid: {
      root: {
        type: "branch",
        size: 720,
        data: [
          {
            type: "leaf",
            size: 768,
            data: {
              id: "workspace-agent-group",
              views: ["agent"],
              activeView: "agent",
              locked: "no-drop-target",
            },
          },
          {
            type: "leaf",
            size: 512,
            data: {
              id: "workspace-tools-group",
              views: ["tool-home"],
              activeView: "tool-home",
              locked: "no-drop-target",
            },
          },
        ],
      },
      width: 1280,
      height: 720,
      orientation: Orientation.HORIZONTAL,
    },
    panels: {
      agent: {
        id: "agent",
        contentComponent: "WorkspaceDockAgentPanel",
        tabComponent: "WorkspaceDockTab",
        title: "Agent",
        renderer: "always",
        params: { kind: "agent" },
      },
      "tool-home": {
        id: "tool-home",
        contentComponent: "WorkspaceDockToolHomePanel",
        tabComponent: "WorkspaceDockTab",
        title: "Tools",
        renderer: "always",
        params: { kind: "toolHome" },
      },
    },
    activeGroup: "workspace-tools-group",
  };
  await page.evaluate(
    ({ hiddenToolsLayout, scopeKey }) => {
      const layout = window.__codexGatewayE2e?.layout;
      if (!layout) throw new Error("Gateway layout test driver is unavailable");
      layout.saveLayout(scopeKey, hiddenToolsLayout);
      layout.setActivePanel(scopeKey, "tool-home");
      layout.setToolSidebarOpen(scopeKey, false);
    },
    { hiddenToolsLayout, scopeKey },
  );
  await expect
    .poll(() => persistedToolSidebarState(page, scopeKey))
    .toEqual({ activePanel: "tool-home", sidebarOpen: false, persistedSidebarOpen: false });

  await reloadApp(page);

  await expect.poll(() => currentWorkspaceScopeKey(page)).toBe(scopeKey);
  await expect
    .poll(() => persistedToolSidebarState(page, scopeKey))
    .toMatchObject({ sidebarOpen: false, persistedSidebarOpen: false });
  await expect(page.getByTestId("workspace-tool-menu-trigger")).toBeHidden();
  await expect(page.getByTestId("workspace-tool-sidebar-toggle")).toHaveCount(1);
  await expect(page.getByTestId("chat-main-pane")).toBeVisible();
});

test("docking a floating tool group preserves the fixed tool controls", async ({ page }) => {
  await openApp(page);

  const toolGroup = page
    .getByTestId("workspace-tool-menu-trigger")
    .locator(
      "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' dv-groupview ')][1]",
    );
  const floatToggle = toolGroup.getByRole("button", { name: "浮动或停靠面板" });
  await floatToggle.click();
  const agentGroup = page.getByRole("region", { name: "Agent" });
  await expect(agentGroup.getByRole("button", { name: "浮动或停靠面板" })).toBeDisabled();
  await expect(agentGroup.getByTestId("dock-popout-group")).toBeDisabled();
  await floatToggle.click();

  await expect(page.getByTestId("workspace-tool-menu-trigger")).toBeVisible();
  await expect(page.getByTestId("workspace-tool-home")).toBeVisible();
});

test("migrates an open Files panel from the saved single-group layout", async ({ page }) => {
  await openApp(page);
  const threadId = `legacy-files-${Date.now()}`;
  const scopeKey = `1:1:${threadId}`;
  const savedLayout: SerializedDockview = {
    grid: {
      root: {
        type: "branch",
        size: 720,
        data: [
          {
            type: "leaf",
            size: 1280,
            data: {
              id: "workspace-default-group",
              views: ["agent", "files"],
              activeView: "files",
            },
          },
        ],
      },
      width: 1280,
      height: 720,
      orientation: Orientation.HORIZONTAL,
    },
    panels: {
      agent: {
        id: "agent",
        contentComponent: "WorkspaceDockAgentPanel",
        tabComponent: "WorkspaceDockTab",
        title: "Agent",
        renderer: "always",
        params: { kind: "agent" },
      },
      files: {
        id: "files",
        contentComponent: "WorkspaceDockFilesPanel",
        tabComponent: "WorkspaceDockTab",
        title: "Files",
        renderer: "always",
        params: { kind: "files" },
      },
    },
    activeGroup: "workspace-default-group",
  };

  await page.evaluate(
    ({ scopeKey, savedLayout }) => {
      const layout = window.__codexGatewayE2e?.layout;
      if (!layout) throw new Error("Gateway layout test driver is unavailable");
      layout.saveLayout(scopeKey, savedLayout);
    },
    { scopeKey, savedLayout },
  );
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Legacy Files", cwd: "/workspace" },
  });

  await expect(page.getByTestId("workspace-file-panel")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        (scopeKey) => window.__codexGatewayE2e?.layout.isFilesPanelOpen(scopeKey) ?? false,
        scopeKey,
      ),
    )
    .toBe(true);
});

async function persistedToolSidebarState(page: Page, scopeKey: string) {
  return page.evaluate((key) => {
    const layout = window.__codexGatewayE2e?.layout;
    if (!layout) throw new Error("Gateway layout test driver is unavailable");
    const username = localStorage.getItem("codex-gateway-auth-token:username")?.trim() ?? "";
    const namespace = username === "" ? "signed-out" : encodeURIComponent(username);
    const stored = localStorage.getItem(`codex-gateway:${namespace}:workspace-tool-sidebar-open`);
    const persisted: unknown = stored === null ? null : JSON.parse(stored);
    const persistedValue: unknown =
      typeof persisted === "object" && persisted !== null ? Reflect.get(persisted, key) : undefined;
    return {
      activePanel: layout.activePanelFor(key),
      sidebarOpen: layout.isToolSidebarOpen(key),
      persistedSidebarOpen: typeof persistedValue === "boolean" ? persistedValue : undefined,
    };
  }, scopeKey);
}

async function currentWorkspaceScopeKey(page: Page) {
  return page.evaluate(() => {
    const navigation = window.__codexGatewayE2e?.navigation;
    if (!navigation) throw new Error("Gateway navigation test driver is unavailable");
    return `${navigation.selectedHostId ?? "host"}:${navigation.selectedProjectId ?? "project"}:${navigation.selectedThreadId ?? "thread"}`;
  });
}
