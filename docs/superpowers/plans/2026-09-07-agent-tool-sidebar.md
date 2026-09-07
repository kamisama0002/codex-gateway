# Agent Tool Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent the permanent primary workspace, move every auxiliary panel into a persistent right-side tool group with a real launcher, and let the pet move across the complete authenticated viewport.

**Architecture:** Keep one keyed Dockview per Host/Project/Thread scope. A pure layout policy assigns Agent to a locked primary group and all tools to a locked secondary group; a permanent hidden-tab `toolHome` panel preserves the empty tool group, while domain stores remain the source of truth for real tool lifecycles. Desktop shows both groups, mobile toggles their visibility as a full-width tool workspace, and the account-scoped layout store persists only Files-open and sidebar-visible UI preferences.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript 6, Pinia, Dockview 8.2, shadcn-vue, Lucide Vue, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-09-07-agent-tool-sidebar-design.md`

## Global Constraints

- Browser code talks only to existing Nuxt APIs and existing domain stores; it never creates fake App Server, SSH, PTY, Browser, Tmux, metrics, or sub-agent data.
- Dockview panel renderers remain `renderer: "always"`; hiding the tool group must not remove panels.
- Visible copy is added to both `i18n/locales/zh.json` and `i18n/locales/en.json`.
- Business UI adds no fixed `px` dimensions; Dockview serialized geometry may use its required numeric pixel sizes.
- Desktop uses a resizable Agent/tools split; mobile shows one full-width group at a time.
- Existing scope-keyed mount, popout error handling, layout persistence, and real backend E2E semantics remain intact.

---

### Task 1: Account-scoped tool visibility state

**Files:**
- Create: `app/stores/gateway-workspace-layout/tool-visibility.test.ts`
- Modify: `app/stores/gateway-workspace-layout/index.ts`

**Interfaces:**
- Produces: `isToolSidebarOpen(scopeKey: string): boolean`
- Produces: `setToolSidebarOpen(scopeKey: string, open: boolean): void`
- Produces: `isFilesPanelOpen(scopeKey: string): boolean`
- Produces: `setFilesPanelOpen(scopeKey: string, open: boolean): void`

- [ ] **Step 1: Write failing scope-state tests**

Mock `useAccountLocalStorage` with real Vue refs, create an active Pinia, then assert literal behavior:

```ts
it("opens the tool sidebar by default and isolates explicit visibility by scope", () => {
  const layout = useGatewayWorkspaceLayoutStore();
  expect(layout.isToolSidebarOpen("host:project:one")).toBe(true);
  layout.setToolSidebarOpen("host:project:one", false);
  expect(layout.isToolSidebarOpen("host:project:one")).toBe(false);
  expect(layout.isToolSidebarOpen("host:project:two")).toBe(true);
});

it("keeps Files closed until the current scope opens it", () => {
  const layout = useGatewayWorkspaceLayoutStore();
  expect(layout.isFilesPanelOpen("host:project:one")).toBe(false);
  layout.setFilesPanelOpen("host:project:one", true);
  expect(layout.isFilesPanelOpen("host:project:one")).toBe(true);
  expect(layout.isFilesPanelOpen("host:project:two")).toBe(false);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm test:unit app/stores/gateway-workspace-layout/tool-visibility.test.ts`

Expected: FAIL because the four methods do not exist.

- [ ] **Step 3: Implement the minimal persisted state**

Add two account-local records and immutable updates:

```ts
const toolSidebarOpenByScope = useAccountLocalStorage<Record<string, boolean>>(
  "workspace-tool-sidebar-open",
  {},
);
const filesPanelOpenByScope = useAccountLocalStorage<Record<string, boolean>>(
  "workspace-files-panel-open",
  {},
);

const isToolSidebarOpen = (scopeKey: string) => toolSidebarOpenByScope.value[scopeKey] ?? true;
const isFilesPanelOpen = (scopeKey: string) => filesPanelOpenByScope.value[scopeKey] === true;
```

Return refs through `skipHydrate`, expose setters, and leave `resetRuntimeState()` limited to ephemeral activation requests.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm test:unit app/stores/gateway-workspace-layout/tool-visibility.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/stores/gateway-workspace-layout
git commit -m "feat(workspace): persist tool sidebar visibility"
```

### Task 2: Pure two-group Dockview policy and reconciliation

**Files:**
- Create: `app/components/chat/workspace-dock/workspace-layout.ts`
- Create: `app/components/chat/workspace-dock/workspace-layout.test.ts`
- Modify: `app/components/chat/workspace-dock/types.ts`
- Modify: `app/components/chat/workspace-dock/panel-registry.ts`
- Modify: `app/components/chat/workspace-dock/useWorkspacePanels.ts`
- Modify: `app/components/chat/workspace-dock/useWorkspaceDockPanels.ts`
- Modify: `app/components/chat/workspace-dock/useWorkspaceDockLifecycle.ts`
- Modify: `app/stores/gateway/workspace-panels.ts`

**Interfaces:**
- Produces: `AGENT_WORKSPACE_GROUP_ID`, `TOOLS_WORKSPACE_GROUP_ID`, `TOOL_HOME_WORKSPACE_PANEL_ID`
- Produces: `workspacePanelGroup(kind: WorkspacePanelKind): "agent" | "tools"`
- Produces: `buildWorkspaceDefaultLayout(definitions, width, height): SerializedDockview`
- Consumes: Task 1 Files-open and tool-sidebar-visible methods

- [ ] **Step 1: Write failing layout policy tests**

Use literal panel definitions and assert:

```ts
expect(workspacePanelGroup("agent")).toBe("agent");
for (const kind of ["toolHome", "files", "gitReview", "terminal", "subagent", "browser", "tmux", "hostMetrics"] as const) {
  expect(workspacePanelGroup(kind)).toBe("tools");
}

const layout = buildWorkspaceDefaultLayout(definitions, 1000, 700);
expect(layout.grid.root.data).toMatchObject([
  { data: { id: AGENT_WORKSPACE_GROUP_ID, views: ["agent"], hideHeader: false } },
  { data: { id: TOOLS_WORKSPACE_GROUP_ID, views: ["tool-home", "files"], activeView: "tool-home" } },
]);
expect(layout.panels["agent"]?.renderer).toBe("always");
expect(layout.panels["tool-home"]?.renderer).toBe("always");
```

The mutation caught is any future regression that puts a tool back into the Agent group, removes the empty-group sentinel, or allows inactive renderers to unmount.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm test:unit app/components/chat/workspace-dock/workspace-layout.test.ts`

Expected: FAIL because `toolHome` and the layout policy do not exist.

- [ ] **Step 3: Implement constants, types, registry, and pure layout builder**

Extend `WorkspacePanelKind` and its Zod union with `{ kind: "toolHome" }`. Register `WorkspaceDockToolHomePanel` as non-closable and non-dynamic. Build the serialized horizontal root with a 60/40 initial split derived from current Dockview width, not CSS fixed widths.

- [ ] **Step 4: Verify policy tests pass**

Run: `pnpm test:unit app/components/chat/workspace-dock/workspace-layout.test.ts`

Expected: PASS.

- [ ] **Step 5: Reconcile real panels into fixed groups**

Change panel definitions to always include Agent and `toolHome`, include Files only when `isFilesPanelOpen(scopeKey)` is true, and add every tool into `workspace-tools-group`:

```ts
api.addPanel({
  ...definition,
  tabComponent: "WorkspaceDockTab",
  renderer: "always",
  position: definition.params.kind === "agent"
    ? { referenceGroup: ensureAgentGroup(api) }
    : { referenceGroup: ensureToolsGroup(api) },
});
```

After restore/reconcile, move any existing panel in the wrong group with `panel.api.moveTo(...)`, set both fixed groups to `locked = "no-drop-target"`, and hide/show the tools group with `group.api.setVisible(...)`. On mobile, tool visibility hides the Agent group and reveals the tool group; returning reverses those calls.

- [ ] **Step 6: Make close/activation preserve empty tool group**

Closing Files calls `setFilesPanelOpen(scopeKey, false)`. Closing the last real tool activates `toolHome`. Any request for a real tool calls `setToolSidebarOpen(scopeKey, true)` before activation.

- [ ] **Step 7: Run focused and full unit tests**

Run: `pnpm test:unit app/components/chat/workspace-dock/workspace-layout.test.ts app/stores/gateway-workspace-layout/tool-visibility.test.ts`

Run: `pnpm test:unit`

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add app/components/chat/workspace-dock app/stores/gateway-workspace-layout app/stores/gateway/workspace-panels.ts
git commit -m "feat(workspace): establish agent and tool dock groups"
```

### Task 3: Shared tool catalog and real launch actions

**Files:**
- Create: `app/components/chat/workspace-tools/tool-catalog.ts`
- Create: `app/components/chat/workspace-tools/tool-catalog.test.ts`
- Create: `app/components/chat/workspace-tools/WorkspaceToolCatalog.vue`
- Create: `app/components/chat/workspace-dock/WorkspaceDockToolHomePanel.vue`
- Create: `app/components/chat/workspace-dock/WorkspaceDockToolHeaderActions.vue`
- Modify: `app/components/chat/workspace-dock/context.ts`
- Modify: `app/components/chat/workspace-dock/WorkspaceDock.vue`
- Modify: `app/components/chat/workspace-dock/WorkspaceDockTab.vue`
- Modify: `app/plugins/workspace-dock.ts`
- Modify: `app/composables/workspace/useWorkspaceLaunchActions.ts`
- Modify: `i18n/locales/zh.json`
- Modify: `i18n/locales/en.json`

**Interfaces:**
- Produces: `WorkspaceToolCatalogItem` with `id`, `labelKey`, `descriptionKey`, `icon`, `disabled`, and `activate`
- Produces: `createWorkspaceToolCatalog(input): WorkspaceToolCatalogItem[]`
- Produces through Dock context: `openToolCatalog`, `toggleToolSidebar`, `toolSidebarOpen`
- Consumes: existing Terminal, Browser, Git review, Sub Agent, Tmux, Host metrics stores and Task 1/2 layout methods

- [ ] **Step 1: Write failing catalog behavior tests**

Pass literal capability input and spy functions, then assert seven stable tool categories, disabled reasons, and exact activation targets. Include two literal sub-agent instances and verify both are returned with their real host/thread ids.

```ts
const catalog = createWorkspaceToolCatalog(fixture);
expect(catalog.map(({ id }) => id)).toEqual([
  "files", "gitReview", "terminal", "browser", "subagent:1:a", "subagent:1:b", "tmux", "hostMetrics",
]);
catalog.find(({ id }) => id === "files")?.activate();
expect(actions.openFiles).toHaveBeenCalledOnce();
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm test:unit app/components/chat/workspace-tools/tool-catalog.test.ts`

Expected: FAIL because the catalog factory does not exist.

- [ ] **Step 3: Implement the catalog factory and real launch wiring**

Keep the factory pure and inject real actions from `WorkspaceDock.vue`. Add `openFiles()` and `openGitReview()` to `useWorkspaceLaunchActions`; `openFiles()` updates Task 1 state and requests `FILES_WORKSPACE_PANEL_ID`, while `openGitReview()` calls the existing review store for the current scope. Browser uses `BrowserOpenDialog`, and each sub-agent item invokes the existing `openSubAgentPanel` action with its actual ids.

- [ ] **Step 4: Verify catalog tests pass**

Run: `pnpm test:unit app/components/chat/workspace-tools/tool-catalog.test.ts`

Expected: PASS.

- [ ] **Step 5: Build the launcher UI and hidden sentinel tab**

`WorkspaceToolCatalog.vue` accepts `variant: "panel" | "menu"`. The panel variant is a plain vertically aligned command list centered vertically within a restrained max-width; the menu variant uses existing dropdown/menu primitives. Disabled rows expose their reason with accessible text and do not call actions.

`WorkspaceDockToolHeaderActions.vue` renders `+` only for `workspace-tools-group`. `WorkspaceDockToolHomePanel.vue` renders the panel catalog. Register both Dockview renderers. Hide only the sentinel's Dockview tab wrapper; never hide actual tool tabs.

- [ ] **Step 6: Add bilingual copy**

Add keys for tool catalog, tool sidebar toggle, empty state, and unavailable reasons in both locale files. Do not add visible keyboard shortcut instructions.

- [ ] **Step 7: Verify focused unit tests and type safety**

Run: `pnpm test:unit app/components/chat/workspace-tools/tool-catalog.test.ts`

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/components/chat/workspace-tools app/components/chat/workspace-dock app/plugins/workspace-dock.ts app/composables/workspace/useWorkspaceLaunchActions.ts i18n/locales
git commit -m "feat(workspace): add unified tool catalog"
```

### Task 4: Agent information header, group controls, and responsive shell

**Files:**
- Create: `app/components/chat/workspace-dock/WorkspaceAgentTab.vue`
- Modify: `app/components/chat/workspace-dock/WorkspaceDockTab.vue`
- Modify: `app/components/chat/workspace-dock/WorkspaceDockGroupActions.vue`
- Modify: `app/components/chat/workspace-dock/WorkspaceDock.vue`
- Modify: `app/components/chat/AgentWorkspacePane.vue`
- Modify: `app/components/thread/ThreadChatHeader.vue`
- Modify: `app/components/sidebar/SidebarWorkspaceToolbar.vue`
- Modify: `app/components/sidebar/GatewaySidebar.vue`
- Modify: `app/components/chat/MobileWorkspaceHeader.vue`
- Modify: `app/layouts/mobile.vue`
- Modify: `i18n/locales/zh.json`
- Modify: `i18n/locales/en.json`
- Modify: `tests/e2e/thread-file-preview.spec.ts`
- Modify: `tests/e2e/thread-scroll-behavior.spec.ts`
- Modify: `tests/e2e/thread-subagent-ui.spec.ts`
- Modify: `tests/e2e/mobile-layout.mobile.spec.ts`
- Modify: `tests/e2e/remote-host-project.spec.ts`
- Modify: `tests/e2e/host-monitoring.spec.ts`

**Interfaces:**
- `WorkspaceAgentTab` consumes current navigation/thread/project/runtime stores and renders title, workspace, and non-idle phase.
- `WorkspaceDockGroupActions` consumes Dockview header params plus Dock UI context and renders three group controls followed by the separate tool-sidebar toggle.

- [ ] **Step 1: Add failing real E2E expectations**

Extend the existing workspace/file-preview and mobile layout specs before production edits:

```ts
await expect(page.getByTestId("workspace-agent-header")).toContainText(threadTitle);
await expect(page.locator('[data-panel-kind="agent"]')).not.toContainText("Agent");
await expect(page.getByTestId("workspace-tool-home")).toBeVisible();
await page.getByTestId("workspace-tool-menu-trigger").click();
await page.getByRole("menuitem", { name: "文件" }).click();
await expect(page.locator('[data-panel-kind="files"]')).toBeVisible();
```

Add a mobile assertion that the tool button swaps from Agent content to a full-width tool home and back. Add a sidebar assertion that `open-host-monitor-button` is absent and `desktop-sidebar-collapse` remains.

- [ ] **Step 2: Run the applicable E2E entry and verify RED**

Run: `pnpm test:e2e`

Expected: the new assertions FAIL because the header, catalog, and responsive group toggle are missing. If the Windows host cannot execute the Docker/bash runner, record that environment failure and run the same test command on the CentOS deployment before completion.

- [ ] **Step 3: Move thread information into the Agent tab renderer**

Extract the existing title/project/phase behavior from `ThreadChatHeader.vue` into `WorkspaceAgentTab.vue`. Render it for `kind === "agent"` in `WorkspaceDockTab.vue`, without the monitor icon or `Agent` text. Remove the duplicate content header from `AgentWorkspacePane.vue`; delete `ThreadChatHeader.vue` if no references remain.

- [ ] **Step 4: Complete desktop group chrome**

Keep maximize, float/dock, and popout in `WorkspaceDockGroupActions.vue`. Add a visually separated tool-sidebar button using `PanelRightOpenIcon`/`PanelRightCloseIcon`. Ensure the control is reachable from either group and uses the same Task 1 toggle.

- [ ] **Step 5: Simplify left sidebar toolbar**

Remove the host title prop, metrics emit, and metrics button from `SidebarWorkspaceToolbar.vue`; keep only `SidebarTrigger`. Remove matching wiring from `GatewaySidebar.vue` while retaining metrics actions in the new tool catalog and host-tree context menu.

- [ ] **Step 6: Implement full-width mobile tool mode**

Replace the mobile host-monitor button with a tool-workspace toggle. The same Dockview keeps both renderer trees mounted, while lifecycle visibility shows exactly one group at a time. The mobile header title switches between the active conversation and localized `工具` without fixed-width layout values.

- [ ] **Step 7: Run typecheck and real E2E**

Run: `pnpm typecheck`

Run: `pnpm test:e2e`

Expected: header, launcher, close, group controls, sidebar simplification, mobile switch, existing Files/Terminal/Browser flows, and route restoration PASS against real services.

- [ ] **Step 8: Commit**

```bash
git add app/components app/layouts/mobile.vue i18n/locales tests/e2e
git commit -m "feat(ui): make agent primary and tools secondary"
```

### Task 5: Viewport-wide pet and final verification

**Files:**
- Modify: `app/app.vue`
- Modify: `app/components/chat/AgentWorkspacePane.vue`
- Modify: `app/components/pet/GatewayPet.vue`
- Modify: `tests/e2e/pet.spec.ts`

**Interfaces:**
- `GatewayPet` remains driven by the existing gateway-pet and config stores.
- Its boundary changes from Agent pane geometry to authenticated viewport geometry.

- [ ] **Step 1: Change the pet E2E first**

Make `desktop-layout` the boundary and assert the pet crosses left of the Agent pane while remaining inside the viewport:

```ts
const desktop = await elementBox(page.getByTestId("desktop-layout"));
const agent = await elementBox(page.getByTestId("chat-main-pane"));
// Drag into the visible navigation side, then assert the pet is left of Agent.
expect(dragged.x).toBeLessThan(agent.x);
expect(dragged.x).toBeGreaterThanOrEqual(desktop.x + 7);
```

- [ ] **Step 2: Run pet E2E and verify RED**

Run: `pnpm test:e2e`

Expected: the cross-sidebar assertion FAILS because the current absolute boundary is the Agent pane.

- [ ] **Step 3: Move the pet to authenticated app root**

Remove `GatewayPet` from `AgentWorkspacePane.vue`. In `app.vue`, render `NuxtLayout` and `GatewayPet` as authenticated siblings. Change the pet boundary to `fixed inset-0`, remove `COMPOSER_INSET`, and clamp all four sides to `EDGE_INSET` only. Preserve pointer-event pass-through and account-scoped saved position.

- [ ] **Step 4: Run pet E2E and verify GREEN**

Run: `pnpm test:e2e`

Expected: drag, reload persistence, and resize clamp PASS.

- [ ] **Step 5: Run complete verification**

Run in order:

```bash
pnpm test:unit
pnpm typecheck
pnpm lint:ox
pnpm format:check
git diff --check
pnpm build
pnpm test:e2e
```

Expected: all task-related checks PASS. If the three known baseline format failures remain untouched, report them separately and verify every changed file directly with `pnpm exec oxfmt --check <changed files>`.

- [ ] **Step 6: Perform visual QA**

Start the local server on an unused port and use system Edge/Playwright to capture desktop and mobile screenshots. Verify nonblank renderers, title/control alignment, resizable split, empty launcher, no overlap, no horizontal overflow, mobile group switching, and viewport-wide pet drag.

- [ ] **Step 7: Commit final test adjustments**

```bash
git add app/app.vue app/components/chat/AgentWorkspacePane.vue app/components/pet/GatewayPet.vue tests/e2e/pet.spec.ts
git commit -m "feat(pet): allow viewport-wide dragging"
```

- [ ] **Step 8: Integrate and deploy**

Push the feature branch, merge it into `dev` as explicitly requested for this repository workflow, then deploy only the `codex-gateway` service from the resulting `dev` commit to `/opt/codex-gateway` on `192.168.48.110`. Preserve `.env`, `.dataops-sso-secret`, `data/`, and `docker-compose.override.yml`; do not restart Runtime Manager or long-lived Agent containers. Verify container health, logs, and `http://192.168.48.110:3100/` after deployment.
