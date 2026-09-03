import { createError, getValidatedQuery } from "h3";
import { remoteFiles } from "../../utils/gateway/infra/host-services";
import { RemoteDirectoryNotFoundError } from "../../utils/gateway/infra/files/remote-file-errors";
import {
  defineGatewayEventHandler,
  hostLogContext,
  setGatewayRequestLogContext,
} from "../../utils/gateway/http/errors";
import { remoteDirectoryListSchema } from "../../utils/gateway/http/validation/remote";
import { requireWorkspaceHost } from "../../utils/gateway/runtime-manager/local-workspace";
import { threadBroker } from "../../utils/gateway/runtime/broker";
import {
  isInsideManagedWorkspace,
  isManagedRuntimeHost,
  resolveManagedWorkspaceBrowsePath,
} from "~~/shared/runtime/managed-runtime";

export default defineGatewayEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (body) => remoteDirectoryListSchema.parse(body));
  const host = await requireWorkspaceHost(query.hostId);
  setGatewayRequestLogContext(event, "remote/directories", {
    ...hostLogContext(host),
    path: query.path,
  });

  if (!isManagedRuntimeHost(host)) {
    return remoteFiles.listDirectories(host, query.path);
  }

  const path = resolveManagedWorkspaceBrowsePath(query.path);
  if (!isInsideManagedWorkspace(path)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Managed workspace folders must stay under /workspace",
    });
  }
  try {
    return await threadBroker.listDirectories(host, path);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|no such file|not a directory/i.test(message)) {
      throw new RemoteDirectoryNotFoundError(query.path, path, { cause: error });
    }
    throw error;
  }
});
