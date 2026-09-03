import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";
import { installRealtimeThreadSnapshotMock, seedGatewayThread } from "./helpers/gateway-store";
import { defaultGatewayHost, defaultGatewayProject } from "./fixtures/thread-history";
import { gatewayThreadFixture } from "./fixtures/gateway-thread";
import {
  MANAGED_RUNTIME_HOST_ID,
  MANAGED_RUNTIME_PROJECT_ID,
} from "../../shared/runtime/managed-runtime";
import {
  installRealtimeThreadStartCapture,
  realtimeThreadStartRequests,
} from "./helpers/realtime-route";

test("collapses the desktop sidebar and restores the saved layout", async ({ page }) => {
  await openApp(page);

  const sidebarGap = page.locator('[data-slot="sidebar-gap"]');
  await expect(page.locator('[data-slot="sidebar"][data-state="expanded"]')).toBeVisible();
  await page.getByTestId("desktop-sidebar-collapse").click();
  await expect.poll(() => sidebarGap.evaluate((element) => element.clientWidth)).toBe(0);
  await expect(page.getByTestId("desktop-sidebar-expand")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("desktop-sidebar-expand")).toBeVisible();
  await expect.poll(() => sidebarGap.evaluate((element) => element.clientWidth)).toBe(0);

  await page.getByTestId("desktop-sidebar-expand").click();
  await expect.poll(() => sidebarGap.evaluate((element) => element.clientWidth)).toBeGreaterThan(0);
  await expect(page.getByTestId("desktop-sidebar-collapse")).toBeVisible();
});

test("toggles an expanded project closed from the desktop sidebar", async ({ page }) => {
  await openApp(page);
  await seedGatewayThread(page, {
    hostId: 101,
    projectId: null,
    host: { ...defaultGatewayHost(101), name: "Toggle Host" },
    project: {
      ...defaultGatewayProject(101, 201),
      name: "Toggle Project",
      remotePath: "/workspace/toggle",
    },
    threads: [
      {
        id: "toggle-thread",
        title: "Toggle Thread",
        projectId: 201,
        pinned: false,
        updatedAt: Date.now(),
      },
    ],
  });
  await page.evaluate(() => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    driver.catalog.selectProject = async (projectId: number) => {
      const { navigation } = driver;
      navigation.selectedProjectId = projectId;
      navigation.selectedThreadId = null;
    };
  });

  await expect(page.getByTestId("desktop-layout")).toBeVisible();
  await expect(page.getByTestId("project-button-201")).toBeVisible();
  await page.getByTestId("project-button-201").click();
  await expect(page.getByTestId("thread-button-toggle-thread")).toBeVisible();

  await page.getByTestId("project-button-201").click();
  await expect(page.getByTestId("thread-button-toggle-thread")).toBeHidden();
});

test("marks completed threads as needing review until they are opened", async ({ page }) => {
  await openApp(page);
  await seedGatewayThread(page, {
    hostId: 102,
    projectId: 202,
    threadId: "selected-thread",
    host: { ...defaultGatewayHost(102), name: "Review Host" },
    project: {
      ...defaultGatewayProject(102, 202),
      name: "Review Project",
      remotePath: "/workspace/review",
    },
    currentThread: { id: "selected-thread", name: "Selected Thread" },
    threads: [
      {
        id: "review-thread",
        name: "Review Thread",
        pinned: false,
        updatedAt: Math.floor(Date.now() / 1000),
      },
      {
        id: "selected-thread",
        name: "Selected Thread",
        pinned: false,
        updatedAt: Math.floor(Date.now() / 1000),
      },
    ],
    status: "completed",
  });
  await installRealtimeThreadSnapshotMock(page, {
    hostId: 102,
    snapshots: {
      "review-thread": {
        thread: { id: "review-thread", name: "Review Thread" },
        history: { thread: { id: "review-thread", turns: [] } },
        projectId: 202,
        runtimeStatus: "completed",
      },
    },
  });
  await page.evaluate(() => {
    const runtime = window.__codexGatewayE2e?.runtime;
    if (!runtime) throw new Error("Gateway E2E driver is unavailable");
    runtime.setThreadStatus(102, "review-thread", "running");
    runtime.setThreadStatus(102, "review-thread", "completed");
  });

  await expect(page.getByTestId("thread-button-review-thread")).toBeVisible();
  await expect(
    page.getByTestId("thread-button-review-thread").getByLabel("已完成，待查看", { exact: true }),
  ).toBeVisible();

  await page.getByTestId("thread-button-review-thread").click();
  await expect(
    page.getByTestId("thread-button-review-thread").getByLabel("已完成", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("thread-button-review-thread").getByLabel("已完成，待查看", { exact: true }),
  ).toBeHidden();
});

test("shows a new conversation action instead of recent activity", async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId("new-conversation-button")).toBeVisible();
  await expect(page.getByText("新会话", { exact: true })).toBeVisible();
  await expect(page.getByText("最近运行", { exact: true })).toHaveCount(0);
  await expect(page.getByText("工作区", { exact: true }).first()).toBeVisible();
});

test("labels an empty conversation without exposing its internal id", async ({ page }) => {
  await openApp(page);
  const emptyThreadId = "01a067f4-9f0a-7961-93f5-a824064e3380";
  await seedGatewayThread(page, {
    hostId: MANAGED_RUNTIME_HOST_ID,
    projectId: MANAGED_RUNTIME_PROJECT_ID,
    threadId: emptyThreadId,
    host: {
      ...defaultGatewayHost(MANAGED_RUNTIME_HOST_ID),
      name: "Local",
      connectionKind: "managed",
    },
    project: {
      ...defaultGatewayProject(MANAGED_RUNTIME_HOST_ID, MANAGED_RUNTIME_PROJECT_ID),
      name: "workspace",
      remotePath: "/workspace",
    },
    currentThread: {
      id: emptyThreadId,
      title: null,
      name: null,
      preview: "",
      cwd: "/workspace",
      turns: [],
    },
    threads: [
      {
        id: emptyThreadId,
        title: null,
        name: null,
        preview: "",
        cwd: "/workspace",
        turns: [],
      },
    ],
  });

  await expect(page.getByTestId(`thread-button-${emptyThreadId}`)).toContainText("新会话");
  await expect(page.getByTestId("thread-chat-header")).toContainText("新会话");
  await expect(page.getByText(emptyThreadId, { exact: true })).toHaveCount(0);
});

test("reopens the newest empty conversation instead of starting another thread", async ({
  page,
}) => {
  await openApp(page);
  const existingThreadId = "existing-conversation";
  const emptyThreadId = "01a067f4-9f0a-7961-93f5-a824064e3380";
  const completedTurn = {
    id: "turn-existing",
    items: [],
    itemsView: "full" as const,
    status: "completed" as const,
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  };
  const cachedEmptyThread = gatewayThreadFixture(
    {
      id: emptyThreadId,
      title: null,
      name: null,
      preview: "",
      cwd: "/workspace",
      turns: [],
      recencyAt: 300,
      updatedAt: 300,
    },
    { hostId: MANAGED_RUNTIME_HOST_ID, projectId: MANAGED_RUNTIME_PROJECT_ID },
  );
  await seedGatewayThread(page, {
    hostId: MANAGED_RUNTIME_HOST_ID,
    projectId: MANAGED_RUNTIME_PROJECT_ID,
    threadId: existingThreadId,
    host: {
      ...defaultGatewayHost(MANAGED_RUNTIME_HOST_ID),
      name: "Local",
      connectionKind: "managed",
    },
    project: {
      ...defaultGatewayProject(MANAGED_RUNTIME_HOST_ID, MANAGED_RUNTIME_PROJECT_ID),
      name: "workspace",
      remotePath: "/workspace",
    },
    currentThread: {
      id: existingThreadId,
      name: "已有会话",
      cwd: "/workspace",
      turns: [completedTurn],
    },
    history: { thread: { id: existingThreadId, turns: [completedTurn] } },
    threads: [
      {
        id: existingThreadId,
        name: "已有会话",
        cwd: "/workspace",
        turns: [],
        recencyAt: 400,
        updatedAt: 400,
      },
      {
        id: emptyThreadId,
        title: null,
        name: null,
        preview: "",
        cwd: "/workspace",
        turns: [],
        recencyAt: 300,
        updatedAt: 300,
      },
    ],
    threadViews: {
      [`${MANAGED_RUNTIME_HOST_ID}:${emptyThreadId}`]: {
        hostId: MANAGED_RUNTIME_HOST_ID,
        projectId: MANAGED_RUNTIME_PROJECT_ID,
        threadId: emptyThreadId,
        currentThread: cachedEmptyThread,
        history: { thread: { id: emptyThreadId, turns: [] } },
        events: [],
        olderTurnsCursor: null,
        newerTurnsCursor: null,
        lastEventId: 0,
        eventEpoch: "e2e-event-epoch",
        loading: false,
        error: null,
      },
    },
  });
  await installRealtimeThreadSnapshotMock(page, {
    hostId: MANAGED_RUNTIME_HOST_ID,
    snapshots: {
      [emptyThreadId]: {
        thread: {
          id: emptyThreadId,
          title: null,
          name: null,
          preview: "",
          cwd: "/workspace",
          turns: [],
        },
        history: { thread: { id: emptyThreadId, turns: [] } },
        projectId: MANAGED_RUNTIME_PROJECT_ID,
        runtimeStatus: "idle",
      },
    },
  });
  installRealtimeThreadStartCapture(page);

  await page.getByTestId("new-conversation-button").click();
  await expect
    .poll(() => page.evaluate(() => window.__codexGatewayE2e?.navigation.selectedThreadId ?? null))
    .toBe(emptyThreadId);
  await expect(page.getByTestId("thread-chat-header")).toContainText("新会话");
  await page.getByTestId("new-conversation-button").click();

  await expect.poll(() => realtimeThreadStartRequests(page).length).toBe(0);
  await expect
    .poll(() => page.evaluate(() => window.__codexGatewayE2e?.navigation.selectedThreadId ?? null))
    .toBe(emptyThreadId);
});

test("starts only one conversation while the first start is pending", async ({ page }) => {
  await openApp(page);
  const existingThreadId = "existing-before-double-click";
  const completedTurn = {
    id: "turn-existing-before-double-click",
    items: [],
    itemsView: "full" as const,
    status: "completed" as const,
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  };
  await seedGatewayThread(page, {
    hostId: MANAGED_RUNTIME_HOST_ID,
    projectId: MANAGED_RUNTIME_PROJECT_ID,
    threadId: existingThreadId,
    host: {
      ...defaultGatewayHost(MANAGED_RUNTIME_HOST_ID),
      name: "Local",
      connectionKind: "managed",
    },
    project: {
      ...defaultGatewayProject(MANAGED_RUNTIME_HOST_ID, MANAGED_RUNTIME_PROJECT_ID),
      name: "workspace",
      remotePath: "/workspace",
    },
    currentThread: {
      id: existingThreadId,
      name: "已有会话",
      cwd: "/workspace",
      turns: [],
    },
    history: { thread: { id: existingThreadId, turns: [completedTurn] } },
    threads: [{ id: existingThreadId, name: "已有会话", cwd: "/workspace", turns: [] }],
  });
  installRealtimeThreadStartCapture(page);

  await page.getByTestId("new-conversation-button").evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) throw new Error("Expected a button");
    element.click();
    element.click();
  });

  await expect.poll(() => realtimeThreadStartRequests(page).length).toBe(1);
  await expect(page.getByTestId("new-conversation-button")).toBeDisabled();
});

test("does not start a managed conversation for a selected host without a project", async ({
  page,
}) => {
  await openApp(page);
  const remoteHostId = 901;
  await seedGatewayThread(page, {
    hostId: remoteHostId,
    projectId: null,
    threadId: null,
    host: { ...defaultGatewayHost(remoteHostId), name: "Remote without project" },
    project: null,
  });
  await page.evaluate(
    ({ managedHostId, managedProjectId, project }) => {
      const driver = window.__codexGatewayE2e;
      if (!driver) throw new Error("Gateway E2E driver is unavailable");
      driver.catalog.projects = [{ ...project, hostId: managedHostId, id: managedProjectId }];
    },
    {
      managedHostId: MANAGED_RUNTIME_HOST_ID,
      managedProjectId: MANAGED_RUNTIME_PROJECT_ID,
      project: defaultGatewayProject(MANAGED_RUNTIME_HOST_ID, MANAGED_RUNTIME_PROJECT_ID),
    },
  );
  installRealtimeThreadStartCapture(page);

  await expect(page.getByTestId("new-conversation-button")).toBeDisabled();
  await page.getByTestId("new-conversation-button").evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) throw new Error("Expected a button");
    element.click();
  });
  await expect.poll(() => realtimeThreadStartRequests(page).length).toBe(0);
});

test("hides the default workspace folder and lists its threads under 工作区", async ({ page }) => {
  await openApp(page);
  await seedGatewayThread(page, {
    hostId: MANAGED_RUNTIME_HOST_ID,
    projectId: MANAGED_RUNTIME_PROJECT_ID,
    threadId: "hello-thread",
    host: {
      ...defaultGatewayHost(MANAGED_RUNTIME_HOST_ID),
      name: "Local",
      connectionKind: "managed",
    },
    project: {
      ...defaultGatewayProject(MANAGED_RUNTIME_HOST_ID, MANAGED_RUNTIME_PROJECT_ID),
      name: "workspace",
      remotePath: "/workspace",
    },
    currentThread: { id: "hello-thread", name: "你好" },
    threads: [
      {
        id: "hello-thread",
        name: "你好",
        pinned: false,
        updatedAt: Math.floor(Date.now() / 1000),
      },
    ],
  });

  await expect(page.getByTestId("new-conversation-button")).toBeVisible();
  await expect(page.getByTestId(`project-button-${MANAGED_RUNTIME_PROJECT_ID}`)).toHaveCount(0);
  await expect(page.getByTestId("thread-button-hello-thread")).toBeVisible();
  await expect(page.getByTestId("thread-button-hello-thread")).toContainText("你好");
});

test("sorts pinned threads for display without rewriting persisted pin order", async ({ page }) => {
  await openApp(page);
  const hosts = [
    { ...defaultGatewayHost(302), name: "Zulu Host" },
    { ...defaultGatewayHost(301), name: "Alpha Host" },
  ];
  const pinnedThreads = [
    { hostId: 302, projectId: null, threadId: "z-alpha", title: "Alpha Thread" },
    { hostId: 301, projectId: null, threadId: "a-zulu", title: "Zulu Thread" },
    { hostId: 301, projectId: null, threadId: "a-alpha-b", title: "Alpha Thread" },
    { hostId: 301, projectId: null, threadId: "a-alpha-a", title: "Alpha Thread" },
  ];
  await page.evaluate(
    ({ hosts, pinnedThreads }) => {
      const driver = window.__codexGatewayE2e;
      if (!driver) throw new Error("Gateway E2E driver is unavailable");
      driver.catalog.hosts = hosts;
      driver.config.gatewayConfig.pinnedThreads = pinnedThreads;
    },
    { hosts, pinnedThreads },
  );

  const renderedThreadIds = await page
    .locator('[data-testid^="pinned-thread-button-"]')
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-testid")?.replace("pinned-thread-button-", "")),
    );
  expect(renderedThreadIds).toEqual(["a-alpha-a", "a-alpha-b", "a-zulu", "z-alpha"]);

  const storedThreadIds = await page.evaluate(() => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    return driver.config.gatewayConfig.pinnedThreads.map((thread) => thread.threadId);
  });
  expect(storedThreadIds).toEqual(pinnedThreads.map((thread) => thread.threadId));
});

test("long expanded tree labels truncate without displacing trailing statuses", async ({
  page,
}) => {
  await openApp(page);
  const hostId = 103;
  const projectId = 203;
  const threadId = "long-sidebar-thread";
  const longTitle = `Long thread ${"unbroken-segment-".repeat(18)}`;
  await seedGatewayThread(page, {
    hostId,
    projectId,
    threadId: null,
    host: {
      ...defaultGatewayHost(hostId),
      name: `Long host ${"host-segment-".repeat(12)}`,
      sshHost: "very-long-hostname.example.internal",
    },
    project: {
      ...defaultGatewayProject(hostId, projectId),
      name: `Long project ${"project-segment-".repeat(12)}`,
      remotePath: "/workspace/sidebar-layout",
    },
    threads: [{ id: threadId, name: longTitle, pinned: false, updatedAt: 1 }],
  });
  await installRealtimeThreadSnapshotMock(page, {
    hostId,
    snapshots: {
      [threadId]: {
        thread: { id: threadId, name: longTitle, status: { type: "active", activeFlags: [] } },
        history: { thread: { id: threadId, turns: [] } },
        projectId,
        runtimeStatus: "running",
      },
    },
  });
  await page.evaluate(
    ({ hostId, threadId }) => {
      const driver = window.__codexGatewayE2e;
      if (!driver) throw new Error("Gateway E2E driver is unavailable");
      const { catalog, runtime } = driver;
      catalog.hostConnectionStatuses = { [hostId]: { status: "connected" } };
      runtime.setThreadStatus(hostId, threadId, "running");
    },
    { hostId, threadId },
  );

  await expect(page.getByTestId(`thread-button-${threadId}`)).toBeVisible();
  await page.getByTestId(`thread-button-${threadId}`).click();
  await expect(page.getByTestId(`thread-button-${threadId}`)).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(page.getByTestId(`host-button-${hostId}`).getByLabel("已连接")).toBeVisible();
  await expect(page.getByTestId(`thread-button-${threadId}`).getByLabel("运行中")).toBeVisible();

  const metrics = await page.getByTestId("sidebar-scroll-area").evaluate(
    (root, { hostId, threadId, longTitle }) => {
      const viewport = root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      const threadButton = root.querySelector<HTMLElement>(
        `[data-testid="thread-button-${CSS.escape(threadId)}"]`,
      );
      const title = threadButton?.querySelector<HTMLElement>(`[title="${CSS.escape(longTitle)}"]`);
      const hostStatus = root.querySelector<HTMLElement>(
        `[data-testid="host-button-${hostId}"] [aria-label="已连接"]`,
      );
      const threadStatus = threadButton?.querySelector<HTMLElement>('[aria-label="运行中"]');
      const statuses = [hostStatus, threadStatus];
      if (!viewport || !title || statuses.some((status) => !status)) {
        throw new Error("Missing sidebar layout nodes");
      }
      const viewportRect = viewport.getBoundingClientRect();
      return {
        overflow: viewport.scrollWidth - viewport.clientWidth,
        titleClipped: title.scrollWidth > title.clientWidth,
        titleOverflow: getComputedStyle(title).textOverflow,
        statusesInside: statuses.every((status) => {
          if (!status) return false;
          const rect = status.getBoundingClientRect();
          return rect.left >= viewportRect.left && rect.right <= viewportRect.right;
        }),
      };
    },
    { hostId, threadId, longTitle },
  );
  expect(metrics).toEqual({
    overflow: 0,
    titleClipped: true,
    titleOverflow: "ellipsis",
    statusesInside: true,
  });
});
