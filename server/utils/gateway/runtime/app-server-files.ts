import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { Readable } from "node:stream";
import { createError } from "h3";
import type {
  HostRecord,
  ProjectFileSearchResult,
  RemoteDirectoryResult,
  RpcEnvelope,
} from "~~/shared/types";
import {
  fsChangedNotificationFromUnknown,
  parseFsCreateDirectoryResponse,
  parseFsGetMetadataResponse,
  parseFsReadDirectoryResponse,
  parseFsReadFileResponse,
  parseFsRemoveResponse,
  parseFsWatchResponse,
  parseFsWriteFileResponse,
  parseFuzzyFileSearchResponse,
} from "~~/shared/runtime/app-server/file-system";
import {
  isInsideManagedWorkspace,
  isManagedRuntimeHost,
  resolveManagedWorkspaceBrowsePath,
} from "~~/shared/runtime/managed-runtime";
import type { CodexRpcClient } from "../infra/rpc/rpc";
import type { RemoteFileMetadata, RemoteFileResult } from "../infra/ssh/ssh-types";
import {
  RemoteFileInvalidPathError,
  RemoteFileNotRegularError,
  RemoteFileTooLargeError,
} from "../infra/files/remote-file-errors";
import { bindGatewayUser, currentGatewayUserId } from "../state/memory";
import { normalizeReferencePath } from "../project-files/project-file-references";

const FILE_RPC_TIMEOUT_MS = 120_000;
const FILE_WATCH_COALESCE_MS = 150;

export type AppServerFileWatchEvent = { type: "changed"; paths: string[] } | { type: "closed" };

type AppServerFileWatchListener = (event: AppServerFileWatchEvent) => void;

interface ActiveFileWatch {
  token: object;
  client: CodexRpcClient;
  watchId: string;
  requestedPath: string;
  canonicalPath: string;
  listeners: Set<AppServerFileWatchListener>;
  removeNotificationListener: () => void;
  removeCloseListener: () => void;
  pendingPaths: Set<string>;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

interface FileWatchLease {
  rootPath: string;
  release: () => void;
}

export interface AppServerFileControllerRegistry {
  getHostClient(host: HostRecord): Promise<CodexRpcClient>;
}

export class AppServerFileService {
  private readonly watches = new Map<
    string,
    { token: object; pending: Promise<ActiveFileWatch> }
  >();

  constructor(private readonly registry: AppServerFileControllerRegistry) {}

  async listDirectory(host: HostRecord, path: string): Promise<RemoteDirectoryResult> {
    const client = await this.registry.getHostClient(host);
    const response = await client.request(
      "fs/readDirectory",
      { path },
      FILE_RPC_TIMEOUT_MS,
      parseFsReadDirectoryResponse,
    );
    const entries = response.entries.map((entry) => ({
      name: entry.fileName,
      path: posix.join(path, entry.fileName),
      type: directoryEntryType(entry),
      size: null,
      modifiedAt: null,
    }));
    entries.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
    return { path, entries };
  }

  async createDirectory(host: HostRecord, path: string) {
    const client = await this.registry.getHostClient(host);
    await client.request(
      "fs/createDirectory",
      { path, recursive: true },
      FILE_RPC_TIMEOUT_MS,
      parseFsCreateDirectoryResponse,
    );
  }

  async openFile(
    host: HostRecord,
    inputPath: string,
    options: { maxSize: number },
  ): Promise<RemoteFileResult> {
    const path = filePathForHost(host, inputPath);
    const client = await this.registry.getHostClient(host);
    const metadata = await this.getFileMetadata(client, path);
    const response = await client.request(
      "fs/readFile",
      { path },
      FILE_RPC_TIMEOUT_MS,
      parseFsReadFileResponse,
    );
    const contents = Buffer.from(response.dataBase64, "base64");
    if (contents.byteLength > options.maxSize) {
      throw new RemoteFileTooLargeError(path, options.maxSize);
    }
    return {
      path,
      size: contents.byteLength,
      modifiedAt: metadata.modifiedAtMs,
      sample: contents.subarray(0, Math.min(contents.byteLength, 515)),
      stream: Readable.from(contents),
    };
  }

  async statFile(host: HostRecord, inputPath: string): Promise<RemoteFileMetadata> {
    const path = filePathForHost(host, inputPath);
    const client = await this.registry.getHostClient(host);
    const metadata = await this.getFileMetadata(client, path);
    const response = await client.request(
      "fs/readFile",
      { path },
      FILE_RPC_TIMEOUT_MS,
      parseFsReadFileResponse,
    );
    return {
      path,
      size: Buffer.from(response.dataBase64, "base64").byteLength,
      modifiedAt: metadata.modifiedAtMs,
    };
  }

  async writeFile(host: HostRecord, inputPath: string, content: Buffer) {
    const path = filePathForHost(host, inputPath);
    const client = await this.registry.getHostClient(host);
    await client.request(
      "fs/writeFile",
      { path, dataBase64: content.toString("base64") },
      FILE_RPC_TIMEOUT_MS,
      parseFsWriteFileResponse,
    );
    const metadata = await this.getFileMetadata(client, path);
    return { path, size: content.byteLength, modifiedAt: metadata.modifiedAtMs };
  }

  async removeFile(host: HostRecord, inputPath: string) {
    const path = filePathForHost(host, inputPath);
    const client = await this.registry.getHostClient(host);
    await this.getFileMetadata(client, path);
    await client.request(
      "fs/remove",
      { path, recursive: false, force: false },
      FILE_RPC_TIMEOUT_MS,
      parseFsRemoveResponse,
    );
  }

  async search(
    host: HostRecord,
    rootPath: string,
    query: string,
    cancellationToken: string,
  ): Promise<ProjectFileSearchResult> {
    if (query.trim() === "") return { files: [] };
    const userId = requiredUserId();
    const client = await this.registry.getHostClient(host);
    const response = await client.request(
      "fuzzyFileSearch",
      {
        query,
        roots: [rootPath],
        // Cancellation tokens are connection-wide. Prefix browser tokens so two users or projects
        // cannot cancel each other's search while sharing the same Gateway process.
        cancellationToken: `gateway:${userId}:${host.id}:${rootPath}:${cancellationToken}`,
      },
      FILE_RPC_TIMEOUT_MS,
      parseFuzzyFileSearchResponse,
    );
    return {
      files: response.files.flatMap((file) => {
        if (file.match_type !== "file" || file.root !== rootPath) return [];
        const path = normalizeReferencePath(file.path);
        return [{ type: "file" as const, path, name: file.file_name }];
      }),
    };
  }

  async watch(
    host: HostRecord,
    rootPath: string,
    listener: AppServerFileWatchListener,
  ): Promise<FileWatchLease> {
    const key = watchKey(requiredUserId(), host.id, rootPath);
    let record = this.watches.get(key);
    if (record === undefined) {
      const token = {};
      record = { token, pending: this.createWatch(key, token, host, rootPath) };
      this.watches.set(key, record);
    }
    let watch: ActiveFileWatch;
    try {
      watch = await record.pending;
    } catch (error) {
      if (this.watches.get(key)?.token === record.token) this.watches.delete(key);
      throw error;
    }
    watch.listeners.add(listener);
    let released = false;
    return {
      rootPath,
      release: () => {
        if (released) return;
        released = true;
        watch.listeners.delete(listener);
        if (watch.listeners.size === 0) this.disposeWatch(key, watch, true);
      },
    };
  }

  private async createWatch(key: string, token: object, host: HostRecord, requestedPath: string) {
    const client = await this.registry.getHostClient(host);
    const watchId = randomUUID();
    const listeners = new Set<AppServerFileWatchListener>();
    const watch: ActiveFileWatch = {
      token,
      client,
      watchId,
      requestedPath,
      canonicalPath: requestedPath,
      listeners,
      removeNotificationListener: () => {},
      removeCloseListener: () => {},
      pendingPaths: new Set(),
      flushTimer: null,
    };
    watch.removeNotificationListener = client.on(
      "notification",
      bindGatewayUser((message: RpcEnvelope) => this.handleNotification(watch, message)),
    );
    watch.removeCloseListener = client.on(
      "close",
      bindGatewayUser(() => {
        this.disposeWatch(key, watch, false);
        for (const subscriber of listeners) subscriber({ type: "closed" });
      }),
    );
    try {
      const response = await client.request(
        "fs/watch",
        { path: requestedPath, watchId },
        FILE_RPC_TIMEOUT_MS,
        parseFsWatchResponse,
      );
      watch.canonicalPath = response.path;
      return watch;
    } catch (error) {
      watch.removeNotificationListener();
      watch.removeCloseListener();
      throw error;
    }
  }

  private async getFileMetadata(client: CodexRpcClient, path: string) {
    const metadata = await client.request(
      "fs/getMetadata",
      { path },
      FILE_RPC_TIMEOUT_MS,
      parseFsGetMetadataResponse,
    );
    if (!metadata.isFile) throw new RemoteFileNotRegularError(path);
    return metadata;
  }

  private handleNotification(watch: ActiveFileWatch, message: RpcEnvelope) {
    if (message.method !== "fs/changed") return;
    const changed = fsChangedNotificationFromUnknown(message.params);
    if (changed === null || changed.watchId !== watch.watchId) return;
    changed.changedPaths.forEach((path) => watch.pendingPaths.add(visibleWatchPath(watch, path)));
    if (watch.flushTimer !== null) return;
    watch.flushTimer = setTimeout(() => {
      watch.flushTimer = null;
      const paths = [...watch.pendingPaths];
      watch.pendingPaths.clear();
      if (paths.length === 0) return;
      for (const listener of watch.listeners) listener({ type: "changed", paths });
    }, FILE_WATCH_COALESCE_MS);
  }

  private disposeWatch(key: string, watch: ActiveFileWatch, notifyServer: boolean) {
    if (this.watches.get(key)?.token === watch.token) this.watches.delete(key);
    watch.removeNotificationListener();
    watch.removeCloseListener();
    if (watch.flushTimer !== null) clearTimeout(watch.flushTimer);
    watch.flushTimer = null;
    watch.pendingPaths.clear();
    if (notifyServer) {
      void watch.client.request("fs/unwatch", { watchId: watch.watchId }).catch(() => {
        // A closing App Server already discarded connection-scoped watches.
      });
    }
  }
}

function filePathForHost(host: HostRecord, inputPath: string) {
  const trimmed = inputPath.trim();
  if (!trimmed.startsWith("/")) throw new RemoteFileInvalidPathError(trimmed);
  if (!isManagedRuntimeHost(host)) return trimmed;
  const path = resolveManagedWorkspaceBrowsePath(trimmed);
  if (!isInsideManagedWorkspace(path) || path === "/workspace") {
    throw createError({
      statusCode: 400,
      statusMessage: "Managed workspace files must stay under /workspace",
      data: { code: "invalidManagedWorkspaceFilePath" },
    });
  }
  return path;
}

function watchKey(userId: number, hostId: number, path: string) {
  return `${userId}:${hostId}:${path}`;
}

function requiredUserId() {
  const userId = currentGatewayUserId();
  if (userId === null) throw new Error("App Server file operations require an authenticated user");
  return userId;
}

function directoryEntryType(entry: { isDirectory: boolean; isFile: boolean }) {
  if (entry.isDirectory) return "directory" as const;
  if (entry.isFile) return "file" as const;
  return "other" as const;
}

function visibleWatchPath(watch: ActiveFileWatch, path: string) {
  if (watch.canonicalPath === watch.requestedPath) return path;
  if (path === watch.canonicalPath) return watch.requestedPath;
  const prefix = `${watch.canonicalPath.replace(/\/+$/u, "")}/`;
  return path.startsWith(prefix)
    ? `${watch.requestedPath.replace(/\/+$/u, "")}/${path.slice(prefix.length)}`
    : path;
}
