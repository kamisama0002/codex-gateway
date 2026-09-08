import { expect, test } from "@playwright/test";

import {
  execManagedRuntimeText,
  expectDataOpsTicketRejected,
  inspectManagedRuntimeDocker,
  loginDataOpsUser,
  recordManagedRuntimeResourceExpectations,
  readManagedRuntimeStatusView,
  restartManagedRuntime,
  startManagedRuntime,
} from "./helpers/managed-runtime";

const FIRST_POLICY_TICKET = "runtime-policy-first-v1-login";
const FIRST_POLICY_REFRESH_API_TICKET = "runtime-policy-first-v2-api";
const FIRST_POLICY_REFRESH_BROWSER_TICKET = "runtime-policy-first-v2-browser";
const SECOND_POLICY_TICKET = "runtime-policy-second-v1-login";
const MARKER_PATH = "/workspace/runtime-policy-marker.txt";
const MARKER_CONTENT = "runtime-policy-workspace-survives";

test("applies DataOps tenant policies to isolated runtimes and preserves workspace on restart", async ({
  page,
  request,
}) => {
  const [firstSession, secondSession] = await Promise.all([
    loginDataOpsUser(request, FIRST_POLICY_TICKET),
    loginDataOpsUser(request, SECOND_POLICY_TICKET),
  ]);
  await expectDataOpsTicketRejected(request, FIRST_POLICY_TICKET);
  await recordManagedRuntimeResourceExpectations([
    {
      session: firstSession,
      resources: {
        memoryBytes: 1280 * 1024 * 1024,
        nanoCpus: 1_250_000_000,
        pidsLimit: 160,
      },
    },
    {
      session: secondSession,
      resources: {
        memoryBytes: 1536 * 1024 * 1024,
        nanoCpus: 1_500_000_000,
        pidsLimit: 192,
      },
    },
  ]);

  await Promise.all([
    startManagedRuntime(request, firstSession),
    startManagedRuntime(request, secondSession),
  ]);
  const [first, second] = await Promise.all([
    inspectManagedRuntimeDocker(firstSession),
    inspectManagedRuntimeDocker(secondSession),
  ]);

  expect(first.memoryBytes).toBe(1024 * 1024 * 1024);
  expect(first.nanoCpus).toBe(1_000_000_000);
  expect(first.pidsLimit).toBe(128);
  expect(second.memoryBytes).toBe(1536 * 1024 * 1024);
  expect(second.nanoCpus).toBe(1_500_000_000);
  expect(second.pidsLimit).toBe(192);
  expect(first.containerId).not.toBe(second.containerId);
  expect(first.workspaceVolume).not.toBe(second.workspaceVolume);

  await execManagedRuntimeText(firstSession, `printf '%s' '${MARKER_CONTENT}' > '${MARKER_PATH}'`);

  const refreshedSession = await loginDataOpsUser(request, FIRST_POLICY_REFRESH_API_TICKET);
  await expectDataOpsTicketRejected(request, FIRST_POLICY_REFRESH_API_TICKET);
  const drifted = await readManagedRuntimeStatusView(request, refreshedSession);
  expect(drifted).toMatchObject({
    assignedPolicy: {
      imageAlias: "stable",
      memoryMiB: 1280,
      cpuCores: 1.25,
      pidsLimit: 160,
    },
    actualResources: {
      memoryBytes: 1024 * 1024 * 1024,
      nanoCpus: 1_000_000_000,
      pidsLimit: 128,
    },
    requiresRestart: true,
    requiresUpgrade: false,
  });

  await page.goto(
    `http://codex.127.0.0.1.nip.io:3100/?embedded=1#dataops_ticket=${FIRST_POLICY_REFRESH_BROWSER_TICKET}`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.getByTestId("desktop-layout")).toBeVisible();
  await expectDataOpsTicketRejected(request, FIRST_POLICY_REFRESH_BROWSER_TICKET);
  await page.getByTestId("settings-toggle").click();
  const settings = page.getByTestId("settings-panel");
  await settings.getByRole("tab", { name: "Agent 运行时", exact: true }).click();
  await expect(settings.getByText("1280 MiB")).toBeVisible();
  await expect(settings.getByText("1.25 CPU")).toBeVisible();
  await expect(settings.getByText("160", { exact: true })).toBeVisible();
  await expect(settings.getByText("重启后生效", { exact: true })).toBeVisible();
  await expect(settings.getByTestId("runtime-admin-row")).toHaveCount(0);

  await restartManagedRuntime(request, refreshedSession);
  const restarted = await inspectManagedRuntimeDocker(refreshedSession);
  expect(restarted.memoryBytes).toBe(1280 * 1024 * 1024);
  expect(restarted.nanoCpus).toBe(1_250_000_000);
  expect(restarted.pidsLimit).toBe(160);
  expect(restarted.workspaceVolume).toBe(first.workspaceVolume);
  expect(await execManagedRuntimeText(refreshedSession, `cat '${MARKER_PATH}'`)).toBe(
    MARKER_CONTENT,
  );
});
