import { describe, expect, it, vi } from "vitest";
import type { SFTPWrapper, Stats } from "ssh2";
import { RemoteFileService } from "./remote-files";
import type { SshConnectionPool } from "../ssh/ssh-connection";
import type { HostWithSecret } from "../ssh/ssh-types";

describe("remote file uploads", () => {
  it("creates missing parent directories through SFTP without consuming an exec channel", async () => {
    const directories = new Set(["/", "/workspace", "/workspace/project"]);
    const sftp = createDirectorySftp(directories);
    const uploadFile = vi.fn(async () => "/workspace/project/reports/revenue.csv");
    const exec = vi.fn(async () => {
      throw new Error("upload must not wait for an exec channel");
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the upload test only needs the three SshConnectionPool methods exercised by RemoteFileService.
    const ssh = {
      exec,
      sftp: vi.fn(async () => sftp),
      uploadFile,
    } as unknown as SshConnectionPool;
    const service = new RemoteFileService(ssh);

    await expect(
      service.uploadFile(host(), "C:/tmp/revenue.csv", "/workspace/project/reports/revenue.csv"),
    ).resolves.toBe("/workspace/project/reports/revenue.csv");

    expect(exec).not.toHaveBeenCalled();
    expect(directories).toContain("/workspace/project/reports");
    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      "C:/tmp/revenue.csv",
      "/workspace/project/reports/revenue.csv",
    );
  });
});

function createDirectorySftp(directories: Set<string>) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ssh2 Stats has no public constructor and the service only reads isDirectory.
  const directoryStats = { isDirectory: () => true } as Stats;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the SFTP test double implements only stat and mkdir, which are the methods under test.
  return {
    stat(path: string, callback: (error: Error | null, stats?: Stats) => void) {
      if (directories.has(path)) callback(null, directoryStats);
      else callback(Object.assign(new Error("No such file"), { code: 2 }));
    },
    mkdir(
      path: string,
      _attributes: { mode: number },
      callback: (error?: Error | null) => void,
    ) {
      directories.add(path);
      callback(null);
    },
  } as unknown as SFTPWrapper;
}

function host(): HostWithSecret {
  return {
    id: 1,
    name: "upload-host",
    sshHost: "ssh.example.test",
    username: "codex",
    port: 22,
    authMode: "password",
    privateKeyPath: null,
    password: "test-password",
    privateKey: null,
    proxyUrl: null,
    hasPassword: true,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
  };
}
