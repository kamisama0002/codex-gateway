import type { Page } from "@playwright/test";
import type { TerminalOpenInput } from "@/stores/gateway/types";

export async function openBrowserWorkspace(page: Page, targetUrl: string) {
  await page.evaluate((url) => {
    const workspace = window.__codexGatewayE2e?.workspace;
    if (workspace === undefined) throw new Error("Gateway E2E workspace driver is unavailable");
    workspace.openBrowser(url);
  }, targetUrl);
}

export async function openTerminalWorkspace(page: Page, input: TerminalOpenInput) {
  await page.evaluate(async (terminalInput) => {
    const workspace = window.__codexGatewayE2e?.workspace;
    if (workspace === undefined) throw new Error("Gateway E2E workspace driver is unavailable");
    await workspace.openTerminal(terminalInput);
  }, input);
}

export async function openTmuxWorkspace(page: Page) {
  await page.evaluate(() => {
    const workspace = window.__codexGatewayE2e?.workspace;
    if (workspace === undefined) throw new Error("Gateway E2E workspace driver is unavailable");
    workspace.openTmux();
  });
}
