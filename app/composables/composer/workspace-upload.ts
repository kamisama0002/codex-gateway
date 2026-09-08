export type WorkspaceUploadSelection = "files" | "folder";
export type WorkspaceUploadLimitViolation = "count" | "fileSize" | "totalSize";

export const MAX_WORKSPACE_UPLOAD_FILES = 200;
export const MAX_WORKSPACE_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_WORKSPACE_UPLOAD_TOTAL_BYTES = 200 * 1024 * 1024;

export function buildWorkspaceUploadFormData(files: File[], selection: WorkspaceUploadSelection) {
  const form = new FormData();
  for (const file of files) {
    const relativePath =
      selection === "folder" && file.webkitRelativePath !== ""
        ? file.webkitRelativePath
        : file.name;
    form.append("files", file, relativePath);
  }
  return form;
}

export function workspaceUploadLimitViolation(files: File[]): WorkspaceUploadLimitViolation | null {
  if (files.length > MAX_WORKSPACE_UPLOAD_FILES) return "count";
  if (files.some((file) => file.size > MAX_WORKSPACE_UPLOAD_FILE_BYTES)) return "fileSize";
  if (files.reduce((total, file) => total + file.size, 0) > MAX_WORKSPACE_UPLOAD_TOTAL_BYTES) {
    return "totalSize";
  }
  return null;
}
