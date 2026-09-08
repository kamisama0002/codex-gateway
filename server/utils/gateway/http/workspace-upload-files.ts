import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import type { HostRecord } from "~~/shared/types";
import { isManagedRuntimeHost } from "~~/shared/runtime/managed-runtime";
import { remoteFiles } from "../infra/host-services";
import { threadBroker } from "../runtime/broker";

interface WorkspaceUploadRemoteFiles {
  existingPaths(host: HostRecord, remotePaths: string[]): Promise<string[]>;
  uploadFile(host: HostRecord, localPath: string, remotePath: string): Promise<unknown>;
}

interface WorkspaceUploadAppServerFiles {
  existingPaths(host: HostRecord, paths: string[]): Promise<string[]>;
  createDirectory(host: HostRecord, path: string): Promise<unknown>;
  writeFile(host: HostRecord, path: string, content: Buffer): Promise<unknown>;
}

export function workspaceUploadFilesForHost(
  host: HostRecord,
  dependencies: {
    remoteFiles: WorkspaceUploadRemoteFiles;
    appServerFiles: WorkspaceUploadAppServerFiles;
  } = {
    remoteFiles,
    appServerFiles: {
      existingPaths: (target, paths) => threadBroker.existingFilePaths(target, paths),
      createDirectory: (target, path) => threadBroker.createDirectory(target, path),
      writeFile: (target, path, content) => threadBroker.writeFile(target, path, content),
    },
  },
): WorkspaceUploadRemoteFiles {
  if (!isManagedRuntimeHost(host)) return dependencies.remoteFiles;
  return {
    existingPaths: (_target, paths) => dependencies.appServerFiles.existingPaths(host, paths),
    uploadFile: async (_target, localPath, remotePath) => {
      await dependencies.appServerFiles.createDirectory(host, posix.dirname(remotePath));
      await dependencies.appServerFiles.writeFile(host, remotePath, await readFile(localPath));
    },
  };
}
