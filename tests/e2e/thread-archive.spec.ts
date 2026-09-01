import { expect, test } from "./fixtures/remote-workspace";
import { openApp } from "./helpers/app";

test.describe.configure({ mode: "serial" });

test("archives a thread and restores it from the host-tree Archived filter", async ({
  browser,
  page,
  remoteWorkspace,
}) => {
  await openApp(page);
  const { host, project } = await remoteWorkspace.provision();
  const threadId = await remoteWorkspace.startThread(project.id);
  const threadButton = page.getByTestId(`thread-button-${threadId}`);
  await expect(threadButton).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`threadId=${threadId}`));

  await threadButton.click({ button: "right" });
  await page.getByRole("menuitem", { name: /归档会话|Archive thread/ }).click();
  await expect(threadButton).toHaveCount(0);
  await expect(page).not.toHaveURL(new RegExp(`threadId=${threadId}`));

  await page.getByTestId("host-tree-menu").click();
  await page.getByTestId("archived-threads-toggle").click();
  const archivedButton = page.getByTestId(`archived-thread-button-${threadId}`);
  await expect(archivedButton).toBeVisible();

  const secondPage = await browser.newPage();
  await openApp(secondPage, { resetConfig: false });
  await secondPage.getByTestId(`host-button-${host.id}`).click();
  await secondPage.getByTestId(`project-button-${project.id}`).click();
  await expect(secondPage.getByTestId(`thread-button-${threadId}`)).toHaveCount(0);
  await secondPage.getByTestId("host-tree-menu").click();
  await secondPage.getByTestId("archived-threads-toggle").click();
  await expect(secondPage.getByTestId(`archived-thread-button-${threadId}`)).toBeVisible();

  await archivedButton.click({ button: "right" });
  await page.getByRole("menuitem", { name: /取消归档|Unarchive/ }).click();
  await expect(page.getByTestId(`thread-button-${threadId}`)).toBeVisible();
  await expect(secondPage.getByTestId(`thread-button-${threadId}`)).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId(`archived-thread-button-${threadId}`)).toHaveCount(0);
  await secondPage.close();
});

test("deletes an archived thread after confirmation and keeps cancel as the safe default", async ({
  page,
  remoteWorkspace,
}) => {
  await openApp(page);
  const { project } = await remoteWorkspace.provision();
  const threadId = await remoteWorkspace.startThread(project.id);
  const threadButton = page.getByTestId(`thread-button-${threadId}`);
  await expect(threadButton).toBeVisible();

  await threadButton.click({ button: "right" });
  await page.getByRole("menuitem", { name: /归档会话|Archive thread/ }).click();
  await page.getByTestId("host-tree-menu").click();
  await page.getByTestId("archived-threads-toggle").click();
  const archivedButton = page.getByTestId(`archived-thread-button-${threadId}`);
  await expect(archivedButton).toBeVisible();

  await archivedButton.click({ button: "right" });
  await page.getByRole("menuitem", { name: /删除会话|Delete thread/ }).click();
  await expect(page.getByTestId("delete-thread-dialog")).toBeVisible();
  await page.getByRole("button", { name: /取消|Cancel/ }).click();
  await expect(page.getByTestId("delete-thread-dialog")).toHaveCount(0);
  await expect(archivedButton).toBeVisible();

  await archivedButton.click({ button: "right" });
  await page.getByRole("menuitem", { name: /删除会话|Delete thread/ }).click();
  await page.getByTestId("delete-thread-confirm").click();
  await expect(page.getByTestId(`archived-thread-button-${threadId}`)).toHaveCount(0);
  await expect(page.getByTestId(`thread-button-${threadId}`)).toHaveCount(0);
});
