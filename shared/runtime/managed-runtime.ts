export const MANAGED_RUNTIME_HOST_ID = 2_000_000_000;
export const MANAGED_RUNTIME_PROJECT_ID = 2_000_000_001;
export const MANAGED_WORKSPACE_PATH = "/workspace";

export function isManagedRuntimeHostId(hostId: number): boolean {
  return hostId === MANAGED_RUNTIME_HOST_ID;
}

export function isManagedRuntimeProjectId(projectId: number): boolean {
  return projectId === MANAGED_RUNTIME_PROJECT_ID;
}

export function isManagedWorkspaceRootProject(project: {
  hostId: number;
  remotePath: string;
}): boolean {
  return (
    isManagedRuntimeHostId(project.hostId) &&
    normalizeRemotePath(project.remotePath) === MANAGED_WORKSPACE_PATH
  );
}

export function workspaceFolderLabel(project: {
  hostId: number;
  name: string;
  remotePath: string;
}): string {
  if (!isManagedRuntimeHostId(project.hostId)) return project.name;
  const path = normalizeRemotePath(project.remotePath);
  if (path === MANAGED_WORKSPACE_PATH) return project.name;
  const prefix = `${MANAGED_WORKSPACE_PATH}/`;
  if (path.startsWith(prefix)) {
    const base = path.slice(prefix.length).split("/").filter(Boolean).at(-1);
    return base === undefined || base.length === 0 ? project.name : base;
  }
  const stripped = project.name.replace(/^workspace\//, "");
  return stripped.length === 0 ? project.name : stripped;
}

export function normalizeRemotePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function resolveManagedWorkspaceBrowsePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "" || trimmed === "~" || trimmed === "~/") return MANAGED_WORKSPACE_PATH;
  if (trimmed.startsWith("~/")) {
    return normalizeRemotePath(`${MANAGED_WORKSPACE_PATH}/${trimmed.slice(2)}`);
  }
  if (trimmed.startsWith("/")) return normalizeRemotePath(trimmed);
  return normalizeRemotePath(`${MANAGED_WORKSPACE_PATH}/${trimmed}`);
}

export function isInsideManagedWorkspace(path: string): boolean {
  const normalized = normalizeRemotePath(path);
  return (
    normalized === MANAGED_WORKSPACE_PATH || normalized.startsWith(`${MANAGED_WORKSPACE_PATH}/`)
  );
}

export function requireManagedWorkspaceSubpath(path: string): string {
  const normalized = resolveManagedWorkspaceBrowsePath(path);
  if (!isInsideManagedWorkspace(normalized) || normalized === MANAGED_WORKSPACE_PATH) {
    throw new Error("Managed workspace folders must be a subdirectory of /workspace");
  }
  return normalized;
}

export function managedWorkspaceFolderFromName(name: string): string {
  const slug = name
    .trim()
    .replaceAll(/[/\\]+/g, "-")
    .replaceAll(/^\.+|\.+$/g, "");
  if (slug.length === 0) return MANAGED_WORKSPACE_PATH;
  return requireManagedWorkspaceSubpath(`${MANAGED_WORKSPACE_PATH}/${slug}`);
}

export function isManagedRuntimeHost(host: {
  id?: number;
  connectionKind?: string | null;
}): boolean {
  return host.id === MANAGED_RUNTIME_HOST_ID || (host.connectionKind ?? "ssh") === "managed";
}
