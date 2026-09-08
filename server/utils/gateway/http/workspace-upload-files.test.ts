import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostRecord } from "~~/shared/types";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { workspaceUploadFilesForHost } from "./workspace-upload-files";

const managedHost = {
  id: MANAGED_RUNTIME_HOST_ID,
  connectionKind: "managed",
  name: "Local",
  sshHost: "localhost",
  username: null,
  port: null,
  authMode: "agent",
  privateKeyPath: null,
  privateKey: null,
  password: null,
  proxyUrl: null,
  hasPassword: false,
  createdAt: "",
  updatedAt: "",
} satisfies HostRecord;

describe("workspace upload file backend", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("uses App Server file methods instead of SSH for a managed runtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workspace-upload-files-test-"));
    temporaryDirectories.push(directory);
    const localPath = join(directory, "report.txt");
    await writeFile(localPath, "revenue 42", "utf8");
    const remoteFiles = {
      existingPaths: vi.fn(async () => {
        throw new Error("SSH must not be used");
      }),
      uploadFile: vi.fn(async () => {
        throw new Error("SSH must not be used");
      }),
    };
    const appServerFiles = {
      existingPaths: vi.fn(async () => ["/workspace/existing.txt"]),
      createDirectory: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => ({ path: "/workspace/reports/report.txt" })),
    };
    const files = workspaceUploadFilesForHost(managedHost, { remoteFiles, appServerFiles });

    await expect(files.existingPaths(managedHost, ["/workspace/existing.txt"])).resolves.toEqual([
      "/workspace/existing.txt",
    ]);
    await files.uploadFile(managedHost, localPath, "/workspace/reports/report.txt");

    expect(appServerFiles.createDirectory).toHaveBeenCalledWith(managedHost, "/workspace/reports");
    expect(appServerFiles.writeFile).toHaveBeenCalledWith(
      managedHost,
      "/workspace/reports/report.txt",
      Buffer.from("revenue 42", "utf8"),
    );
    expect(remoteFiles.existingPaths).not.toHaveBeenCalled();
    expect(remoteFiles.uploadFile).not.toHaveBeenCalled();
  });
});
