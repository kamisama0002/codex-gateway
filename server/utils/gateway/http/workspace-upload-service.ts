import pLimit from "p-limit";
import { createError } from "h3";
import type { WorkspaceUploadResult } from "~~/shared/types";
import type { ParsedUploadFile } from "./multipart-uploads";
import {
  normalizeWorkspaceUploadPath,
  workspaceUploadRemotePath,
} from "./validation/workspace-uploads";

interface WorkspaceUploadHost {
  id: number;
}

interface WorkspaceUploadProject {
  id: number;
  hostId: number;
  remotePath: string;
}

interface WorkspaceUploadRemoteFiles<THost> {
  existingPaths(host: THost, remotePaths: string[]): Promise<string[]>;
  uploadFile(host: THost, localPath: string, remotePath: string): Promise<unknown>;
}

export async function uploadWorkspaceFiles<THost extends WorkspaceUploadHost>(input: {
  host: THost;
  project: WorkspaceUploadProject;
  parts: ParsedUploadFile[];
  overwrite: boolean;
  remoteFiles: WorkspaceUploadRemoteFiles<THost>;
}): Promise<WorkspaceUploadResult> {
  if (input.project.hostId !== input.host.id) {
    throw createError({ statusCode: 400, statusMessage: "Project does not belong to host" });
  }
  const destinations = input.parts.map((part) => {
    const relativePath = normalizeWorkspaceUploadPath(part.relativePath);
    return {
      part,
      relativePath,
      remotePath: workspaceUploadRemotePath(input.project.remotePath, relativePath),
    };
  });
  if (new Set(destinations.map(({ remotePath }) => remotePath)).size !== destinations.length) {
    throw createError({ statusCode: 400, statusMessage: "Upload contains duplicate paths" });
  }
  if (!input.overwrite) {
    const existing = new Set(
      await input.remoteFiles.existingPaths(
        input.host,
        destinations.map(({ remotePath }) => remotePath),
      ),
    );
    const conflicts = destinations
      .filter(({ remotePath }) => existing.has(remotePath))
      .map(({ relativePath }) => relativePath);
    if (conflicts.length > 0) return { status: "conflict", conflicts };
  }

  const upload = pLimit(4);
  await Promise.all(
    destinations.map(({ part, remotePath }) =>
      upload(() => input.remoteFiles.uploadFile(input.host, part.localPath, remotePath)),
    ),
  );
  return {
    status: "uploaded",
    files: destinations.map(({ part, relativePath, remotePath }) => ({
      name: part.originalName,
      relativePath,
      path: remotePath,
      mimeType: part.mimeType,
      size: part.size,
    })),
  };
}
