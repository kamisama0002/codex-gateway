export function fileWorkspaceScopeKey(hostId: number, threadId: string) {
  return `${hostId}:${threadId}`;
}

/**
 * Files can be opened from a selected project before the first conversation exists. Keep that
 * editor state in a project-local scope instead of inventing a Codex thread.
 */
export function fileWorkspaceThreadId(
  hostId: number,
  projectId: number | null,
  threadId: string | null,
) {
  if (threadId !== null) return threadId;
  return projectId === null ? null : `workspace-project:${hostId}:${projectId}`;
}

export function fileDocumentKey(hostId: number, threadId: string, path: string) {
  return `${fileWorkspaceScopeKey(hostId, threadId)}:${path}`;
}

export function directoryStateKey(hostId: number, threadId: string, path: string) {
  return `${fileWorkspaceScopeKey(hostId, threadId)}:${path}`;
}

export function fileName(path: string) {
  return (
    path
      .split("/")
      .filter((part) => part !== "")
      .pop() ?? path
  );
}

export function parentPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  return normalized.slice(0, normalized.lastIndexOf("/")) || "/";
}

export function parentPaths(path: string) {
  const result: string[] = [];
  let current = parentPath(path);
  while (current !== "" && current !== "/") {
    result.push(current);
    current = parentPath(current);
  }
  result.push("/");
  return result;
}

export function isPathWithinRoot(rootPath: string, path: string) {
  const root = normalizeRemotePath(rootPath);
  const candidate = normalizeRemotePath(path);
  return root === "/" ? candidate.startsWith("/") : candidate.startsWith(`${root}/`);
}

export function directoryPathsToFile(rootPath: string, filePath: string) {
  if (!isPathWithinRoot(rootPath, filePath)) {
    return [];
  }
  return parentPaths(filePath)
    .reverse()
    .filter((path) => path === normalizeRemotePath(rootPath) || isPathWithinRoot(rootPath, path));
}

export function absolutePath(rootPath: string, path: string) {
  return path.startsWith("/") ? path : `${rootPath.replace(/\/$/, "")}/${path}`;
}

export function withoutPathAndDescendants(paths: string[], removedPath: string) {
  return paths.filter(
    (path) => path !== removedPath && !path.startsWith(`${removedPath.replace(/\/$/, "")}/`),
  );
}

function normalizeRemotePath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  return normalized === "" ? "/" : normalized;
}
