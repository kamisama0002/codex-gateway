import { expect, test } from "./fixtures/remote-workspace";
import { E2E_PASSWORD, E2E_USERNAME, openApp } from "./helpers/app";
import { loginGatewayUser, startManagedRuntime } from "./helpers/managed-runtime";
import {
  activeRealtimeSocketCount,
  installRealtimeSocketProbe,
} from "./helpers/realtime-socket-probe";

test("streams Agent container metrics through the shared realtime connection", async ({
  page,
  request,
  remoteWorkspace,
}) => {
  const session = await loginGatewayUser(request, E2E_USERNAME, E2E_PASSWORD);
  await installRealtimeSocketProbe(page);
  await openApp(page);
  const { project } = await remoteWorkspace.provision({
    hostName: `metrics-host-${Date.now()}`,
    projectName: "Metrics project",
  });
  await startManagedRuntime(request, session);

  await expect(page.getByTestId(`project-button-${project.id}`)).toBeVisible();
  await page.getByTestId("open-host-monitor-button").click();
  const panel = page.getByTestId("host-metrics-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "运行时监控" })).toBeVisible();
  await expect(panel.getByTestId("host-metric-cpu")).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId("host-metric-memory")).toBeVisible();
  await expect(panel.getByTestId("host-metric-network")).toBeVisible();
  await expect(panel.getByTestId("host-metric-disk")).toBeVisible();
  await expect(panel.getByText("实时采集中")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "GPU", exact: true })).toHaveCount(0);
  await expect.poll(() => activeRealtimeSocketCount(page)).toBe(1);

  const monitorTab = page.getByRole("tab", { name: "运行时监控" });
  await monitorTab.getByLabel(/关闭标签页|Close tab/).click();
  await expect(panel).toBeHidden();
  await page.getByTestId("open-host-monitor-button").click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "运行时监控" })).toBeVisible();
  await expect(panel.getByTestId("host-metric-cpu")).toBeVisible();
});
