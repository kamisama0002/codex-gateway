import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getValidatedQuery } from "h3";
import type { WorkspaceUploadResult } from "~~/shared/types";
import { remoteFiles } from "../../utils/gateway/infra/host-services";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { streamMultipartUploads } from "../../utils/gateway/http/multipart-uploads";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { workspaceUploadQuerySchema } from "../../utils/gateway/http/validation/workspace-uploads";
import { uploadWorkspaceFiles } from "../../utils/gateway/http/workspace-upload-service";
import { requireWorkspaceHost } from "../../utils/gateway/runtime-manager/local-workspace";
import { projectStore } from "../../utils/gateway/state/projects";

const MAX_WORKSPACE_UPLOAD_FILES = 200;
const MAX_WORKSPACE_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
const MAX_WORKSPACE_UPLOAD_TOTAL_BYTES = 200 * 1024 * 1024;

export default defineGatewayEventHandler(async (event): Promise<WorkspaceUploadResult> => {
  const query = await getValidatedQuery(event, (value) => workspaceUploadQuerySchema.parse(value));
  const host = await requireWorkspaceHost(query.hostId);
  const project = requireRecord(projectStore.get(query.projectId), "Project not found");
  const tempDir = await mkdtemp(join(tmpdir(), "codex-gateway-workspace-upload-"));
  try {
    const parts = await streamMultipartUploads(event, tempDir, {
      maxFiles: MAX_WORKSPACE_UPLOAD_FILES,
      maxFileBytes: MAX_WORKSPACE_UPLOAD_FILE_BYTES,
      maxTotalBytes: MAX_WORKSPACE_UPLOAD_TOTAL_BYTES,
      preserveRelativePaths: true,
    });
    return await uploadWorkspaceFiles({
      host,
      project,
      parts,
      overwrite: query.overwrite,
      remoteFiles,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
