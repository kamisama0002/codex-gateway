import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect, test } from "./fixtures/remote-workspace";
import { openApp } from "./helpers/app";
import { execRemoteSsh } from "./helpers/remote-codex";

test("uploads files and folders into the real project workspace with conflict confirmation", async ({
  page,
  remoteWorkspace,
}, testInfo) => {
  await openApp(page);
  const marker = String(Date.now());
  const remote = remoteWorkspace.remote;
  const remotePath = `/home/codex/workspace-upload-${marker}`;
  await execRemoteSsh(remote, `mkdir -p ${shellQuote(remotePath)}`);
  const { project } = await remoteWorkspace.provision({
    hostName: `workspace-upload-host-${Date.now()}`,
    projectName: `workspace-upload-project-${Date.now()}`,
    remotePath,
  });
  const singleName = `workspace-single-${marker}.txt`;
  const singlePath = testInfo.outputPath(singleName);
  await writeFile(singlePath, "single upload", "utf8");

  await chooseWorkspaceUpload(page, "上传文件到工作区", singlePath);
  await expect(page.getByText("已上传 1 个文件到工作区")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await execRemoteSsh(remote, `cat ${shellQuote(`${project.remotePath}/${singleName}`)}`))
          .stdout,
    )
    .toBe("single upload");

  const folder = testInfo.outputPath(`workspace-folder-${marker}`);
  const nested = join(folder, "nested");
  await mkdir(nested, { recursive: true });
  await writeFile(join(folder, "root.txt"), "folder root v1", "utf8");
  await writeFile(join(nested, "revenue.csv"), "revenue v1", "utf8");

  await chooseWorkspaceUpload(page, "上传文件夹到工作区", folder);
  await expect(page.getByText("已上传 2 个文件到工作区")).toBeVisible();
  const remoteFolder = `${project.remotePath}/${basename(folder)}`;
  await expect
    .poll(
      async () =>
        (await execRemoteSsh(remote, `cat ${shellQuote(`${remoteFolder}/nested/revenue.csv`)}`))
          .stdout,
    )
    .toBe("revenue v1");

  await writeFile(join(folder, "root.txt"), "folder root v2", "utf8");
  await writeFile(join(nested, "revenue.csv"), "revenue v2", "utf8");
  await chooseWorkspaceUpload(page, "上传文件夹到工作区", folder);

  const conflict = page.getByTestId("workspace-upload-conflict-dialog");
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText("2 个文件已存在");
  expect(
    (await execRemoteSsh(remote, `cat ${shellQuote(`${remoteFolder}/nested/revenue.csv`)}`)).stdout,
  ).toBe("revenue v1");

  await page.getByTestId("workspace-upload-overwrite").click();
  await expect(conflict).toBeHidden();
  await expect
    .poll(
      async () =>
        (await execRemoteSsh(remote, `cat ${shellQuote(`${remoteFolder}/nested/revenue.csv`)}`))
          .stdout,
    )
    .toBe("revenue v2");
});

async function chooseWorkspaceUpload(
  page: import("@playwright/test").Page,
  label: string,
  path: string,
) {
  await page.getByTestId("composer-add-content").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: label }).click();
  await (await chooser).setFiles(path);
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
