import { createRequire } from "node:module";
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
  afterEach(() => vi.restoreAllMocks());

  it("rejects when opening SFTP never returns", async () => {
    vi.spyOn(sshConnections, "sftp").mockImplementation(() => new Promise<SFTPWrapper>(() => {}));

    await expect(validate()).rejects.toThrow("file_reference_timeout");
  }, 250);

  it("rejects when SFTP realpath never returns", async () => {
    vi.spyOn(sshConnections, "sftp").mockResolvedValue(
      testSftp({
        realpath() {},
      }),
    );

    await expect(validate()).rejects.toThrow("file_reference_timeout");
  }, 250);

  it("rejects when SFTP stat never returns", async () => {
    vi.spyOn(sshConnections, "sftp").mockResolvedValue(
      testSftp({
        realpath(path: string, callback: (error: Error | undefined, resolved: string) => void) {
          callback(undefined, path);
        },
        stat() {},
      }),
    );

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

interface SftpConstructor {
  new (
    client: { _protocol: { _remoteIdentRaw: string } },
    channel: { type: string; incoming: unknown; outgoing: { state: string; id: number } },
    options: object,
  ): SFTPWrapper;
}

function testSftp(overrides: Partial<Pick<SFTPWrapper, "realpath" | "stat">>) {
  const sftp = new (sftpConstructor())(
    { _protocol: { _remoteIdentRaw: "" } },
    { type: "session", incoming: {}, outgoing: { state: "open", id: 1 } },
    {},
  );
  sftp.realpath = overrides.realpath ?? (() => {});
  sftp.stat = overrides.stat ?? (() => {});
  return sftp;
}

function sftpConstructor(): SftpConstructor {
  const module: unknown = createRequire(import.meta.url)("ssh2/lib/protocol/SFTP");
  if (!isRecord(module) || !isSftpConstructor(module.SFTP)) {
    throw new Error("ssh2 SFTP constructor is unavailable");
  }
  return module.SFTP;
}

function isSftpConstructor(value: unknown): value is SftpConstructor {
  return typeof value === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
