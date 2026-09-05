import { afterEach, describe, expect, it, vi } from "vitest";
import type { SFTPWrapper } from "ssh2";
import type { HostRecord, ProjectRecord } from "~~/shared/types";
import { sshConnections } from "../infra/host-services";
import { validateProjectFileReferences } from "./project-file-references";

const host: HostRecord = {
  id: 1,
  name: "Host",
  sshHost: "host.test",
  username: "user",
  port: 22,
  authMode: "agent",
  privateKeyPath: null,
  proxyUrl: null,
  hasPassword: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const project: ProjectRecord = {
  id: 1,
  hostId: 1,
  name: "Project",
  remotePath: "/workspace/project",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("project file references", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(sshConnections, "sftp");
  });

  it("rejects when opening SFTP never returns", async () => {
    vi.spyOn(sshConnections, "sftp").mockImplementation(() => new Promise<SFTPWrapper>(() => {}));

    await expect(validate()).rejects.toThrow("file_reference_timeout");
  }, 250);

  it("rejects when SFTP realpath never returns", async () => {
    useSftp({
      realpath() {},
      stat() {
        throw new Error("stat must not be called");
      },
    } satisfies FileReferenceSftp);

    await expect(validate()).rejects.toThrow("file_reference_timeout");
  }, 250);

  it("rejects when SFTP stat never returns", async () => {
    useSftp({
      realpath(path: string, callback: (error: Error | undefined, resolved: string) => void) {
        callback(undefined, path);
      },
      stat() {},
    } satisfies FileReferenceSftp);

    await expect(validate()).rejects.toThrow("file_reference_timeout");
  }, 250);
});

function validate() {
  return validateProjectFileReferences(
    host,
    project,
    [{ type: "file", path: "README.md", name: "README.md" }],
    { timeoutMs: 20 },
  );
}

type FileReferenceSftp = Pick<SFTPWrapper, "realpath" | "stat">;

function useSftp(sftp: FileReferenceSftp) {
  if (!Reflect.set(sshConnections, "sftp", () => Promise.resolve(sftp))) {
    throw new Error("Unable to replace SFTP client for test");
  }
}
