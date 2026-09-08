import { getValidatedQuery } from "h3";
import { isManagedRuntimeHost } from "~~/shared/runtime/managed-runtime";
import {
  defineGatewayEventHandler,
  hostLogContext,
  setGatewayRequestLogContext,
} from "../../utils/gateway/http/errors";
import { remoteFileSchema } from "../../utils/gateway/http/validation/remote";
import { remoteFiles } from "../../utils/gateway/infra/host-services";
import { requireWorkspaceHost } from "../../utils/gateway/runtime-manager/local-workspace";
import { threadBroker } from "../../utils/gateway/runtime/broker";

export default defineGatewayEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (body) => remoteFileSchema.parse(body));
  const host = await requireWorkspaceHost(query.hostId);
  setGatewayRequestLogContext(event, "remote/files.delete", {
    ...hostLogContext(host),
    path: query.path,
  });

  if (isManagedRuntimeHost(host)) {
    await threadBroker.removeFile(host, query.path);
  } else {
    await remoteFiles.deleteFile(host, query.path);
  }
  return { deleted: true as const };
});
